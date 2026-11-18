import { isAuthorized } from './keys.js';
import { state, checkpoint, undo } from './store.js';
import { t } from './i18n.js';
/** Affiche le nom du projet courant dans l'en-tête. */
export const showProject = () => { const e = document.getElementById('proj'); if (e) e.textContent = state.name; };
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const $ = (root, sel) => root.querySelector(sel);
/** Lit des fichiers en texte : nom = chemin relatif (dossier) ; avec ext (['.yml', …]), les .zip sont dépliés et seuls ces types gardés. */
export async function readFiles(files, ext) {
  const ok = n => !ext || ext.some(x => n.toLowerCase().endsWith(x));
  const out = [];
  for (const f of files) {
    const name = f.webkitRelativePath || f.name;
    if (ext && /\.zip$/i.test(name)) out.push(...(await unzip(f, ok)).map(e => ({ ...e, name: `${name}/${e.name}` })));
    else if (ok(name)) out.push({ name, text: await f.text() });
  }
  return out;
}
async function inflate(raw) {
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
  w.write(raw).catch(() => {}); w.close().catch(() => {}); // l'erreur éventuelle remonte par la lecture
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
const MAX_UNZIP = 50e6; // octets décompressés par archive (bombe zip)
/** Entrées texte d'un .zip (Blob) : stockées ou deflate (DecompressionStream natif). Ni Zip64 ni chiffrement. */
export async function unzip(blob, ok = () => true) {
  const b = new Uint8Array(await blob.arrayBuffer()), v = new DataView(b.buffer), dec = new TextDecoder();
  let e = b.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error(t('{f} : archive zip illisible.', { f: blob.name || 'zip' }));
  const count = v.getUint16(e + 10, true), cd = v.getUint32(e + 16, true);
  if (count === 0xFFFF || cd === 0xFFFFFFFF) throw new Error(t('{f} : archive Zip64 non prise en charge.', { f: blob.name || 'zip' }));
  const out = [];
  let total = 0;
  for (let i = 0, p = cd; i < count; i++) {
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true);
    const nl = v.getUint16(p + 28, true), name = dec.decode(b.subarray(p + 46, p + 46 + nl)), lh = v.getUint32(p + 42, true);
    p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || flags & 1 || !ok(name) || (method !== 0 && method !== 8)) continue;
    if ((total += usize) > MAX_UNZIP) throw new Error(t('{f} : archive trop volumineuse une fois décompressée (> 50 Mo).', { f: blob.name || 'zip' }));
    const start = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true), raw = b.subarray(start, start + size);
    const data = method ? await inflate(raw) : raw;
    out.push({ name, text: dec.decode(data) });
  }
  return out;
}
/* ---------- Tâches : statut dans l'écran d'origine + panneau #tasks (survit à la fermeture d'un volet ou au changement d'onglet) ---------- */
export const tasks = new Map(); // clé → { label, msg, state: run|ok|err|cancel, el, lock, ac, open }
/** Vrai si l'onglet id est affiché : une tâche ne redessine son écran qu'à cette condition. */
export const onTab = id => location.hash === '#' + id;
function paint(x) {
  if (x.el?.isConnected) {
    x.el.innerHTML = x.state === 'run' ? `<span class="mut spin">${esc(x.msg)} </span><button>${t('Annuler')}</button>`
      : `<span class="${{ ok: 'ok', err: 'err', cancel: 'mut' }[x.state]}">${esc(x.msg)}</span>`;
    if (x.state === 'run') x.el.querySelector('button').onclick = () => x.ac.abort();
  }
  x.lock.forEach(b => b && (b.disabled = x.state === 'run'));
  tray();
}
function tray() {
  const list = [...tasks.values()].filter(x => x.label && !x.hidden);
  let b = document.getElementById('tasks');
  if (!b) {
    if (!list.length) return;
    b = document.createElement('section'); b.id = 'tasks'; b.setAttribute('role', 'status'); b.setAttribute('aria-label', t('Tâches en cours')); document.body.append(b);
    b.onclick = e => {
      const x = b.list[e.target.dataset.i], a = e.target.dataset.a;
      if (!x) return;
      if (a === 'open') { x.open(); if (x.state !== 'run') { x.hidden = true; tray(); } } else if (a === 'stop') x.ac.abort(); else { x.hidden = true; tray(); }
    };
  }
  b.list = list; b.hidden = !list.length;
  b.innerHTML = list.map((x, i) => `<div class="task ${x.state}"><span class="${x.state === 'run' ? 'spin' : ''}"><b>${esc(x.label)}</b> ${esc(x.msg)}</span>${x.open ? `<button data-i="${i}" data-a="open">${t('Afficher')}</button>` : ''}${x.state === 'run' ? `<button data-i="${i}" data-a="stop">${t('Annuler')}</button>` : `<button data-i="${i}" data-a="hide" aria-label="${t('Masquer')}">×</button>`}</div>`).join('');
}
/** Exécute fn(signal, say) avec statut animé + bouton annuler ; les boutons `lock` sont grisés pendant l'exécution.
 *  key : une seule tâche par clé, état retrouvé par attach() ; label : affichée dans le panneau des tâches ; open() : bouton « Afficher » ;
 *  keep : le succès reste dans le panneau jusqu'à « Afficher » ou × (résultat qui attend une action), sinon il disparaît après 8 s. */
