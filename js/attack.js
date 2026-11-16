export const attack = { version: '', tactics: [], techniques: [], components: [], moved: {} }; // objet partagé, rempli par loadAttack()
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
