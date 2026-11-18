import { state, save, exportJson, download, loadDemo, sref, uid } from './store.js';
import { attack, parentOf, tech, sourcesOf, validate } from './attack.js';
import { chatJson, fence, UNTRUSTED } from './llm.js';
import { extractTechniques, mapRules, focusRule } from './mapping.js';
import { reportHtml, workbook, layer, layersZip } from './export.js';
import { esc, $, showProject, undoable, run, gateAI, attach, tasks, onTab } from './ui.js';
import { t, lang, locale } from './i18n.js';

const RANK = { low: 1, medium: 2, high: 3 };
/** id -> {n, best, exact, rules[], items[]} : une règle sur une sous-technique compte aussi pour la parente ;
 *  exact = meilleure confiance des règles qui citent la technique elle-même. */
export function coverageMap(rules = state.rules) {
  const m = new Map();
  for (const r of rules) {
    const c = RANK[r.confidence] || 2, ids = new Map(); // id -> cité exactement par la règle ?
    for (const x of r.techniques) { ids.set(x, true); if (!ids.has(parentOf(x))) ids.set(parentOf(x), false); }
    for (const [id, exact] of ids) {
      const e = m.get(id) || { n: 0, best: 0, exact: 0, rules: [], items: [] };
      e.n++; e.best = Math.max(e.best, c); if (exact) e.exact = Math.max(e.exact, c); e.rules.push(r.name); e.items.push(r); m.set(id, e);
    }
  }
  return m;
}
const subsOf = id => attack.techniques.filter(x => x.id.startsWith(id + '.')).map(x => x.id);
/** Statut d'une technique :
 *  cov  = règle medium+ sur la technique elle-même, ou toutes ses sous-techniques couvertes (medium+) ;
 *  part = seulement certaines sous-techniques, confiance basse, ou (pour une sous-technique) seule la parente est couverte ;
 *  gap  = aucune règle. */
export function status(cm, id) {
  const e = cm.get(id);
  if (!e) return id.includes('.') && cm.get(parentOf(id))?.exact ? 'part' : 'gap';
  if (e.exact >= 2) return 'cov';
  const subs = id.includes('.') ? [] : subsOf(id);
  return subs.length && subs.every(s => (cm.get(s)?.exact || 0) >= 2) ? 'cov' : 'part';
}
export const LABEL = { cov: t('couvert'), part: t('partiel'), gap: t('écart') };
const PRIO = { high: 0, medium: 1, low: 2 }, PRIOL = [t('Haute'), t('Moyenne'), t('Basse')];
/** Analyse partagée par l'écran et les exports : statuts par scénario, écarts priorisés, totaux. */
export function analysis() {
  const cm = coverageMap();
  const scen = state.scenarios.map(s => {
    const st = s.techniques.map(id => [id, status(cm, id)]), c = { cov: 0, part: 0, gap: 0 };
    st.forEach(([, k]) => c[k]++);
    return { s, st, c, pct: s.techniques.length ? Math.round(100 * c.cov / s.techniques.length) : 0 };
  });
  const g = new Map();
  for (const { s, st } of scen) for (const [id, k] of st) if (k !== 'cov') {
    const x = g.get(id) || { id, name: tech(id)?.name || '', k, scs: [], p: 3 };
    x.scs.push(s); x.p = Math.min(x.p, PRIO[s.priority] ?? 1); g.set(id, x);
  }
  const gaps = [...g.values()].sort((a, b) => a.p - b.p || (b.k === 'gap') - (a.k === 'gap') || b.scs.length - a.scs.length);
  const uniq = new Map(scen.flatMap(x => x.st)), tot = { cov: 0, part: 0, gap: 0 };
  uniq.forEach(k => tot[k]++);
  const A = { cm, status: id => status(cm, id), scen, gaps, tot, nTech: uniq.size, pct: uniq.size ? Math.round(100 * tot.cov / uniq.size) : 0, sources: sourcesFor(gaps) };
  const snap = state.snapshots?.find(x => x.id === view.cmp) || (view.cmp === '' ? state.snapshots?.at(-1) : null);
  return Object.assign(A, { diff: snap ? compare(A, snap) : null });
}
/** Composants de données ATT&CK à prioriser : ceux qui servent au plus d'écarts, pondérés par la priorité des scénarios (high 3, medium 2, low 1). */
function sourcesFor(gaps) {
  const m = new Map();
  for (const g of gaps) for (const c of sourcesOf(g.id)) {
    const x = m.get(c.id) || { ...c, ids: [], p: 3, w: 0 };
    x.ids.push(g.id); x.p = Math.min(x.p, g.p); x.w += 3 - g.p; m.set(c.id, x);
  }
  return [...m.values()].sort((a, b) => b.w - a.w || b.ids.length - a.ids.length || a.id.localeCompare(b.id));
}
/** Instantané figé de la couverture (statut de chaque technique de scénario) pour mesurer l'évolution. */
export const snapshot = (A, label) => ({ id: uid(), date: new Date().toISOString(), label, pct: A.pct, tot: { ...A.tot }, nTech: A.nTech,
  st: Object.fromEntries(A.scen.flatMap(x => x.st)), scen: A.scen.map(({ s, pct }) => ({ ref: s.ref, name: s.name, pct })) });
