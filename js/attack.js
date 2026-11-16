export const attack = { version: '', tactics: [], techniques: [], components: [], moved: {}, groups: [] }; // objet partagé, rempli par loadAttack()
const byId = new Map();
export async function loadAttack() {
  Object.assign(attack, globalThis.__ATTACK__ ?? await (await fetch('data/attack.json')).json()); // __ATTACK__ : version fichier unique
  attack.techniques.forEach(t => byId.set(t.id, t));
  return attack;
}
export const tech = id => byId.get(id);
/** ID révoqué par MITRE (ex. T1562.001 -> T1685 en v19) : ID actuel ; sinon l'ID lui-même. */
export const current = id => attack.moved?.[id] || id;
/** Valide une liste d'IDs : retourne {ok:[ids], rejected:[ids]} (normalise la casse, convertit les IDs révoqués, dédoublonne). */
export function validate(ids) {
  const ok = [], rejected = [];
  for (const raw of ids || []) {
    const id = current(String(raw).trim().toUpperCase());
    if (byId.has(id)) { if (!ok.includes(id)) ok.push(id); } else rejected.push(String(raw));
  }
  return { ok, rejected };
}
export const parentOf = id => id.split('.')[0];
/** Catalogue pour les prompts : "T1059 Command and Scripting Interpreter", sous-techniques en retrait " .001 PowerShell" (évite les IDs inventés ou périmés). */
export const promptCatalog = () => `Référentiel ATT&CK Enterprise v${attack.version} : utilise UNIQUEMENT ces IDs (une sous-technique en retrait « .001 » sous T1059 se note T1059.001) :\n` + attack.techniques.map(t => t.id.includes('.') ? ` ${t.id.slice(5)} ${t.name}` : `${t.id} ${t.name}`).join('\n');
/** Composants de données ATT&CK ({id: 'DC0032', name}) utiles pour détecter la technique (stratégies de détection MITRE) ; sous-technique sans stratégie propre : ceux de la parente. */
export const sourcesOf = id => (tech(id)?.dc || tech(parentOf(id))?.dc || []).map(i => attack.components[i]).filter(Boolean);
/** Groupes ATT&CK (intrusion sets) : {id: 'G0102', name, aka[], t[index de technique]}. */
export const group = id => attack.groups?.find(g => g.id === id);
export const groupTechs = g => g.t.map(i => attack.techniques[i].id);
/** IDs de groupes valides ; accepte aussi un nom ou un alias (« Wizard Spider », « FIN12 »). Retourne {ok, rejected}. */
export function validateGroups(list) {
  const ok = [], rejected = [], k = s => String(s).trim().toLowerCase();
  for (const raw of Array.isArray(list) ? list : []) {
    const q = k(raw), g = attack.groups?.find(x => k(x.id) === q || k(x.name) === q || x.aka.some(a => k(a) === q));
    if (g) { if (!ok.includes(g.id)) ok.push(g.id); } else if (q) rejected.push(String(raw).slice(0, 60));
  }
  return { ok, rejected };
}
/** Catalogue des groupes pour le prompt : "G0102 Wizard Spider (UNC1878, FIN12…)". */
export const groupCatalog = () => attack.groups.map(g => `${g.id} ${g.name}${g.aka.length ? ` (${g.aka.join(', ')})` : ''}`).join('\n');
