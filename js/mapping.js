import { state, save, uid, sample } from './store.js';
import { chatJson } from './llm.js';
import { attack, tech, validate, parentOf, promptCatalog } from './attack.js';
import { esc, $, readFiles, run } from './ui.js';

const SYSTEM = (stages, scenarios) => `Tu es un ingénieur detection engineering. Pour chaque règle de détection (Sigma, KQL, SPL, EDR, ou simple documentation), tu identifies les techniques ATT&CK Enterprise qu'elle détecte réellement (pas celles simplement liées au contexte).
Réponds en JSON : {"results":[{"i":0,"techniques":["T1059.001"],"scenarios":[{"s":"S1","why":"une phrase"}],"stage":"","confidence":"high|medium|low","note":""}]}
- i = index de la règle fourni en entrée ; techniques = IDs existants, préférer la sous-technique quand la logique la cible précisément.
- stage = une valeur parmi : ${stages.join(' | ')}
- scenarios = scénarios ci-dessous (S1, S2…) dont la règle détecte réellement une étape ; sois sélectif, [] si aucun. why = une phrase qui dit quelle étape du scénario la règle détecte.
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

/** Techniques de la règle qui recoupent celles du scénario (comparaison au niveau technique parente). */
export const common = (r, s) => {
  const p = new Set(s.techniques.map(parentOf));
  return [...new Set(r.techniques.filter(t => p.has(parentOf(t))))];
};
/** 'ok' lié et cohérent · 'suspect' lié sans technique commune · 'miss' non lié mais technique commune · '' sinon. */
export const linkState = (r, s) => {
  const c = common(r, s).length;
  return r.scenarios.includes(s.id) ? (c ? 'ok' : 'suspect') : (c ? 'miss' : '');
};
const flags = r => {
  const st = state.scenarios.map(s => linkState(r, s)), n = r.scenarios.length;
  return { todo: !r.reviewed, suspect: st.includes('suspect'), miss: st.includes('miss'), none: !n, wide: n >= 4 && n > state.scenarios.length / 2, low: r.confidence === 'low' };
};
const FILTERS = { all: 'Toutes', todo: 'À relire', suspect: 'Suspects', miss: 'Oublis possibles', none: 'Sans scénario', wide: 'Trop larges', low: 'Confiance basse' };
const SYM = { ok: '●', suspect: '⚠', miss: '◌', '': '·' };
const view = { q: '', f: 'all', hl: '', sel: null }; // état d'affichage conservé tant que la page est ouverte
const scId = (ref, sc) => sc[+String(ref).replace(/\D/g, '') - 1]?.id;

export function render(root) {
  root.innerHTML = `
  <details id="imp" ${state.rules.length ? '' : 'open'}><summary><b>Importer des règles</b></summary>
    <textarea id="paste" placeholder="Coller des règles ou de la documentation. Séparer plusieurs règles par une ligne --- (YAML Sigma multi-documents OK)."></textarea>
    <div class="bar"><button id="demo">Charger les règles d'exemple</button><button id="addp">Ajouter le texte collé</button>
      <label style="margin:0">Ou fichiers <input id="files" type="file" multiple style="width:auto" accept=".yml,.yaml,.json,.txt,.md,.kql,.spl,.csv"></label>
      <span class="mut">Un fichier = une ou plusieurs règles (séparateur ---) ; un .json contenant un tableau = une règle par élément.</span></div>
  </details>
  <div class="bar"><button id="map" class="pri">Mapper les règles non traitées</button><button id="remap">Tout remapper</button><span id="st"></span></div>
  <h2>Revue du mapping (<span id="n"></span>)</h2>
  <div class="mtools"><input id="q" type="search" placeholder="Chercher règle ou technique" aria-label="Chercher"><span id="flt"></span><span id="prog" class="mut"></span></div>
  <p class="mut" style="margin:.2rem 0 .6rem"><b>●</b> lié, techniques en commun · <b class="err">⚠</b> lié sans technique commune (à challenger) · <b style="color:var(--amber)">◌</b> non lié mais technique en commun (oubli possible) · clic sur une cellule = lier / délier · clic sur une ligne = détail</p>
  <div class="mwrap"><table class="rm"><thead id="head"></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table></div>
  <aside id="detail" aria-live="polite"></aside><datalist id="techlist">${attack.techniques.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</datalist>`;

  const sc = () => state.scenarios, rule = id => state.rules.find(r => r.id === id);
  const chips = (ids, rm) => ids.map(t => `<span class="tag" title="${esc(tech(t)?.name || '')}">${t}${rm ? `<button class="rmt" data-rmt="${t}" aria-label="Retirer ${t}">×</button>` : ''}</span>`).join('');

  function draw() {
    const q = view.q.trim().toLowerCase(), S = sc();
    $(root, '#n').textContent = state.rules.length;
    $(root, '#prog').textContent = `${state.rules.filter(r => r.reviewed).length}/${state.rules.length} validées`;
    $(root, '#flt').innerHTML = Object.entries(FILTERS).map(([f, l]) => `<button class="lg flt ${view.f === f ? 'on' : ''}" data-f="${f}">${l} ${f === 'all' ? state.rules.length : state.rules.filter(r => flags(r)[f]).length}</button>`).join('');
    $(root, '#head').innerHTML = `<tr><th></th><th>Règle</th><th>Techniques</th>${S.map((s, k) => `<th class="sc ${view.hl === s.id ? 'hl' : ''}" data-hl="${s.id}" title="${esc(s.name)} (${esc(s.priority)}) : trier par ce scénario"><span class="tag sref">S${k + 1}</span></th>`).join('')}</tr>`;
    const list = state.rules.filter(r => (view.f === 'all' || flags(r)[view.f])
      && (!q || (r.name + ' ' + r.source + ' ' + r.techniques.map(t => t + ' ' + (tech(t)?.name || '')).join(' ')).toLowerCase().includes(q)));
    if (view.hl) list.sort((a, b) => b.scenarios.includes(view.hl) - a.scenarios.includes(view.hl));
    $(root, '#rows').innerHTML = list.map(r => `<tr data-id="${r.id}" class="${view.sel === r.id ? 'sel' : ''}">
      <td><input type="checkbox" data-rev ${r.reviewed ? 'checked' : ''} aria-label="Règle validée"></td>
      <td><b>${esc(r.name)}</b><div class="mut">${esc(r.source)}${r.confidence ? ' · ' + esc(r.confidence) : ''}${r.stage ? ' · ' + esc(r.stage) : ''}</div></td>
      <td>${chips(r.techniques)}${r.rejected?.length ? `<div class="err">rejetés : ${esc(r.rejected.join(', '))}</div>` : ''}</td>
      ${S.map(s => { const k = linkState(r, s); return `<td class="lk ${k} ${view.hl === s.id ? 'hl' : ''}"><button data-s="${s.id}" aria-pressed="${r.scenarios.includes(s.id)}" title="${esc(s.name)}">${SYM[k] || (r.scenarios.includes(s.id) ? '●' : '·')}</button></td>`; }).join('')}</tr>`).join('')
      || `<tr><td colspan="${3 + S.length}" class="mut">${state.rules.length ? 'Aucune règle ne correspond à ces filtres.' : 'Aucune règle : importe-en ci-dessus.'}</td></tr>`;
    const linked = s => state.rules.filter(r => r.scenarios.includes(s.id));
    const open = s => { const ls = linked(s); return s.techniques.filter(t => !ls.some(r => r.techniques.some(x => parentOf(x) === parentOf(t)))).length; };
    $(root, '#foot').innerHTML = S.length ? `<tr><td colspan="3">Règles liées</td>${S.map(s => `<td class="${linked(s).length ? '' : 'zero'}">${linked(s).length}</td>`).join('')}</tr>
      <tr><td colspan="3">Techniques sans règle liée</td>${S.map(s => `<td title="${open(s)} sur ${s.techniques.length}">${open(s)}/${s.techniques.length}</td>`).join('')}</tr>` : '';
    if ($(root, '#detail').classList.contains('open')) detail();
  }

  function detail() {
    const r = rule(view.sel), d = $(root, '#detail');
    if (!r) { d.classList.remove('open'); return; }
    const S = sc(), idx = s => S.indexOf(s) + 1;
    const lnk = S.filter(s => r.scenarios.includes(s.id)), miss = S.filter(s => linkState(r, s) === 'miss');
    d.innerHTML = `<button class="x" aria-label="Fermer">×</button><h3>${esc(r.name)}</h3>
      <p class="mut">${esc(r.source)} · <label style="display:inline;margin:0"><input type="checkbox" data-d="rev" ${r.reviewed ? 'checked' : ''} style="width:auto"> Validée</label></p>
      <h4>Règle</h4><pre>${esc(r.body)}</pre>
      ${r.note ? `<h4>Note du LLM</h4><p>${esc(r.note)}</p>` : ''}
      <h4>Scénarios liés (${lnk.length})</h4>${lnk.map(s => `<div class="item"><span class="tag sref">S${idx(s)}</span> <b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span>
        ${linkState(r, s) === 'suspect' ? '<span class="tag gap">⚠ aucune technique commune</span>' : ''}
        <div class="mut">${esc(r.why?.[s.id] || 'Pas de justification (remapper pour en obtenir une).')}</div>
        <div>${chips(common(r, s))}</div><button data-unlink="${s.id}">Délier</button></div>`).join('') || '<p class="mut">Aucun scénario lié.</p>'}
      <h4>Oublis possibles (${miss.length})</h4>${miss.map(s => `<div class="item"><span class="tag sref">S${idx(s)}</span> ${esc(s.name)}<div>${chips(common(r, s))}</div><button data-link="${s.id}">Lier</button></div>`).join('') || '<p class="mut">Aucun.</p>'}
      <h4>Techniques</h4><div>${chips(r.techniques, true) || '<span class="mut">Aucune.</span>'}</div>
      <div class="bar"><input id="addt" list="techlist" placeholder="T1059.001" style="width:9rem"><button data-addt>Ajouter</button></div>${r.rejected?.length ? `<p class="err">ID inconnu : ${esc(r.rejected.join(', '))}</p>` : ''}
      <h4>Qualification</h4><div class="row"><div><label>Confiance</label><select data-d="confidence">${['', 'high', 'medium', 'low'].map(x => `<option ${x === r.confidence ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div><label>Étape</label><select data-d="stage"><option></option>${state.settings.stages.map(x => `<option ${x === r.stage ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>
      <div class="bar"><button data-d="del">Supprimer la règle</button></div>`;
    d.classList.add('open');
  }
  const link = (r, sid, on) => { r.scenarios = on ? [...new Set([...r.scenarios, sid])] : r.scenarios.filter(x => x !== sid); if (!on && r.why) delete r.why[sid]; };

  $(root, '#q').value = view.q;
  $(root, '#q').oninput = e => { view.q = e.target.value; draw(); };
  $(root, '#flt').onclick = e => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { view.f = f; draw(); } };
  $(root, '#head').onclick = e => { const h = e.target.closest('[data-hl]')?.dataset.hl; if (h) { view.hl = view.hl === h ? '' : h; draw(); } };
  $(root, '#rows').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const r = rule(tr.dataset.id), b = e.target.closest('button[data-s]');
    if (e.target.closest('input')) return;
    if (b) { link(r, b.dataset.s, !r.scenarios.includes(b.dataset.s)); save(); draw(); return; }
    view.sel = r.id; draw(); detail();
  };
  $(root, '#rows').onchange = e => { if (e.target.matches('[data-rev]')) { rule(e.target.closest('tr').dataset.id).reviewed = e.target.checked; save(); draw(); } };
  const dt = $(root, '#detail');
  dt.onclick = e => {
    const r = rule(view.sel), t = e.target;
    if (t.classList.contains('x')) return dt.classList.remove('open');
    if (!r) return;
    if (t.dataset.unlink) link(r, t.dataset.unlink, false);
    else if (t.dataset.link) link(r, t.dataset.link, true);
    else if (t.dataset.rmt) r.techniques = r.techniques.filter(x => x !== t.dataset.rmt);
    else if (t.dataset.addt !== undefined) {
      const v = validate($(dt, '#addt').value.split(/[,\s]+/).filter(Boolean));
      r.techniques = [...new Set([...r.techniques, ...v.ok])]; r.mapped = true; r.rejected = v.rejected;
    } else if (t.dataset.d === 'del') { if (!confirm('Supprimer cette règle ?')) return; state.rules = state.rules.filter(x => x !== r); view.sel = null; dt.classList.remove('open'); }
    else return;
    save(); draw();
  };
  dt.onchange = e => {
    const r = rule(view.sel), k = e.target.dataset.d; if (!r || !k || k === 'del') return;
    if (k === 'rev') r.reviewed = e.target.checked; else r[k] = e.target.value;
    save(); draw();
  };
  root.onkeydown = e => { if (e.key === 'Escape') dt.classList.remove('open'); };

  $(root, '#demo').onclick = async () => { state.rules.push(...splitRules('exemple.yml', await sample('rules.yml'))); save(); draw(); };
  $(root, '#addp').onclick = () => { const t = $(root, '#paste'); state.rules.push(...splitRules('collé', t.value)); t.value = ''; save(); draw(); };
  $(root, '#files').onchange = async e => {
    for (const f of await readFiles(e.target.files)) state.rules.push(...(f.name.endsWith('.json') ? fromJson(f.name, f.text) : splitRules(f.name, f.text)));
    e.target.value = ''; save(); draw();
  };
  const go = all => run($(root, '#st'), async (signal, say) => {
    const todo = state.rules.filter(r => all || !r.mapped), n = +state.settings.batch || 8;
    if (!todo.length) throw new Error('Rien à mapper.');
    const S = sc(), system = SYSTEM(state.settings.stages, S);
    for (let i = 0; i < todo.length; i += n) {
      say(`Lot ${i / n + 1}/${Math.ceil(todo.length / n)}…`);
      const batch = todo.slice(i, i + n);
      const user = batch.map((r, k) => `### i=${k} (${r.name})\n${r.body.slice(0, 3000)}`).join('\n\n');
      const res = (await chatJson({ system, user, signal }));
      for (const x of res.results || res) {
        const r = batch[x.i]; if (!r) continue;
        const v = validate(x.techniques), links = (x.scenarios || []).map(e => typeof e === 'string' ? { s: e } : e)
          .map(l => ({ id: scId(l.s, S), why: l.why })).filter(l => l.id); // ancien format (liste d'IDs) accepté
        Object.assign(r, { techniques: v.ok, rejected: v.rejected, stage: x.stage || '', confidence: x.confidence || 'medium', note: x.note || '', mapped: true, reviewed: false,
          scenarios: links.map(l => l.id), why: Object.fromEntries(links.filter(l => l.why).map(l => [l.id, l.why])) });
      }
      save(); draw();
    }
  });
  $(root, '#map').onclick = () => go(false);
  $(root, '#remap').onclick = () => go(true);
  draw();
}
