import { loadAttack, attack } from './attack.js';
import { showProject } from './ui.js';
import { t, lang, setLang } from './i18n.js';
import * as settings from './settings.js';
import * as scenarios from './scenarios.js';
import * as mapping from './mapping.js';
import * as coverage from './coverage.js';
// id d'onglet (ancre d'URL) -> [module, libellé] ; les anciennes ancres françaises restent acceptées
const views = { scenarios: [scenarios, t('Scénarios')], rules: [mapping, t('Règles')], coverage: [coverage, t('Couverture')], settings: [settings, t('Paramètres')] };
const legacy = { 'Scénarios': 'scenarios', 'Règles': 'rules', 'Couverture': 'coverage', 'Paramètres': 'settings' };
const tabs = document.getElementById('tabs'), view = document.getElementById('view');
function show(id) {
  [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.id === id));
  view.replaceChildren(); views[id][0].render(view); showProject();
  location.hash = id;
}
for (const [id, [, label]] of Object.entries(views)) {
  const b = document.createElement('button'); b.textContent = label; b.dataset.id = id; b.onclick = () => show(id); tabs.append(b);
}
document.documentElement.lang = lang;
document.querySelector('footer').textContent = t('MITREMapper · Wavestone — Outil d’aide à la couverture de détection ATT&CK · Les propositions du LLM sont à relire');
document.getElementById('proj').title = t('Projet courant (Paramètres → Projets)');
const lb = document.getElementById('lang');
lb.textContent = lang === 'en' ? 'FR' : 'EN';
lb.title = lang === 'en' ? 'Passer l’interface en français' : 'Switch the interface to English';
lb.onclick = () => { setLang(lang === 'en' ? 'fr' : 'en'); location.reload(); };
await loadAttack();
document.getElementById('ver').textContent = `ATT&CK Enterprise v${attack.version}`;
const h = decodeURIComponent(location.hash.slice(1));
show(views[h] ? h : legacy[h] || 'settings');
