import { setKey } from './keys.js';
import { t, lang } from './i18n.js';
import { validate } from './attack.js';
const KEY = 'mitremapper.v1';                         // projet courant + réglages
const LIB = 'mitremapper.lib', LIBP = 'mitremapper.lib.'; // index des projets + données de chaque projet (sans réglages)
export const DEFAULT_STAGES = lang === 'en' ? ['Prevention', 'Detection', 'Investigation', 'Response'] : ['Prévention', 'Détection', 'Investigation', 'Réponse'];
export const uid = () => Math.random().toString(36).slice(2, 9);
const fresh = () => ({
  pid: uid(), name: t('Projet sans nom'), nextRef: 1,
  client: { sector: '', size: '', country: '', assets: '' },
  cti: '', scenarios: [], rules: [], snapshots: [],
  settings: { provider: 'local', base: 'http://127.0.0.1:11434/v1', model: 'auto', deployment: '', apiVersion: '2024-10-21', temperature: 0.2, batch: 8, stages: DEFAULT_STAGES },
});
export const state = fresh();

/** Référence stable d'un scénario (S1, S2…) : attribuée une fois, jamais réutilisée tant que le projet a des scénarios. */
export const sref = s => 'S' + s.ref;
function ensureRefs() {
  if (!state.scenarios.some(s => s.ref)) state.nextRef = 1; // liste vide ou remplacée : on renumérote depuis S1
  state.nextRef = Math.max(state.nextRef || 1, ...state.scenarios.map(s => (s.ref || 0) + 1));
  for (const s of state.scenarios) if (!s.ref) s.ref = state.nextRef++;
}

const readLib = () => { try { return JSON.parse(localStorage.getItem(LIB)) || {}; } catch { return {}; } };
export const projectForExport = () => ({ ...state, settings: undefined });
export const save = () => {
  ensureRefs();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    const lib = readLib(); lib[state.pid] = { name: state.name, updated: new Date().toISOString() };
    localStorage.setItem(LIB, JSON.stringify(lib));
    localStorage.setItem(LIBP + state.pid, JSON.stringify(projectForExport()));
    saveError('');
  } catch (e) { console.warn(e); saveError(t('Enregistrement impossible ({e}) : le stockage du navigateur est probablement plein. Les dernières modifications seront perdues à la fermeture de l’onglet : exporte le projet en JSON (Paramètres) ou supprime d’anciens projets.', { e: e.name })); }
};
/** Bandeau persistant tant que l'enregistrement échoue (sinon perte silencieuse du travail). */
function saveError(msg) {
  let b = document.getElementById('saveerr');
  if (!msg) return b?.remove();
  if (!b) { b = document.createElement('div'); b.id = 'saveerr'; b.setAttribute('role', 'alert'); document.body.append(b); }
  b.textContent = msg;
}

try {
  const d = JSON.parse(localStorage.getItem(KEY));
  const legacy = d?.settings && ('key' in d.settings || 'protocol' in d.settings);
  // migration : une clé API héritée (stockée en clair avec le projet) passe dans le stockage de session, puis est supprimée du projet
  if (d?.settings?.key) setKey(d.settings.provider || 'local', d.settings.key);
  if (legacy) { delete d.settings.key; delete d.settings.protocol; }
  Object.assign(state, d); state.settings = { ...fresh().settings, ...state.settings };
} catch {}
save(); // migration (références, bibliothèque de projets) idempotente

