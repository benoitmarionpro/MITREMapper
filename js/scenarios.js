import { state, save, uid, sample, sref, sanitize } from './store.js';
import { chatJson, fence, UNTRUSTED } from './llm.js';
import { validate, promptCatalog, group, groupTechs, groupCatalog, validateGroups, tech, parentOf } from './attack.js';
import { esc, $, readFiles, run, gateAI, undoable } from './ui.js';
import { t, lang, locale } from './i18n.js';
/** La citation (evidence) figure-t-elle dans la CTI ? Comparaison tolérante (casse, espaces, apostrophes) ; « … » sépare plusieurs extraits. */
export function citeOk(evidence, cti) {
  const norm = x => String(x || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[«»“”]/g, '"').replace(/\s+/g, ' ').trim();
  const parts = norm(evidence).replace(/^"|"$/g, '').split(/\.\.\.|…/).map(x => x.trim().replace(/^"|"$/g, '').trim()).filter(x => x.length >= 12);
  const c = norm(cti);
  return parts.length > 0 && parts.every(x => c.includes(x));
}
const MAX_CTI = 60000; // ponytail: troncature simple, découpage en plusieurs appels si les sources dépassent souvent

const SYSTEM = () => `Tu es un analyste CTI senior. À partir du profil client et des extraits de rapports de menace, tu déduis les scénarios de menace les plus pertinents à couvrir en détection.
Réponds en JSON : {"scenarios":[{"name":"","actors":"","summary":"","techniques":["T1566.001"],"priority":"high|medium|low","rationale":"","groups":["G0102"],"evidence":""}]}
Règles : ${lang === 'en' ? 'rédige tous les textes (name, actors, summary, rationale) EN ANGLAIS' : 'rédige tout en français'} ; 5 à 15 scénarios, concrets et distincts ; techniques = IDs ATT&CK Enterprise existants (techniques ou sous-techniques), 4 à 12 par scénario, ordonnées selon la kill chain ; priority selon la probabilité et l'impact pour CE client ; répartis les priorités (au plus la moitié en high) ; préfère les sous-techniques précises quand la source les justifie.
groups = IDs des groupes ATT&CK de la liste ci-dessous nommés dans les sources (nom ou alias) ou dont le mode opératoire décrit correspond clairement ; [] sinon, n'invente pas.
evidence = la phrase des sources qui justifie le scénario, COPIÉE MOT POUR MOT dans la langue des sources (pas de reformulation ni de traduction, 300 caractères au plus ; « … » pour relier deux extraits).
${UNTRUSTED}
Groupes ATT&CK (intrusion sets) :
${groupCatalog()}
`;

