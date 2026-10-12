const KEY = 'mitremapper.v1';
export const DEFAULT_STAGES = ['Prévention', 'Détection', 'Investigation', 'Réponse'];
const fresh = () => ({
  client: { sector: '', size: '', country: '', assets: '' },
  cti: '', scenarios: [], rules: [],
  settings: { provider: 'local', protocol: 'openai', base: 'http://127.0.0.1:11434/v1', key: '', model: 'auto', temperature: 0.2, batch: 8, stages: DEFAULT_STAGES },
});
export let state = fresh();
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY))); state.settings = { ...fresh().settings, ...state.settings }; } catch {}
export const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn(e); } };
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