export async function run(statusEl, fn, lock = [], { key = {}, label, open, keep } = {}) {
  if (tasks.get(key)?.state === 'run') return;
  const x = { label, open, msg: t('En cours…'), state: 'run', el: statusEl, lock, ac: new AbortController() };
  tasks.set(key, x); paint(x);
  try {
    x.msg = (await fn(x.ac.signal, m => { x.msg = m; paint(x); })) || t('Terminé'); x.state = 'ok';
    if (!keep) setTimeout(() => { x.hidden = true; tray(); }, 8000);
  } catch (e) { x.state = e.name === 'AbortError' ? 'cancel' : 'err'; x.msg = x.state === 'cancel' ? t('Annulé') : e.message; x.hidden ||= x.state === 'cancel'; }
  paint(x);
  if (!label) tasks.delete(key);
}
/** Rattache la tâche `key` (si elle existe) à l'écran redessiné : statut et boutons grisés repris. */
export function attach(el, key, lock = []) {
  const x = tasks.get(key);
  if (x) { x.el = el; x.lock = lock; paint(x); }
  return x;
}
/** Exécute une action destructive, puis propose de l'annuler (bandeau 10 s). L'annulation réaffiche l'onglet courant. */
let closeToast = () => {};
export function undoable(label, fn) {
  checkpoint(); fn(); closeToast();
  const b = document.createElement('div'); b.id = 'toast'; b.setAttribute('role', 'status');
  b.innerHTML = `<span>${esc(label)}</span><button title="Ctrl+Z">${t('Revenir en arrière')}</button>`;
  const close = closeToast = () => { b.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.target.closest('input,textarea')) { e.preventDefault(); b.querySelector('button').click(); } };
  b.querySelector('button').onclick = () => { undo(); close(); showProject(); document.querySelector('#tabs .on')?.click(); };
  document.addEventListener('keydown', key); document.body.append(b); setTimeout(close, 10000);
}
/** Désactive les boutons IA tant que l'usage de l'IA n'est pas autorisé (Paramètres). */
export function gateAI(root, sels, statusSel) {
  if (isAuthorized()) return;
  sels.forEach(q => { const b = $(root, q); b.disabled = true; b.title = t('Usage de l’IA non autorisé'); });
  $(root, statusSel).innerHTML = `<span class="err">${t('IA non autorisée : coche la case de confirmation dans Paramètres.')}</span>`;
}
