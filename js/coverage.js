import { state, exportJson } from './store.js';
import { attack, parentOf } from './attack.js';
import { esc, $ } from './ui.js';

const RANK = { low: 1, medium: 2, high: 3 };
/** id -> {n, best, rules[]} ; une règle sur une sous-technique compte aussi pour la parente. */
function coverageMap() {
  const m = new Map();
  for (const r of state.rules) for (const t of r.techniques) for (const id of new Set([t, parentOf(t)])) {
    const e = m.get(id) || { n: 0, best: 0, rules: [] };
    e.n++; e.best = Math.max(e.best, RANK[r.confidence] || 2); e.rules.push(r.name); m.set(id, e);
  }
  return m;
}
/** Statut d'une technique de scénario : cov (règle medium+), part (low, ou seule la parente/une sous-technique), gap. */
function status(cm, id) {
  const e = cm.get(id);
  if (!e) return 'gap';
  const exact = state.rules.some(r => r.techniques.includes(id));
  return exact && e.best >= 2 ? 'cov' : 'part';
}
const LABEL = { cov: 'couvert', part: 'partiel', gap: 'trou' };

export function render(root) {
  const cm = coverageMap(), scTech = new Set(state.scenarios.flatMap(s => s.techniques.map(parentOf)));
  const parents = attack.techniques.filter(t => !t.id.includes('.'));
  const cols = attack.tactics.map(tc => `<div class="col"><h3>${esc(tc.name)}</h3>${parents.filter(t => t.tactics.includes(tc.short)).map(t => {
    const e = cm.get(t.id);
    return `<div class="cell ${e ? 'c' + e.best : ''} ${scTech.has(t.id) ? 'sc' : ''}" title="${esc(e ? e.rules.join('\n') : 'non couvert')}">${t.id} ${esc(t.name)}${e ? ` (${e.n})` : ''}</div>`;
  }).join('')}</div>`).join('');

  const total = new Set(state.scenarios.flatMap(s => s.techniques)).size;
  const rowsHtml = state.scenarios.map(s => {
    const st = s.techniques.map(id => [id, status(cm, id)]);
    const c = k => st.filter(x => x[1] === k).length;
    return `<tr><td><b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span></td>
      <td>${s.techniques.length ? Math.round(100 * c('cov') / s.techniques.length) : 0}% <span class="mut">(${c('cov')} couvertes, ${c('part')} partielles, ${c('gap')} trous)</span></td>
      <td>${st.map(([id, k]) => `<span class="tag ${k}" title="${esc(attack.techniques.find(t => t.id === id)?.name)}">${id}</span>`).join('')}</td></tr>`;
  }).join('');

  const prio = { high: 0, medium: 1, low: 2 }, gaps = new Map();
  for (const s of state.scenarios) for (const id of s.techniques) if (status(cm, id) !== 'cov') {
    const g = gaps.get(id) || { scs: [], p: 3 }; g.scs.push(s.name); g.p = Math.min(g.p, prio[s.priority] ?? 1); gaps.set(id, g);
  }
  const gapRows = [...gaps].sort((a, b) => a[1].p - b[1].p || b[1].scs.length - a[1].scs.length)
    .map(([id, g]) => `<tr><td>${id} ${esc(attack.techniques.find(t => t.id === id)?.name)}</td><td class="${status(cm, id)}">${LABEL[status(cm, id)]}</td><td>${g.scs.map(esc).join(', ')}</td></tr>`).join('');

  root.innerHTML = `
  <div class="bar"><button id="nav">Exporter couche ATT&CK Navigator</button><button id="csv">Exporter CSV (règles)</button>
    <span class="mut">${state.rules.length} règles · ${state.scenarios.length} scénarios · ${total} techniques de scénario · liseré rouge = technique d'un scénario</span></div>
  <h2>Matrice ATT&CK</h2><div class="matrix">${cols}</div>
  <h2>Couverture par scénario</h2><table><thead><tr><th>Scénario</th><th>Couverture</th><th>Techniques</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan=3 class="mut">Aucun scénario</td></tr>'}</tbody></table>
  <h2>Trous priorisés</h2><table><thead><tr><th>Technique</th><th>Statut</th><th>Scénarios concernés</th></tr></thead><tbody>${gapRows || '<tr><td colspan=3 class="mut">Aucun trou</td></tr>'}</tbody></table>`;

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