export function render(root) {
  const c = state.client;
  root.innerHTML = `
  <h2>${t('Profil client')}</h2>
  <div class="row">
    <div><label>${t('Secteur')}</label><input id="sector"></div><div><label>${t('Taille')}</label><input id="size"></div>
    <div><label>${t('Pays / zones')}</label><input id="country"></div><div><label>${t('Actifs / contraintes clés')}</label><input id="assets"></div>
  </div>
  <h2>${t('Sources CTI (rapports, tendances)')}</h2>
  <textarea id="cti" placeholder="${t('Coller le texte des rapports de menace…')}"></textarea><small id="ctin" class="mst"></small>
  <div class="bar"><label style="margin:0">${t('Ajouter des fichiers texte')} <input id="files" type="file" multiple accept=".txt,.md,.json,.csv,.html" style="width:auto"></label>
    <button id="demo">${t('Charger l’exemple')}</button><button id="gen" class="pri">${t('Générer les scénarios')}</button><label style="margin:0"><input id="repl" type="checkbox" style="width:auto"> ${t('remplacer l’existant')}</label><span id="st"></span></div>
  <h2>${t('Scénarios')} (<span id="n"></span>)</h2><div id="list"></div><button id="add">${t('+ Scénario manuel')}</button>`;
  gateAI(root, ['#gen'], '#st');
  for (const k of Object.keys(c)) { const el = $(root, '#' + k); el.value = c[k]; el.onchange = () => { c[k] = el.value; save(); }; }
  const cti = $(root, '#cti'), ctin = $(root, '#ctin');
  const count = () => {
    const n = cti.value.length, over = n > MAX_CTI;
    ctin.className = 'mst' + (over ? ' warn' : '');
    ctin.textContent = over ? t('{n} caractères : seuls les {max} premiers seront envoyés au LLM (le reste est ignoré).', { n: n.toLocaleString(locale), max: MAX_CTI.toLocaleString(locale) })
      : t('{n} / {max} caractères envoyés au LLM', { n: n.toLocaleString(locale), max: MAX_CTI.toLocaleString(locale) });
  };
  cti.value = state.cti; count(); cti.oninput = count; cti.onchange = () => { state.cti = cti.value; save(); count(); };
  $(root, '#files').onchange = async e => {
    cti.value += (cti.value ? '\n\n' : '') + (await readFiles(e.target.files)).map(f => `### ${f.name}\n${f.text}`).join('\n\n');
    cti.onchange();
  };

  $(root, '#demo').onclick = async () => {
    Object.assign(c, { sector: t('Santé (hôpitaux)'), size: t('ETI, 3 000 employés'), country: t('France / Europe'), assets: t('SI hospitalier, serveurs ESXi, dossiers patients') });
    state.cti = await sample('cti.txt'); save(); render(root);
  };
  const list = $(root, '#list');
  /** Techniques connues des groupes du scénario (ATT&CK) qui n'y figurent pas : pistes pour compléter le scénario. */
  const suggest = s => {
    const have = new Set(s.techniques.flatMap(x => [x, parentOf(x)]));
    const ids = [...new Set((s.groups || []).flatMap(id => group(id) ? groupTechs(group(id)) : []))].filter(x => !have.has(x)).sort();
    return ids.length ? `<details class="sugg"><summary>${t('{n} technique(s) connue(s) de ces groupes absente(s) du scénario', { n: ids.length })}</summary>
      ${ids.map(x => `<button class="tag" data-addt="${x}" title="${esc(tech(x)?.name)}">+ ${x} <small>${esc(tech(x)?.name)}</small></button>`).join('')}</details>` : '';
  };
  const draw = () => {
    $(root, '#n').textContent = state.scenarios.length;
    list.innerHTML = state.scenarios.map(s => `<div class="card" data-id="${s.id}"><b class="tag sref">${sref(s)}</b>
      <div class="row"><div><label>${t('Nom')}</label><input data-k="name" value="${esc(s.name)}"></div>
      <div><label>${t('Priorité')}</label><select data-k="priority">${['high', 'medium', 'low'].map(p => `<option ${p === s.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div><label>${t('Techniques (IDs, séparés par des virgules)')}</label><input data-k="techniques" value="${esc(s.techniques.join(', '))}"></div></div>
      <label>${t('Résumé / justification')}</label><input data-k="summary" value="${esc(s.summary || '')}">
      <div class="mut">${esc(s.actors || '')} ${s.rejected?.length ? `<span class="err">${t('IDs rejetés : {ids}', { ids: esc(s.rejected.join(', ')) })}</span>` : ''}</div>
      <div class="row"><div><label>${t('Groupes ATT&CK (IDs ou noms)')}</label><input data-k="groups" value="${esc((s.groups || []).join(', '))}" placeholder="G0102, FIN12…">
        <div>${(s.groups || []).map(id => `<a class="tag" href="https://attack.mitre.org/groups/${id}/" target="_blank" rel="noopener">${id} ${esc(group(id)?.name)}</a>`).join(' ')}${s.badGroups?.length ? ` <span class="err">${t('inconnus : {ids}', { ids: esc(s.badGroups.join(', ')) })}</span>` : ''}</div></div>
      <div><label>${t('Citation CTI (justification)')}</label><input data-k="evidence" value="${esc(s.evidence || '')}">
        ${s.evidence ? (citeOk(s.evidence, state.cti) ? `<small class="mst ok">${t('✓ citation retrouvée dans les sources CTI')}</small>` : `<small class="mst warn">${t('⚠ citation introuvable dans les sources CTI : à vérifier')}</small>`) : ''}</div></div>
      ${suggest(s)}
      <button data-del>${t('Supprimer')}</button></div>`).join('');
  };
  list.onchange = e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const s = state.scenarios.find(x => x.id === e.target.closest('.card').dataset.id);
    if (k === 'techniques') { const v = validate(e.target.value.split(/[,\s]+/).filter(Boolean)); s.techniques = v.ok; s.rejected = v.rejected; save(); draw(); }
    else if (k === 'groups') { const v = validateGroups(e.target.value.split(',').map(x => x.trim()).filter(Boolean)); s.groups = v.ok; s.badGroups = v.rejected; save(); draw(); }
    else if (k === 'evidence') { s.evidence = e.target.value; save(); draw(); }
    else { s[k] = e.target.value; save(); }
  };
  list.onclick = e => {
    const add = e.target.closest('[data-addt]');
    if (add) { const s = state.scenarios.find(x => x.id === add.closest('.card').dataset.id); s.techniques = [...new Set([...s.techniques, add.dataset.addt])]; save(); draw(); return; }
    if (e.target.dataset.del === undefined) return;
    const s = state.scenarios.find(x => x.id === e.target.closest('.card').dataset.id);
    undoable(t('Scénario {ref} supprimé.', { ref: sref(s) }), () => { state.scenarios = state.scenarios.filter(x => x !== s); save(); draw(); });
  };
  $(root, '#add').onclick = () => { state.scenarios.push({ id: uid(), name: t('Nouveau scénario'), priority: 'medium', techniques: [] }); save(); draw(); };
  $(root, '#gen').onclick = () => run($(root, '#st'), async (signal, say) => {
    if (!state.cti.trim()) throw new Error(t('Ajoute du contenu CTI.'));
    say(t('Appel LLM…'));
    const user = `Profil client : ${JSON.stringify(c)}\n\nSources CTI :\n${fence('source', state.cti.slice(0, MAX_CTI))}`;
    const r = await chatJson({ system: SYSTEM() + promptCatalog(), user, signal });
    const raw = [r.scenarios || r].flat().filter(s => s && typeof s === 'object');
    // sortie LLM = donnée non fiable : même nettoyage qu'un import (champs connus, typés, techniques validées)
    const out = sanitize({ scenarios: raw.map(s => ({ ...s, ref: undefined, rejected: validate(Array.isArray(s.techniques) ? s.techniques : []).rejected })), rules: [] }).scenarios;
    const add = () => { state.scenarios = $(root, '#repl').checked ? out : [...state.scenarios, ...out]; save(); draw(); };
    if ($(root, '#repl').checked) undoable(t('Scénarios existants remplacés.'), add); else add();
    const n = state.cti.length;
    return n > MAX_CTI ? t('{k} scénario(s) générés. Attention : CTI tronquée, {max} caractères analysés sur {n}.', { k: out.length, max: MAX_CTI.toLocaleString(locale), n: n.toLocaleString(locale) }) : t('{k} scénario(s) générés.', { k: out.length });
  }, [$(root, '#gen')]);
  draw();
}
