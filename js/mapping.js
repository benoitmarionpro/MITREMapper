import { state, save, uid } from './store.js';
import { chatJson } from './llm.js';
import { validate, promptCatalog } from './attack.js';
import { esc, $, readFiles, run } from './ui.js';

const SYSTEM = (stages, scenarios) => `Tu es un ingénieur detection engineering. Pour chaque règle de détection (Sigma, KQL, SPL, EDR, ou simple documentation), tu identifies les techniques ATT&CK Enterprise qu'elle détecte réellement (pas celles simplement liées au contexte).
Réponds en JSON : {"results":[{"i":0,"techniques":["T1059.001"],"scenarios":["S1"],"stage":"","confidence":"high|medium|low","note":""}]}
- i = index de la règle fourni en entrée ; techniques = IDs existants, préférer la sous-technique quand la logique la cible précisément.
- stage = une valeur parmi : ${stages.join(' | ')}
- scenarios = identifiants (S1, S2…) des scénarios ci-dessous que la règle aide à détecter ; [] si aucun.
- confidence : high = détection directe et robuste ; medium = partielle/contournable ; low = indirecte ou très bruitée.
Scénarios :\n${scenarios.map((s, k) => `S${k + 1} ${s.name} [${s.techniques.join(',')}]`).join('\n') || '(aucun)'}
Techniques parentes de référence :\n${promptCatalog()}`;

/** Découpe un texte collé en règles (séparateur : ligne '---' ou '==='). */
const splitRules = (name, text) => text.split(/^\s*(?:---|===)\s*$/m).map(t => t.trim()).filter(Boolean).map(body => ({
  id: uid(), source: name, body, name: (body.match(/^title:\s*(.+)$/mi) || body.match(/^(.{1,80})/))[1].trim(),
  techniques: [], scenarios: [], stage: '', confidence: '', mapped: false,
}));
function fromJson(name, text) {
  try {
    const d = JSON.parse(text);
    if (Array.isArray(d)) return d.map(o => ({ ...splitRules(name, JSON.stringify(o, null, 1))[0], name: String(o.name || o.title || o.rule_name || o.id || 'règle') }));
  } catch {}
  return splitRules(name, text);
}

export function render(root) {
  root.innerHTML = `
  <h2>Importer des règles</h2>
  <textarea id="paste" placeholder="Coller des règles ou de la documentation. Séparer plusieurs règles par une ligne --- (YAML Sigma multi-documents OK)."></textarea>
  <div class="bar"><button id="addp">Ajouter le texte collé</button>
    <label style="margin:0">Ou fichiers <input id="files" type="file" multiple style="width:auto" accept=".yml,.yaml,.json,.txt,.md,.kql,.spl,.csv"></label>
    <span class="mut">Un fichier = une ou plusieurs règles (séparateur ---) ; un .json contenant un tableau = une règle par élément.</span></div>
  <div class="bar"><button id="map" class="pri">Mapper les règles non traitées</button><button id="remap">Tout remapper</button><span id="st"></span></div>
  <h2>Règles (<span id="n"></span>)</h2><div style="overflow-x:auto"><table><thead><tr><th>Règle</th><th>Techniques</th><th>Scénarios</th><th>Étape</th><th>Confiance</th><th>Note</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const rows = $(root, '#rows');
  const draw = () => {
    $(root, '#n').textContent = state.rules.length;
    const stages = state.settings.stages;
    rows.innerHTML = state.rules.map(r => `<tr data-id="${r.id}">
      <td title="${esc(r.body.slice(0, 500))}"><b>${esc(r.name)}</b><div class="mut">${esc(r.source)}</div></td>
      <td><input data-k="techniques" value="${esc(r.techniques.join(', '))}" size="18">${r.rejected?.length ? `<div class="err">rejetés : ${esc(r.rejected.join(', '))}</div>` : ''}</td>
      <td>${state.scenarios.map((s, k) => `<label title="${esc(s.name)}"><input type="checkbox" data-k="sc" value="${s.id}" style="width:auto" ${r.scenarios.includes(s.id) ? 'checked' : ''}>S${k + 1}</label> `).join('')}</td>
      <td><select data-k="stage"><option></option>${stages.map(x => `<option ${x === r.stage ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
      <td><select data-k="confidence">${['', 'high', 'medium', 'low'].map(x => `<option ${x === r.confidence ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td class="mut">${esc(r.note || '')}</td><td><button data-del>×</button></td></tr>`).join('');
  };
  rows.onchange = e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const r = state.rules.find(x => x.id === e.target.closest('tr').dataset.id);
    if (k === 'techniques') { const v = validate(e.target.value.split(/[,\s]+/).filter(Boolean)); r.techniques = v.ok; r.rejected = v.rejected; r.mapped = true; save(); draw(); return; }
    if (k === 'sc') r.scenarios = [...e.target.closest('tr').querySelectorAll('[data-k=sc]:checked')].map(c => c.value);
    else r[k] = e.target.value;
    save();
  };
  rows.onclick = e => { if (e.target.dataset.del !== undefined) { state.rules = state.rules.filter(x => x.id !== e.target.closest('tr').dataset.id); save(); draw(); } };
  $(root, '#addp').onclick = () => { const t = $(root, '#paste'); state.rules.push(...splitRules('collé', t.value)); t.value = ''; save(); draw(); };
  $(root, '#files').onchange = async e => {
    for (const f of await readFiles(e.target.files)) state.rules.push(...(f.name.endsWith('.json') ? fromJson(f.name, f.text) : splitRules(f.name, f.text)));
    e.target.value = ''; save(); draw();
  };
  const go = all => run($(root, '#st'), async (signal, say) => {
    const todo = state.rules.filter(r => all || !r.mapped), n = +state.settings.batch || 8;
    if (!todo.length) throw new Error('Rien à mapper.');
    const sc = state.scenarios, system = SYSTEM(state.settings.stages, sc);
    for (let i = 0; i < todo.length; i += n) {
      say(`Lot ${i / n + 1}/${Math.ceil(todo.length / n)}…`);
      const batch = todo.slice(i, i + n);
      const user = batch.map((r, k) => `### i=${k} (${r.name})\n${r.body.slice(0, 3000)}`).join('\n\n');
      const res = (await chatJson({ system, user, signal }));
      for (const x of res.results || res) {
        const r = batch[x.i]; if (!r) continue;
        const v = validate(x.techniques);
        Object.assign(r, { techniques: v.ok, rejected: v.rejected, stage: x.stage || '', confidence: x.confidence || 'medium', note: x.note || '', mapped: true,
          scenarios: (x.scenarios || []).map(s => sc[+String(s).replace(/\D/g, '') - 1]?.id).filter(Boolean) });
      }
      save(); draw();
    }
  });
  $(root, '#map').onclick = () => go(false);
  $(root, '#remap').onclick = () => go(true);
  draw();
}
