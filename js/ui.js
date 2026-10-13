import { isAuthorized } from './keys.js';
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = (root, sel) => root.querySelector(sel);
export const readFiles = async files => Promise.all([...files].map(async f => ({ name: f.name, text: await f.text() })));
/** Exécute fn(signal) avec bouton annuler + statut. */
export async function run(statusEl, fn) {
  const ac = new AbortController();
  statusEl.innerHTML = '<span class="mut">En cours… </span><button>Annuler</button>';
  statusEl.querySelector('button').onclick = () => ac.abort();
  try { await fn(ac.signal, msg => statusEl.firstChild.textContent = msg + ' '); statusEl.innerHTML = '<span class="ok">Terminé</span>'; }
  catch (e) { statusEl.innerHTML = e.name === 'AbortError' ? '<span class="mut">Annulé</span>' : `<span class="err">${esc(e.message)}</span>`; }
}
/** Désactive les boutons IA tant que l'usage de l'IA n'est pas autorisé (Paramètres). */
export function gateAI(root, sels, statusSel) {
  if (isAuthorized()) return;
  sels.forEach(q => { const b = $(root, q); b.disabled = true; b.title = 'Usage de l’IA non autorisé'; });
  $(root, statusSel).innerHTML = '<span class="err">IA non autorisée : coche la case de confirmation dans Paramètres.</span>';
}
