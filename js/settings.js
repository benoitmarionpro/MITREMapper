import { state, save, exportJson, importProject, projectForExport, loadDemo, listProjects, openProject, newProject, deleteProject } from './store.js';
import { PROVIDERS, llm } from './llm.js';
import { getKey, setKey, clearKeys, isRemembered, mask, isAuthorized, setAuthorized } from './keys.js';
import { esc, $, showProject } from './ui.js';
import { t, locale } from './i18n.js';

export function render(root) {
  const s = state.settings;
  root.innerHTML = `
  <h2>${t('Projets')}</h2>
  <div class="row">
    <div><label for="pname">${t('Nom du projet courant')}</label><input id="pname"></div>
    <div><label for="plist">${t('Ouvrir un projet')}</label><select id="plist">${listProjects().map(p => `<option value="${p.pid}" ${p.pid === state.pid ? 'selected' : ''}>${esc(p.name)} (${new Date(p.updated).toLocaleDateString(locale)})</option>`).join('')}</select></div>
  </div>
  <div class="bar"><button id="pnew">${t('Nouveau projet')}</button><button id="pdel">${t('Supprimer le projet courant')}</button><button id="reset">${t('Vider le projet courant')}</button>
    <button id="exp">${t('Exporter le projet (JSON)')}</button><label style="margin:0">${t('Importer comme nouveau projet')} <input id="imp" type="file" accept=".json" style="width:auto"></label></div>
  <div class="bar"><button id="demo" class="pri">${t('Ouvrir la démo complète (sans LLM)')}</button><span class="mut">${t('Nouveau projet avec scénarios et règles d’exemple déjà mappés : prêt pour la matrice en un clic.')}</span></div>
  <p class="mut">${t('Les projets sont enregistrés dans ce navigateur ; exporter en JSON pour les sauvegarder ou les partager (les clés API ne sont jamais exportées).')}</p>
  <h2>${t('Utilisation de l’IA')}</h2>
  <label class="chk"><input type="checkbox" id="auth"> I confirm that AI use is authorized for this content and complies with the client's rules.</label>
  <p class="mut">${t('Je confirme que l’usage de l’IA est autorisé pour ce contenu et conforme aux règles du client. Aucun appel IA (génération, mapping, liste des modèles, test) n’est envoyé tant que cette case n’est pas cochée ; elle est à reconfirmer à chaque session.')}</p>
  <h2>${t('Endpoint LLM')}</h2>
  <div class="row">
    <div><label for="prov">${t('Fournisseur')}</label><select id="prov">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(t(p.label))}</option>`).join('')}</select></div>
    <div><label for="base" id="base-l"></label><input id="base"></div>
    <div><label for="key" id="key-l"></label><input id="key" type="password" autocomplete="off"></div>
    <div data-hide="azure"><label for="model">${t('Modèle')}</label><input id="model" list="models"><datalist id="models"></datalist></div>
    <div data-show="azure"><label for="dep">${t('Déploiement')}</label><input id="dep"></div>
    <div data-show="azure"><label for="apiv">${t('Version d’API')}</label><input id="apiv"></div>
    <div><label for="temp">${t('Température')}</label><input id="temp" type="number" step="0.1" min="0" max="2"></div>
    <div><label for="batch">${t('Règles par lot')}</label><input id="batch" type="number" min="1" max="50"></div>
  </div>
  <label class="chk"><input type="checkbox" id="rem"> ${t('Mémoriser cette clé sur ce navigateur')}</label>
  <p class="mut">${t('Par défaut la clé reste en mémoire de session (effacée à la fermeture de l’onglet) et n’est jamais exportée ni enregistrée avec le projet. Elle n’est envoyée qu’à l’URL ci-dessus (HTTPS exigé, sauf en local). Le serveur doit autoriser CORS pour {origin} (Ollama : variable {var}).', { origin: `<code>${esc(location.origin)}</code>`, var: '<code>OLLAMA_ORIGINS</code>' })}</p>
  <div class="bar"><button id="models-btn">${t('Lister les modèles')}</button><button id="test" class="pri">${t('Tester la connexion')}</button><button id="clear">${t('Effacer les clés API')}</button><span id="pill" class="pill"></span></div>
  <p id="st" class="mut"></p>
  <h2>${t('Stratégie de détection')}</h2>
  <label for="stages">${t('Étapes (une par ligne)')}</label><textarea id="stages" style="min-height:5rem"></textarea>
