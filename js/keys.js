// Secrets et consentement IA : stockés à part des données projet (CYBAIMaker).
// Clés API : sessionStorage par défaut, localStorage seulement via « Mémoriser cette clé ». Une clé par fournisseur.
const K = 'mitremapper.keys', OK = 'mitremapper.ai-ok';
const rd = s => { try { return JSON.parse(s.getItem(K)) || {}; } catch { return {}; } };
const wr = (s, o) => { try { Object.keys(o).length ? s.setItem(K, JSON.stringify(o)) : s.removeItem(K); } catch {} };

export const getKey = p => rd(sessionStorage)[p] || rd(localStorage)[p] || '';
export const isRemembered = p => !!rd(localStorage)[p];
export function setKey(p, v, remember = false) {
  const ss = rd(sessionStorage), ls = rd(localStorage);
  delete ss[p]; delete ls[p];
  if (v) (remember ? ls : ss)[p] = v;
  wr(sessionStorage, ss); wr(localStorage, ls);
}
export function clearKeys() { try { sessionStorage.removeItem(K); localStorage.removeItem(K); } catch {} }
/** Aperçu masqué d'une clé (jamais la clé complète). */
export const mask = k => (k ? '••••' + k.slice(-4) : '');

/** Autorisation d'utiliser l'IA : à reconfirmer à chaque session. */
export const isAuthorized = () => { try { return sessionStorage.getItem(OK) === '1'; } catch { return false; } };
export const setAuthorized = on => { try { on ? sessionStorage.setItem(OK, '1') : sessionStorage.removeItem(OK); } catch {} };
