import { state, save, uid, sample, sref } from './store.js';
import { chatJson, fence, UNTRUSTED } from './llm.js';
const MAX_RULE = 3000; // caractères d'une règle envoyés au LLM
import { attack, tech, validate, parentOf, promptCatalog } from './attack.js';
import { esc, $, readFiles, run, undoable, attach, onTab } from './ui.js';
import { isAuthorized } from './keys.js';
import { t, lang } from './i18n.js';

const SYSTEM = (stages, scenarios) => `Tu es un ingénieur detection engineering. Pour chaque règle de détection (Sigma, KQL, SPL, EDR, ou simple documentation), tu identifies les techniques ATT&CK Enterprise qu'elle détecte réellement (pas celles simplement liées au contexte).
Réponds en JSON : {"results":[{"i":0,"techniques":["T1059.001"],"scenarios":[{"s":"S1","why":"une phrase"}],"stage":"","confidence":"high|medium|low","note":""}]}
- i = index de la règle fourni en entrée ; techniques = IDs existants, préférer la sous-technique quand la logique la cible précisément.
- stage = une valeur parmi : ${stages.join(' | ')}
- scenarios = scénarios ci-dessous (S1, S2…) dont la règle détecte réellement une étape ; sois sélectif, [] si aucun. why = une phrase qui dit quelle étape du scénario la règle détecte.
- confidence : high = détection directe et robuste ; medium = partielle/contournable ; low = indirecte ou très bruitée.
- why et note : ${lang === 'en' ? 'rédigés EN ANGLAIS' : 'rédigés en français'}.
- ${UNTRUSTED}
Scénarios :\n${scenarios.map(s => `${sref(s)} ${s.name} [${s.techniques.join(',')}]`).join('\n') || '(aucun)'}
${promptCatalog()}`;

/** IDs ATT&CK déclarés dans la règle, sans IA : tags Sigma (attack.t1059.001), champs MITRE des exports Sentinel/Splunk/Elastic (T1059…). Validés contre le référentiel. */
export const extractTechniques = body => validate((String(body).match(/\bT\d{4}(?:\.\d{3})?\b/gi) || [])).ok;
const tagsOf = r => (r.tags ??= extractTechniques(r.body));
/** Divergence (au niveau technique parente) entre les tags déclarés et la lecture de l'IA ; null si aucun. */
export const tagDiff = (tags, ia) => {
  const P = a => new Set(a.map(parentOf)), pt = P(tags), pi = P(ia);
  const d = { tags: tags.filter(x => !pi.has(parentOf(x))), ia: ia.filter(x => !pt.has(parentOf(x))) };
  return tags.length && (d.tags.length || d.ia.length) ? d : null;
};
/** Mapping déterministe depuis les tags : scénarios liés = ceux qui partagent une technique. */
const fromTags = (r, tags, S) => {
  const links = S.map(s => [s, common({ techniques: tags }, s)]).filter(([, c]) => c.length);
  return { techniques: tags, rejected: [], scenarios: links.map(([s]) => s.id), mapped: true, reviewed: false, by: 'tags', tagDiff: null,
    why: Object.fromEntries(links.map(([s, c]) => [s.id, t('Lien automatique : technique commune {ids}.', { ids: c.join(', ') })])),
    note: t('Techniques lues dans les tags de la règle (sans IA).') };
};

/** Découpe un texte collé en règles (séparateur : ligne '---' ou '==='). */
const mk = (source, body, name) => ({ id: uid(), source, body, techniques: [], scenarios: [], stage: '', confidence: '', mapped: false,
  name: String(name || (body.match(/^title:\s*(.+)$/mi) || body.match(/^(?:name|displayName):\s*(.+)$/mi) || body.match(/^(.{1,80})/))[1]).trim().slice(0, 200) });
