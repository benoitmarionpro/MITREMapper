// Usage: node tools/build-attack.mjs  -> data/attack.json (compact ATT&CK enterprise)
import { writeFileSync } from 'node:fs';
const SRC = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const bundle = await (await fetch(SRC)).json();
const ref = o => o.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;
const live = o => !o.revoked && !o.x_mitre_deprecated;
const tactics = bundle.objects.filter(o => o.type === 'x-mitre-tactic' && live(o))
  .map(o => ({ id: ref(o), short: o.x_mitre_shortname, name: o.name }));
const order = ['reconnaissance','resource-development','initial-access','execution','persistence','privilege-escalation','stealth','defense-impairment','credential-access','discovery','lateral-movement','collection','command-and-control','exfiltration','impact'];
tactics.sort((a, b) => order.indexOf(a.short) - order.indexOf(b.short));
const techniques = bundle.objects.filter(o => o.type === 'attack-pattern' && live(o)).map(o => ({
  id: ref(o), name: o.name, tactics: (o.kill_chain_phases || []).map(k => k.phase_name),
})).sort((a, b) => a.id.localeCompare(b.id));
const version = bundle.objects.find(o => o.type === 'x-mitre-collection')?.x_mitre_version;
writeFileSync(new URL('../data/attack.json', import.meta.url), JSON.stringify({ version, tactics, techniques }));
console.log(version, tactics.length, techniques.length);
