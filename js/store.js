import { setKey } from './keys.js';
const KEY = 'mitremapper.v1';
export const DEFAULT_STAGES = ['Prévention', 'Détection', 'Investigation', 'Réponse'];
const fresh = () => ({
  client: { sector: '', size: '', country: '', assets: '' },
  cti: '', scenarios: [], rules: [],
  settings: { provider: 'local', base: 'http://127.0.0.1:11434/v1', model: 'auto', deployment: '', apiVersion: '2024-10-21', temperature: 0.2, batch: 8, stages: DEFAULT_STAGES },
});
export let state = fresh();
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn(e); } };
try {
  const d = JSON.parse(localStorage.getItem(KEY));
  const legacy = d?.settings && ('key' in d.settings || 'protocol' in d.settings);
  // migration : une clé API héritée (stockée en clair avec le projet) passe dans le stockage de session, puis est supprimée du projet
  if (d?.settings?.key) setKey(d.settings.provider || 'local', d.settings.key);
  if (legacy) { delete d.settings.key; delete d.settings.protocol; }
  Object.assign(state, d); state.settings = { ...fresh().settings, ...state.settings };
  if (legacy) save();
} catch {}
export const uid = () => Math.random().toString(36).slice(2, 9);
export function exportJson(name, data) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)]));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
export function importProject(text) {
  const d = JSON.parse(text);
  if (!d.scenarios || !d.rules) throw new Error('Fichier projet invalide');
  const keep = state.settings; // ne pas écraser clé API / endpoint
  Object.assign(state, fresh(), d, { settings: keep }); save();
}
export const projectForExport = () => ({ ...state, settings: undefined });
/** Charge un fichier de data/sample/ (démos rapides). */
export const sample = f => globalThis.__SAMPLES__?.[f] != null ? Promise.resolve(globalThis.__SAMPLES__[f]) : fetch('data/sample/' + f, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('Exemple introuvable : ' + f); return r.text(); });
/** Démo complète sans LLM : scénarios + règles déjà mappées. Remplace les données du projet. */
export const loadDemo = async () => importProject(await sample('project.json'));
