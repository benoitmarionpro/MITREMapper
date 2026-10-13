import { state } from './store.js';
import { getKey, isAuthorized } from './keys.js';

/** Registre des fournisseurs. kind : protocole (openai | anthropic | azure). models : liste de secours si le chargement échoue. */
export const PROVIDERS = {
  local:       { label: 'Local / proxy compatible OpenAI', kind: 'openai',    base: 'http://127.0.0.1:11434/v1',  model: 'auto',                 keyRequired: false, models: ['auto'] },
  openai:      { label: 'OpenAI',                          kind: 'openai',    base: 'https://api.openai.com/v1',  model: 'gpt-4o',               keyRequired: true,  models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
  anthropic:   { label: 'Anthropic',                       kind: 'anthropic', base: 'https://api.anthropic.com',  model: 'claude-sonnet-5-5',    keyRequired: true,  models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  mistral:     { label: 'Mistral',                         kind: 'openai',    base: 'https://api.mistral.ai/v1',  model: 'mistral-large-latest', keyRequired: true,  models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  azure:       { label: 'Azure OpenAI / AI Foundry',       kind: 'azure',     base: '',                           model: '',                     keyRequired: true,  models: [] },
  ollamacloud: { label: 'Ollama Cloud',                    kind: 'openai',    base: 'https://ollama.com/v1',      model: 'gpt-oss:120b',         keyRequired: true,  models: ['gpt-oss:120b', 'gpt-oss:20b'] },
  ollama:      { label: 'Ollama (local)',                  kind: 'openai',    base: 'http://localhost:11434/v1',  model: 'llama3.1',             keyRequired: false, models: ['llama3.1', 'qwen2.5', 'mistral'] },
  openrouter:  { label: 'OpenRouter',                      kind: 'openai',    base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', keyRequired: true, models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o'] },
  custom:      { label: 'Endpoint générique compatible OpenAI', kind: 'openai', base: '',                         model: '',                     keyRequired: false, models: [] },
};

/** Erreur contextualisée : opération, fournisseur, modèle, statut HTTP, code. Le message est purgé des secrets. */
export class LLMError extends Error {
  constructor(message, ctx = {}) {
    super(message);
    Object.assign(this, { name: 'LLMError', op: ctx.op, provider: ctx.provider, model: ctx.model, status: ctx.status, code: ctx.code });
  }
}
/** Retire d'un texte la clé API et les formes usuelles de jetons. */
export const redact = (t, key) => {
  let s = String(t ?? '');
  if (key && key.length >= 4) s = s.split(key).join('***');
  return s.replace(/Bearer\s+[\w.~+\/-]+=*/gi, 'Bearer ***').replace(/\bsk-[\w-]{8,}/g, 'sk-***');
};
function fail(ctx, msg, code, status) {
  const ctxTxt = `${ctx.op} · ${PROVIDERS[ctx.provider]?.label || ctx.provider} · ${ctx.model || 'modèle non défini'}${status ? ' · HTTP ' + status : ''}${code ? ' · ' + code : ''}`;
  throw new LLMError(`[${ctxTxt}] ${redact(msg, ctx.key)}`, { ...ctx, status, code, key: undefined });
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
/** Valide l'état avant tout appel IA (autorisation, fournisseur, modèle, clé, HTTPS, URL) et renvoie la configuration normalisée. */
export function config(op) {
  const s = state.settings, p = PROVIDERS[s.provider];
  const ctx = { op, provider: s.provider, model: p?.kind === 'azure' ? s.deployment : s.model };
  if (!isAuthorized()) fail(ctx, 'Utilisation de l’IA non autorisée : coche la case de confirmation dans Paramètres.', 'not_authorized');
  if (!p) fail(ctx, 'Fournisseur inconnu.', 'bad_provider');
  const key = getKey(s.provider); ctx.key = key;
  if (p.keyRequired && !key) fail(ctx, `Clé API manquante pour ${p.label}.`, 'missing_key');
  let u;
  try { u = new URL(String(s.base).trim()); } catch { fail(ctx, `URL de base invalide : « ${s.base} ».`, 'bad_url'); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.includes(u.hostname))) fail(ctx, 'L’endpoint doit être en HTTPS (HTTP admis seulement en local : 127.0.0.1 ou localhost).', 'insecure_url');
  if (p.kind === 'azure') {
    if (!String(s.deployment).trim()) fail(ctx, 'Nom du déploiement Azure manquant.', 'missing_deployment');
    if (!String(s.apiVersion).trim()) fail(ctx, 'Version d’API Azure manquante.', 'missing_api_version');
  } else if (op !== 'models' && !String(s.model).trim()) fail(ctx, 'Modèle manquant.', 'missing_model');
  let base = (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/(chat\/completions|v1\/messages)$/, '');
  if (p.kind === 'anthropic') base = base.replace(/\/v1$/, '');
  return { s, p, ctx, key, base };
}

function headers({ p, key }) {
  const h = { 'content-type': 'application/json' };
  if (p.kind === 'anthropic') Object.assign(h, { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  else if (p.kind === 'azure') h['api-key'] = key;
  else if (key) h.authorization = `Bearer ${key}`;
  return h;
}
async function http(ctx, url, opts) {
  let r;
  try { r = await fetch(url, opts); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    fail(ctx, `Connexion impossible à ${new URL(url).host} (réseau ou CORS : le serveur doit autoriser l’origine ${location.origin}).`, 'network');
  }
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) fail(ctx, j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || text.slice(0, 300) || r.statusText, j?.error?.code || j?.error?.type || j?.code, r.status);
  if (j === null) fail(ctx, 'Réponse non JSON du fournisseur : ' + text.slice(0, 120), 'bad_json', r.status);
  return j;
}

/** Couche unique d'accès au LLM : getAvailableModels, testConnection, generate. */
class LLMClient {
  status = { state: 'idle', text: '' }; // idle | busy | ok | warn | error
  #set(state, text) { this.status = { state, text }; }

  /** Renvoie { models, fallback, reason } : liste du fournisseur, ou liste de secours si le chargement échoue. */
  async getAvailableModels() {
    const fallback = (p, reason) => { this.#set('warn', `Liste de secours : ${reason}`); return { models: p?.models || [], fallback: true, reason }; };
    let c;
    try { c = config('models'); } catch (e) { if (e.code === 'not_authorized') throw e; return fallback(PROVIDERS[state.settings.provider], e.message); }
    if (c.p.kind === 'azure') return fallback(c.p, 'Azure ne liste pas les déploiements ici : saisis le nom du déploiement.');
    this.#set('busy', 'Chargement des modèles…');
    try {
      const d = await http(c.ctx, c.p.kind === 'anthropic' ? `${c.base}/v1/models` : `${c.base}/models`, { headers: headers(c) });
      const ids = (d.data || d.models || []).map(m => m.id || m.name).filter(Boolean);
      if (!ids.length) fail(c.ctx, 'Liste de modèles vide.', 'empty');
      this.#set('ok', `${ids.length} modèles chargés`);
      return { models: ids, fallback: false };
    } catch (e) {
      if (e.name === 'AbortError') { this.#set('idle', ''); throw e; }
      return fallback(c.p, e.message);
    }
  }

  /** Appel minimal pour vérifier endpoint, clé et modèle. Renvoie un court texte, ou lève LLMError. */
  async testConnection() {
    const t = await this.#call('test', 'Réponds brièvement.', 'Dis "ok".');
    return t.slice(0, 60);
  }

  async generate({ system, user, signal }) { return this.#call('generate', system, user, signal); }

  async #call(op, system, user, signal) {
    const c = config(op), { s, p } = c;
    this.#set('busy', `${p.label} · ${c.ctx.model} : appel en cours…`);
    try {
      const T = +s.temperature;
      let url, body;
      if (p.kind === 'anthropic') { url = `${c.base}/v1/messages`; body = { model: s.model, max_tokens: 8192, temperature: T, system, messages: [{ role: 'user', content: user }] }; }
      else {
        const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
        url = p.kind === 'azure' ? `${c.base}/openai/deployments/${encodeURIComponent(s.deployment)}/chat/completions?api-version=${encodeURIComponent(s.apiVersion)}` : `${c.base}/chat/completions`;
        body = p.kind === 'azure' ? { temperature: T, messages } : { model: s.model, temperature: T, messages };
      }
      const d = await http(c.ctx, url, { method: 'POST', signal, headers: headers(c), body: JSON.stringify(body) });
      const text = p.kind === 'anthropic' ? (d.content || []).map(x => x.text || '').join('') : d.choices?.[0]?.message?.content;
      if (!text || !String(text).trim()) fail(c.ctx, 'Réponse vide du fournisseur.', 'empty');
      this.#set('ok', `${p.label} · ${c.ctx.model} : OK`);
      return text;
    } catch (e) {
      this.#set(e.name === 'AbortError' ? 'idle' : 'error', e.name === 'AbortError' ? '' : e.message);
      throw e;
    }
  }
}
export const llm = new LLMClient();

/** Extrait un JSON d'une réponse LLM (bloc ```json, texte autour, etc.). */
export function parseJson(text) {
  const t = text.replace(/```(?:json)?/gi, '');
  const i = t.search(/[\[{]/);
  if (i < 0) throw new Error('Aucun JSON dans la réponse');
  const close = t[i] === '[' ? ']' : '}';
  const j = t.lastIndexOf(close);
  return JSON.parse(t.slice(i, j + 1));
}
/** generate + parse, avec 1 retry demandant du JSON strict. */
export async function chatJson(args) {
  const r = await llm.generate(args);
  try { return parseJson(r); }
  catch { return parseJson(await llm.generate({ ...args, user: args.user + '\n\nRéponds UNIQUEMENT avec du JSON valide, sans texte autour.' })); }
}
