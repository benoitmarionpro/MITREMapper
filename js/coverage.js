import { state, exportJson, loadDemo, sref } from './store.js';
import { attack, parentOf } from './attack.js';
import { esc, $, showProject } from './ui.js';

const RANK = { low: 1, medium: 2, high: 3 };
/** id -> {n, best, exact, rules[], items[]} : une règle sur une sous-technique compte aussi pour la parente ;
 *  exact = meilleure confiance des règles qui citent la technique elle-même. */
export function coverageMap(rules = state.rules) {
  const m = new Map();
  for (const r of rules) {
    const c = RANK[r.confidence] || 2, ids = new Map(); // id -> cité exactement par la règle ?
    for (const t of r.techniques) { ids.set(t, true); if (!ids.has(parentOf(t))) ids.set(parentOf(t), false); }
    for (const [id, exact] of ids) {
      const e = m.get(id) || { n: 0, best: 0, exact: 0, rules: [], items: [] };
      e.n++; e.best = Math.max(e.best, c); if (exact) e.exact = Math.max(e.exact, c); e.rules.push(r.name); e.items.push(r); m.set(id, e);
    }
  }
  return m;
}
const subsOf = id => attack.techniques.filter(t => t.id.startsWith(id + '.')).map(t => t.id);
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
const LABEL = { cov: 'couvert', part: 'partiel', gap: 'trou' };
const SHOW = { all: 'Toutes les techniques', scenario: 'Techniques des scénarios', gap: 'Trous uniquement', cov: 'Couvertes uniquement' };
const view = { q: '', sc: '', show: 'all' }; // filtres conservés tant que la page est ouverte