const RK = { gap: 0, part: 1, cov: 2 };
/** Différence entre un instantané et l'état courant (techniques améliorées, dégradées, entrées ou sorties du périmètre, scénarios). */
export function compare(A, snap) {
  const now = new Map(A.scen.flatMap(x => x.st)), before = new Map(Object.entries(snap.st)), both = [...now.keys()].filter(id => before.has(id));
  const moved = dir => both.filter(id => dir * (RK[now.get(id)] - RK[before.get(id)]) > 0).map(id => ({ id, from: before.get(id), to: now.get(id) }));
  return { snap, dPct: A.pct - snap.pct, dCov: A.tot.cov - snap.tot.cov, dGap: A.tot.gap - snap.tot.gap, better: moved(1), worse: moved(-1),
    added: [...now.keys()].filter(id => !before.has(id)), removed: [...before.keys()].filter(id => !now.has(id)),
    scen: new Map(A.scen.map(({ s }) => [s.id, snap.scen.find(x => x.ref === s.ref)?.pct])) };
}
export const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const SIGMA = () => `Tu es un ingénieur detection engineering. Rédige UNE ébauche de règle Sigma qui détecte la technique ATT&CK indiquée, dans le contexte des scénarios fournis.
Réponds en JSON : {"sigma":"<règle YAML complète>","notes":""}
- sigma : règle Sigma valide (title, id UUID v4, status: experimental, description, references vers la fiche ATT&CK, author: MITREMapper (ébauche IA), tags dont attack.<tactique> et attack.<id de technique en minuscules>, logsource, detection, falsepositives, level).
- Logique comportementale robuste plutôt qu'un indicateur fragile ; choisis un logsource cohérent avec les sources de données ATT&CK fournies.
- notes : ${lang === 'en' ? 'EN ANGLAIS' : 'en français'}, 2 à 4 phrases : journaux requis, hypothèses, faux positifs attendus, comment tester.
- ${UNTRUSTED}`;
const SHOW = { all: t('Toutes les techniques'), scenario: t('Techniques des scénarios'), gap: t('Écarts uniquement'), cov: t('Couvertes uniquement') };
const view = { q: '', sc: '', show: 'all', cmp: '', reopen: '' }; // filtres conservés tant que la page est ouverte ; cmp : '' = dernier instantané, 'none' = sans comparaison

