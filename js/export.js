// Livrables client : rapport HTML imprimable (PDF), classeur Excel (.xlsx), couches ATT&CK Navigator.
// Sans dépendance : le .xlsx et le .zip sont écrits ici (zip non compressé). A = analysis() de coverage.js.
import { state, sref } from './store.js';
import { attack, tech } from './attack.js';
import { esc } from './ui.js';

const LBL = { cov: 'Couvert', part: 'Partiel', gap: 'Trou' };
const PRIO = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
const prio = p => PRIO[p] || p || '';
const name = id => tech(id)?.name || '';
const scName = id => state.scenarios.find(s => s.id === id);

/** Recommandation déterministe pour une technique de scénario non couverte. */
export function reco(A, g) {
  if (g.k === 'gap') return 'Aucune détection : créer une règle pour cette technique.';
  const e = A.cm.get(g.id);
  if (!e) return 'Seule la technique parente est couverte : vérifier que la détection couvre cette sous-technique.';
  if (e.best < 2) return 'Détection de confiance basse : renforcer ou compléter la règle existante.';
  const subs = attack.techniques.filter(t => t.id.startsWith(g.id + '.'));
  const ok = subs.filter(t => (A.cm.get(t.id)?.exact || 0) >= 2).length;
  return `Sous-techniques couvertes : ${ok}/${subs.length} ; compléter les variantes utilisées par les scénarios.`;
}

/* ---------- ATT&CK Navigator ---------- */
const versions = () => ({ layer: '4.5', navigator: '5.1.0', attack: String(attack.version).split('.')[0] });
/** Couche globale (score = meilleure confiance) ou couche d'un scénario (3 couvert, 2 partiel, 1 trou). */
export function layer(A, s) {
  if (!s) return {
    name: `MITREMapper : ${state.name}`, description: 'Couverture globale : score = meilleure confiance des règles (1 basse, 2 moyenne, 3 haute)',
    versions: versions(), domain: 'enterprise-attack', gradient: { colors: ['#ef9f27', '#2f9e5b'], minValue: 1, maxValue: 3 },
    techniques: [...A.cm].map(([techniqueID, e]) => ({ techniqueID, score: e.best, comment: e.rules.join('; ') })),
  };
  const x = A.scen.find(r => r.s === s), score = { gap: 1, part: 2, cov: 3 };
  return {
    name: `${sref(s)} ${s.name}`, description: `Scénario ${sref(s)}, priorité ${prio(s.priority)} : 3 couvert, 2 partiel, 1 trou`,
    versions: versions(), domain: 'enterprise-attack', gradient: { colors: ['#e24b4a', '#ef9f27', '#2f9e5b'], minValue: 1, maxValue: 3 },
    techniques: x.st.map(([techniqueID, k]) => ({ techniqueID, score: score[k], comment: `${LBL[k]} : ${(A.cm.get(techniqueID)?.rules || []).join('; ') || 'aucune règle'}` })),
  };
}
export const layersZip = A => zip({
  '00-global.json': JSON.stringify(layer(A), null, 1),
  ...Object.fromEntries(A.scen.map(({ s }) => [`${sref(s)}.json`, JSON.stringify(layer(A, s), null, 1)])),
});

/* ---------- ZIP (méthode « stockée », sans compression) ---------- */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [fname, data] of Object.entries(files)) {
    const n = enc.encode(fname), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [12, 0x21, 2], [14, crc, 4], [18, d.length, 4], [22, d.length, 4], [26, n.length, 2]]
      .forEach(([o, v, z]) => z === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [14, 0x21, 2], [16, crc, 4], [20, d.length, 4], [24, d.length, 4], [28, n.length, 2], [42, off, 4]]
      .forEach(([o, v, z]) => z === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    parts.push(h, n, d); central.push(c, n);
    off += 30 + n.length + d.length;
  }
  const size = central.reduce((a, x) => a + x.byteLength, 0), count = central.length / 2, e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