export function render(root) {
  const cm = coverageMap();
  const parents = attack.techniques.filter(t => !t.id.includes('.'));
  const relSet = () => new Set(state.scenarios.filter(s => !view.sc || s.id === view.sc).flatMap(s => s.techniques.map(parentOf)));
  const kind = (t, rel) => { const k = status(cm, t.id); return k === 'gap' ? (rel.has(t.id) ? 'gap' : 'none') : k; };

  const total = new Set(state.scenarios.flatMap(s => s.techniques)).size;
  const rowsHtml = state.scenarios.map(s => {
    const st = s.techniques.map(id => [id, status(cm, id)]);
    const c = x => st.filter(y => y[1] === x).length;
    return `<tr><td><b class="tag sref">${sref(s)}</b> <b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span></td>
      <td>${s.techniques.length ? Math.round(100 * c('cov') / s.techniques.length) : 0}% <span class="mut">(${c('cov')} couvertes, ${c('part')} partielles, ${c('gap')} trous)</span></td>
      <td>${st.map(([id, k]) => `<span class="tag ${k}" title="${esc(attack.techniques.find(t => t.id === id)?.name)}">${id}</span>`).join('')}</td></tr>`;
  }).join('');

  const prio = { high: 0, medium: 1, low: 2 }, gaps = new Map();
  state.scenarios.forEach(s => { for (const id of s.techniques) if (status(cm, id) !== 'cov') {
    const g = gaps.get(id) || { scs: [], p: 3 }; g.scs.push({ ref: sref(s), name: s.name }); g.p = Math.min(g.p, prio[s.priority] ?? 1); gaps.set(id, g);
  } });
  const gapRows = [...gaps].sort((a, b) => a[1].p - b[1].p || b[1].scs.length - a[1].scs.length)
    .map(([id, g]) => `<tr><td>${id} ${esc(attack.techniques.find(t => t.id === id)?.name)}</td><td class="${status(cm, id)}">${LABEL[status(cm, id)]}</td><td>${g.scs.map(x => `<div><span class="tag sref">${x.ref}</span> ${esc(x.name)}</div>`).join('')}</td></tr>`).join('');

  root.innerHTML = `${state.rules.length || state.scenarios.length ? '' : '<div class="card"><b>Aucune donnée.</b> Génère des scénarios et mappe des règles, ou <button id="demo" class="pri">charge la démo complète</button></div>'}
  <div class="bar"><button id="nav">Exporter couche ATT&CK Navigator</button><button id="csv">Exporter CSV (règles)</button>
    <span class="mut">${state.rules.length} règles · ${state.scenarios.length} scénarios · ${total} techniques de scénario</span></div>
  <h2>Matrice ATT&CK</h2>
  <div class="mtools">
    <input id="q" type="search" placeholder="Chercher T1059 ou « credential »" aria-label="Chercher une technique">
    <select id="msc" aria-label="Scénario"><option value="">Tous les scénarios</option>${state.scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
    <select id="mshow" aria-label="Afficher">${Object.entries(SHOW).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span id="legend"></span>
  </div>
  <div id="matrix" class="matrix"></div><aside id="detail" aria-live="polite"></aside>
  <h2>Couverture par scénario</h2><table><thead><tr><th>Scénario</th><th>Couverture</th><th>Techniques</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan=3 class="mut">Aucun scénario</td></tr>'}</tbody></table>
  <h2>Trous priorisés</h2><table><thead><tr><th>Technique</th><th>Statut</th><th>Scénarios concernés</th></tr></thead><tbody>${gapRows || '<tr><td colspan=3 class="mut">Aucun trou</td></tr>'}</tbody></table>`;

  function drawMatrix() {
    const rel = relSet(), q = view.q.trim().toLowerCase(), n = { cov: 0, part: 0, gap: 0 };
    for (const t of parents) { const k = kind(t, rel); if (rel.has(t.id) && k !== 'none') n[k]++; }
    const keep = (t, k) => (!q || (t.id + ' ' + t.name).toLowerCase().includes(q))
      && (view.show === 'all' || (view.show === 'scenario' && rel.has(t.id)) || (view.show === 'gap' && k === 'gap') || (view.show === 'cov' && k === 'cov'));
    const cols = attack.tactics.map(tc => {
      const all = parents.filter(t => t.tactics.includes(tc.short));
      const relAll = all.filter(t => rel.has(t.id)), relCov = relAll.filter(t => kind(t, rel) === 'cov');
      const cells = all.filter(t => keep(t, kind(t, rel)));
      if (!cells.length && (view.show !== 'all' || q)) return '';
      return `<div class="col"><h3>${esc(tc.name)}${relAll.length ? `<span title="Techniques de scénario couvertes dans cette tactique">${relCov.length}/${relAll.length}</span>` : ''}</h3>${cells.map(t => {
        const k = kind(t, rel), e = cm.get(t.id);
        return `<button class="cell ${k} ${rel.has(t.id) ? 'rel' : ''}" data-id="${t.id}"><b>${t.id}</b>${e ? `<i>×${e.n}</i>` : ''}<span>${esc(t.name)}</span></button>`;
      }).join('')}</div>`;
    }).join('');
    $(root, '#matrix').innerHTML = cols || '<p class="mut" style="padding:1rem">Aucune technique ne correspond à ces filtres.</p>';
    $(root, '#legend').innerHTML = `<span class="lg cov">Couvert ${n.cov}</span><span class="lg part">Partiel ${n.part}</span><span class="lg gap">Trou ${n.gap}</span><span class="lg none">Hors scénarios</span>`;
  }

  function openDetail(id) {
    const t = parents.find(x => x.id === id), e = cm.get(id), k = kind(t, relSet());
    const scs = state.scenarios.filter(s => s.techniques.some(x => parentOf(x) === id));
    const subs = attack.techniques.filter(x => x.id.startsWith(id + '.'));
    const st = { cov: ['cov', 'Couvert'], part: ['part', 'Partiel'], gap: ['gap', 'Trou : aucune règle'], none: ['', 'Non couvert, hors scénarios'] }[k];
    const rules = e ? e.items.map(r => `<div class="item"><b>${esc(r.name)}</b><div class="mut">${r.techniques.map(x => `<span class="tag">${x}</span>`).join('')} ${esc(r.confidence || '')}${r.stage ? ' · ' + esc(r.stage) : ''}</div></div>`).join('') : '<p class="mut">Aucune règle ne cible cette technique.</p>';
    const scn = scs.map(s => `<div class="item">${esc(s.name)} <span class="tag">${esc(s.priority)}</span></div>`).join('') || '<p class="mut">Aucun scénario ne l’utilise.</p>';
    const sub = subs.map(x => { const c = cm.get(x.id); return `<div class="item sub"><span class="tag ${c ? (c.best >= 2 ? 'cov' : 'part') : ''}">${x.id}</span> ${esc(x.name)}${c ? ` <span class="mut">×${c.n}</span>` : ''}</div>`; }).join('') || '<p class="mut">Aucune.</p>';
    const d = $(root, '#detail');
    d.innerHTML = `<button class="x" aria-label="Fermer">×</button><h3>${id} ${esc(t.name)}</h3>
      <p><span class="tag ${st[0]}">${st[1]}</span> <a href="https://attack.mitre.org/techniques/${id}/" target="_blank" rel="noopener">Fiche MITRE</a></p>
      <h4>Règles (${e ? e.items.length : 0})</h4>${rules}<h4>Scénarios (${scs.length})</h4>${scn}<h4>Sous-techniques (${subs.filter(x => (cm.get(x.id)?.exact || 0) >= 2).length}/${subs.length} couvertes)</h4>${sub}`;
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

  $(root, '#nav').onclick = () => exportJson('mitremapper-layer.json', {
    name: 'MITREMapper coverage', versions: { layer: '4.5', navigator: '5.1.0', attack: String(attack.version).split('.')[0] }, domain: 'enterprise-attack',
    gradient: { colors: ['#e0a526', '#2f9e5b'], minValue: 1, maxValue: 3 },
    techniques: [...cm].map(([techniqueID, e]) => ({ techniqueID, score: e.best, comment: e.rules.join('; ') })),
  });
  $(root, '#csv').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, sc = id => state.scenarios.find(s => s.id === id)?.name;
    exportJson('mitremapper-rules.csv', ['règle,source,techniques,scénarios,étape,confiance,note',
      ...state.rules.map(r => [r.name, r.source, r.techniques.join(' '), r.scenarios.map(sc).join(' | '), r.stage, r.confidence, r.note].map(q).join(','))].join('\n'));
  };
}