const splitRules = (name, text) => text.split(/^\s*(?:---|===)\s*$/m).map(x => x.trim()).filter(Boolean).map(body => mk(name, body));
/** Règles d'un fichier : JSON (tableau, template ARM Sentinel, export REST Splunk, objet seul), savedsearches.conf Splunk, sinon
 *  texte découpé par ---. bulk (dossier, zip) : les documents YAML sans detection/query/search (config) sont ignorés. */
export function parseRuleFile(name, text, bulk = false) {
  const ext = name.toLowerCase().match(/\.[^./]*$/)?.[0];
  if (bulk && /(^|\/)(readme|changelog|license|contributing)[^/]*$/i.test(name)) return [];
  if (ext === '.json') {
    let d; try { d = JSON.parse(text); } catch { return splitRules(name, text); }
    const items = Array.isArray(d) ? d : Array.isArray(d?.resources) ? d.resources.map(x => x?.properties).filter(Boolean)
      : Array.isArray(d?.entry) ? d.entry.map(x => ({ name: x?.name, ...x?.content })) : [d];
    return items.filter(o => o && typeof o === 'object').map(o => mk(name, JSON.stringify(o, null, 1), o.displayName || o.name || o.title || o.rule_name || o.id || t('règle')));
  }
  if (ext === '.conf') { // [stanza] … search = …
    const p = text.split(/^\[([^\]\n]+)\]\s*$/m), out = [];
    for (let i = 1; i < p.length; i += 2) if (p[i] !== 'default' && /^\s*search\s*=/m.test(p[i + 1])) out.push(mk(name, `[${p[i]}]\n${p[i + 1].trim()}`, p[i]));
    return out;
  }
  const r = splitRules(name, text);
  return bulk && /^\.ya?ml$/.test(ext) ? r.filter(x => /^\s*(?:detection|query|search)\s*:/m.test(x.body)) : r;
}
export const RULE_EXT = ['.yml', '.yaml', '.json', '.txt', '.md', '.kql', '.spl', '.csv', '.conf'];

/** Techniques de la règle qui recoupent celles du scénario (comparaison au niveau technique parente). */
export const common = (r, s) => {
  const p = new Set(s.techniques.map(parentOf));
  return [...new Set(r.techniques.filter(x => p.has(parentOf(x))))];
};
/** 'ok' lié et cohérent · 'suspect' lié sans technique commune · 'miss' non lié mais technique commune · '' sinon. */
export const linkState = (r, s) => {
  const c = common(r, s).length;
  return r.scenarios.includes(s.id) ? (c ? 'ok' : 'suspect') : (c ? 'miss' : '');
};
const flags = r => {
  const st = state.scenarios.map(s => linkState(r, s)), n = r.scenarios.length;
  return { todo: !r.reviewed, suspect: st.includes('suspect'), miss: st.includes('miss'), none: !n, wide: n >= 4 && n > state.scenarios.length / 2, low: r.confidence === 'low', diff: !!r.tagDiff };
};
const FILTERS = { all: t('Toutes'), todo: t('À relire'), suspect: t('Suspects'), miss: t('Oublis possibles'), none: t('Sans scénario'), wide: t('Trop larges'), low: t('Confiance basse'), diff: t('Divergence tags / IA') };
const SYM = { ok: '●', suspect: '⚠', miss: '◌', '': '·' };
const view = { q: '', f: 'all', hl: '', sel: null }; // état d'affichage conservé tant que la page est ouverte
/** Ouvre une règle dans l'onglet Règles (volet de détail), filtres réinitialisés : à appeler avant d'afficher l'onglet. */
export const focusRule = id => Object.assign(view, { sel: id, f: 'all', q: '', open: true });
const scId = (ref, sc) => sc.find(s => s.ref === +String(ref).replace(/\D/g, ''))?.id;

/** Pipeline de mapping unique (onglet Règles, ébauches Sigma) : tags d'abord, sans IA ; puis l'IA pour les règles sans tag,
 *  ou pour toutes si verify. Modifie les règles reçues ; onBatch() après chaque étape (sauvegarde, affichage). */
