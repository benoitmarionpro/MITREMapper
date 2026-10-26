import { state, exportJson, download, loadDemo, sref } from './store.js';
import { attack, parentOf, tech } from './attack.js';
import { reportHtml, workbook, layer, layersZip } from './export.js';
import { esc, $, showProject } from './ui.js';
import { t } from './i18n.js';

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
const PRIO = { high: 0, medium: 1, low: 2 };
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
  return { cm, status: id => status(cm, id), scen, gaps, tot, nTech: uniq.size, pct: uniq.size ? Math.round(100 * tot.cov / uniq.size) : 0 };
}
const SHOW = { all: t('Toutes les techniques'), scenario: t('Techniques des scénarios'), gap: t('Écarts uniquement'), cov: t('Couvertes uniquement') };
const view = { q: '', sc: '', show: 'all' }; // filtres conservés tant que la page est ouverte

export function render(root) {
  const cm = coverageMap();
  const parents = attack.techniques.filter(x => !x.id.includes('.'));
  const relSet = () => new Set(state.scenarios.filter(s => !view.sc || s.id === view.sc).flatMap(s => s.techniques.map(parentOf)));
  const kind = (te, rel) => { const k = status(cm, te.id); return k === 'gap' ? (rel.has(te.id) ? 'gap' : 'none') : k; };

  const A = analysis(), total = A.nTech;
  const rowsHtml = A.scen.map(({ s, st, c, pct }) => `<tr><td><b class="tag sref">${sref(s)}</b> <b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span></td>
      <td>${pct}% <span class="mut">(${t('{c} couvertes, {p} partielles, {g} écarts', { c: c.cov, p: c.part, g: c.gap })})</span></td>
      <td>${st.map(([id, k]) => `<span class="tag ${k}" title="${esc(tech(id)?.name)}">${id}</span>`).join('')}</td></tr>`).join('');
  const gapRows = A.gaps.map(g => `<tr><td>${g.id} ${esc(g.name)}</td><td class="${g.k}">${LABEL[g.k]}</td><td>${g.scs.map(s => `<div><span class="tag sref">${sref(s)}</span> ${esc(s.name)}</div>`).join('')}</td></tr>`).join('');

  root.innerHTML = `${state.rules.length || state.scenarios.length ? '' : `<div class="card"><b>${t('Aucune donnée.')}</b> ${t('Génère des scénarios et mappe des règles, ou')} <button id="demo" class="pri">${t('charge la démo complète')}</button></div>`}
  <div class="bar"><button id="rep" class="pri">${t('Rapport client (PDF)')}</button><button id="reph">${t('Rapport (HTML)')}</button><button id="xlsx">${t('Classeur Excel')}</button><button id="nav">${t('Couche Navigator')}</button><button id="navz">${t('Couches Navigator par scénario (.zip)')}</button><button id="csv">${t('CSV (règles)')}</button>
    <span class="mut">${t('{r} règles · {s} scénarios · {n} techniques de scénario', { r: state.rules.length, s: state.scenarios.length, n: total })}</span></div>
  <h2>${t('Matrice ATT&CK')}</h2>
  <div class="mtools">
    <input id="q" type="search" placeholder="${t('Chercher T1059 ou « credential »')}" aria-label="${t('Chercher une technique')}">
    <select id="msc" aria-label="${t('Scénario')}"><option value="">${t('Tous les scénarios')}</option>${state.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <select id="mshow" aria-label="${t('Afficher')}">${Object.entries(SHOW).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span id="legend"></span>
  </div>
  <div id="matrix" class="matrix"></div><aside id="detail" aria-live="polite"></aside>
  <h2>${t('Couverture par scénario')}</h2><table><thead><tr><th>${t('Scénario')}</th><th>${t('Couverture')}</th><th>${t('Techniques')}</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan=3 class="mut">${t('Aucun scénario')}</td></tr>`}</tbody></table>
  <h2>${t('Écarts priorisés')}</h2><table><thead><tr><th>${t('Technique')}</th><th>${t('Statut')}</th><th>${t('Scénarios concernés')}</th></tr></thead><tbody>${gapRows || `<tr><td colspan=3 class="mut">${t('Aucun écart')}</td></tr>`}</tbody></table>`;

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
        return `<button class="cell ${k} ${rel.has(te.id) ? 'rel' : ''}" data-id="${te.id}"><b>${te.id}</b>${e ? `<i>×${e.n}</i>` : ''}<span>${esc(te.name)}</span></button>`;
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
      <h4>${t('Règles')} (${e ? e.items.length : 0})</h4>${rules}<h4>${t('Scénarios')} (${scs.length})</h4>${scn}<h4>${t('Sous-techniques ({n}/{m} couvertes)', { n: subs.filter(x => (cm.get(x.id)?.exact || 0) >= 2).length, m: subs.length })}</h4>${sub}`;
    d.classList.add('open'); $(d, '.x').focus();
  }

  $(root, '#q').value = view.q; $(root, '#msc').value = view.sc; $(root, '#mshow').value = view.show;
  $(root, '#q').oninput = e => { view.q = e.target.value; drawMatrix(); };
  $(root, '#msc').onchange = e => { view.sc = e.target.value; drawMatrix(); };
  $(root, '#mshow').onchange = e => { view.show = e.target.value; drawMatrix(); };
  $(root, '#matrix').onclick = e => { const c = e.target.closest('.cell'); if (c) openDetail(c.dataset.id); };
  $(root, '#detail').onclick = e => { if (e.target.classList.contains('x')) e.currentTarget.classList.remove('open'); };
  root.onkeydown = e => { if (e.key === 'Escape') $(root, '#detail').classList.remove('open'); };
  drawMatrix();
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
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, sc = id => state.scenarios.find(s => s.id === id)?.name;
    exportJson('mitremapper-rules.csv', [t('règle,source,techniques,scénarios,étape,confiance,note'),
      ...state.rules.map(r => [r.name, r.source, r.techniques.join(' '), r.scenarios.map(sc).join(' | '), r.stage, r.confidence, r.note].map(q).join(','))].join('\n'));
  };
}