const drafts = {}; // technique → { y, notes } : ébauche générée, gardée tant que la page est ouverte (retirée une fois ajoutée aux règles)
let reopen = () => {}; // draft() du dernier rendu : une tâche finie redessine le volet courant, pas celui d'un rendu disparu
const shown = id => { const d = document.getElementById('detail'); return onTab('coverage') && d?.classList.contains('open') && d.dataset.draft === id; };
export function render(root) {
  const cm = coverageMap();
  const parents = attack.techniques.filter(x => !x.id.includes('.'));
  const relSet = () => new Set(state.scenarios.filter(s => !view.sc || s.id === view.sc).flatMap(s => s.techniques.map(parentOf)));
  const kind = (te, rel) => { const k = status(cm, te.id); return k === 'gap' ? (rel.has(te.id) ? 'gap' : 'none') : k; };

  const A = analysis(), total = A.nTech, D = A.diff;
  const delta = (n, unit = '') => n ? ` <span class="${n > 0 ? 'ok' : 'err'}">(${signed(n)}${unit})</span>` : '';
  const rowsHtml = A.scen.map(({ s, st, c, pct }) => `<tr><td><b class="tag sref">${sref(s)}</b> <b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span></td>
      <td>${pct}%${D ? (D.scen.get(s.id) == null ? ` <span class="mut">(${t('nouveau')})</span>` : delta(pct - D.scen.get(s.id), ' pts')) : ''} <span class="mut">(${t('{c} couvertes, {p} partielles, {g} écarts', { c: c.cov, p: c.part, g: c.gap })})</span></td>
      <td>${st.map(([id, k]) => `<span class="tag ${k}" title="${esc(tech(id)?.name)}">${id}</span>`).join('')}</td></tr>`).join('');
  const dcs = id => sourcesOf(id).map(c => esc(c.name)).join(', ') || '<span class="mut">—</span>';
  const gapRows = A.gaps.map(g => `<tr><td>${g.id} ${esc(g.name)}</td><td class="${g.k}">${LABEL[g.k]}</td><td>${g.scs.map(s => `<div><span class="tag sref">${sref(s)}</span> ${esc(s.name)}</div>`).join('')}</td><td class="mut">${dcs(g.id)}</td><td><button data-draft="${g.id}">${t('Ébaucher une règle')}</button></td></tr>`).join('');
  const srcRows = A.sources.slice(0, 15).map(c => `<tr><td><a href="https://attack.mitre.org/datacomponents/${c.id}/" target="_blank" rel="noopener">${c.id}</a> <b>${esc(c.name)}</b></td><td>${c.ids.length}</td><td>${PRIOL[c.p]}</td><td>${c.ids.map(id => `<span class="tag" title="${esc(tech(id)?.name)}">${id}</span>`).join('')}</td></tr>`).join('');
  const snaps = state.snapshots || [], fmt = d => new Date(d).toLocaleDateString(locale);
  const ids = (list, f) => list.map(x => `<span class="tag ${x.to || ''}" title="${esc(tech(x.id || x)?.name)}">${x.id || x}${f ? ` <small>${LABEL[x.from]} → ${LABEL[x.to]}</small>` : ''}</span>`).join('') || `<span class="mut">${t('Aucune.')}</span>`;
  const evo = !snaps.length ? `<p class="mut">${t('Fige un instantané (par exemple avant un atelier ou une campagne de création de règles) pour mesurer ensuite les progrès et les inclure dans le rapport.')}</p>`
    : !D ? '' : `<div class="kpis"><div class="kpi"><b>${D.snap.pct}% → ${A.pct}%</b><span>${t('couverture')}${delta(D.dPct, ' pts')}</span></div>
      <div class="kpi"><b>${signed(D.dCov)}</b><span>${t('techniques couvertes')}</span></div><div class="kpi"><b>${signed(D.dGap)}</b><span>${t('écarts')}</span></div></div>
      <p><b>${t('Améliorées')} (${D.better.length})</b> ${ids(D.better, true)}</p><p><b>${t('Dégradées')} (${D.worse.length})</b> ${ids(D.worse, true)}</p>
      ${D.added.length || D.removed.length ? `<p class="mut">${t('Périmètre : {a} technique(s) ajoutée(s), {r} retirée(s) depuis l’instantané.', { a: D.added.length, r: D.removed.length })}</p>` : ''}`;

  const unmapped = state.rules.filter(r => !r.mapped).length;
  root.innerHTML = `${unmapped ? `<div class="card warnc"><b>${t('{n} règle(s) non mappée(s) : la couverture ne les prend pas encore en compte.', { n: unmapped })}</b> <button id="gomap" class="pri">${t('Mapper dans Règles')}</button></div>` : ''}${state.rules.length || state.scenarios.length ? '' : `<div class="card"><b>${t('Aucune donnée.')}</b> ${t('Génère des scénarios et mappe des règles, ou')} <button id="demo" class="pri">${t('charge la démo complète')}</button></div>`}
  <div class="bar"><button id="rep" class="pri">${t('Rapport client (PDF)')}</button><button id="reph">${t('Rapport (HTML)')}</button><button id="xlsx">${t('Classeur Excel')}</button><button id="nav">${t('Couche Navigator')}</button><button id="navz">${t('Couches Navigator par scénario (.zip)')}</button><button id="csv">${t('CSV (règles)')}</button>
    <span class="mut">${t('{r} règles · {s} scénarios · {n} techniques de scénario', { r: state.rules.length, s: state.scenarios.length, n: total })}</span></div>
  <h2>${t('Matrice ATT&CK')}</h2>
  <div class="mtools">
    <input id="q" type="search" placeholder="${t('Chercher T1059 ou « credential »')}" aria-label="${t('Chercher une technique')}">
    <select id="msc" aria-label="${t('Scénario')}"><option value="">${t('Tous les scénarios')}</option>${state.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <select id="mshow" aria-label="${t('Afficher')}">${Object.entries(SHOW).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span id="legend"></span>
  </div>
  <div id="matrix" class="matrix"></div><aside id="detail" role="region" aria-label="${t('Détail de la technique')}"></aside>
  <h2>${t('Évolution')}</h2>
  <div class="bar"><button id="snap">${t('Figer un instantané')}</button>${snaps.length ? `<label for="cmp" style="margin:0">${t('Comparer avec')}</label><select id="cmp" style="width:auto"><option value="none">${t('Aucune comparaison')}</option>${snaps.map(x => `<option value="${x.id}" ${D?.snap === x ? 'selected' : ''}>${esc(x.label)} (${fmt(x.date)}, ${x.pct}%)</option>`).join('')}</select><button id="snapdel" ${D ? '' : 'disabled'}>${t('Supprimer cet instantané')}</button>` : ''}</div>
  ${evo}
  <h2>${t('Couverture par scénario')}</h2><table><thead><tr><th>${t('Scénario')}</th><th>${t('Couverture')}</th><th>${t('Techniques')}</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan=3 class="mut">${t('Aucun scénario')}</td></tr>`}</tbody></table>
  <h2>${t('Écarts priorisés')}</h2><table><thead><tr><th>${t('Technique')}</th><th>${t('Statut')}</th><th>${t('Scénarios concernés')}</th><th>${t('Sources de données (ATT&CK)')}</th><th></th></tr></thead><tbody id="gaps">${gapRows || `<tr><td colspan=5 class="mut">${t('Aucun écart')}</td></tr>`}</tbody></table>
  ${srcRows ? `<h2>${t('Sources de données à prioriser')}</h2><p class="mut">${t('Composants de données ATT&CK nécessaires pour détecter les écarts, classés par nombre d’écarts et priorité des scénarios. À confronter aux journaux réellement collectés.')}</p>
  <table><thead><tr><th>${t('Composant de données')}</th><th>${t('Écarts')}</th><th>${t('Priorité max.')}</th><th>${t('Techniques concernées')}</th></tr></thead><tbody>${srcRows}</tbody></table>` : ''}`;

  function drawMatrix() {
    const rel = relSet(), q = view.q.trim().toLowerCase(), n = { cov: 0, part: 0, gap: 0 };
    for (const te of parents) { const k = kind(te, rel); if (rel.has(te.id) && k !== 'none') n[k]++; }
    const keep = (te, k) => (!q || (te.id + ' ' + te.name).toLowerCase().includes(q))
      && (view.show === 'all' || (view.show === 'scenario' && rel.has(te.id)) || (view.show === 'gap' && k === 'gap') || (view.show === 'cov' && k === 'cov'));
    const cols = attack.tactics.map(tc => {
      const all = parents.filter(te => te.tactics.includes(tc.short));
      const relAll = all.filter(te => rel.has(te.id)), relCov = relAll.filter(te => kind(te, rel) === 'cov');
      const cells = all.filter(te => keep(te, kind(te, rel)));
      if (!cells.length && (view.show !== 'all' || q)) return '';
      return `<div class="col"><h3>${esc(tc.name)}${relAll.length ? `<span title="${t('Techniques de scénario couvertes dans cette tactique')}">${relCov.length}/${relAll.length}</span>` : ''}</h3>${cells.map(te => {
        const k = kind(te, rel), e = cm.get(te.id);
        return `<button class="cell ${k} ${rel.has(te.id) ? 'rel' : ''}" data-id="${te.id}" aria-label="${te.id} ${esc(te.name)} : ${LABEL[k] || t('hors scénarios')}${e ? ', ' + t('{n} règle(s)', { n: e.n }) : ''}"><b>${te.id}</b>${e ? `<i>×${e.n}</i>` : ''}<span>${esc(te.name)}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    $(root, '#matrix').innerHTML = cols || `<p class="mut" style="padding:1rem">${t('Aucune technique ne correspond à ces filtres.')}</p>`;
    $(root, '#legend').innerHTML = `<span class="lg cov">${t('Couvert')} ${n.cov}</span><span class="lg part">${t('Partiel')} ${n.part}</span><span class="lg gap">${t('Écart')} ${n.gap}</span><span class="lg none">${t('Hors scénarios')}</span>`;
  }

  function openDetail(id) {
    const te = parents.find(x => x.id === id), e = cm.get(id), k = kind(te, relSet());
    const scs = state.scenarios.filter(s => s.techniques.some(x => parentOf(x) === id));
    const subs = attack.techniques.filter(x => x.id.startsWith(id + '.'));
    const st = { cov: ['cov', t('Couvert')], part: ['part', t('Partiel')], gap: ['gap', t('Écart : aucune règle')], none: ['', t('Non couvert, hors scénarios')] }[k];
    const rules = e ? e.items.map(r => `<div class="item"><b>${esc(r.name)}</b><div class="mut">${r.techniques.map(x => `<span class="tag">${x}</span>`).join('')} ${esc(r.confidence || '')}${r.stage ? ' · ' + esc(r.stage) : ''}</div></div>`).join('') : `<p class="mut">${t('Aucune règle ne cible cette technique.')}</p>`;
    const scn = scs.map(s => `<div class="item">${esc(s.name)} <span class="tag">${esc(s.priority)}</span></div>`).join('') || `<p class="mut">${t('Aucun scénario ne l’utilise.')}</p>`;
    const sub = subs.map(x => { const c = cm.get(x.id); return `<div class="item sub"><span class="tag ${c ? (c.best >= 2 ? 'cov' : 'part') : ''}">${x.id}</span> ${esc(x.name)}${c ? ` <span class="mut">×${c.n}</span>` : ''}</div>`; }).join('') || `<p class="mut">${t('Aucune.')}</p>`;
    const d = $(root, '#detail');
    d.innerHTML = `<button class="x" aria-label="${t('Fermer')}">×</button><h3>${id} ${esc(te.name)}</h3>
      <p><span class="tag ${st[0]}">${st[1]}</span> <a href="https://attack.mitre.org/techniques/${id}/" target="_blank" rel="noopener">${t('Fiche MITRE')}</a></p>
      <h4>${t('Règles')} (${e ? e.items.length : 0})</h4>${rules}<h4>${t('Scénarios')} (${scs.length})</h4>${scn}<h4>${t('Sources de données (ATT&CK)')}</h4>${sourcesOf(id).map(c => `<div class="item"><a href="https://attack.mitre.org/datacomponents/${c.id}/" target="_blank" rel="noopener">${c.id}</a> ${esc(c.name)}</div>`).join('') || `<p class="mut">${t('Aucune stratégie de détection MITRE pour cette technique.')}</p>`}<h4>${t('Sous-techniques ({n}/{m} couvertes)', { n: subs.filter(x => (cm.get(x.id)?.exact || 0) >= 2).length, m: subs.length })}</h4>${sub}
      ${k !== 'cov' || drafts[id] || busy(id) ? `<div class="bar"><button data-draft="${id}">${busy(id) ? t('Voir l’ébauche en cours') : drafts[id] ? t('Voir l’ébauche générée') : t('Ébaucher une règle Sigma (IA)')}</button></div>` : ''}`;
    d.dataset.draft = ''; d.classList.add('open'); $(d, '.x').focus();
  }
  /** Après l'ajout d'une ébauche (page réaffichée) : volet de confirmation, avec accès à la règle dans l'onglet Règles pour la relire et la valider. */
  function draftDone(rule) {
    const d = $(root, '#detail'), names = state.scenarios.filter(s => rule.scenarios.includes(s.id));
    d.innerHTML = `<button class="x" aria-label="${t('Fermer')}">×</button><h3>${esc(rule.name)}</h3>
      <p><span class="tag part">${t('Confiance basse : à valider')}</span> ${rule.techniques.map(x => `<span class="tag">${x}</span>`).join('')}</p>
      <h4>${t('Scénarios liés')} (${names.length})</h4>${names.map(s => `<div class="item"><span class="tag sref">${sref(s)}</span> ${esc(s.name)}<div class="mut">${esc(rule.why?.[s.id] || '')}</div></div>`).join('') || `<p class="mut">${t('Aucun scénario lié.')}</p>`}
      <div class="bar"><button id="gorule" class="pri">${t('Relire et valider dans Règles')}</button></div>`;
    d.dataset.draft = ''; d.classList.add('open'); $(d, '#gorule').focus();
    $(d, '#gorule').onclick = () => { focusRule(rule.id); document.querySelector('#tabs [data-id="rules"]')?.click(); };
  }
  const busy = id => ['draft:', 'add:'].some(k => tasks.get(k + id)?.state === 'run');
  /** Ébauche de règle Sigma pour une technique non couverte : générée par l'IA, ajoutée en confiance basse (la technique reste partielle tant que la règle n'est pas validée).
   *  Le volet reprend l'état à chaque ouverture : tâche en cours (attach), ébauche déjà générée (drafts). */
  function draft(id, focus = true) {
    const te = tech(id), d = $(root, '#detail'), dr = drafts[id];
    // ébauches déjà ajoutées (lues dans les règles : survit au rechargement et à l'annulation)
    const prev = state.rules.filter(r => r.source === t('ébauche IA') && r.techniques.includes(id));
    const scs = state.scenarios.filter(s => s.techniques.some(x => parentOf(x) === parentOf(id)));
    const open = () => { view.reopen = id; document.querySelector('#tabs [data-id="coverage"]')?.click(); };
    d.dataset.draft = id;
    d.innerHTML = `<button class="x" aria-label="${t('Fermer')}">×</button><h3>${t('Ébauche de règle Sigma')}</h3><p><b>${id}</b> ${esc(te?.name)}</p>
      <p class="mut">${t('Générée par l’IA à partir de la technique, des scénarios concernés et des sources de données ATT&CK. À relire, tester et adapter avant tout déploiement. Ajoutée aux règles, elle reste en confiance basse : la technique passe en « partiel », pas en « couvert », tant que tu ne l’as pas validée.')}</p>
      ${prev.length ? `<h4>${t('Déjà ajoutée(s) aux règles ({n})', { n: prev.length })}</h4>${prev.map(r => `<div class="item"><b>${esc(r.name)}</b> <span class="tag ${r.reviewed ? 'cov' : 'part'}">${r.reviewed ? t('Validée') : t('Confiance basse : à valider')}</span>
        <div class="bar"><button data-rule="${r.id}">${t('Relire et valider dans Règles')}</button></div></div>`).join('')}
        <p class="mut">${t('Une nouvelle ébauche n’a d’intérêt que pour une détection complémentaire (autre source de données, autre variante de la technique). Sinon, relis et valide la règle existante dans Règles.')}</p>` : ''}
      <div class="bar"><button id="sgo" class="${prev.length && !dr ? '' : 'pri'}">${dr ? t('Régénérer') : prev.length ? t('Générer une autre ébauche') : t('Générer l’ébauche')}</button><span id="sst"></span></div>
      <div id="sout">${dr ? `<pre>${esc(dr.y)}</pre>${dr.notes ? `<p class="mut">${esc(dr.notes)}</p>` : ''}
        <div class="bar"><button id="sadd" class="pri">${t('Ajouter aux règles (à valider)')}</button><button id="scopy">${t('Copier')}</button><span id="sast" role="status"></span></div>` : ''}</div>`;
    d.classList.add('open'); if (focus) $(d, '.x').focus();
    d.querySelectorAll('[data-rule]').forEach(b => b.onclick = () => { focusRule(b.dataset.rule); document.querySelector('#tabs [data-id="rules"]')?.click(); });
    $(d, '#sgo').onclick = () => run($(d, '#sst'), async (signal, say) => {
      say(t('Appel LLM…'));
      const existing = (cm.get(id)?.items || []).map(r => r.name);
      const user = `Technique : ${id} ${te?.name} (tactiques : ${(te?.tactics?.length ? te.tactics : tech(parentOf(id))?.tactics || []).join(', ')})
Sources de données ATT&CK utiles : ${sourcesOf(id).map(c => c.name).join(', ') || '(non précisé)'}
Règles existantes sur cette technique (à ne pas dupliquer) : ${existing.join(' ; ') || '(aucune)'}
Scénarios concernés :
${fence('source', scs.map(s => `${sref(s)} ${s.name} : ${s.summary || ''}`).join('\n') || '(aucun)')}`;
      const r = await chatJson({ system: SIGMA(), user, signal });
      const y = typeof r?.sigma === 'string' ? r.sigma.slice(0, 20000) : '', notes = typeof r?.notes === 'string' ? r.notes.slice(0, 2000) : '';
      if (!/^\s*title\s*:/m.test(y) || !/^\s*detection\s*:/m.test(y)) throw new Error(t('Réponse inexploitable : pas de règle Sigma (title, detection).'));
      drafts[id] = { y, notes };
      if (shown(id)) reopen(id, false);
      return t('Ébauche générée ci-dessous : relis-la, puis ajoute-la aux règles.');
    }, [$(d, '#sgo')], { key: 'draft:' + id, label: t('Ébauche Sigma {id}', { id }), open, keep: true });
    if (dr) {
      $(d, '#scopy').onclick = () => navigator.clipboard?.writeText(dr.y);
      // Ajout = mapping réel (même pipeline que l'onglet Règles : tags puis relecture IA), puis confiance basse forcée : une ébauche ne compte pas comme couverte avant validation.
      $(d, '#sadd').onclick = () => run($(d, '#sast'), async (signal, say) => {
        say(t('Intégration de la règle…'));
        const g = tasks.get('draft:' + id); if (g) g.hidden = true; // l'ébauche est prise en charge : sa ligne « à relire » n'a plus lieu d'être
        const y = dr.y, rule = { id: uid(), name: (y.match(/^title\s*:\s*['"]?(.+?)['"]?\s*$/m)?.[1] || id).slice(0, 200), source: t('ébauche IA'), body: y,
          techniques: [], scenarios: [], why: {}, reviewed: false, tags: [...new Set([id, ...extractTechniques(y)])], tagDiff: null, stage: '', confidence: 'low', note: '', mapped: false };
        let warn = '';
        try { await mapRules([rule], { verify: true, signal, say: () => say(t('Mise à jour de la cartographie MITRE…')) }); }
        catch (e) { if (e.name === 'AbortError') throw e; warn = t('Relecture IA impossible ({e}) : liens établis par les tags seulement.', { e: e.message }); }
        if (!rule.techniques.includes(id)) rule.techniques = validate([id, ...rule.techniques]).ok; // la règle a été écrite pour cet écart
        Object.assign(rule, { confidence: 'low', reviewed: false, note: [t('Ébauche générée par l’IA pour combler un écart : à relire, tester et valider.'), dr.notes, rule.note].filter(Boolean).join(' ') });
        const msg = t('Règle « {name} » ajoutée et mappée : {n} scénario(s) lié(s){stage} ; confiance basse jusqu’à validation dans Règles.', { name: rule.name, n: rule.scenarios.length, stage: rule.stage ? t(', étape {s}', { s: rule.stage }) : '' });
        const was = shown(id);
        delete drafts[id];
        // l'onglet a pu changer pendant l'appel : on ne redessine la Couverture que si elle est affichée
        undoable(warn ? `${msg} ${warn}` : msg, () => { state.rules.push(rule); save(); if (onTab('coverage')) render(root); });
        if (was) draftDone(rule);
        return msg;
      }, [$(d, '#sadd'), $(d, '#sgo'), $(d, '#scopy')], { key: 'add:' + id, label: t('Ajout de l’ébauche {id}', { id }), open });
    }
    // reprise de l'état : génération, puis ajout (qui grise aussi #sgo), puis autorisation IA
    // le message « générée » d'une ébauche déjà ajoutée (ou annulée) n'a plus de sens : seul l'état en cours ou une erreur est repris
    const g = tasks.get('draft:' + id);
    if (g && (dr || g.state !== 'ok')) attach($(d, '#sst'), 'draft:' + id, [$(d, '#sgo')]);
    if (dr) attach($(d, '#sast'), 'add:' + id, [$(d, '#sadd'), $(d, '#sgo'), $(d, '#scopy')]);
    gateAI(d, ['#sgo'], '#sst');
  }
  reopen = draft;

  $(root, '#q').value = view.q; $(root, '#msc').value = view.sc; $(root, '#mshow').value = view.show;
  $(root, '#q').oninput = e => { view.q = e.target.value; drawMatrix(); };
  $(root, '#msc').onchange = e => { view.sc = e.target.value; drawMatrix(); };
  $(root, '#mshow').onchange = e => { view.show = e.target.value; drawMatrix(); };
  let opened = '';
  // fermeture du volet : le focus revient sur la cellule d'origine (navigation clavier)
  let opener = null;
  const close = () => { $(root, '#detail').classList.remove('open'); (opener?.isConnected ? opener : root.querySelector(`.cell[data-id="${opened}"]`))?.focus(); };
  $(root, '#matrix').onclick = e => { const c = e.target.closest('.cell'); if (c) { opener = c; openDetail(opened = c.dataset.id); } };
  $(root, '#detail').onclick = e => { if (e.target.classList.contains('x')) close(); else if (e.target.dataset.draft) draft(e.target.dataset.draft); };
  $(root, '#gaps').onclick = e => { const b = e.target.closest('[data-draft]'); if (b) { opener = b; draft(b.dataset.draft); } };
  root.onkeydown = e => { if (e.key === 'Escape' && $(root, '#detail').classList.contains('open')) close(); };
  drawMatrix();
  if (view.reopen) { const id = view.reopen; view.reopen = ''; draft(id); } // bouton « Afficher » du panneau des tâches
  if (unmapped) $(root, '#gomap').onclick = () => document.querySelector('#tabs [data-id="rules"]')?.click();
  $(root, '#snap').onclick = () => {
    const label = prompt(t('Nom de l’instantané'), t('Instantané du {date}', { date: new Date().toLocaleDateString(locale) }));
    if (label === null) return;
    (state.snapshots ||= []).push(snapshot(analysis(), label.trim().slice(0, 100) || fmt(Date.now()))); view.cmp = ''; save(); render(root);
  };
  if (snaps.length) {
    $(root, '#cmp').onchange = e => { view.cmp = e.target.value; render(root); };
    $(root, '#snapdel').onclick = () => { const x = D.snap; undoable(t('Instantané « {name} » supprimé.', { name: x.label }), () => { state.snapshots = snaps.filter(y => y !== x); view.cmp = ''; save(); render(root); }); };
  }
  const demo = $(root, '#demo'); if (demo) demo.onclick = async () => { await loadDemo(); showProject(); render(root); };

  const slug = state.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projet';
  const html = () => new Blob([reportHtml(analysis())], { type: 'text/html' });
  $(root, '#rep').onclick = () => { const w = window.open(URL.createObjectURL(html())); if (!w) alert(t('Fenêtre bloquée : autorise les pop-ups ou utilise « Rapport (HTML) ».')); };
  $(root, '#reph').onclick = () => download(`mitremapper-${t('rapport')}-${slug}.html`, html());
  $(root, '#xlsx').onclick = () => download(`mitremapper-${slug}.xlsx`, workbook(analysis()));
  // couche du scénario sélectionné dans le filtre, sinon couche globale
  $(root, '#nav').onclick = () => { const s = state.scenarios.find(x => x.id === view.sc); exportJson(`mitremapper-layer-${s ? sref(s) : 'global'}.json`, layer(analysis(), s)); };
  $(root, '#navz').onclick = () => download(`mitremapper-layers-${slug}.zip`, layersZip(analysis()));
  $(root, '#csv').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"` // préfixe ' : pas de formule exécutée par Excel, sc = id => state.scenarios.find(s => s.id === id)?.name;
    exportJson('mitremapper-rules.csv', [t('règle,source,techniques,scénarios,étape,confiance,note'),
      ...state.rules.map(r => [r.name, r.source, r.techniques.join(' '), r.scenarios.map(sc).join(' | '), r.stage, r.confidence, r.note].map(q).join(','))].join('\n'));
  };
}