export async function mapRules(rules, { verify = false, signal, say = () => {}, onBatch = () => {} } = {}) {
  const S = state.scenarios, n = +state.settings.batch || 8, todo = [];
  let nTags = 0;
  for (const r of rules) { // 1. déterministe d'abord : techniques déclarées dans la règle
    const tags = tagsOf(r);
    if (tags.length) { Object.assign(r, fromTags(r, tags, S)); nTags++; }
    if (!tags.length || verify) todo.push(r);
  }
  onBatch();
  if (!todo.length) return { nTags, nAI: 0, cut: 0 };
  if (!isAuthorized()) throw new Error(t('{n} règle(s) mappée(s) depuis leurs tags. {m} règle(s) restante(s) nécessitent l’IA : coche l’autorisation dans Paramètres.', { n: nTags, m: todo.length }));
  const system = SYSTEM(state.settings.stages, S);
  for (let i = 0; i < todo.length; i += n) {
    say(t('Lot {i}/{n}…', { i: i / n + 1, n: Math.ceil(todo.length / n) }));
    const batch = todo.slice(i, i + n);
    const user = batch.map((r, k) => `### i=${k}\n${fence('rule', `${r.name}\n${r.body.slice(0, MAX_RULE)}`)}`).join('\n\n');
    const res = (await chatJson({ system, user, signal }));
    for (const x of [res.results || res].flat()) { // sortie LLM = donnée non fiable : valeurs bornées
      const r = batch[x?.i]; if (!r) continue;
      const txt = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
      const v = validate(Array.isArray(x.techniques) ? x.techniques.map(String) : []), links = (Array.isArray(x.scenarios) ? x.scenarios : []).map(e => typeof e === 'string' ? { s: e } : e || {})
        .map(l => ({ id: scId(l.s, S), why: txt(l.why, 1000) })).filter(l => l.id); // ancien format (liste d'IDs) accepté
      Object.assign(r, { techniques: v.ok, rejected: v.rejected, stage: state.settings.stages.includes(x.stage) ? x.stage : '', confidence: ['high', 'medium', 'low'].includes(x.confidence) ? x.confidence : 'medium',
        note: txt(x.note, 2000), mapped: true, reviewed: false,
        scenarios: links.map(l => l.id), why: Object.fromEntries(links.filter(l => l.why).map(l => [l.id, l.why])), by: 'ia', tagDiff: tagDiff(tagsOf(r), v.ok) });
    }
    onBatch();
  }
  return { nTags, nAI: todo.length, cut: todo.filter(r => r.body.length > MAX_RULE).length };
}