/** Remplace le contenu du projet courant (même objet `state`), en conservant les réglages. */
function loadInto(d) {
  const keep = state.settings;
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh(), d, { settings: keep });
  save();
}
// ponytail: une seule action annulable (la dernière), historique complet si le besoin apparaît
let snap = null;
/** Mémorise le projet avant une action destructive ; undo() le restaure (même pid : un projet supprimé réapparaît). */
export const checkpoint = () => { snap = JSON.stringify(projectForExport()); };
export const undo = () => { if (snap) { loadInto(JSON.parse(snap)); snap = null; } };
export const listProjects = () => Object.entries(readLib()).map(([pid, p]) => ({ pid, ...p })).sort((a, b) => b.updated.localeCompare(a.updated));
export function openProject(pid) {
  const d = JSON.parse(localStorage.getItem(LIBP + pid) || 'null');
  if (!d) throw new Error(t('Projet introuvable'));
  loadInto({ ...d, pid });
}
export const newProject = name => loadInto({ pid: uid(), name: name || t('Nouveau projet') });
export function deleteProject(pid) {
  const lib = readLib(); delete lib[pid];
  try { localStorage.setItem(LIB, JSON.stringify(lib)); localStorage.removeItem(LIBP + pid); } catch {}
  if (pid === state.pid) { const next = listProjects()[0]; next ? openProject(next.pid) : newProject(); }
}

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export const exportJson = (name, data) => download(name, new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)]));
/** Importe un fichier projet comme NOUVEAU projet (le projet courant reste dans la bibliothèque). */
const str = (v, max = 20000) => typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '';
const one = (v, ok, def) => ok.includes(v) ? v : def;
const techs = v => validate(Array.isArray(v) ? v.map(x => str(x, 20)) : []).ok;
const strs = v => Array.isArray(v) ? v.slice(0, 50).map(x => str(x, 40)) : [];
/** Fichier importé = donnée non fiable : on ne garde que les champs connus, typés, et on régénère les identifiants (insérés dans le HTML). */
export function sanitize(d) {
  if (!d || !Array.isArray(d.scenarios) || !Array.isArray(d.rules)) throw new Error(t('Fichier projet invalide'));
  const ids = new Map();
  const scenarios = d.scenarios.filter(s => s && typeof s === 'object').map(s => {
    const id = uid(); ids.set(s.id, id);
    return { id, ref: Number.isInteger(s.ref) && s.ref > 0 ? s.ref : undefined, name: str(s.name, 300), priority: one(s.priority, ['high', 'medium', 'low'], 'medium'), techniques: techs(s.techniques), summary: str(s.summary), actors: str(s.actors, 1000), rationale: str(s.rationale), rejected: strs(s.rejected) };
  });
  const rules = d.rules.filter(r => r && typeof r === 'object').map(r => {
    const why = {};
    for (const [k, v] of Object.entries(r.why && typeof r.why === 'object' ? r.why : {})) if (ids.has(k)) why[ids.get(k)] = str(v, 1000);
    const td = r.tagDiff && typeof r.tagDiff === 'object' ? { tags: techs(r.tagDiff.tags), ia: techs(r.tagDiff.ia) } : null;
    return {
      id: uid(), name: str(r.name, 300), source: str(r.source, 300), body: str(r.body, 200000), techniques: techs(r.techniques), rejected: strs(r.rejected),
      scenarios: (Array.isArray(r.scenarios) ? r.scenarios : []).filter(x => ids.has(x)).map(x => ids.get(x)), why,
      reviewed: r.reviewed === true, tags: techs(r.tags), by: one(r.by, ['tags', 'ia'], undefined), tagDiff: td,
      stage: str(r.stage, 100), confidence: one(r.confidence, ['high', 'medium', 'low', ''], 'low'), note: str(r.note, 2000), mapped: r.mapped === true,
    };
  });
  const num = v => Number.isFinite(v) ? Math.max(0, Math.min(v, 1e6)) : 0, K = ['cov', 'part', 'gap'];
  const snapshots = (Array.isArray(d.snapshots) ? d.snapshots : []).filter(x => x && typeof x === 'object' && x.st && typeof x.st === 'object').slice(-50).map(x => ({
    id: uid(), date: isNaN(Date.parse(x.date)) ? new Date().toISOString() : new Date(x.date).toISOString(), label: str(x.label, 100), pct: num(x.pct), nTech: num(x.nTech),
    tot: Object.fromEntries(K.map(k => [k, num(x.tot?.[k])])),
    st: Object.fromEntries(Object.entries(x.st).filter(([id, k]) => K.includes(k) && techs([id]).length).map(([id, k]) => [techs([id])[0], k])),
    scen: (Array.isArray(x.scen) ? x.scen : []).filter(s => s && Number.isInteger(s.ref)).map(s => ({ ref: s.ref, name: str(s.name, 300), pct: num(s.pct) })),
  }));
  const c = d.client && typeof d.client === 'object' ? d.client : {};
  return {
    name: str(d.name, 200), nextRef: Number.isInteger(d.nextRef) && d.nextRef > 0 ? d.nextRef : 1, cti: str(d.cti, 2000000),
    client: Object.fromEntries(['sector', 'size', 'country', 'assets'].map(k => [k, str(c[k], 500)])), scenarios, rules, snapshots,
  };
}
export function importProject(text, name) {
  const d = sanitize(JSON.parse(text));
  loadInto({ ...d, pid: uid(), name: d.name && !['Projet sans nom', 'Untitled project'].includes(d.name) ? d.name : name || t('Projet importé') });
}
/** Charge un fichier de data/sample/ (démos rapides). */
export const sample = f => globalThis.__SAMPLES__?.[f] != null ? Promise.resolve(globalThis.__SAMPLES__[f]) : fetch('data/sample/' + f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(t('Exemple introuvable : {f}', { f })); return r.text(); });
/** Démo complète sans LLM (scénarios + règles déjà mappés), ouverte dans un nouveau projet. */
export const loadDemo = async () => importProject(await sample('project.json'), t('Démo : établissement de santé'));
