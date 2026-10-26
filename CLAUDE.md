# MITREMapper

## Objectif
Outil 100 % client-side (HTML/JS/CSS, hébergement statique) qui aide un analyste detection engineering / CTI à :
1. **Dériver des scénarios de menace** à couvrir pour un type de client, à partir de rapports CTI et de son profil.
2. **Mapper des règles de détection** (Sigma, KQL, SPL, documentation…) vers MITRE ATT&CK, une étape de stratégie de détection et ces scénarios.
3. **Produire une matrice de couverture** (matrice ATT&CK, couverture par scénario, trous priorisés, export Navigator/CSV).

Le LLM fait le gros du travail ; l'utilisateur relit et corrige. Les IDs ATT&CK renvoyés par le LLM sont toujours validés contre le référentiel embarqué (anti-hallucination).

## Contraintes
- Statique pur : pas de backend, pas de dépendance npm au runtime, ES modules natifs. Le dossier se sert avec `python -m http.server 8000` ; pour l'usage sans serveur, `node tools/build-standalone.mjs` génère `dist/mitremapper.html` (fichier unique, ouvrable en `file://`). **Régénérer et committer `dist/` après toute modification de `js/`, `css/`, `index.html` ou `data/`.**
- Règles de l'équipe centrale Wavestone : `CYBAIMaker.md` (à respecter pour toute évolution : approbation avant appel IA, secrets, `LLMClient`, validation, erreurs).
- Données projet dans le `localStorage` (clé `mitremapper.v1`). Les clés API sont **séparées** (`js/keys.js`, `mitremapper.keys`) : `sessionStorage` par défaut, `localStorage` seulement via « Mémoriser cette clé », une clé par fournisseur ; jamais dans le projet, les exports, les prompts ou les messages d'erreur. L'autorisation d'usage de l'IA est en `sessionStorage` (`mitremapper.ai-ok`) et bloque tout appel tant qu'elle n'est pas donnée. Rien n'est envoyé ailleurs qu'à l'endpoint LLM configuré.
- LLM configurable via le registre `PROVIDERS` de `js/llm.js` (OpenAI, Anthropic, Mistral, Azure OpenAI/Foundry, Ollama Cloud, Ollama local, OpenRouter, générique compatible OpenAI). Un seul point d'accès : `llm` (classe `LLMClient` : `getAvailableModels`, `testConnection`, `generate`), précédé de `config()` qui valide autorisation, fournisseur, modèle, clé, HTTPS et URL, et de `LLMError` (erreurs contextualisées, purgées des secrets). Endpoint de dev par défaut : `http://127.0.0.1:11434/v1` (modèle `auto`).
- Garder le code minimal : pas d'abstraction ni de framework sans besoin avéré.

## Structure
| Fichier | Rôle |
|---|---|
| `index.html`, `css/style.css` | Coquille, charte Wavestone (tokens repris de l'outil Mythos Readiness Assessment, thème clair uniquement) |
| `js/app.js` | Onglets (Scénarios, Règles, Couverture, Paramètres), chargement ATT&CK |
| `js/store.js` | État du projet ↔ localStorage, import/export JSON (les `settings` ne sont jamais exportés/écrasés) |
| `js/llm.js` | Registre `PROVIDERS`, `config()` (validation), `LLMError`, `llm` (`LLMClient`), `parseJson` tolérant, `chatJson` (1 retry) |
| `js/keys.js` | Clés API (session / mémorisées, par fournisseur) et autorisation d'usage de l'IA |
| `js/attack.js` | Chargement et validation des IDs, catalogue pour les prompts |
| `js/scenarios.js`, `js/mapping.js`, `js/coverage.js` | Un module par écran : prompts + rendu + édition |
| `js/settings.js` | Configuration LLM, étapes de stratégie, import/export projet |
| `js/ui.js` | Helpers (`esc`, `run` avec annulation, lecture de fichiers) |
| `data/attack.json` | Référentiel ATT&CK Enterprise compact, **généré** |
| `tools/build-attack.mjs` | Régénère `data/attack.json` depuis le STIX officiel (`node tools/build-attack.mjs`) |
| `tools/build-standalone.mjs` | Génère `dist/mitremapper.html`, fichier unique sans serveur (mini-bundler : un module = une fonction ; ne pas utiliser de `export` hors `export const/let/function/class NOM` en début de ligne ni de live binding, ex. `attack` est un objet partagé) |
| `data/sample/` | CTI, règles Sigma et `project.json` (démo complète déjà mappée, chargée par `loadDemo()` dans `store.js`) |
| `test.html` | Asserts minimaux (parse JSON, validation d'IDs) : ouvrir via le serveur local |

## Modèle de données
`{client, cti, scenarios[{id,name,priority,techniques[],summary,actors}], rules[{id,name,source,body,techniques[],scenarios[ids],why{scenarioId:phrase},reviewed,tags[],by:'tags'|'ia',tagDiff{tags[],ia[]}|null,stage,confidence,note,mapped}], settings}`

Revue du mapping (`mapping.js`) : `linkState(règle, scénario)` → `ok` (lié, technique commune au niveau parent), `suspect` (lié sans technique commune), `miss` (non lié mais technique commune). `why` et `reviewed` sont optionnels (projets anciens compatibles).

Mapping déterministe d'abord (`mapping.js`) : `extractTechniques(body)` lit les IDs ATT&CK déclarés (tags Sigma, champs MITRE des exports) et les valide ; une règle taguée est mappée sans IA (`by: 'tags'`, scénarios liés par technique commune). L'IA ne traite que les règles sans tag, ou toutes si l'option de vérification est cochée (`tagDiff` = écart au niveau technique parente entre tags et lecture IA).

Règle de couverture (`coverage.js`) : une technique de scénario est *couverte* si une règle de confiance ≥ medium la cite ou cite l'une de ses sous-techniques, *partielle* si seule une règle `low` la couvre ou si seule sa technique parente est couverte, sinon *trou*. Une règle sur une sous-technique compte aussi pour sa parente dans la matrice.

## Conventions
- Interface et prompts en français. Les noms de techniques restent ceux de MITRE.
- Toute sortie LLM passe par `chatJson` puis `validate()` avant d'entrer dans l'état.
- Le référentiel ATT&CK évolue (v19 a scindé Defense Evasion en Stealth + Defense Impairment) : ne pas coder en dur la liste des tactiques, elle vient de `attack.json`.
- Vérifier après modification : `node --check js/*.js`, ouvrir `test.html`, tester sur l'exemple de `data/sample/`, régénérer `dist/mitremapper.html` et l'ouvrir en `file://`.

## Hors périmètre actuel
Import PDF (coller le texte), ATT&CK Mobile/ICS, connecteurs API SIEM/EDR, comptes/serveur, streaming des réponses LLM.
