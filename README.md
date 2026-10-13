# MITREMapper

**Accès en ligne : <https://benoitmarionpro.github.io/MITREMapper/>**

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
| Local (proxy compatible OpenAI) | OpenAI | `http://127.0.0.1:11434/v1` |
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

Coller ou charger des règles (Sigma, KQL, SPL, texte de documentation…). Séparer plusieurs règles par une ligne `---`. Un fichier `.json` contenant un tableau donne une règle par élément. Cliquer **Mapper les règles non traitées** : pour chaque règle, techniques, scénarios liés (avec une phrase de justification), étape et confiance (high / medium / low) sont proposés par lots.

La **revue du mapping** est une matrice règles × scénarios (S1…Sn, nom au survol) :

- **●** lien cohérent (la règle a au moins une technique en commun avec le scénario) ; **⚠** lien sans technique commune, à challenger ; **◌** non lié mais technique en commun, oubli possible.
- Un clic sur une cellule lie ou délie ; un clic sur l'en-tête Sk met la colonne en évidence et remonte les règles liées.
- Le pied de matrice donne, par scénario, le nombre de règles liées et le nombre de techniques sans règle liée (un scénario à 0 règle est en rouge).
- Filtres : à relire, suspects, oublis possibles, sans scénario, trop larges (liée à plus de la moitié des scénarios), confiance basse ; recherche par nom ou technique.
- Un clic sur une règle ouvre le détail : code complet, justification de chaque lien, oublis possibles, ajout/retrait de techniques (les IDs inconnus sont rejetés), confiance, étape. Cocher **Validée** pour suivre l'avancement de la relecture (compteur n/m).

## 4. Couverture

- **Matrice ATT&CK** : vert = couvert, ambre = partiel, rouge = trou (technique d'un scénario sans règle), barre colorée à gauche = technique présente dans un scénario, ×n = nombre de règles. Les en-têtes de tactiques restent visibles au défilement et affichent « couvertes/total » pour les scénarios. Recherche par ID ou nom, filtre par scénario, filtre par statut (techniques des scénarios, trous, couvertes). Un clic sur une technique ouvre un volet avec ses règles, ses scénarios et ses sous-techniques ; Échap le ferme.
- **Couverture par scénario** : couvert (règle de confiance ≥ medium sur la technique ou l'une de ses sous-techniques), partiel (confiance faible, ou seule la technique parente est couverte), trou.
- **Trous priorisés** par priorité de scénario.
- **Exports** : couche ATT&CK Navigator (JSON), CSV des règles.

## Sauvegarde

Le projet est enregistré automatiquement dans le navigateur. Paramètres → **Exporter le projet** pour une sauvegarde JSON (sans la clé API), **Importer** pour la restaurer.

## Essayer

Pour une démo rapide :

- **Paramètres → Charger la démo complète (sans LLM)**, ou le bouton équivalent sur l'écran Couverture vide : 11 scénarios et 7 règles déjà mappés, la matrice s'affiche immédiatement. Remplace les scénarios et règles en cours ; vos réglages LLM sont conservés.
- **Scénarios → Charger l'exemple** : remplit le profil client et le rapport CTI d'exemple ; il reste à cliquer sur Générer.
- **Règles → Charger les règles d'exemple** : ajoute 7 règles Sigma ; il reste à cliquer sur Mapper.

Les fichiers sont dans `data/sample/` (`cti.txt`, `rules.yml`, `project.json`).

## Mettre à jour le référentiel ATT&CK

`node tools/build-attack.mjs` régénère `data/attack.json` (ATT&CK Enterprise, dernière version publiée).

## Limites

Les résultats du LLM sont des propositions à relire : une règle mal comprise peut être mal mappée. Pas d'import PDF (coller le texte), ATT&CK Enterprise uniquement.
