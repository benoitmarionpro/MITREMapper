import { loadAttack, attack } from './attack.js';
import * as settings from './settings.js';
import * as scenarios from './scenarios.js';
import * as mapping from './mapping.js';
import * as coverage from './coverage.js';
const views = { Scénarios: scenarios, Règles: mapping, Couverture: coverage, Paramètres: settings };
const tabs = document.getElementById('tabs'), view = document.getElementById('view');
function show(name) {
  [...tabs.children].forEach(b => b.classList.toggle('on', b.textContent === name));
  view.replaceChildren(); views[name].render(view);
  location.hash = name;
}
for (const n of Object.keys(views)) {
  const b = document.createElement('button'); b.textContent = n; b.onclick = () => show(n); tabs.append(b);
}
await loadAttack();
document.getElementById('ver').textContent = `ATT&CK Enterprise v${attack.version}`;
const h = decodeURIComponent(location.hash.slice(1));
show(views[h] ? h : 'Paramètres');
