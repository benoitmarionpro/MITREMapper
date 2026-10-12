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
