import { state, save, uid } from './store.js';
import { chatJson } from './llm.js';
import { validate, promptCatalog } from './attack.js';
import { esc, $, readFiles, run } from './ui.js';

const SYSTEM = `Tu es un analyste CTI senior. À partir du profil client et des extraits de rapports de menace, tu déduis les scénarios de menace les plus pertinents à couvrir en détection.
Réponds en JSON : {"scenarios":[{"name":"","actors":"","summary":"","techniques":["T1566.001"],"priority":"high|medium|low","rationale":""}]}
Règles : 5 à 15 scénarios, concrets et distincts ; techniques = IDs ATT&CK Enterprise existants (techniques ou sous-techniques), 4 à 12 par scénario, ordonnées selon la kill chain ; priority selon la probabilité et l'impact pour CE client.
Techniques parentes de référence :\n`;

export function render(root) {
  const c = state.client;
  root.innerHTML = `
  <h2>Profil client</h2>
  <div class="row">
    <div><label>Secteur</label><input id="sector"></div><div><label>Taille</label><input id="size"></div>
    <div><label>Pays / zones</label><input id="country"></div><div><label>Actifs / contraintes clés</label><input id="assets"></div>
  </div>
  <h2>Sources CTI (rapports, tendances)</h2>
  <textarea id="cti" placeholder="Coller le texte des rapports de menace…"></textarea>
  <div class="bar"><label style="margin:0">Ajouter des fichiers texte <input id="files" type="file" multiple accept=".txt,.md,.json,.csv,.html" style="width:auto"></label>
    <button id="gen" class="pri">Générer les scénarios</button><label style="margin:0"><input id="repl" type="checkbox" style="width:auto"> remplacer l'existant</label><span id="st"></span></div>
  <h2>Scénarios (<span id="n"></span>)</h2><div id="list"></div><button id="add">+ Scénario manuel</button>`;
  for (const k of Object.keys(c)) { const el = $(root, '#' + k); el.value = c[k]; el.onchange = () => { c[k] = el.value; save(); }; }
  const cti = $(root, '#cti'); cti.value = state.cti; cti.onchange = () => { state.cti = cti.value; save(); };
  $(root, '#files').onchange = async e => {
    cti.value += (cti.value ? '\n\n' : '') + (await readFiles(e.target.files)).map(f => `### ${f.name}\n${f.text}`).join('\n\n');
    cti.onchange();
  };

  const list = $(root, '#list');
  const draw = () => {
    $(root, '#n').textContent = state.scenarios.length;
    list.innerHTML = state.scenarios.map(s => `<div class="card" data-id="${s.id}">
      <div class="row"><div><label>Nom</label><input data-k="name" value="${esc(s.name)}"></div>
      <div><label>Priorité</label><select data-k="priority">${['high', 'medium', 'low'].map(p => `<option ${p === s.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div><label>Techniques (IDs, séparés par des virgules)</label><input data-k="techniques" value="${esc(s.techniques.join(', '))}"></div></div>
      <label>Résumé / justification</label><input data-k="summary" value="${esc(s.summary || '')}">
      <div class="mut">${esc(s.actors || '')} ${s.rejected?.length ? `<span class="err">IDs rejetés : ${esc(s.rejected.join(', '))}</span>` : ''}</div>
      <button data-del>Supprimer</button></div>`).join('');
  };
  list.onchange = e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const s = state.scenarios.find(x => x.id === e.target.closest('.card').dataset.id);
    if (k === 'techniques') { const v = validate(e.target.value.split(/[,\s]+/).filter(Boolean)); s.techniques = v.ok; s.rejected = v.rejected; save(); draw(); }
    else { s[k] = e.target.value; save(); }
  };
  list.onclick = e => {
    if (e.target.dataset.del === undefined) return;
    state.scenarios = state.scenarios.filter(x => x.id !== e.target.closest('.card').dataset.id); save(); draw();
  };
  $(root, '#add').onclick = () => { state.scenarios.push({ id: uid(), name: 'Nouveau scénario', priority: 'medium', techniques: [] }); save(); draw(); };
  $(root, '#gen').onclick = () => run($(root, '#st'), async (signal, say) => {
    if (!state.cti.trim()) throw new Error('Ajoute du contenu CTI.');
    say('Appel LLM…');
    const user = `Profil client : ${JSON.stringify(c)}\n\nSources CTI :\n${state.cti.slice(0, 60000)}`;
    const r = await chatJson({ system: SYSTEM + promptCatalog(), user, signal });
    const out = (r.scenarios || r).map(s => { const v = validate(s.techniques); return { ...s, id: uid(), techniques: v.ok, rejected: v.rejected }; });
    state.scenarios = $(root, '#repl').checked ? out : [...state.scenarios, ...out];
    save(); draw();
  });
  draw();
}
