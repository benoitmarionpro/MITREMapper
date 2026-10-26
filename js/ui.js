import { isAuthorized } from './keys.js';
import { state } from './store.js';
import { t } from './i18n.js';
/** Affiche le nom du projet courant dans l'en-tête. */
export const showProject = () => { const e = document.getElementById('proj'); if (e) e.textContent = state.name; };
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = (root, sel) => root.querySelector(sel);
export const readFiles = async files => Promise.all([...files].map(async f => ({ name: f.name, text: await f.text() })));
/** Exécute fn(signal) avec bouton annuler + statut. */
export async function run(statusEl, fn) {
  const ac = new AbortController();
  statusEl.innerHTML = `<span class="mut">${t('En cours…')} </span><button>${t('Annuler')}</button>`;
  statusEl.querySelector('button').onclick = () => ac.abort();
  try { const done = await fn(ac.signal, msg => statusEl.firstChild.textContent = msg + ' '); statusEl.innerHTML = `<span class="ok">${esc(done || t('Terminé'))}</span>`; }
  catch (e) { statusEl.innerHTML = e.name === 'AbortError' ? `<span class="mut">${t('Annulé')}</span>` : `<span class="err">${esc(e.message)}</span>`; }
}
/** Désactive les boutons IA tant que l'usage de l'IA n'est pas autorisé (Paramètres). */
export function gateAI(root, sels, statusSel) {
  if (isAuthorized()) return;
  sels.forEach(q => { const b = $(root, q); b.disabled = true; b.title = t('Usage de l’IA non autorisé'); });
  $(root, statusSel).innerHTML = `<span class="err">${t('IA non autorisée : coche la case de confirmation dans Paramètres.')}</span>`;
}
