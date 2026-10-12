import { state } from './store.js';
export const PRESETS = {
  local:      { label: 'Local / proxy Copilot', protocol: 'openai',    base: 'http://127.0.0.1:11434/v1', model: 'auto' },
  openai:     { label: 'OpenAI',                protocol: 'openai',    base: 'https://api.openai.com/v1', model: 'gpt-4o' },
  anthropic:  { label: 'Anthropic',             protocol: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  ollama:     { label: 'Ollama',                protocol: 'openai',    base: 'http://localhost:11434/v1', model: 'llama3.1' },
  mistral:    { label: 'Mistral',               protocol: 'openai',    base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  openrouter: { label: 'OpenRouter',            protocol: 'openai',    base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5' },
  custom:     { label: 'Personnalisé',          protocol: 'openai',    base: '', model: '' },
};
const trim = s => s.replace(/\/+$/, '');
function headers(s) {
  if (s.protocol === 'anthropic') {
    return { 'content-type': 'application/json', 'x-api-key': s.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  }
  return { 'content-type': 'application/json', ...(s.key && { authorization: `Bearer ${s.key}` }) };
}
async function http(url, opts) {
  let r;
  try { r = await fetch(url, opts); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error(`Connexion impossible à ${url} (réseau ou CORS : le serveur doit autoriser l'origine ${location.origin}).`); }
  if (!r.ok) throw new Error(`HTTP ${r.status} : ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
export async function chat({ system, user, signal }) {
  const s = state.settings, base = trim(s.base);
  if (s.protocol === 'anthropic') {
    const d = await http(`${base}/v1/messages`, { method: 'POST', signal, headers: headers(s),
      body: JSON.stringify({ model: s.model, max_tokens: 8192, temperature: +s.temperature, system, messages: [{ role: 'user', content: user }] }) });
    return d.content.map(c => c.text || '').join('');
  }
  const d = await http(`${base}/chat/completions`, { method: 'POST', signal, headers: headers(s),
    body: JSON.stringify({ model: s.model, temperature: +s.temperature, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
  return d.choices[0].message.content;
}
export async function listModels() {
  const s = state.settings, base = trim(s.base);
  const d = await http(s.protocol === 'anthropic' ? `${base}/v1/models` : `${base}/models`, { headers: headers(s) });
  return (d.data || []).map(m => m.id);
}
/** Extrait un JSON d'une réponse LLM (bloc ```json, texte autour, etc.). */
export function parseJson(text) {
  const t = text.replace(/```(?:json)?/gi, '');
  const i = t.search(/[\[{]/);
  if (i < 0) throw new Error('Aucun JSON dans la réponse');
  const close = t[i] === '[' ? ']' : '}';
  const j = t.lastIndexOf(close);
  return JSON.parse(t.slice(i, j + 1));
}
/** chat + parse, avec 1 retry demandant du JSON strict. */
export async function chatJson(args) {
  const r = await chat(args);
  try { return parseJson(r); }
  catch { return parseJson(await chat({ ...args, user: args.user + '\n\nRéponds UNIQUEMENT avec du JSON valide, sans texte autour.' })); }
}
