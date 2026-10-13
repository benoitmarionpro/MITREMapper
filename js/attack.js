export const attack = { version: '', tactics: [], techniques: [] }; // objet partagé, rempli par loadAttack()
const byId = new Map();
export async function loadAttack() {
  Object.assign(attack, globalThis.__ATTACK__ ?? await (await fetch('data/attack.json')).json()); // __ATTACK__ : version fichier unique
  attack.techniques.forEach(t => byId.set(t.id, t));
  return attack;
}
export const tech = id => byId.get(id);
/** Valide une liste d'IDs : retourne {ok:[ids], rejected:[ids]} (normalise la casse, dédoublonne). */
export function validate(ids) {
  const ok = [], rejected = [];
  for (const raw of ids || []) {
    const id = String(raw).trim().toUpperCase();
    if (byId.has(id)) { if (!ok.includes(id)) ok.push(id); } else rejected.push(String(raw));
  }
  return { ok, rejected };
}
export const parentOf = id => id.split('.')[0];
/** Liste compacte pour les prompts : "T1059 Command and Scripting Interpreter" (techniques parentes seules). */
export const promptCatalog = () => attack.techniques.filter(t => !t.id.includes('.')).map(t => `${t.id} ${t.name}`).join('\n');
