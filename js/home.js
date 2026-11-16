// Accueil : le parcours en 3 étapes et l'état du projet courant, pour s'orienter sans connaître l'outil.
import { state, loadDemo, sref } from './store.js';
import { PROVIDERS } from './llm.js';
import { isAuthorized } from './keys.js';
import { analysis } from './coverage.js';
import { esc, $, showProject } from './ui.js';
import { t } from './i18n.js';

const go = id => document.querySelector(`#tabs [data-id="${id}"]`)?.click();

export function render(root) {
  const S = state.scenarios, R = state.rules, mapped = R.filter(r => r.mapped).length, reviewed = R.filter(r => r.reviewed).length;
  const A = S.length && R.length ? analysis() : null, p = PROVIDERS[state.settings.provider];
  // état d'une étape : done (faite), todo (à faire maintenant), wait (dépend d'une étape précédente)
  const steps = [
    { id: 'scenarios', n: 1, title: t('Scénarios de menace'), what: t('Profil du client et rapports CTI : l’IA propose les scénarios à couvrir, tu les relis.'),
      k: S.length ? 'done' : 'todo', stat: S.length ? t('{n} scénario(s) : {list}', { n: S.length, list: S.slice(0, 4).map(sref).join(', ') + (S.length > 4 ? '…' : '') }) : t('Aucun scénario.') },
    { id: 'rules', n: 2, title: t('Règles de détection'), what: t('Importe les règles (Sigma, KQL, SPL…) : mappées sur ATT&CK et sur les scénarios, par leurs tags ou par l’IA.'),
      k: !R.length ? (S.length ? 'todo' : 'wait') : mapped < R.length || reviewed < R.length ? 'todo' : 'done', // relecture comprise
      stat: R.length ? t('{n} règle(s), {m} mappée(s), {v} validée(s)', { n: R.length, m: mapped, v: reviewed }) : t('Aucune règle.') },
    { id: 'coverage', n: 3, title: t('Couverture et livrables'), what: t('Matrice ATT&CK, écarts priorisés, sources de données, rapport client, Excel et couches Navigator.'),
      k: A ? 'done' : 'wait', stat: A ? t('{pct} % des techniques des scénarios couvertes, {gap} écart(s)', { pct: A.pct, gap: A.tot.gap }) : t('Disponible quand scénarios et règles sont en place.') },
  ];
  const next = steps.find(s => s.k === 'todo');
  const LBL = { done: t('Fait'), todo: t('À faire'), wait: t('En attente') };
  root.innerHTML = `
  <h2>${t('Projet « {name} »', { name: esc(state.name) })}</h2>
  <p class="mut">${t('MITREMapper aide à vérifier qu’un client détecte les attaques qui le menacent : scénarios issus de la CTI, règles de détection mappées sur MITRE ATT&CK, couverture et écarts priorisés.')}</p>
  <div class="steps">${steps.map(s => `<section class="card step ${s.k}${s === next ? ' next' : ''}">
    <div class="sh"><b class="num">${s.n}</b><h3>${s.title}</h3><span class="pill ${s.k === 'done' ? 'ok' : s.k === 'todo' ? 'warn' : ''}">${LBL[s.k]}</span></div>
    <p class="mut">${s.what}</p><p>${esc(s.stat)}</p>
    <button data-go="${s.id}" class="${s === next ? 'pri' : ''}">${t('Ouvrir')} ${s.title.toLowerCase()}</button></section>`).join('')}</div>
  <div class="card"><h3>${t('Intelligence artificielle')}</h3>
    <p>${isAuthorized() ? `<span class="pill ok">${t('Autorisée pour cette session')}</span>` : `<span class="pill warn">${t('Non autorisée')}</span> ${t('les règles taguées sont mappées sans IA ; le reste attend l’autorisation.')}`}
    <span class="mut">${t('Fournisseur : {p}, modèle {m}', { p: esc(t(p?.label || '')), m: esc(state.settings.model || '—') })}</span></p>
    <button data-go="settings">${t('Paramètres')}</button></div>
  ${S.length || R.length ? '' : `<div class="card"><b>${t('Première visite ?')}</b> ${t('La démo ouvre un projet complet (11 scénarios, 7 règles déjà mappés) sans appel à l’IA.')} <button id="demo" class="pri">${t('Ouvrir la démo')}</button></div>`}`;
  root.onclick = e => { const id = e.target.closest('[data-go]')?.dataset.go; if (id) go(id); };
  const d = $(root, '#demo'); if (d) d.onclick = async () => { try { await loadDemo(); showProject(); render(root); } catch (x) { alert(x.message); } };
}