/* ---------- Excel (.xlsx) ---------- */
const xesc = v => String(v ?? '').slice(0, 32000).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = i => { let s = ''; for (i++; i; i = (i - 1) / 26 | 0) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
function sheet(rows, widths) {
  const cell = (v, r, c) => {
    const ref = colName(c) + (r + 1), st = r === 0 ? ' s="1"' : '';
    return typeof v === 'number' ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    + `<sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}
export function workbook(A) {
  const c = state.client, refs = ids => ids.map(scName).filter(Boolean).map(sref).join(' '), rel = new Set(A.scen.flatMap(x => x.st.map(([id]) => id)));
  const sheets = {
    'Synthèse': [[['Indicateur', 'Valeur'], ['Projet', state.name], ['Date', new Date().toLocaleDateString('fr-FR')], ['Référentiel', `ATT&CK Enterprise v${attack.version}`],
      ['Secteur', c.sector], ['Taille', c.size], ['Pays / zones', c.country], ['Actifs clés', c.assets],
      ['Scénarios', state.scenarios.length], ['Règles', state.rules.length], ['Règles validées', state.rules.filter(r => r.reviewed).length],
      ['Techniques de scénario', A.nTech], ['Couvertes', A.tot.cov], ['Partielles', A.tot.part], ['Trous', A.tot.gap], ['Couverture globale (%)', A.pct]], [28, 60]],
    'Scénarios': [[['Réf', 'Scénario', 'Priorité', 'Acteurs', 'Résumé', 'Techniques', 'Couvertes', 'Partielles', 'Trous', 'Couverture (%)', 'Règles liées'],
      ...A.scen.map(({ s, c: n, pct }) => [sref(s), s.name, prio(s.priority), s.actors || '', s.summary || '', s.techniques.join(' '), n.cov, n.part, n.gap, pct,
        state.rules.filter(r => r.scenarios.includes(s.id)).length])], [6, 45, 10, 25, 60, 40, 11, 11, 8, 14, 12]],
    'Trous': [[['Technique', 'Nom', 'Statut', 'Priorité', 'Scénarios', 'Recommandation'],
      ...A.gaps.map(g => [g.id, g.name, LBL[g.k], prio(['high', 'medium', 'low'][g.p]), g.scs.map(sref).join(' '), reco(A, g)])], [12, 40, 10, 10, 22, 80]],
    'Règles': [[['Règle', 'Source', 'Origine', 'Techniques', 'Scénarios', 'Étape', 'Confiance', 'Validée', 'Note'],
      ...state.rules.map(r => [r.name, r.source, r.by === 'tags' ? 'tags' : r.by === 'ia' ? 'IA' : '', r.techniques.join(' '), refs(r.scenarios), r.stage || '', r.confidence || '', r.reviewed ? 'oui' : 'non', r.note || ''])],
      [45, 16, 9, 30, 22, 14, 11, 9, 70]],
    'Techniques': [[['Technique', 'Nom', 'Tactiques', 'Statut', 'Dans un scénario', 'Nb règles', 'Règles'],
      ...attack.techniques.filter(t => rel.has(t.id) || A.cm.has(t.id)).map(t => {
        const k = A.status(t.id), e = A.cm.get(t.id);
        return [t.id, t.name, t.tactics.join(', '), k === 'gap' && !rel.has(t.id) ? '' : LBL[k], rel.has(t.id) ? 'oui' : 'non', e ? e.n : 0, e ? e.rules.join('; ') : ''];
      })], [12, 40, 30, 10, 16, 10, 80]],
  };
  const names = Object.keys(sheets), ns = 'http://schemas.openxmlformats.org/';
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    ...Object.fromEntries(names.map((n, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet(...sheets[n])])),
  };
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ---------- Rapport client (HTML imprimable) ---------- */
export function reportHtml(A) {
  const c = state.client, date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const rel = new Set(A.scen.flatMap(x => x.st.map(([id]) => id.split('.')[0])));
  const validated = state.rules.filter(r => r.reviewed).length;
  const kpi = (v, l, cls = '') => `<div class="kpi ${cls}"><b>${v}</b><span>${l}</span></div>`;
  const bar = n => { const t = n.cov + n.part + n.gap || 1; return `<div class="bar">${['cov', 'part', 'gap'].map(k => n[k] ? `<i class="${k}" style="width:${100 * n[k] / t}%"></i>` : '').join('')}</div>`; };
  const parents = attack.techniques.filter(t => !t.id.includes('.'));
  const cols = attack.tactics.map(tc => {
    const cells = parents.filter(t => t.tactics.includes(tc.short)).map(t => [t, A.status(t.id)]).filter(([t, k]) => k !== 'gap' || rel.has(t.id));
    return cells.length ? `<div class="col"><h4>${esc(tc.name)}</h4>${cells.map(([t, k]) => `<div class="cell ${k}${rel.has(t.id) ? ' rel' : ''}"><b>${t.id}</b> ${esc(t.name)}</div>`).join('')}</div>` : '';
  }).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Couverture de détection : ${esc(state.name)}</title><style>
:root{--ind:#451DC7;--ind8:#2D1380;--ink:#16121F;--mut:#6B6580;--line:#E6E4EE;--cov:#04F06A;--covt:#088A42;--part:#EF9F27;--partb:#FEF6E8;--gap:#E24B4A;--gapb:#FDF1F1}
*{box-sizing:border-box}body{margin:0;font:11pt/1.5 Inter,'Segoe UI',system-ui,sans-serif;color:var(--ink);background:#fff}
h1,h2,h3,h4{font-family:Poppins,'Segoe UI',system-ui,sans-serif;line-height:1.25}
header{background:radial-gradient(120% 120% at 25% 15%,#5226E0 0%,#451DC7 38%,#2D1380 100%);color:#fff;padding:28px 36px}
header h1{margin:0 0 6px;font-size:22pt}header p{margin:0;opacity:.85}
main{padding:8px 36px 32px;max-width:1200px;margin:auto}h2{color:var(--ind);font-size:15pt;margin:28px 0 10px;border-bottom:2px solid var(--ind);padding-bottom:4px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.kpi{border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.kpi b{display:block;font:600 20pt Poppins,'Segoe UI',sans-serif;color:var(--ind8)}.kpi span{color:var(--mut);font-size:9.5pt}.kpi.cov b{color:var(--covt)}.kpi.part b{color:#8A4800}.kpi.gap b{color:var(--gap)}
table{border-collapse:collapse;width:100%;font-size:9.5pt}th,td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}th{color:var(--mut);font-weight:600;background:#F5F4F9}
tr{break-inside:avoid}.ref{display:inline-block;background:var(--ind);color:#fff;border-radius:4px;padding:0 6px;font-weight:600;font-size:9pt}
.bar{display:flex;height:10px;border-radius:5px;overflow:hidden;background:var(--line);min-width:120px}.bar i{display:block}.bar .cov{background:var(--cov)}.bar .part{background:var(--part)}.bar .gap{background:var(--gap)}
.st{font-weight:600}.st.cov{color:var(--covt)}.st.part{color:#8A4800}.st.gap{color:var(--gap)}
.matrix{display:flex;flex-wrap:wrap;gap:6px}.col{width:150px}.col h4{margin:0 0 4px;font-size:9pt;color:var(--ind8);border-bottom:2px solid var(--ind)}
.cell{font-size:7.5pt;line-height:1.25;padding:3px 4px;margin-bottom:2px;border:1px solid var(--line);border-radius:3px;break-inside:avoid}
.cell.cov{background:var(--cov);border-color:var(--cov)}.cell.part{background:var(--partb);border-color:var(--part)}.cell.gap{background:var(--gapb);border-color:var(--gap)}.cell.rel{box-shadow:inset 3px 0 0 var(--ind)}
.legend span{display:inline-block;margin-right:14px;font-size:9pt}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.mut{color:var(--mut)}.noprint{position:fixed;top:12px;right:12px}.noprint button{font:600 10pt Inter,sans-serif;background:#fff;color:var(--ind);border:0;border-radius:999px;padding:8px 16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2)}
@page{size:A4;margin:12mm}@page matrice{size:A4 landscape;margin:10mm}.pg-matrix{page:matrice;break-before:page}
@media print{.noprint{display:none}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{break-after:avoid}}
</style></head><body>
<div class="noprint"><button onclick="print()">Imprimer / PDF</button></div>
<header><h1>Couverture de détection : ${esc(state.name)}</h1>
<p>${date} · Référentiel MITRE ATT&amp;CK Enterprise v${esc(attack.version)}${[c.sector, c.size, c.country].filter(Boolean).length ? ' · ' + esc([c.sector, c.size, c.country].filter(Boolean).join(' · ')) : ''}</p></header>
<main>
<h2>Synthèse</h2>
<div class="kpis">${kpi(A.pct + ' %', 'des techniques des scénarios couvertes', 'cov')}${kpi(state.scenarios.length, 'scénarios de menace')}${kpi(state.rules.length, `règles analysées (${validated} validées)`)}${kpi(A.tot.cov, 'techniques couvertes', 'cov')}${kpi(A.tot.part, 'techniques partielles', 'part')}${kpi(A.tot.gap, 'trous de détection', 'gap')}</div>
<p>Sur les ${A.nTech} techniques ATT&amp;CK mobilisées par les ${state.scenarios.length} scénarios retenus${c.assets ? ` (actifs clés : ${esc(c.assets)})` : ''}, ${A.tot.cov} sont couvertes par au moins une règle fiable, ${A.tot.part} le sont partiellement et ${A.tot.gap} ne disposent d'aucune détection.${A.gaps.length ? ` Les ${Math.min(5, A.gaps.length)} actions prioritaires portent sur ${A.gaps.slice(0, 5).map(g => `${g.id} (${esc(g.name)})`).join(', ')}.` : ''}</p>

<h2>Couverture par scénario</h2>
<table><thead><tr><th>Réf</th><th>Scénario</th><th>Priorité</th><th>Couverture</th><th></th><th>Détail</th></tr></thead><tbody>
${A.scen.map(({ s, c: n, pct }) => `<tr><td><span class="ref">${sref(s)}</span></td><td><b>${esc(s.name)}</b>${s.actors ? `<div class="mut">${esc(s.actors)}</div>` : ''}</td><td>${prio(s.priority)}</td><td>${bar(n)}</td><td><b>${pct} %</b></td><td class="mut">${n.cov} couvertes, ${n.part} partielles, ${n.gap} trous</td></tr>`).join('')}
</tbody></table>

<h2>Trous prioritaires et recommandations</h2>
${A.gaps.length ? `<table><thead><tr><th>Technique</th><th>Statut</th><th>Priorité</th><th>Scénarios</th><th>Recommandation</th></tr></thead><tbody>
${A.gaps.map(g => `<tr><td><b>${g.id}</b> ${esc(g.name)}</td><td class="st ${g.k}">${LBL[g.k]}</td><td>${prio(['high', 'medium', 'low'][g.p])}</td><td>${g.scs.map(s => `<span class="ref" title="${esc(s.name)}">${sref(s)}</span>`).join(' ')}</td><td>${esc(reco(A, g))}</td></tr>`).join('')}
</tbody></table>` : '<p>Aucun trou : toutes les techniques des scénarios sont couvertes.</p>'}

<section class="pg-matrix"><h2>Matrice ATT&amp;CK</h2>
<p class="legend"><span><i style="background:var(--cov)"></i>Couvert</span><span><i style="background:var(--partb);border:1px solid var(--part)"></i>Partiel</span><span><i style="background:var(--gapb);border:1px solid var(--gap)"></i>Trou (technique d'un scénario)</span><span><i style="background:#fff;box-shadow:inset 3px 0 0 var(--ind);border:1px solid var(--line)"></i>Technique d'un scénario</span></p>
<div class="matrix">${cols}</div></section>

<h2>Inventaire des règles</h2>
<table><thead><tr><th>Règle</th><th>Techniques</th><th>Scénarios</th><th>Étape</th><th>Confiance</th><th>Origine</th><th>Validée</th></tr></thead><tbody>
${state.rules.map(r => `<tr><td><b>${esc(r.name)}</b><div class="mut">${esc(r.source)}</div></td><td>${r.techniques.map(t => `<span title="${esc(name(t))}">${t}</span>`).join(', ')}</td><td>${r.scenarios.map(scName).filter(Boolean).map(s => `<span class="ref">${sref(s)}</span>`).join(' ')}</td><td>${esc(r.stage || '')}</td><td>${esc(r.confidence || '')}</td><td>${r.by === 'tags' ? 'tags' : r.by === 'ia' ? 'IA' : ''}</td><td>${r.reviewed ? 'oui' : 'non'}</td></tr>`).join('')}
</tbody></table>

<h2>Méthode et limites</h2>
<ul>
<li>Scénarios dérivés de sources CTI et du profil client ; techniques validées contre le référentiel MITRE ATT&amp;CK Enterprise v${esc(attack.version)}.</li>
<li>Règles mappées à partir de leurs tags ATT&amp;CK quand ils existent, sinon par analyse assistée par IA ; ${validated}/${state.rules.length} règles relues et validées par un analyste.</li>
<li><b>Couvert</b> : règle de confiance moyenne ou haute sur la technique, ou sur toutes ses sous-techniques. <b>Partiel</b> : seulement certaines sous-techniques, confiance basse, ou seule la technique parente. <b>Trou</b> : aucune règle.</li>
<li>La couverture mesure l'existence de détections, pas leur efficacité opérationnelle (qualité des journaux, taux de faux positifs, délais de traitement).</li>
</ul>
<p class="mut">Généré par MITREMapper (Wavestone) le ${date}.</p>
</main></body></html>`;
}
