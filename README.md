# MITREMapper

**Accès en ligne : <https://benoitmarionpro.github.io/MITREMapper/>**

Outil web local pour passer de la **veille CTI** à une **matrice de couverture de détection** :

1. des rapports de menace + le profil du client → **scénarios de menace** à couvrir ;
2. vos règles de détection (ou leur documentation) → **mapping MITRE ATT&CK**, étape de stratégie de détection, scénarios ;
3. une **matrice de couverture** avec les trous classés par priorité.

L'IA propose, vous validez. Tout tourne dans votre navigateur : pas de serveur, vos données restent en local.

## Démarrage

- **Sans serveur (fichier unique)** : ouvrir `dist/mitremapper.html` par double-clic dans un navigateur. Rien à installer. Le fichier est régénéré par `node tools/build-standalone.mjs` (outil de développement, non requis pour l'utiliser).
- **Dossier statique** : `python -m http.server 8000` puis <http://localhost:8000> (ou n'importe quel hébergement statique : GitHub Pages, nginx…). Ouvrir `index.html` directement ne fonctionne pas, les modules JS exigent HTTP : utiliser le fichier unique dans ce cas.

## 1. Configurer le LLM (onglet Paramètres)

**Autorisation obligatoire.** Cocher d'abord « I confirm that AI use is authorized for this content and complies with the client's rules. » Tant qu'elle n'est pas cochée, aucun appel IA n'est envoyé (génération, mapping, liste des modèles, test) et les boutons correspondants sont désactivés. Elle est à reconfirmer à chaque session.

Choisir ensuite un fournisseur ; les champs, l'URL et le modèle s'adaptent :

| Fournisseur | Champs | URL par défaut |
|---|---|---|
| Local / proxy compatible OpenAI | URL, modèle, clé optionnelle | `http://127.0.0.1:11434/v1` |
| OpenAI | URL, modèle, clé | `https://api.openai.com/v1` |
| Anthropic | URL, modèle, clé | `https://api.anthropic.com` |
| Mistral | URL, modèle, clé | `https://api.mistral.ai/v1` |
| Azure OpenAI / AI Foundry | endpoint HTTPS, déploiement, version d'API, clé | à renseigner |
| Ollama Cloud | URL, modèle, clé | `https://ollama.com/v1` (à vérifier selon votre compte) |
| Ollama (local), OpenRouter | URL, modèle, clé | préremplie |
| Endpoint générique compatible OpenAI | URL, modèle, clé optionnelle | à renseigner |

La liste des modèles se charge automatiquement quand c'est possible ; sinon une liste de secours du fournisseur est proposée, avec la raison de l'échec. **Tester la connexion** vérifie endpoint, clé et modèle ; la pastille d'état indique : non testé, en cours, OK, liste de secours, erreur.

### Sécurité et clés API

- La clé est stockée **séparément du projet**, en mémoire de session par défaut (effacée à la fermeture de l'onglet), une clé par fournisseur. « Mémoriser cette clé sur ce navigateur » la conserve en `localStorage`, « Effacer les clés API » supprime tout.
- Elle n'est jamais exportée (projet JSON, couche Navigator, CSV), jamais enregistrée avec les données du projet ni affichée en entier. Une clé enregistrée par une ancienne version est migrée automatiquement.
- Avant chaque appel : autorisation, fournisseur, modèle, clé, URL valide et **HTTPS exigé** (HTTP accepté seulement pour `127.0.0.1` / `localhost`).
- Les erreurs indiquent l'opération, le fournisseur, le modèle, le statut HTTP et le message du fournisseur, sans secret.
- **CORS** : le serveur LLM doit autoriser l'origine de l'outil (`http://localhost:8000`, `https://benoitmarionpro.github.io`…). Pour Ollama : variable `OLLAMA_ORIGINS`. Avec le **fichier unique ouvert en double-clic**, l'origine est `null` : le serveur doit l'accepter (ex. proxy local CoPro : ajouter `null` dans Settings, Local API) ; sinon servir le dossier en HTTP.
- Les étapes de la stratégie de détection (Prévention, Détection, Investigation, Réponse par défaut) sont modifiables.

## 2. Scénarios

Renseigner le profil client (secteur, taille, zones, actifs clés), coller ou charger des rapports CTI, cliquer **Générer les scénarios**. Chaque scénario a un nom, une priorité et des techniques ATT&CK, tous éditables. Les IDs inconnus de MITRE sont rejetés et signalés.

## 3. Règles

Coller ou charger des règles (Sigma, KQL, SPL, texte de documentation…). Séparer plusieurs règles par une ligne `---`. Un fichier `.json` contenant un tableau donne une règle par élément. Cliquer **Mapper les règles non traitées** : pour chaque règle, techniques, scénarios liés (avec une phrase de justification), étape et confiance (high / medium / low) sont proposés par lots.

**Mapping sans IA d'abord.** Les règles qui déclarent leurs techniques (tags Sigma `attack.t1059.001`, champs MITRE des exports Sentinel, Splunk, Elastic…) sont mappées localement : techniques lues dans la règle et validées contre ATT&CK, scénarios liés automatiquement s'ils partagent une technique (justification « Lien automatique »). Seules les règles sans tag partent vers l'IA ; sans autorisation IA, le mapping des règles taguées fonctionne quand même. La colonne Règle indique l'origine (*via tags* / *via IA*).

Option **« Faire aussi relire par l'IA les règles qui ont des tags »** : l'IA lit la logique de la règle indépendamment des tags ; les différences (au niveau technique parente) apparaissent dans le filtre **Écart tags / IA** et dans le détail, avec un bouton **Utiliser les tags**. Exemple dans la démo : la règle PsExec est taguée T1569.002 (exécution de service) alors que l'IA y voit T1021.002 (mouvement latéral SMB).

La **revue du mapping** est une matrice règles × scénarios (S1…Sn, nom au survol) :

- **●** lien cohérent (la règle a au moins une technique en commun avec le scénario) ; **⚠** lien sans technique commune, à challenger ; **◌** non lié mais technique en commun, oubli possible.
- Un clic sur une cellule lie ou délie ; un clic sur l'en-tête Sk met la colonne en évidence et remonte les règles liées.
- Le pied de matrice donne, par scénario, le nombre de règles liées et le nombre de techniques sans règle liée (un scénario à 0 règle est en rouge).
- Filtres : à relire, suspects, oublis possibles, sans scénario, trop larges (liée à plus de la moitié des scénarios), confiance basse, écart tags / IA ; recherche par nom ou technique.
- Un clic sur une règle ouvre le détail : code complet, justification de chaque lien, oublis possibles, ajout/retrait de techniques (les IDs inconnus sont rejetés), confiance, étape. Cocher **Validée** pour suivre l'avancement de la relecture (compteur n/m).

## 4. Couverture

- **Matrice ATT&CK** : vert = couvert, ambre = partiel, rouge = trou (technique d'un scénario sans règle), barre colorée à gauche = technique présente dans un scénario, ×n = nombre de règles. Les en-têtes de tactiques restent visibles au défilement et affichent « couvertes/total » pour les scénarios. Recherche par ID ou nom, filtre par scénario, filtre par statut (techniques des scénarios, trous, couvertes). Un clic sur une technique ouvre un volet avec ses règles, ses scénarios et ses sous-techniques ; Échap le ferme.
- **Statuts** : *couvert* = règle de confiance ≥ medium sur la technique elle-même, ou toutes ses sous-techniques couvertes ; *partiel* = seulement certaines sous-techniques couvertes (le volet de détail indique « n/N couvertes »), confiance basse, ou pour une sous-technique seule sa parente est couverte ; *trou* = aucune règle.
- **Couverture par scénario** : pourcentage de techniques couvertes, partielles et en trou.
- **Trous priorisés** par priorité de scénario.
- **Exports** : couche ATT&CK Navigator (JSON), CSV des règles.

## Projets et sauvegarde

Paramètres → **Projets** : plusieurs projets (un par client ou mission) dans le même navigateur, enregistrés automatiquement. Renommer, ouvrir, créer, supprimer, vider ; le nom du projet courant est affiché dans l'en-tête. **Exporter le projet** produit une sauvegarde JSON (sans clé API) ; **Importer** l'ouvre comme nouveau projet, sans écraser le projet courant.

Les scénarios gardent une référence stable (S1, S2…) : supprimer S2 ne renumérote pas les suivants, et un nouveau scénario prend le numéro suivant.

## Essayer

Pour une démo rapide :

- **Paramètres → Ouvrir la démo complète (sans LLM)**, ou le bouton équivalent sur l'écran Couverture vide : nouveau projet avec 11 scénarios et 7 règles déjà mappés, la matrice s'affiche immédiatement. Vos autres projets et vos réglages LLM sont conservés.
- **Scénarios → Charger l'exemple** : remplit le profil client et le rapport CTI d'exemple ; il reste à cliquer sur Générer.
- **Règles → Charger les règles d'exemple** : ajoute 7 règles Sigma (5 avec tags ATT&CK, mappées sans IA ; 2 sans tag, pour l'IA) ; il reste à cliquer sur Mapper.

Les fichiers sont dans `data/sample/` (`cti.txt`, `rules.yml`, `project.json`).

## Développement

- `node tools/build-standalone.mjs` régénère `dist/mitremapper.html` (à committer après toute modification).
- `test.html` (servi en HTTP) exécute les tests ; la CI GitHub Actions (`.github/workflows/ci.yml`) vérifie à chaque push la syntaxe, que `dist/` est à jour et que `test.html` passe dans Chrome headless.
- Polices Inter et Poppins embarquées dans `fonts/` (licence SIL OFL 1.1) : aucune requête externe, fonctionne hors ligne.

## Mettre à jour le référentiel ATT&CK

`node tools/build-attack.mjs` régénère `data/attack.json` (ATT&CK Enterprise, dernière version publiée).

## Limites

Les résultats du LLM sont des propositions à relire : une règle mal comprise peut être mal mappée. Pas d'import PDF (coller le texte), ATT&CK Enterprise uniquement.
