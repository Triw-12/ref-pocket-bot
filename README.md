# ref-pocket-bot

> [!WARNING]
> **Ce code a été entièrement fait par Claude et Copilot**, pour voir leur capacité à
> faire un petit projet de A à Z et pour m'entraîner sur la gestion d'agents IA. Le but
> étant aussi de répondre à un petit besoin que j'avais (une automatisation). **Seul le
> README a été relu, le reste est susceptible d'avoir des erreurs.**

Petits scripts d'automatisation pour **Ref Pocket**, le jeu de cartes à collectionner.
Chaque script se connecte à **ton** compte (via l'API Supabase du jeu, exactement comme
l'appli) et fait une tâche : ouvrir les boosters, améliorer les cartes, lister ce
qui te manque, lister tes doublons, auditer ce que la base expose.

> ⚠️ Ces scripts agissent sur **ton** compte avec **tes** identifiants. Ils
> n'utilisent que les fonctions publiques du jeu (mêmes droits qu'un joueur normal
> dans l'appli) : rien n'est « piraté », tout passe par les règles du serveur.

## Pour l'utiliser sur ton compte

Le dépôt est prévu pour être **forké** : tu fais ta propre copie, tu y mets tes
identifiants (dans **tes** secrets, jamais dans le code), et tu lances les scripts.

1. **Fork** : en haut à droite de la page GitHub du projet, clique sur **Fork**.
   Tu obtiens `https://github.com/<TON-COMPTE>/ref-pocket-bot`.
2. Ensuite, deux façons de t'en servir :
   - **Automatisé** via GitHub Actions + cron-job.org (recommandé, rien à installer) ;
   - **En local** sur ta machine (section *Utilisation en local*).

Dans tout ce README, remplace `<TON-COMPTE>` par ton nom d'utilisateur GitHub.

> Pas besoin de toucher au code : l'adresse du jeu et la clé publique Supabase sont
> les mêmes pour tout le monde (ce sont celles de l'appli). Seuls **tes identifiants**
> changent, et ils ne vont jamais dans le dépôt.

## Les scripts

| Script | Commande | Ce qu'il fait | Écrit |
|---|---|---|---|
| `bot.mjs` | `npm run bot` | Ouvre les boosters disponibles | — |
| `ameliore-cartes.mjs` | `npm run ameliore` | Améliore toutes les cartes qui peuvent l'être, et explique pourquoi les autres ne le peuvent pas | `ameliorations.md` |
| `cartes-manquantes.mjs` | `npm run manquantes` | Liste les cartes du catalogue que tu n'as pas | `cartes-manquantes.md` |
| `doublons.mjs` | `npm run doublons` | Liste toutes tes cartes en plusieurs exemplaires (total, holos, simples) | `doublons.md` |
| `profils.mjs` | `npm run profils` | Audit : ce que la base laisse voir des profils des autres joueurs | `profils.json` |

## Exécution sur GitHub Actions

C'est la façon la plus simple : rien à installer, tout tourne sur les serveurs de
GitHub. Chaque script a un workflow dans [`.github/workflows/`](.github/workflows/).
Ils se lancent **à la main** (bouton « Run workflow » dans l'onglet *Actions*) ou par
un déclencheur externe (voir cron-job.org plus bas). Le résultat s'affiche dans le
résumé du run et se télécharge en artefact.

| Workflow | Fichier |
|---|---|
| Booster horaire | `booster.yml` |
| Amélioration des cartes | `ameliore.yml` |
| Cartes manquantes | `cartes-manquantes.yml` |
| Cartes en doublon | `doublons.yml` |

### 1. Activer les Actions sur ton fork

Sur un dépôt forké, GitHub désactive les workflows par défaut. Va dans l'onglet
**Actions** de ton fork et clique sur **« I understand my workflows, go ahead and
enable them »**.

### 2. Mettre tes identifiants dans les secrets de ton fork

Sur **ton fork** : **Settings → Secrets and variables → Actions → New repository secret**.
Créer **deux** secrets (ne pas les mettre ailleurs, surtout pas dans le code) :

| Nom du secret | Valeur |
|---|---|
| `REF_EMAIL` | ton email Ref Pocket |
| `REF_PASS` | ton mot de passe Ref Pocket (tel quel, **sans** guillemets) |

Les workflows lisent ces secrets via `${{ secrets.REF_EMAIL }}` / `${{ secrets.REF_PASS }}`.

## Automatiser avec cron-job.org (recommandé)

Le `cron:` intégré de GitHub Actions est imprécis (déclenchements souvent reportés
de plusieurs dizaines de minutes, voire sautés). On garde donc les workflows en
**déclenchement manuel** (`workflow_dispatch`) et on les déclenche depuis
l'extérieur avec [cron-job.org](https://cron-job.org), gratuit et ponctuel.

cron-job.org appelle l'API GitHub qui lance le workflow. Il faut un jeton d'accès.

### Étape A — Créer un jeton GitHub (PAT)

Sur **ton** compte GitHub → **Settings → Developer settings → Personal access tokens
→ Fine-grained tokens → Generate new token** :

- **Repository access** : *Only select repositories* → `<TON-COMPTE>/ref-pocket-bot`
- **Permissions → Repository permissions → Actions** : **Read and write**
- Générer et **copier** le jeton (il ne sera plus affiché).

> Avec un token « classic » à la place, il faut les scopes `repo` + `workflow`.

### Étape B — Créer un cronjob par workflow

Dans cron-job.org → **Create cronjob**, pour chaque workflow à automatiser :

- **URL** (remplace `<TON-COMPTE>` et `<FICHIER>` par `ameliore.yml`, `doublons.yml`, etc.) :
  ```
  https://api.github.com/repos/<TON-COMPTE>/ref-pocket-bot/actions/workflows/<FICHIER>/dispatches
  ```
- **Request method** : `POST`
- **Advanced → Headers** :
  | Clé | Valeur |
  |---|---|
  | `Authorization` | `Bearer TON_JETON` |
  | `Accept` | `application/vnd.github+json` |
  | `X-GitHub-Api-Version` | `2022-11-28` |
  | `Content-Type` | `application/json` |
- **Advanced → Request body** :
  ```json
  {"ref":"main"}
  ```
- **Schedule** : l'horaire voulu (ex. tous les jours, ou toutes les heures pour le booster).

Une réponse **HTTP 204** = le workflow a bien été lancé (va voir l'onglet *Actions*).

### Exemple de rythme

| Workflow | Fréquence conseillée |
|---|---|
| `booster.yml` | toutes les heures (les boosters se rechargent avec le temps) |
| `ameliore.yml` | 1×/jour (ou à la main) |
| `doublons.yml` / `cartes-manquantes.yml` | quand tu veux un rapport à jour |

## Utilisation en local

Si tu préfères lancer les scripts depuis ta machine :

1. **Cloner ton fork** et installer Node 22+ puis les dépendances :
   ```bash
   git clone https://github.com/<TON-COMPTE>/ref-pocket-bot.git
   cd ref-pocket-bot
   npm install
   ```
2. Créer un fichier `.env` à partir du modèle et y mettre tes identifiants Ref Pocket :
   ```bash
   cp .env.example .env
   # puis éditer .env :
   # REF_EMAIL=ton.email@exemple.com
   # REF_PASS=ton_mot_de_passe
   ```
   Le `.env` n'est **jamais** commité (il est dans `.gitignore`).
   > Astuce : mets ton mot de passe entre guillemets simples si il contient des
   > caractères spéciaux (ex. `REF_PASS='mon#pass'`).
3. Lancer ce que tu veux, par exemple :
   ```bash
   npm run manquantes
   npm run doublons
   npm run ameliore
   ```