`;

  const f = { base: 'base', model: 'model', dep: 'deployment', apiv: 'apiVersion', temp: 'temperature', batch: 'batch' };
  const st = $(root, '#st'), pill = $(root, '#pill');
  const showStatus = () => {
    const { state: k } = llm.status;
    pill.className = 'pill ' + k;
    pill.textContent = { idle: t('Non testé'), busy: t('En cours…'), ok: 'OK', warn: t('Liste de secours'), error: t('Erreur') }[k];
  };
  const applyProvider = () => {
    const p = PROVIDERS[s.provider], az = p.kind === 'azure';
    root.querySelectorAll('[data-show]').forEach(e => e.hidden = !az);
    root.querySelectorAll('[data-hide]').forEach(e => e.hidden = az);
    $(root, '#base-l').textContent = az ? t('Endpoint HTTPS Azure (https://<ressource>.openai.azure.com)') : t('URL de base');
    $(root, '#key-l').textContent = p.keyRequired ? t('Clé API (requise)') : t('Clé API (optionnelle)');
    const k = getKey(s.provider);
    $(root, '#key').value = ''; $(root, '#key').placeholder = k ? t('Clé enregistrée {mask}', { mask: mask(k) }) : '';
    $(root, '#rem').checked = isRemembered(s.provider);
  };
  const fill = () => { for (const [id, k] of Object.entries(f)) $(root, '#' + id).value = s[k]; $(root, '#stages').value = s.stages.join('\n'); $(root, '#prov').value = s.provider; applyProvider(); };
  const loadModels = async () => {
    try {
      const r = await llm.getAvailableModels();
      $(root, '#models').innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
      st.textContent = r.fallback ? t('Liste de secours (chargement impossible : {r})', { r: r.reason }) : t('{n} modèles chargés (voir le champ Modèle).', { n: r.models.length });
    } catch (e) { st.textContent = e.message; }
    showStatus();
  };
  fill(); showStatus(); st.textContent = llm.status.text;
  $(root, '#auth').checked = isAuthorized();
  $(root, '#auth').onchange = e => { setAuthorized(e.target.checked); if (e.target.checked) loadModels(); };
  for (const [id, k] of Object.entries(f)) $(root, '#' + id).onchange = e => { s[k] = e.target.value; save(); };
  $(root, '#prov').onchange = e => {
    const { base, model } = PROVIDERS[e.target.value];
    Object.assign(s, { provider: e.target.value, base, model }); save(); fill();
    $(root, '#models').innerHTML = PROVIDERS[s.provider].models.map(m => `<option value="${esc(m)}">`).join('');
    if (isAuthorized()) loadModels();
  };
  $(root, '#key').onchange = e => {
    if (!e.target.value.trim()) return;
    setKey(s.provider, e.target.value.trim(), $(root, '#rem').checked); applyProvider();
    if (isAuthorized()) loadModels();
  };
  $(root, '#rem').onchange = e => { const k = getKey(s.provider); if (k) setKey(s.provider, k, e.target.checked); };
  $(root, '#clear').onclick = () => { if (confirm(t('Effacer toutes les clés API de ce navigateur (session et mémorisées) ?'))) { clearKeys(); applyProvider(); st.textContent = t('Clés API effacées.'); } };
  $(root, '#stages').onchange = e => { s.stages = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); save(); };
  $(root, '#models-btn').onclick = loadModels;
  $(root, '#test').onclick = async () => {
    st.textContent = ''; pill.className = 'pill busy'; pill.textContent = t('En cours…');
    try { st.textContent = t('Connexion OK : {r}', { r: await llm.testConnection() }); } catch (e) { st.textContent = e.message; }
    showStatus();
  };
  const reload = () => { showProject(); render(root); };
  $(root, '#pname').value = state.name;
  $(root, '#pname').onchange = e => { state.name = e.target.value.trim() || t('Projet sans nom'); save(); reload(); };
  $(root, '#plist').onchange = e => { try { openProject(e.target.value); } catch (x) { alert(x.message); } reload(); };
  $(root, '#pnew').onclick = () => { const n = prompt(t('Nom du nouveau projet'), t('Nouveau projet')); if (n !== null) { newProject(n.trim()); reload(); } };
  $(root, '#pdel').onclick = () => { if (confirm(t('Supprimer définitivement le projet « {name} » de ce navigateur ?', { name: state.name }))) { deleteProject(state.pid); reload(); } };
  const slug = state.name.normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'projet';
  $(root, '#exp').onclick = () => exportJson(`mitremapper-${slug}.json`, projectForExport());
  $(root, '#imp').onchange = async e => {
    const file = e.target.files[0];
    try { importProject(await file.text(), file.name.replace(/\.json$/i, '')); reload(); } catch (x) { alert(x.message); }
  };
  $(root, '#demo').onclick = async () => { try { await loadDemo(); reload(); } catch (x) { alert(x.message); } };
  $(root, '#reset').onclick = () => { if (confirm(t('Vider le projet « {name} » (scénarios, règles, CTI) ?', { name: state.name }))) { state.scenarios = []; state.rules = []; state.cti = ''; save(); } };
}
