# MITREMapper

## Objectif
Outil 100 % client-side (HTML/JS/CSS, hébergement statique) qui aide un analyste detection engineering / CTI à :
1. **Dériver des scénarios de menace** à couvrir pour un type de client, à partir de rapports CTI et de son profil.
2. **Mapper des règles de détection** (Sigma, KQL, SPL, documentation…) vers MITRE ATT&CK, une étape de stratégie de détection et ces scénarios.
3. **Produire une matrice de couverture** (matrice ATT&CK, couverture par scénario, écarts priorisés, export Navigator/CSV).

Le LLM fait le gros du travail ; l'utilisateur relit et corrige. Les IDs ATT&CK renvoyés par le LLM sont toujours validés contre le référentiel embarqué (anti-hallucination).

## Contraintes
- Statique pur : pas de backend, pas de dépendance npm au runtime, ES modules natifs. Le dossier se sert avec `python tools/serve.py` (sans cache ; `python -m http.server` laisse le navigateur garder d'anciens modules) ; pour l'usage sans serveur, `node tools/build-standalone.mjs` génère `dist/mitremapper.html` (fichier unique, ouvrable en `file://`). **Régénérer et committer `dist/` après toute modification de `js/`, `css/`, `index.html` ou `data/`.**
- Règles de l'équipe centrale Wavestone : `CYBAIMaker.md` (à respecter pour toute évolution : approbation avant appel IA, secrets, `LLMClient`, validation, erreurs).
- Données projet dans le `localStorage` (clé `mitremapper.v1`). Les clés API sont **séparées** (`js/keys.js`, `mitremapper.keys`) : `sessionStorage` par défaut, `localStorage` seulement via « Mémoriser cette clé », une clé par fournisseur ; jamais dans le projet, les exports, les prompts ou les messages d'erreur. L'autorisation d'usage de l'IA est en `sessionStorage` (`mitremapper.ai-ok`) et bloque tout appel tant qu'elle n'est pas donnée. Rien n'est envoyé ailleurs qu'à l'endpoint LLM configuré.
- LLM configurable via le registre `PROVIDERS` de `js/llm.js` (OpenAI, Anthropic, Mistral, Azure OpenAI/Foundry, Ollama Cloud, Ollama local, OpenRouter, générique compatible OpenAI). Un seul point d'accès : `llm` (classe `LLMClient` : `getAvailableModels`, `testConnection`, `generate`), précédé de `config()` qui valide autorisation, fournisseur, modèle, clé, HTTPS et URL, et de `LLMError` (erreurs contextualisées, purgées des secrets). Endpoint de dev par défaut : `http://127.0.0.1:11434/v1` (modèle `auto`).
- Garder le code minimal : pas d'abstraction ni de framework sans besoin avéré.

## Structure
| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | Coquille, charte Wavestone (tokens repris de l'outil Mythos Readiness Assessment, thème clair uniquement) |
| `js/app.js` | Onglets (Accueil, Scénarios, Règles, Couverture, Paramètres ; Accueil par défaut), chargement ATT&CK |
| `js/home.js` | Accueil : parcours en 3 étapes avec leur état (fait / à faire / en attente), état de l’IA, accès à la démo |
| `js/store.js` | État du projet ↔ localStorage, import/export JSON (les `settings` ne sont jamais exportés/écrasés) |
| `js/llm.js` | Registre `PROVIDERS`, `config()` (validation), `LLMError`, `llm` (`LLMClient`), `parseJson` tolérant, `chatJson` (1 retry) |
| `js/keys.js` | Clés API (session / mémorisées, par fournisseur) et autorisation d'usage de l'IA |
| `js/attack.js` | Chargement et validation des IDs, catalogue pour les prompts |
| `js/scenarios.js`, `js/mapping.js`, `js/coverage.js` | Un module par écran : prompts + rendu + édition |
| `js/export.js` | Livrables : `reportHtml(A)` (rapport imprimable), `workbook(A)` (.xlsx écrit à la main), `layer(A, s?)` / `layersZip(A)` (Navigator), `zip()` (zip « stocké » + CRC32), `reco()` ; `A = analysis()` de `coverage.js` (ne pas importer `coverage.js` depuis `export.js` : cycle interdit par le mini-bundler) |
| `js/settings.js` | Configuration LLM, étapes de stratégie, import/export projet |
| `js/i18n.js` | `t()`, `lang`, `locale`, `setLang`, dictionnaire `EN` |
| `js/ui.js` | Helpers (`esc`, `run` avec annulation, lecture de fichiers) |
| `data/attack.json` | Référentiel ATT&CK Enterprise compact, **généré** : `techniques[{id,name,tactics,dc[]}]` (`dc` = index dans `components[{id:'DC0032',name}]`, composants de données des stratégies de détection MITRE ; lire via `sourcesOf()`), `moved{ancienId: idActuel}` (IDs révoqués), `groups[{id:'G0102',name,aka[],t[index de technique]}]` (lire via `group()`, `groupTechs()`, `validateGroups()`) |
| `tools/build-attack.mjs` | Régénère `data/attack.json` depuis le STIX officiel (`node tools/build-attack.mjs [version] [stix-local]`, version figée à 20.1 par défaut : monter de version est une décision explicite) |
| `tools/build-standalone.mjs` | Génère `dist/mitremapper.html`, fichier unique sans serveur (mini-bundler : un module = une fonction ; ne pas utiliser de `export` hors `export const/let/function/class NOM` en début de ligne ni de live binding, ex. `attack` est un objet partagé) |
| `data/sample/` | CTI, règles Sigma et `project.json` (démo complète déjà mappée, chargée par `loadDemo()` dans `store.js`) |
| `test.html` | Tests (parse JSON, IDs, tags, liens, CYBAIMaker, couverture, références) : ouvrir via le serveur local ; met `document.title` à `PASS n` / `FAIL n` ; sauvegarde et restaure le localStorage |
| `.github/workflows/ci.yml` | CI : `node --check`, `dist/` à jour, `test.html` dans Chrome headless |
| `fonts/` | Inter et Poppins (woff2, SIL OFL 1.1), inlinées en data URI dans `dist/` |

## Modèle de données
`{pid, name, nextRef, client, cti, snapshots[{id,date,label,pct,nTech,tot,st{techId:cov|part|gap},scen[{ref,name,pct}]}], scenarios[{id,ref,name,priority,techniques[],summary,actors,groups[G…],evidence}], rules[{id,name,source,body,techniques[],scenarios[ids],why{scenarioId:phrase},reviewed,tags[],by:'tags'|'ia',tagDiff{tags[],ia[]}|null,stage,confidence,note,mapped}], settings}`

Projets (`store.js`) : projet courant + réglages dans `mitremapper.v1` ; bibliothèque dans `mitremapper.lib` (index) et `mitremapper.lib.<pid>` (données sans réglages), synchronisée à chaque `save()`. `state` est un objet unique jamais réassigné (`loadInto` le vide puis le remplit). Références de scénarios stables : `s.ref` attribué par `save()` (`nextRef`, jamais réutilisé ; renumérotation depuis S1 si aucun scénario n'a de ref) ; toujours afficher via `sref(s)`, jamais par l'index.

Revue du mapping (`mapping.js`) : `linkState(règle, scénario)` → `ok` (lié, technique commune au niveau parent), `suspect` (lié sans technique commune), `miss` (non lié mais technique commune). `why` et `reviewed` sont optionnels (projets anciens compatibles).

Mapping déterministe d'abord (`mapping.js`) : `extractTechniques(body)` lit les IDs ATT&CK déclarés (tags Sigma, champs MITRE des exports) et les valide ; une règle taguée est mappée sans IA (`by: 'tags'`, scénarios liés par technique commune). L'IA ne traite que les règles sans tag, ou toutes si l'option de vérification est cochée (`tagDiff` = divergence au niveau technique parente entre tags et lecture IA).

Règle de couverture (`coverage.js`, `status(coverageMap(), id)`) : *couverte* si une règle de confiance ≥ medium cite la technique elle-même, ou si toutes ses sous-techniques sont couvertes ; *partielle* si seulement certaines sous-techniques, confiance `low`, ou (sous-technique) seule la parente est couverte ; sinon *écart*.

`analysis()` renvoie aussi `sources` (composants de données ATT&CK des écarts, pondérés par priorité de scénario) et `diff` (`compare()` avec l'instantané choisi dans la page, `view.cmp` : `''` = dernier, `'none'` = aucun), repris par le rapport et le classeur. Instantanés : `snapshot(A, label)`, rapprochés des scénarios par `ref`.

## Conventions
- Interface bilingue (`js/i18n.js`) : tout texte affiché passe par `t('texte français', { var })` (clé = français, `{var}` pour les variables, apostrophe typographique ’ dans les clés) et doit avoir son entrée dans `EN` (vérifié par `test.html`). Langue mémorisée dans `localStorage` (`mitremapper.lang`), changement = rechargement. Prompts en français, avec consigne de rédiger en anglais si `lang === 'en'`. Les noms de techniques restent ceux de MITRE.
- Ne pas nommer `t` une variable locale dans un module qui importe `t`.
- Action destructive (suppression, vidage, remplacement, remappage complet) : l'envelopper dans `undoable(libellé, fn)` (`ui.js`), qui mémorise le projet (`checkpoint`/`undo` de `store.js`, une seule action annulable) et affiche « Revenir en arrière » (Ctrl+Z) pendant 10 s.
- Accessibilité : tout élément cliquable est un `<button>` (pas de `div`/`tr` seul), avec `aria-label` quand l'état n'est porté que par la couleur ou un symbole ; un volet de détail prend le focus à l'ouverture et le rend à l'élément d'origine à la fermeture (Échap).
- Toute sortie LLM passe par `chatJson` puis `validate()` avant d'entrer dans l'état ; elle est traitée comme non fiable (scénarios via `sanitize()`, valeurs de mapping bornées).
- Contenus analysés (CTI, règles) envoyés au LLM entre balises via `fence()` + consigne `UNTRUSTED` (`llm.js`) : ce sont des données, jamais des instructions. Toute troncature (`MAX_CTI`, `MAX_RULE`) est signalée à l'utilisateur.
- Tout projet importé passe par `sanitize()` (`store.js`) : champs connus seulement, typés et bornés, identifiants régénérés (ils sont insérés dans le HTML), techniques validées. Ajouter un champ au modèle = l'ajouter aussi dans `sanitize()`, sinon il est perdu à l'import.
- Exports CSV : préfixer `'` les cellules commençant par `= + - @` (injection de formule).
- Le référentiel ATT&CK évolue (v19 a scindé Defense Evasion en Stealth + Defense Impairment) : ne pas coder en dur la liste des tactiques, elle vient de `attack.json`. Les IDs révoqués (`attack.moved`) sont convertis par `validate()` / `current()`, et les projets enregistrés par `upgradeIds()` (au démarrage et dans `loadInto`). Le prompt reçoit le catalogue complet, sous-techniques comprises (`promptCatalog()`).
- Citations CTI des scénarios (`evidence`) : vérifiées par `citeOk()` (`scenarios.js`) contre `state.cti`, jamais considérées comme fiables sans ce contrôle.
- Mapping : un seul pipeline, `mapRules(règles, { verify })` (`mapping.js` : tags puis IA), utilisé par l'onglet Règles et par l'ajout d'une ébauche ; ne pas dupliquer cette logique. Une règle non mappée n'entre pas dans la couverture : la page Couverture le signale.
- Ébauches Sigma (`coverage.js`, `draft()`) : mappées par `mapRules(..., { verify: true })` à l'ajout, puis toujours forcées en `confidence: 'low'`, `reviewed: false`, pour ne jamais compter comme couverture avant validation humaine.
- Démo et exemples bilingues : `sample(f)` charge `cti.en.txt` / `project.en.json` en anglais ; toute modification de `project.json` doit être reportée dans `project.en.json` (mêmes IDs et liens).
- Vérifier après modification : `node --check js/*.js`, ouvrir `test.html`, tester sur l'exemple de `data/sample/`, régénérer `dist/mitremapper.html` et l'ouvrir en `file://`.

## Hors périmètre actuel
Import PDF (coller le texte), ATT&CK Mobile/ICS, connecteurs API SIEM/EDR, comptes/serveur, streaming des réponses LLM.
