import { setKey } from './keys.js';
const KEY = 'mitremapper.v1';                         // projet courant + réglages
const LIB = 'mitremapper.lib', LIBP = 'mitremapper.lib.'; // index des projets + données de chaque projet (sans réglages)
export const DEFAULT_STAGES = ['Prévention', 'Détection', 'Investigation', 'Réponse'];
export const uid = () => Math.random().toString(36).slice(2, 9);
const fresh = () => ({
  pid: uid(), name: 'Projet sans nom', nextRef: 1,
  client: { sector: '', size: '', country: '', assets: '' },
  cti: '', scenarios: [], rules: [],
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
  } catch (e) { console.warn(e); }
};

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
export const listProjects = () => Object.entries(readLib()).map(([pid, p]) => ({ pid, ...p })).sort((a, b) => b.updated.localeCompare(a.updated));
export function openProject(pid) {
  const d = JSON.parse(localStorage.getItem(LIBP + pid) || 'null');
  if (!d) throw new Error('Projet introuvable');
  loadInto({ ...d, pid });
}
export const newProject = name => loadInto({ pid: uid(), name: name || 'Nouveau projet' });
export function deleteProject(pid) {
  const lib = readLib(); delete lib[pid];
  try { localStorage.setItem(LIB, JSON.stringify(lib)); localStorage.removeItem(LIBP + pid); } catch {}
  if (pid === state.pid) { const next = listProjects()[0]; next ? openProject(next.pid) : newProject(); }
}

export function exportJson(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)]));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
/** Importe un fichier projet comme NOUVEAU projet (le projet courant reste dans la bibliothèque). */
export function importProject(text, name) {
  const d = JSON.parse(text);
  if (!d.scenarios || !d.rules) throw new Error('Fichier projet invalide');
  loadInto({ ...d, pid: uid(), name: d.name && d.name !== 'Projet sans nom' ? d.name : name || 'Projet importé' });
}
/** Charge un fichier de data/sample/ (démos rapides). */
export const sample = f => globalThis.__SAMPLES__?.[f] != null ? Promise.resolve(globalThis.__SAMPLES__[f]) : fetch('data/sample/' + f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('Exemple introuvable : ' + f); return r.text(); });
/** Démo complète sans LLM (scénarios + règles déjà mappés), ouverte dans un nouveau projet. */
export const loadDemo = async () => importProject(await sample('project.json'), 'Démo : établissement de santé');