export function render(root) {
  root.innerHTML = `
  <details id="imp" ${state.rules.length ? '' : 'open'}><summary><b>${t('Importer des règles')}</b></summary>
    <textarea id="paste" placeholder="${t('Coller des règles ou de la documentation. Séparer plusieurs règles par une ligne --- (YAML Sigma multi-documents OK).')}"></textarea>
    <div class="bar"><button id="demo">${t('Charger les règles d’exemple')}</button><button id="addp">${t('Ajouter le texte collé')}</button>
      <label style="margin:0">${t('Ou fichiers')} <input id="files" type="file" multiple style="width:auto" accept="${RULE_EXT.join(',')},.zip"></label>
      <label style="margin:0">${t('Ou dossier')} <input id="dir" type="file" webkitdirectory style="width:auto"></label><span id="ist"></span>
      <span class="mut">${t('Un fichier = une ou plusieurs règles (séparateur ---) ; .zip et dossiers lus en entier ; JSON (tableau, export Sentinel ARM, export REST Splunk) = une règle par élément ; savedsearches.conf Splunk = une règle par recherche. Les doublons sont ignorés.')}</span></div>
  </details>
  <div class="bar"><button id="map" class="pri">${t('Mapper les règles non traitées')}</button><button id="remap">${t('Tout remapper')}</button><span id="st"></span></div>
  <label class="chk"><input type="checkbox" id="verify"> ${t('Faire aussi relire par l’IA les règles qui ont des tags ATT&amp;CK (détecte les divergences entre tags déclarés et logique de la règle)')}</label>
  <p class="mut" style="margin-top:0">${t('Les règles qui déclarent leurs techniques (tags Sigma <code>attack.t…</code>, champs MITRE des exports SIEM/EDR) sont mappées sans IA ; l’IA ne traite que les autres.')}</p>
  <h2>${t('Revue du mapping')} (<span id="n"></span>)</h2>
  <div class="mtools"><input id="q" type="search" placeholder="${t('Chercher règle ou technique')}" aria-label="${t('Chercher')}"><span id="flt"></span><span id="prog" class="mut"></span></div>
  <p class="mut" style="margin:.2rem 0 .6rem">${t('<b>●</b> lié, techniques en commun · <b class="err">⚠</b> lié sans technique commune (à challenger) · <b style="color:var(--amber)">◌</b> non lié mais technique en commun (oubli possible) · clic sur une cellule = lier / délier · clic sur une ligne = détail')}</p>
  <div class="mwrap"><table class="rm"><thead id="head"></thead><tbody id="rows"></tbody><tfoot id="foot"></tfoot></table></div>
  <aside id="detail" role="region" aria-label="${t('Détail de la règle')}"></aside><datalist id="techlist">${attack.techniques.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</datalist>`;

  if (!isAuthorized()) $(root, '#st').innerHTML = `<span class="mut">${t('IA non autorisée : seules les règles avec tags ATT&amp;CK seront mappées (autorisation dans Paramètres).')}</span>`;
  attach($(root, '#st'), 'map', [$(root, '#map'), $(root, '#remap')]); // mapping lancé avant un changement d'onglet
  const sc = () => state.scenarios, rule = id => state.rules.find(r => r.id === id);
  const chips = (ids, rm) => ids.map(id => `<span class="tag" title="${esc(tech(id)?.name || '')}">${id}${rm ? `<button class="rmt" data-rmt="${id}" aria-label="${t('Retirer {id}', { id })}">×</button>` : ''}</span>`).join('');

  let shown = []; // règles affichées (filtre + recherche) : cible de la case « tout valider »
  function draw() {
    const q = view.q.trim().toLowerCase(), S = sc();
    $(root, '#n').textContent = state.rules.length;
    $(root, '#prog').textContent = t('{n}/{m} validées', { n: state.rules.filter(r => r.reviewed).length, m: state.rules.length });
    $(root, '#flt').innerHTML = Object.entries(FILTERS).map(([f, l]) => `<button class="lg flt ${view.f === f ? 'on' : ''}" aria-pressed="${view.f === f}" data-f="${f}">${l} ${f === 'all' ? state.rules.length : state.rules.filter(r => flags(r)[f]).length}</button>`).join('');
    $(root, '#head').innerHTML = `<tr><th><input type="checkbox" id="revall" aria-label="${t('Valider toutes les règles affichées')}" title="${t('Valider toutes les règles affichées')}"></th><th>${t('Règle')}</th><th>${t('Techniques')}</th>${S.map(s => `<th class="sc ${view.hl === s.id ? 'hl' : ''}" data-hl="${s.id}"><button class="scb" aria-pressed="${view.hl === s.id}" title="${t('{name} ({prio}) : trier par ce scénario', { name: esc(s.name), prio: esc(s.priority) })}"><span class="tag sref">${sref(s)}</span></button></th>`).join('')}</tr>`;
    const list = state.rules.filter(r => (view.f === 'all' || flags(r)[view.f])
      && (!q || (r.name + ' ' + r.source + ' ' + r.techniques.map(x => x + ' ' + (tech(x)?.name || '')).join(' ')).toLowerCase().includes(q)));
    if (view.hl) list.sort((a, b) => b.scenarios.includes(view.hl) - a.scenarios.includes(view.hl));
    shown = list;
    const all = $(root, '#revall'), nRev = list.filter(r => r.reviewed).length;
    Object.assign(all, { checked: !!list.length && nRev === list.length, indeterminate: nRev > 0 && nRev < list.length, disabled: !list.length });
    $(root, '#rows').innerHTML = list.map(r => `<tr data-id="${r.id}" class="${view.sel === r.id ? 'sel' : ''}">
      <td><input type="checkbox" data-rev ${r.reviewed ? 'checked' : ''} aria-label="${t('Règle validée')}"></td>
      <td><button class="rn" aria-label="${t('Détail de la règle')} : ${esc(r.name)}">${esc(r.name)}</button><div class="mut">${esc(r.source)}${r.confidence ? ' · ' + esc(r.confidence) : ''}${r.stage ? ' · ' + esc(r.stage) : ''}${r.by ? ' · ' + (r.by === 'tags' ? t('via tags') : t('via IA')) : ''}</div></td>
      <td>${chips(r.techniques)}${r.rejected?.length ? `<div class="err">${t('rejetés : {ids}', { ids: esc(r.rejected.join(', ')) })}</div>` : ''}</td>
      ${S.map(s => { const k = linkState(r, s); return `<td class="lk ${k} ${view.hl === s.id ? 'hl' : ''}"><button data-s="${s.id}" aria-pressed="${r.scenarios.includes(s.id)}" title="${esc(s.name)}" aria-label="${sref(s)} ${esc(s.name)}${k === 'suspect' ? ' : ' + t('lié sans technique commune') : k === 'miss' ? ' : ' + t('oubli possible') : ''}">${SYM[k] || (r.scenarios.includes(s.id) ? '●' : '·')}</button></td>`; }).join('')}</tr>`).join('')
      || `<tr><td colspan="${3 + S.length}" class="mut">${state.rules.length ? t('Aucune règle ne correspond à ces filtres.') : t('Aucune règle : importe-en ci-dessus.')}</td></tr>`;
    const linked = s => state.rules.filter(r => r.scenarios.includes(s.id));
    const open = s => { const ls = linked(s); return s.techniques.filter(x => !ls.some(r => r.techniques.some(y => parentOf(y) === parentOf(x)))).length; };
    $(root, '#foot').innerHTML = S.length ? `<tr><td colspan="3">${t('Règles liées')}</td>${S.map(s => `<td class="${linked(s).length ? '' : 'zero'}">${linked(s).length}</td>`).join('')}</tr>
      <tr><td colspan="3">${t('Techniques sans règle liée')}</td>${S.map(s => `<td title="${t('{n} sur {m}', { n: open(s), m: s.techniques.length })}">${open(s)}/${s.techniques.length}</td>`).join('')}</tr>` : '';
    if ($(root, '#detail').classList.contains('open')) detail();
  }

  function detail() {
    const r = rule(view.sel), d = $(root, '#detail');
    if (!r) { d.classList.remove('open'); return; }
    const S = sc();
    const lnk = S.filter(s => r.scenarios.includes(s.id)), miss = S.filter(s => linkState(r, s) === 'miss');
    d.innerHTML = `<button class="x" aria-label="${t('Fermer')}">×</button><h3>${esc(r.name)}</h3>
      <p class="mut">${esc(r.source)} · <label style="display:inline;margin:0"><input type="checkbox" data-d="rev" ${r.reviewed ? 'checked' : ''} style="width:auto"> ${t('Validée')}</label></p>
      <h4>${t('Règle')}</h4><pre>${esc(r.body)}</pre>
      ${r.note ? `<h4>${t('Note du LLM')}</h4><p>${esc(r.note)}</p>` : ''}
      <h4>${t('Scénarios liés')} (${lnk.length})</h4>${lnk.map(s => `<div class="item"><span class="tag sref">${sref(s)}</span> <b>${esc(s.name)}</b> <span class="tag">${esc(s.priority)}</span>
        ${linkState(r, s) === 'suspect' ? `<span class="tag gap">${t('⚠ aucune technique commune')}</span>` : ''}
        <div class="mut">${esc(r.why?.[s.id] || t('Pas de justification (remapper pour en obtenir une).'))}</div>
        <div>${chips(common(r, s))}</div><button data-unlink="${s.id}">${t('Délier')}</button></div>`).join('') || `<p class="mut">${t('Aucun scénario lié.')}</p>`}
      <h4>${t('Oublis possibles')} (${miss.length})</h4>${miss.map(s => `<div class="item"><span class="tag sref">${sref(s)}</span> ${esc(s.name)}<div>${chips(common(r, s))}</div><button data-link="${s.id}">${t('Lier')}</button></div>`).join('') || `<p class="mut">${t('Aucun.')}</p>`}
      <h4>${t('Techniques')}</h4><div>${chips(r.techniques, true) || `<span class="mut">${t('Aucune.')}</span>`}</div>
      ${tagsOf(r).length ? `<p class="mut">${t('Tags déclarés dans la règle :')} ${chips(tagsOf(r))}</p>` : ''}
      ${r.tagDiff ? `<div class="item"><span class="tag gap">${t('Divergence tags / IA')}</span> ${r.tagDiff.tags.length ? `${t('tags seuls :')} ${chips(r.tagDiff.tags)}` : ''} ${r.tagDiff.ia.length ? `${t('IA seule :')} ${chips(r.tagDiff.ia)}` : ''}<div><button data-usetags>${t('Utiliser les tags')}</button></div></div>` : ''}
      <div class="bar"><input id="addt" list="techlist" placeholder="T1059.001" style="width:9rem"><button data-addt>${t('Ajouter')}</button></div>${r.rejected?.length ? `<p class="err">${t('ID inconnu : {ids}', { ids: esc(r.rejected.join(', ')) })}</p>` : ''}
      <h4>${t('Qualification')}</h4><div class="row"><div><label>${t('Confiance')}</label><select data-d="confidence">${['', 'high', 'medium', 'low'].map(x => `<option ${x === r.confidence ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div><label>${t('Étape')}</label><select data-d="stage"><option></option>${state.settings.stages.map(x => `<option ${x === r.stage ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></div></div>
      <div class="bar"><button data-d="del">${t('Supprimer la règle')}</button></div>`;
    d.classList.add('open');
  }
  const link = (r, sid, on) => { r.scenarios = on ? [...new Set([...r.scenarios, sid])] : r.scenarios.filter(x => x !== sid); if (!on && r.why) delete r.why[sid]; };

  $(root, '#q').value = view.q;
  $(root, '#q').oninput = e => { view.q = e.target.value; draw(); };
  $(root, '#flt').onclick = e => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { view.f = f; draw(); } };
  $(root, '#head').onchange = e => {
    if (e.target.id !== 'revall') return;
    const v = e.target.checked, list = shown;
    undoable(t(v ? '{n} règle(s) validée(s).' : '{n} règle(s) remise(s) à relire.', { n: list.length }), () => { list.forEach(r => r.reviewed = v); save(); draw(); });
  };
  $(root, '#head').onclick = e => { const h = e.target.closest('[data-hl]')?.dataset.hl; if (h) { view.hl = view.hl === h ? '' : h; draw(); } };
  $(root, '#rows').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const r = rule(tr.dataset.id), b = e.target.closest('button[data-s]');
    if (e.target.closest('input')) return;
    if (b) { link(r, b.dataset.s, !r.scenarios.includes(b.dataset.s)); save(); draw(); return; }
    view.sel = r.id; draw(); detail(); $(root, '#detail .x').focus();
  };
  $(root, '#rows').onchange = e => { if (e.target.matches('[data-rev]')) { rule(e.target.closest('tr').dataset.id).reviewed = e.target.checked; save(); draw(); } };
  const dt = $(root, '#detail');
  const close = () => { dt.classList.remove('open'); root.querySelector(`tr[data-id="${view.sel}"] .rn`)?.focus(); }; // focus rendu à la ligne d'origine
  dt.onclick = e => {
    const r = rule(view.sel), el = e.target;
    if (el.classList.contains('x')) return close();
    if (!r) return;
    if (el.dataset.unlink) link(r, el.dataset.unlink, false);
    else if (el.dataset.link) link(r, el.dataset.link, true);
    else if (el.dataset.rmt) r.techniques = r.techniques.filter(x => x !== el.dataset.rmt);
    else if (el.dataset.usetags !== undefined) { r.techniques = [...tagsOf(r)]; r.tagDiff = null; }
    else if (el.dataset.addt !== undefined) {
      const v = validate($(dt, '#addt').value.split(/[,\s]+/).filter(Boolean));
      r.techniques = [...new Set([...r.techniques, ...v.ok])]; r.mapped = true; r.rejected = v.rejected;
    } else if (el.dataset.d === 'del') { view.sel = null; dt.classList.remove('open'); return undoable(t('Règle « {name} » supprimée.', { name: r.name }), () => { state.rules = state.rules.filter(x => x !== r); save(); draw(); }); }
    else return;
    save(); draw();
  };
  dt.onchange = e => {
    const r = rule(view.sel), k = e.target.dataset.d; if (!r || !k || k === 'del') return;
    if (k === 'rev') r.reviewed = e.target.checked; else r[k] = e.target.value;
    save(); draw();
  };
  root.onkeydown = e => { if (e.key === 'Escape' && dt.classList.contains('open')) close(); };

  $(root, '#demo').onclick = async () => { state.rules.push(...splitRules(t('exemple.yml'), await sample('rules.yml'))); save(); draw(); };
  $(root, '#addp').onclick = () => { const p = $(root, '#paste'); state.rules.push(...splitRules(t('collé'), p.value)); p.value = ''; save(); draw(); };
  const importFiles = e => run($(root, '#ist'), async () => {
    const list = [...e.target.files], bulk = list.length > 1 || list.some(f => f.webkitRelativePath || /\.zip$/i.test(f.name));
    e.target.value = '';
    const files = await readFiles(list, RULE_EXT), seen = new Set(state.rules.map(r => r.body));
    let n = 0, d = 0;
    for (const f of files) for (const r of parseRuleFile(f.name, f.text, bulk)) seen.has(r.body) ? d++ : (seen.add(r.body), state.rules.push(r), n++);
    save(); draw();
    return t('{n} règle(s) importée(s) depuis {f} fichier(s) ; {d} doublon(s) ignoré(s).', { n, f: files.length, d });
  });
  $(root, '#files').onchange = importFiles;
  $(root, '#dir').onchange = importFiles;
  const go = all => run($(root, '#st'), async (signal, say) => {
    const todo0 = state.rules.filter(r => all || !r.mapped);
    if (!todo0.length) throw new Error(t('Rien à mapper.'));
    const { nTags, nAI, cut } = await mapRules(todo0, { verify: $(root, '#verify').checked, signal, say, onBatch: () => { save(); if (onTab('rules')) draw(); } });
    if (!nAI) return t('{n} règle(s) mappée(s) depuis leurs tags, sans IA.', { n: nTags });
    return t('{n} règle(s) mappée(s) depuis leurs tags ; {m} règle(s) traitée(s) par l’IA.', { n: nTags, m: nAI })
      + (cut ? ' ' + t('Attention : {k} règle(s) trop longue(s), seuls les {max} premiers caractères ont été analysés.', { k: cut, max: MAX_RULE }) : '');
  }, [$(root, '#map'), $(root, '#remap')], { key: 'map', label: t('Mapping des règles'), open: () => document.querySelector('#tabs [data-id="rules"]')?.click() });
  $(root, '#map').onclick = () => go(false);
  $(root, '#remap').onclick = () => undoable(t('Remappage de toutes les règles lancé (les corrections manuelles seront remplacées).'), () => go(true));
  draw();
  if (view.open && rule(view.sel)) { view.open = false; detail(); root.querySelector(`tr[data-id="${view.sel}"]`)?.scrollIntoView({ block: 'center' }); $(root, '#detail .x').focus(); } // focusRule()
}
