// Usage: node tools/build-standalone.mjs  -> dist/mitremapper.html
// Génère un fichier HTML unique (CSS, JS, référentiel ATT&CK et exemples inlinés) qui s'ouvre par double-clic (file://), sans serveur.
// Mini-bundler sans dépendance : chaque module devient une fonction, les import/export sont réécrits.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');

const order = [], seen = new Set(), src = {};
function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  src[name] = read(`js/${name}.js`);
  for (const m of src[name].matchAll(/^import\s+.+?\s+from\s+'\.\/(\w+)\.js';?\s*$/gm)) visit(m[1]);
  order.push(name); // dépendances d'abord
}
visit('app');

const rewriteImports = code => code.replace(/^import\s+(.+?)\s+from\s+'\.\/(\w+)\.js';?\s*$/gm, (_, spec, dep) => {
  const ns = spec.match(/^\*\s+as\s+(\w+)$/);
  return ns ? `const ${ns[1]} = __m.${dep};` : `const ${spec.replace(/(\w+)\s+as\s+(\w+)/g, '$1: $2')} = __m.${dep};`;
});
let bundle = '';
for (const name of order) {
  let code = rewriteImports(src[name]);
  if (name === 'app') { bundle += code; continue; } // point d'entrée : top-level await conservé
  const names = [];
  code = code.replace(/^export\s+((?:async\s+)?function|const|let|class)\s+([\w$]+)/gm, (_, kw, n) => { names.push(n); return `${kw} ${n}`; });
  bundle += `__m.${name} = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();\n`;
}

const attack = JSON.parse(read('data/attack.json'));
const samples = Object.fromEntries(['cti.txt', 'rules.yml', 'project.json'].map(f => [f, read('data/sample/' + f)]));
const script = `const __m = {};\nglobalThis.__ATTACK__ = ${JSON.stringify(attack)};\nglobalThis.__SAMPLES__ = ${JSON.stringify(samples)};\n${bundle}`.replace(/<\/script/gi, '<\\/script');

const html = read('index.html')
  .replace(/<!-- dev:start[\s\S]*?<!-- dev:end -->\r?\n?/, '')
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${read('css/style.css')}\n</style>`)
  .replace('<script type="module" src="js/app.js"></script>', () => `<script type="module">\n${script}\n</script>`);
if (html.includes('src="js/app.js"') || html.includes('href="css/style.css"')) throw new Error('Remplacement HTML échoué');

mkdirSync(new URL('dist/', root), { recursive: true });
writeFileSync(new URL('dist/mitremapper.html', root), html);
console.log(`dist/mitremapper.html : ${(html.length / 1024).toFixed(0)} Ko, modules : ${order.join(', ')}`);
