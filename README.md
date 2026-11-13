# ref-pocket-bot

> [!WARNING]
> **Ce code a été entièrement fait par Claude et Copilot**, pour voir leur capacité à
> faire un petit projet de A à Z et pour m'entraîner sur la gestion d'agents IA. Le but
> étant aussi de répondre à un petit besoin que j'avais (une automatisation). **Seul le
> README a été relu, le reste est susceptible d'avoir des erreurs.**
> Si le créateur du jeu passe par là, n'hésite pas à visiter [cette page](CHEAT.md).

Automatise les tâches répétitives de **Ref Pocket**, le jeu de cartes à collectionner :
ouvrir tes boosters toutes les heures, améliorer tes cartes, vendre tes doublons, jouer tes
duels du jour et savoir ce qui te manque. Tout tourne gratuitement sur GitHub, sans rien
installer.

> [!CAUTION]
> **Les risques, avant de commencer :**
> - Automatiser un jeu peut aller contre ses règles : ton compte peut être **banni**. Voir
>   [CHEAT.md](CHEAT.md) pour ce qui pourrait poser problème.
> - Certaines actions sont **définitives** : une carte défaussée ou vendue ne revient pas.
> - Les scripts agissent sur **ton** compte avec **tes** identifiants. Ils ne quittent jamais
>   tes secrets GitHub (ou ton fichier `.env` en local).

## Sommaire

