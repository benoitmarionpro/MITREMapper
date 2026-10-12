import { state, save, exportJson, importProject, projectForExport } from './store.js';
import { PRESETS, listModels, chat } from './llm.js';
import { esc, $ } from './ui.js';
export function render(root) {
  const s = state.settings;
  root.innerHTML = `
  <h2>Endpoint LLM</h2>
  <div class="row">
    <div><label>Fournisseur</label><select id="prov">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></div>
    <div><label>Protocole</label><select id="proto"><option value="openai">OpenAI-compatible (/chat/completions)</option><option value="anthropic">Anthropic (/v1/messages)</option></select></div>
    <div><label>Base URL</label><input id="base"></div>
    <div><label>Clé API (optionnelle en local)</label><input id="key" type="password" autocomplete="off"></div>
    <div><label>Modèle</label><input id="model" list="models"><datalist id="models"></datalist></div>
    <div><label>Température</label><input id="temp" type="number" step="0.1" min="0" max="2"></div>
    <div><label>Règles par lot</label><input id="batch" type="number" min="1" max="50"></div>
  </div>
  <p class="mut">La clé est stockée en clair dans le localStorage de ce navigateur et n'est envoyée qu'à l'URL ci-dessus. Le serveur doit autoriser CORS pour <code>${esc(location.origin)}</code> (Ollama : variable <code>OLLAMA_ORIGINS</code>).</p>
  <div class="bar"><button id="models-btn">Lister les modèles</button><button id="test" class="pri">Tester la connexion</button><span id="st"></span></div>
  <h2>Stratégie de détection</h2>
  <label>Étapes (une par ligne)</label><textarea id="stages" style="min-height:5rem"></textarea>
  <h2>Projet</h2>
  <div class="bar"><button id="exp">Exporter le projet (JSON)</button><label style="margin:0">Importer <input id="imp" type="file" accept=".json" style="width:auto"></label><button id="reset">Tout effacer</button></div>`;
  const f = { prov: 'provider', proto: 'protocol', base: 'base', key: 'key', model: 'model', temp: 'temperature', batch: 'batch' };
  const fill = () => { for (const [id, k] of Object.entries(f)) $(root, '#' + id).value = s[k]; $(root, '#stages').value = s.stages.join('\n'); };
  fill();
  for (const [id, k] of Object.entries(f)) $(root, '#' + id).onchange = e => { s[k] = e.target.value; save(); };
  $(root, '#prov').onchange = e => {
    const { protocol, base, model } = PRESETS[e.target.value];
    Object.assign(s, { provider: e.target.value, protocol, base, model }); save(); fill();
  };
  $(root, '#stages').onchange = e => { s.stages = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); save(); };
  const st = $(root, '#st');
  $(root, '#models-btn').onclick = async () => {
    try { $(root, '#models').innerHTML = (await listModels()).map(m => `<option>${esc(m)}</option>`).join(''); st.innerHTML = '<span class="ok">Modèles chargés (voir le champ Modèle)</span>'; }
    catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  $(root, '#test').onclick = async () => {
    st.textContent = '…';
    try { const r = await chat({ system: 'Réponds brièvement.', user: 'Dis "ok".' }); st.innerHTML = `<span class="ok">OK : ${esc(r.slice(0, 60))}</span>`; }
    catch (e) { st.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  };
  $(root, '#exp').onclick = () => exportJson('mitremapper-projet.json', projectForExport());
  $(root, '#imp').onchange = async e => { try { importProject(await e.target.files[0].text()); alert('Projet importé'); } catch (x) { alert(x.message); } };
  $(root, '#reset').onclick = () => { if (confirm('Effacer scénarios, règles et CTI ?')) { state.scenarios = []; state.rules = []; state.cti = ''; save(); } };
}
