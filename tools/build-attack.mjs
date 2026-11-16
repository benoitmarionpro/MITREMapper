// Usage: node tools/build-attack.mjs [version] [fichier-stix-local]  -> data/attack.json (compact ATT&CK enterprise)
// Version figée (20.1 par défaut) : changer de référentiel est une décision explicite (techniques renommées, tactiques scindées…).
import { readFileSync, writeFileSync } from 'node:fs';
const V = process.argv[2] || '20.1';
const SRC = `https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack-${V}.json`;
const bundle = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : await (await fetch(SRC)).json();
const ref = o => o.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;
const live = o => !o.revoked && !o.x_mitre_deprecated;
const byId = new Map(bundle.objects.map(o => [o.id, o]));
const tactics = bundle.objects.filter(o => o.type === 'x-mitre-tactic' && live(o))
  .map(o => ({ id: ref(o), short: o.x_mitre_shortname, name: o.name }));
const order = ['reconnaissance','resource-development','initial-access','execution','persistence','privilege-escalation','stealth','defense-impairment','credential-access','discovery','lateral-movement','collection','command-and-control','exfiltration','impact'];
tactics.sort((a, b) => order.indexOf(a.short) - order.indexOf(b.short));
// Sources de données : technique <- detects <- stratégie de détection -> analytics -> composants de données (DCxxxx)
const dcOf = new Map();
for (const r of bundle.objects) if (r.type === 'relationship' && r.relationship_type === 'detects' && live(r)) {
  const ds = byId.get(r.source_ref), te = byId.get(r.target_ref);
  if (!ds || !te || !live(ds) || !live(te)) continue;
  const s = dcOf.get(te.id) || new Set();
  for (const a of ds.x_mitre_analytic_refs || []) for (const l of byId.get(a)?.x_mitre_log_source_references || []) s.add(l.x_mitre_data_component_ref);
  dcOf.set(te.id, s);
}
const components = [...new Set([...dcOf.values()].flatMap(s => [...s]))].map(id => byId.get(id)).filter(Boolean)
  .map(o => ({ stix: o.id, id: ref(o), name: o.name })).sort((a, b) => a.id.localeCompare(b.id));
const idx = new Map(components.map((c, i) => [c.stix, i]));
const techniques = bundle.objects.filter(o => o.type === 'attack-pattern' && live(o)).map(o => {
  const dc = [...(dcOf.get(o.id) || [])].map(s => idx.get(s)).filter(i => i !== undefined).sort((a, b) => a - b);
  return { id: ref(o), name: o.name, tactics: (o.kill_chain_phases || []).map(k => k.phase_name), ...(dc.length ? { dc } : {}) };
}).sort((a, b) => a.id.localeCompare(b.id));
// IDs révoqués -> ID actuel (chaînes suivies) : les anciens IDs proposés par un LLM ou présents dans un projet sont convertis, pas rejetés
const live_ = new Set(techniques.map(t => t.id)), revoked = new Map();
for (const r of bundle.objects) if (r.type === 'relationship' && r.relationship_type === 'revoked-by' && r.source_ref.startsWith('attack-pattern--'))
  revoked.set(ref(byId.get(r.source_ref)), ref(byId.get(r.target_ref)));
const moved = {};
for (const [from] of revoked) { let to = from, n = 0; while (revoked.has(to) && n++ < 10) to = revoked.get(to); if (live_.has(to) && !live_.has(from)) moved[from] = to; }
const version = bundle.objects.find(o => o.type === 'x-mitre-collection')?.x_mitre_version;
writeFileSync(new URL('../data/attack.json', import.meta.url), JSON.stringify({ version, tactics, techniques, components: components.map(({ id, name }) => ({ id, name })), moved }));
console.log(version, tactics.length, techniques.length, 'composants de données :', components.length, 'IDs révoqués convertis :', Object.keys(moved).length);
