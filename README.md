# MITREMapper

Outil web local pour passer de la **veille CTI** à une **matrice de couverture de détection** :

1. des rapports de menace + le profil du client → **scénarios de menace** à couvrir ;
2. vos règles de détection (ou leur documentation) → **mapping MITRE ATT&CK**, étape de stratégie de détection, scénarios ;
3. une **matrice de couverture** avec les trous classés par priorité.

L'IA propose, vous validez. Tout tourne dans votre navigateur : pas de serveur, vos données restent en local.

## Démarrage

```
python -m http.server 8000
```
Puis ouvrir <http://localhost:8000>. (Ne pas ouvrir `index.html` directement : les modules JS exigent un serveur HTTP.)

N'importe quel hébergement statique convient aussi (GitHub Pages, nginx…).

## 1. Configurer le LLM (onglet Paramètres)

Choisir un fournisseur ; l'URL et le modèle se pré-remplissent :

| Fournisseur | Protocole | URL par défaut |
|---|---|---|
| Local / proxy Copilot | OpenAI | `http://127.0.0.1:11434/v1` |
| OpenAI | OpenAI | `https://api.openai.com/v1` |
| Anthropic | Anthropic | `https://api.anthropic.com` |
| Ollama | OpenAI | `http://localhost:11434/v1` |
| Mistral, OpenRouter, autre | OpenAI | à renseigner |

Renseigner la clé API si nécessaire, puis **Lister les modèles** et **Tester la connexion**.

- Tout service compatible OpenAI (LM Studio, Groq, Azure…) fonctionne via « Personnalisé ».
- La clé est stockée **en clair dans le navigateur** et envoyée uniquement à l'URL configurée.
- Le serveur LLM doit autoriser CORS pour votre origine (ex. `http://localhost:8000`). Pour Ollama : variable d'environnement `OLLAMA_ORIGINS`.
- Les étapes de la stratégie de détection (Prévention, Détection, Investigation, Réponse par défaut) sont modifiables.

## 2. Scénarios

Renseigner le profil client (secteur, taille, zones, actifs clés), coller ou charger des rapports CTI, cliquer **Générer les scénarios**. Chaque scénario a un nom, une priorité et des techniques ATT&CK, tous éditables. Les IDs inconnus de MITRE sont rejetés et signalés.

## 3. Règles

Coller ou charger des règles (Sigma, KQL, SPL, texte de documentation…). Séparer plusieurs règles par une ligne `---`. Un fichier `.json` contenant un tableau donne une règle par élément. Cliquer **Mapper les règles non traitées** : pour chaque règle, techniques, scénarios liés, étape et confiance (high / medium / low) sont proposés par lots, puis corrigeables à la main.

## 4. Couverture

- **Matrice ATT&CK** : intensité selon la meilleure confiance, nombre de règles entre parenthèses, liseré rouge = technique présente dans un scénario.
- **Couverture par scénario** : couvert (règle de confiance ≥ medium sur la technique exacte), partiel (confiance faible, ou seule la technique parente / une sous-technique est couverte), trou.
- **Trous priorisés** par priorité de scénario.
- **Exports** : couche ATT&CK Navigator (JSON), CSV des règles.

## Sauvegarde

Le projet est enregistré automatiquement dans le navigateur. Paramètres → **Exporter le projet** pour une sauvegarde JSON (sans la clé API), **Importer** pour la restaurer.

## Essayer

Dans `data/sample/` : `cti.txt` (à coller dans Scénarios) et `rules.yml` (à importer dans Règles).

## Mettre à jour le référentiel ATT&CK

`node tools/build-attack.mjs` régénère `data/attack.json` (ATT&CK Enterprise, dernière version publiée).

## Limites

Les résultats du LLM sont des propositions à relire : une règle mal comprise peut être mal mappée. Pas d'import PDF (coller le texte), ATT&CK Enterprise uniquement.