- [Ce que ça fait](#ce-que-ça-fait)
- [Démarrage rapide (5 minutes)](#démarrage-rapide-5-minutes)
- [Automatiser avec cron-job.org](#automatiser-avec-cron-joborg)
- [Réglages](#réglages) : [boosters](#ouvrir-les-boosters) · [améliorer](#améliorer-les-cartes) ·
  [vendre](#vendre-les-doublons) · [retirer](#retirer-des-annonces) · [duels](#duels-du-jour) ·
  [rapports](#rapports)
- [Compte secondaire (pour les duels)](#compte-secondaire-pour-les-duels)
- [Utilisation en local](#utilisation-en-local)
- [Dépannage](#dépannage)
- [Mettre à jour ton fork](#mettre-à-jour-ton-fork)
- [Pour les curieux](#pour-les-curieux)

## Ce que ça fait

| Je veux… | Workflow GitHub | En local | Rapport |
|---|---|---|---|
| Ouvrir mes boosters dès qu'ils sont disponibles | Booster horaire | `npm run boosters` | — |
| Améliorer toutes les cartes qui peuvent l'être | Amélioration des cartes | `npm run ameliore` | `ameliorations.md` |
| Vendre mes doublons inutiles, puis baisser leur prix s'ils ne partent pas | Vente des doublons inutiles | `npm run vendre` | `ventes.md` |
| Retirer mes annonces du marché | Retrait des annonces | `npm run vendre -- --retirer` | `ventes.md` |
| Jouer mes 10 duels récompensés du jour (+300 K) | Duels du jour contre le bot | `npm run duels` | `duels.md` |
| Savoir quelles cartes il me manque | Cartes manquantes | `npm run manquantes` | `cartes-manquantes.md` |
| Voir mes cartes en plusieurs exemplaires | Cartes en doublon | `npm run doublons` | `doublons.md` |

Les duels demandent un [compte secondaire](#compte-secondaire-pour-les-duels) qui te sert
d'adversaire. Tout le reste fonctionne avec ton seul compte.

> L'onglet *Actions* affiche aussi **« Rapatrier les comptes »** et **« Maintenir le compte
> principal »** : c'est un usage personnel de l'auteur. Ignore-les, ils échouent sans
> configuration particulière.

## Démarrage rapide (5 minutes)

1. **Copie le projet** : en haut à droite de cette page GitHub, clique sur **Fork**, puis sur
   **Create fork**. Tu as maintenant ta propre copie, `https://github.com/<TON-COMPTE>/ref-pocket-bot`.
2. **Active les workflows** : dans ta copie, ouvre l'onglet **Actions** et clique sur
   **« I understand my workflows, go ahead and enable them »**.
3. **Ajoute tes identifiants Ref Pocket** : **Settings → Secrets and variables → Actions →
   New repository secret**, deux fois :

   | Name | Secret |
   |---|---|
   | `REF_EMAIL` | ton e-mail Ref Pocket |
   | `REF_PASS` | ton mot de passe Ref Pocket, tel quel, **sans** guillemets |

4. **Lance un premier workflow** : onglet **Actions** → **Booster horaire** (dans la liste à
   gauche) → **Run workflow** → **Run workflow**.
5. **Vérifie** : au bout d'une minute, le run doit être vert ✅. Clique dessus pour voir ce qui
   a été fait. Pour les workflows qui écrivent un rapport, il s'affiche en bas du run et se
   télécharge dans *Artifacts*.

C'est tout : chaque workflow se lance maintenant avec **Run workflow**. Pour qu'ils tournent
tout seuls (toutes les heures, tous les jours…), passe à l'étape suivante.

Dans tout ce README, remplace `<TON-COMPTE>` par ton nom d'utilisateur GitHub.

## Automatiser avec cron-job.org

[cron-job.org](https://cron-job.org) est un service gratuit qui lance tes workflows à
l'heure que tu veux. Il est bien plus ponctuel que la planification intégrée à GitHub.

### Étape 1 : créer un jeton GitHub

Sur GitHub : ta photo en haut à droite → **Settings → Developer settings → Personal access
tokens → Fine-grained tokens → Generate new token** :

- **Expiration** : choisis la durée la plus longue proposée, et **note la date** : à
  l'expiration, tout s'arrête sans prévenir et il faudra en créer un nouveau.
- **Repository access** : *Only select repositories* → `<TON-COMPTE>/ref-pocket-bot`.
- **Permissions → Repository permissions → Actions** : **Read and write**.
- **Generate token**, puis **copie le jeton** : il ne sera plus jamais affiché.

### Étape 2 : créer un cronjob par workflow

Sur cron-job.org → **Create cronjob** :

- **URL**, en remplaçant `<TON-COMPTE>` et `<FICHIER>` (voir le tableau plus bas) :
  ```
  https://api.github.com/repos/<TON-COMPTE>/ref-pocket-bot/actions/workflows/<FICHIER>/dispatches
  ```
- **Schedule** : le rythme voulu (voir le tableau).
- Onglet **Advanced** :
  - **Request method** : `POST`
  - **Headers** :

    | Key | Value |
    |---|---|
    | `Authorization` | `Bearer TON_JETON` |
    | `Accept` | `application/vnd.github+json` |
    | `Content-Type` | `application/json` |

  - **Request body** : le JSON du tableau.

Teste avec le bouton de test de cron-job.org (*Test run*) : une réponse **204** veut dire que
le workflow est lancé (va voir l'onglet *Actions*). Sinon, voir [Dépannage](#dépannage).

### Les cronjobs à créer

| Pour… | `<FICHIER>` | Request body | Rythme conseillé |
|---|---|---|---|
| Ouvrir les boosters | `booster.yml` | `{"ref":"main"}` | toutes les heures |
| Améliorer les cartes | `ameliore.yml` | `{"ref":"main"}` | 1×/jour |
| Vendre les doublons | `vendre.yml` | `{"ref":"main"}` | 1×/jour |
| Jouer les duels | `duels.yml` | `{"ref":"main"}` | 1×/jour, après 1 h du matin (heure de Paris) |
| Rapports | `cartes-manquantes.yml`, `doublons.yml` | `{"ref":"main"}` | quand tu veux |

Le body accepte aussi des réglages, dans `inputs` (les valeurs toujours **entre guillemets**).
Quelques exemples :

| Je veux… | Request body |
|---|---|
| Vendre la Gén. 1 à -20 % et la Gén. 2 à +100 %, avec une baisse de 10 % tous les 2 jours | `{"ref":"main","inputs":{"remise_gen1":"20","remise_gen2":"-100","baisse":"10","palier":"48"}}` |
| Vendre sans jamais rien défausser | `{"ref":"main","inputs":{"defausser":"false"}}` |
| N'ouvrir que des boosters de Gén. 1 (`booster.yml`) | `{"ref":"main","inputs":{"generation":"1"}}` |
| N'améliorer que la Gén. 2 (`ameliore.yml`) | `{"ref":"main","inputs":{"generation":"2"}}` |
| Ne pas améliorer les communes | `{"ref":"main","inputs":{"communes":"false"}}` |

Tous les réglages possibles sont décrits dans la section suivante.

## Réglages

Chaque fonctionnalité se règle de trois façons :
- **Sur GitHub** : les champs du formulaire **Run workflow** ;
- **Avec cron-job.org** : les mêmes champs, dans `inputs` du body ;
- **En local** : les options après `--` (voir [Utilisation en local](#utilisation-en-local)).

### Ouvrir les boosters

Ouvre tous les boosters disponibles, la Génération 2 d'abord. Si un
[compte secondaire](#compte-secondaire-pour-les-duels) est configuré, ses boosters sont
ouverts aussi.

| Sur GitHub / cron-job.org | En local | Effet |
|---|---|---|
| `generation` : `"toutes"`, `"1"`, `"2"` | `--gen=1` ou `--gen=2` | n'ouvre que cette génération |

### Améliorer les cartes

Améliore toutes les cartes qui peuvent l'être. Le rapport explique pourquoi les autres ne
peuvent pas : les holos et les cartes en vente ne comptent jamais comme doublons.

| Sur GitHub / cron-job.org | En local | Effet |
|---|---|---|
| `legendaires`, `epiques`, `rares`, `communes` : `"true"` / `"false"` | `--raretes=L,E,R,C` | raretés traitées (toutes par défaut) |
| `generation` : `"toutes"`, `"1"`, `"2"` | `--gen=1` ou `--gen=2` | générations traitées |
| — | `--dry` | explique sans rien améliorer |

### Vendre les doublons

Met en vente sur le marché les exemplaires qui ne te servent plus :
- **les holos en double** (une holo est toujours gardée par carte) ;
- **sur une carte au niveau maximum**, tout ce qui dépasse 2 exemplaires.

Ensuite, à chaque lancement :
- une annonce restée sans acheteur trop longtemps **baisse de prix** ;
- quand le prix atteindrait la valeur de défausse, la carte est **défaussée** : la vendre à
  ce prix ne rapporterait pas plus. Tout ce qui dépasse 3 exemplaires disponibles de la carte est défaussé avec
  elle (normales d'abord, les holos sont gardés en priorité) ;
- **une seule annonce à la fois par carte** : l'exemplaire suivant part en vente au lancement
  d'après ;
- **tes annonces posées à la main ne sont jamais touchées**.

Le prix de départ part du prix de référence du jeu : Commune 20 K, Rare 60 K, Épique 200 K,
Légendaire 800 K, × 3 pour une holo.

| Sur GitHub / cron-job.org | En local | Effet | Par défaut |
|---|---|---|---|
| `remise` | `--remise=20` | prix de départ en % sous la référence. **Négatif = plus cher** : `-30` vend 30 % au-dessus | `20` |
| `remise_gen1`, `remise_gen2` | `--remise-gen1=…`, `--remise-gen2=…` | la même chose, pour une seule génération (vide = `remise`) | — |
| `baisse` | `--baisse=10` | baisse en % de la référence à chaque palier | `10` |
| `palier` | `--palier=24` | heures sans acheteur avant chaque baisse | `24` |
| `defausser` : `"false"` | `--sans-defausse` | ne défausse jamais : la carte reste en vente au prix minimum | défausse |
| `generation` : `"toutes"`, `"1"`, `"2"` | `--gen=1` ou `--gen=2` | générations traitées | toutes |
| `dry` : `"true"` | `--dry` | affiche ce qui serait fait, sans rien faire | — |

Exemple : une commune normale part à 16 K, puis 14 K, 12 K… jusqu'à 6 K, et elle est
défaussée (+5 K) si personne ne l'a achetée.

> ⚠️ La défausse est **définitive**. Fais d'abord un test à blanc pour voir ce qui serait
> vendu, baissé ou défaussé.

### Retirer des annonces

Retire tes annonces encore ouvertes. Pratique avant de changer tes réglages de prix.

| Sur GitHub / cron-job.org | En local | Effet |
|---|---|---|
| `cartes` : `"141,176"` | `--retirer=141,176` | seulement ces numéros de carte (vide = **toutes** les annonces) |
| `generation` : `"toutes"`, `"1"`, `"2"` | `--gen=1` ou `--gen=2` | seulement cette génération |
| `dry` : `"true"` | `--dry` | affiche ce qui serait retiré |

Les numéros sont ceux affichés sur le site. La Gén. 2 a ses propres numéros, qui repartent à 1 :
choisis la génération pour viser une seule carte.

> ⚠️ Sans numéros, **toutes** tes annonces sont retirées, même celles posées à la main dans
> l'appli. Une carte retirée mais encore en surplus repartira en vente au prochain lancement
> de la vente : pense à couper le cronjob si tu ne veux plus vendre.

### Duels du jour

Joue tes **10 duels récompensés** du jour contre ton
[compte secondaire](#compte-secondaire-pour-les-duels) : +30 K par victoire, soit +300 K par
jour pour toi et +100 K pour le compte secondaire. À chaque victoire, tu gagnes une de ses
cartes, en priorité une carte que tu n'as pas. Le compteur repart à zéro à minuit UTC
(1 h du matin à Paris en hiver, 2 h en été).

| Sur GitHub / cron-job.org | En local | Effet | Par défaut |
|---|---|---|---|
| `mode` : `"abandon"` ou `"jouer"` | `--mode=jouer` | `abandon` : l'adversaire abandonne tout de suite ; `jouer` : les deux comptes jouent les coups | `abandon` |
| `nombre` : `"3"` | `--nombre=3` | nombre maximum de duels | tous ceux qui restent |
| `dry` : `"true"` | `--dry` | vérifie les comptes et les decks, sans jouer | — |

### Rapports

- **Cartes manquantes** : les cartes que tu n'as pas, par génération et par rareté. Si un
  [compte secondaire](#compte-secondaire-pour-les-duels) est configuré, celles qu'il possède
  sont marquées `🤖 x2` (le nombre d'exemplaires qu'il pourrait te donner).
- **Cartes en doublon** : tes cartes en plusieurs exemplaires, avec le nombre de holos et
  d'exemplaires en vente.

Les numéros de carte sont ceux du site. Une carte qui ne sort plus des boosters est notée « HS ».

## Compte secondaire (pour les duels)

Les duels se jouent contre un **second compte Ref Pocket**, qui te sert d'adversaire. Les
scripts l'appellent « le bot ». Il ne sert qu'aux duels et au marquage `🤖` des cartes
manquantes.

1. **Crée le compte** : inscris-toi sur Ref Pocket avec une autre adresse e-mail et choisis
   un pseudo. Inutile de l'ajouter en ami : c'est automatique.
2. **Ajoute ses identifiants** : deux secrets de plus, au même endroit que les tiens
   (**Settings → Secrets and variables → Actions**) :

   | Name | Secret |
   |---|---|
   | `BOT_EMAIL` | l'e-mail du compte secondaire |
   | `BOT_PASS` | son mot de passe, tel quel, **sans** guillemets |

3. **C'est tout** : il lui faut au moins 6 cartes différentes pour jouer, mais *Booster
   horaire* ouvre maintenant ses boosters aussi, et *Duels du jour* les ouvre avant chaque série.
4. **Vérifie** : lance *Duels du jour contre le bot* avec **dry** coché. Le run affiche les deux
   decks sans jouer.

## Utilisation en local

Pour lancer les scripts depuis ton ordinateur plutôt que sur GitHub.

1. Installe [Node.js](https://nodejs.org) 22 ou plus récent.
2. Récupère ta copie et installe les dépendances :
   ```bash
   git clone https://github.com/<TON-COMPTE>/ref-pocket-bot.git
   cd ref-pocket-bot
   npm install
   ```
3. Crée ton fichier d'identifiants à partir du modèle :
   ```bash
   cp .env.example .env
   ```
   Puis ouvre `.env` et remplis-le :
   ```bash
   REF_EMAIL=ton.email@exemple.com
   REF_PASS='ton_mot_de_passe'
   # Facultatif, pour les duels :
   BOT_EMAIL=email.du.compte.secondaire@exemple.com
   BOT_PASS='son_mot_de_passe'
   ```
   Garde les guillemets simples autour des mots de passe : ils protègent les caractères
   spéciaux comme `#`. Le fichier `.env` reste sur ton ordinateur, il n'est jamais envoyé sur GitHub.
4. Lance ce que tu veux. Les options s'ajoutent après `--` :
   ```bash
   npm run manquantes
   npm run vendre -- --dry
   npm run vendre -- --remise-gen2=-50
   npm run ameliore -- --raretes=L,E --gen=2
   npm run duels -- --nombre=1
   ```
   Pour ouvrir les boosters du compte secondaire :
   ```bash
   REF_EMAIL='email.du.compte.secondaire@exemple.com' REF_PASS='son_mot_de_passe' npm run boosters
   ```

## Dépannage

| Ce que tu vois | Ce qu'il faut faire |
|---|---|
| Aucun workflow dans l'onglet *Actions* | Les workflows ne sont pas activés : voir l'étape 2 du [démarrage rapide](#démarrage-rapide-5-minutes). |
| `Connexion impossible : Invalid login credentials` | E-mail ou mot de passe erroné dans les secrets. Recrée le secret, sans guillemets ni espace en trop. |
| `REF_EMAIL / REF_PASS manquants` | Le secret n'existe pas, ou son nom est mal écrit (majuscules comprises). |
| `Profil introuvable` | Le compte n'a pas encore de pseudo : connecte-toi une fois sur le site pour le choisir. |
| cron-job.org répond **401** | Jeton GitHub erroné ou expiré : crée-en un nouveau. |
| cron-job.org répond **403** | Le jeton n'a pas la permission *Actions : Read and write*. |
| cron-job.org répond **404** | Erreur dans l'URL (`<TON-COMPTE>`, nom du fichier), ou le jeton n'a pas accès à ce dépôt. |
| cron-job.org répond **422** | Body invalide : branche qui ne s'appelle pas `main`, réglage mal écrit dans `inputs`, ou valeur sans guillemets. |
| `Le compte bot n'a pas 6 cartes différentes` | Lance *Booster horaire* et attends que ses boosters se rechargent. |
| `BOT_EMAIL / BOT_PASS manquants` | Ajoute les secrets du [compte secondaire](#compte-secondaire-pour-les-duels). |

## Mettre à jour ton fork

Quand le projet évolue, ta copie ne se met pas à jour toute seule. Sur la page de ton fork,
clique sur **Sync fork → Update branch**. Tes secrets et tes cronjobs sont conservés.

## Pour les curieux

- **Comment ça marche** : chaque script se connecte à ton compte exactement comme l'appli, et
  n'utilise que les actions qu'un joueur peut faire dans le jeu. Le serveur applique ses règles
  comme d'habitude.
- **Audit des profils** : `npm run profils` (en local uniquement) montre ce que la base laisse
  voir des profils des autres joueurs, et l'écrit dans `profils.json`.
