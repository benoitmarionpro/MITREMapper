import { state, save, exportJson, importProject, projectForExport, loadDemo } from './store.js';
import { PROVIDERS, llm } from './llm.js';
import { getKey, setKey, clearKeys, isRemembered, mask, isAuthorized, setAuthorized } from './keys.js';
import { esc, $ } from './ui.js';

export function render(root) {
  const s = state.settings;
  root.innerHTML = `
  <h2>Utilisation de l'IA</h2>
  <label class="chk"><input type="checkbox" id="auth"> I confirm that AI use is authorized for this content and complies with the client's rules.</label>
  <p class="mut">Je confirme que l'usage de l'IA est autorisé pour ce contenu et conforme aux règles du client. Aucun appel IA (génération, mapping, liste des modèles, test) n'est envoyé tant que cette case n'est pas cochée ; elle est à reconfirmer à chaque session.</p>
  <h2>Endpoint LLM</h2>
  <div class="row">
    <div><label for="prov">Fournisseur</label><select id="prov">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('')}</select></div>
    <div><label for="base" id="base-l">URL de base</label><input id="base"></div>
    <div><label for="key" id="key-l">Clé API</label><input id="key" type="password" autocomplete="off"></div>
    <div data-hide="azure"><label for="model">Modèle</label><input id="model" list="models"><datalist id="models"></datalist></div>
    <div data-show="azure"><label for="dep">Déploiement</label><input id="dep"></div>
    <div data-show="azure"><label for="apiv">Version d'API</label><input id="apiv"></div>
    <div><label for="temp">Température</label><input id="temp" type="number" step="0.1" min="0" max="2"></div>
    <div><label for="batch">Règles par lot</label><input id="batch" type="number" min="1" max="50"></div>
  </div>
  <label class="chk"><input type="checkbox" id="rem"> Mémoriser cette clé sur ce navigateur</label>
  <p class="mut">Par défaut la clé reste en mémoire de session (effacée à la fermeture de l'onglet) et n'est jamais exportée ni enregistrée avec le projet. Elle n'est envoyée qu'à l'URL ci-dessus (HTTPS exigé, sauf en local). Le serveur doit autoriser CORS pour <code>${esc(location.origin)}</code> (Ollama : variable <code>OLLAMA_ORIGINS</code>).</p>
  <div class="bar"><button id="models-btn">Lister les modèles</button><button id="test" class="pri">Tester la connexion</button><button id="clear">Effacer les clés API</button><span id="pill" class="pill"></span></div>
  <p id="st" class="mut"></p>
  <h2>Stratégie de détection</h2>
  <label for="stages">Étapes (une par ligne)</label><textarea id="stages" style="min-height:5rem"></textarea>
  <h2>Projet</h2>
  <div class="bar"><button id="exp">Exporter le projet (JSON)</button><label style="margin:0">Importer <input id="imp" type="file" accept=".json" style="width:auto"></label><button id="reset">Tout effacer</button></div>
  <div class="bar"><button id="demo" class="pri">Charger la démo complète (sans LLM)</button><span class="mut">Scénarios et règles d'exemple déjà mappés : prêt pour la matrice en un clic.</span></div>`;

  const f = { base: 'base', model: 'model', dep: 'deployment', apiv: 'apiVersion', temp: 'temperature', batch: 'batch' };
  const st = $(root, '#st'), pill = $(root, '#pill');
  const showStatus = () => {
    const { state: k } = llm.status;
    pill.className = 'pill ' + k;
    pill.textContent = { idle: 'Non testé', busy: 'En cours…', ok: 'OK', warn: 'Liste de secours', error: 'Erreur' }[k];
  };
  const applyProvider = () => {
    const p = PROVIDERS[s.provider], az = p.kind === 'azure';
    root.querySelectorAll('[data-show]').forEach(e => e.hidden = !az);
    root.querySelectorAll('[data-hide]').forEach(e => e.hidden = az);
    $(root, '#base-l').textContent = az ? 'Endpoint HTTPS Azure (https://<ressource>.openai.azure.com)' : 'URL de base';
    $(root, '#key-l').textContent = `Clé API (${p.keyRequired ? 'requise' : 'optionnelle'})`;
    const k = getKey(s.provider);
    $(root, '#key').value = ''; $(root, '#key').placeholder = k ? `Clé enregistrée ${mask(k)}` : '';
    $(root, '#rem').checked = isRemembered(s.provider);
  };
  const fill = () => { for (const [id, k] of Object.entries(f)) $(root, '#' + id).value = s[k]; $(root, '#stages').value = s.stages.join('\n'); $(root, '#prov').value = s.provider; applyProvider(); };
  const loadModels = async () => {
    try {
      const r = await llm.getAvailableModels();
      $(root, '#models').innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
      st.textContent = r.fallback ? `Liste de secours (chargement impossible : ${r.reason})` : `${r.models.length} modèles chargés (voir le champ Modèle).`;
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
  $(root, '#clear').onclick = () => { if (confirm('Effacer toutes les clés API de ce navigateur (session et mémorisées) ?')) { clearKeys(); applyProvider(); st.textContent = 'Clés API effacées.'; } };
  $(root, '#stages').onchange = e => { s.stages = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); save(); };
  $(root, '#models-btn').onclick = loadModels;
  $(root, '#test').onclick = async () => {
    st.textContent = ''; pill.className = 'pill busy'; pill.textContent = 'En cours…';
    try { st.textContent = 'Connexion OK : ' + await llm.testConnection(); } catch (e) { st.textContent = e.message; }
    showStatus();
  };
  $(root, '#exp').onclick = () => exportJson('mitremapper-projet.json', projectForExport());
  $(root, '#imp').onchange = async e => { try { importProject(await e.target.files[0].text()); alert('Projet importé'); } catch (x) { alert(x.message); } };
  $(root, '#demo').onclick = async () => {
    if ((state.scenarios.length || state.rules.length) && !confirm('Remplacer les scénarios et règles actuels par la démo ?')) return;
    try { await loadDemo(); alert('Démo chargée : voir Scénarios, Règles et Couverture.'); } catch (x) { alert(x.message); }
  };
  $(root, '#reset').onclick = () => { if (confirm('Effacer scénarios, règles et CTI ?')) { state.scenarios = []; state.rules = []; state.cti = ''; save(); } };
}
