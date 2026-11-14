#!/usr/bin/env python3
"""Crée des comptes et rassemble leurs cartes sur le compte principal (le premier créé).

    python3 projet_secret/projet_secret.py

Peut être coupé puis relancé : les comptes de compte-auto.json sont repris au démarrage.
"""

import json
import os
import secrets
import subprocess
import sys
import time
from itertools import zip_longest
from pathlib import Path
import random

DOSSIER = Path(__file__).resolve().parent
RACINE = DOSSIER.parent
 
# Débuts de pseudo commençant par U, V, W, X, Y ou Z
DEBUTS = {
    "U": ["Ul", "Um", "Ur", "Us", "Ux", "Ulr", "Uz"],
    "V": ["Va", "Ve", "Vi", "Vo", "Vy", "Vla", "Vra", "Val", "Vex", "Vor"],
    "W": ["Wa", "We", "Wi", "Wo", "Wyl", "Wra", "Wil", "Wol", "Wes"],
    "X": ["Xa", "Xe", "Xi", "Xo", "Xan", "Xer", "Xyl", "Xen"],
    "Y": ["Ya", "Ye", "Yo", "Yu", "Yll", "Yar", "Yen", "Yor"],
    "Z": ["Za", "Ze", "Zi", "Zo", "Zy", "Zar", "Zel", "Zor", "Zeph"],
}
MILIEUX = ["", "", "ra", "ri", "no", "la", "ve", "ka", "to", "ry", "an", "el"]
FINS = ["x", "n", "r", "s", "th", "ko", "ra", "ix", "on", "yr", "ia", "us", "ek", "o", "a"]
MOTS = ["Wolf", "Shadow", "Storm", "Blade", "Fox", "Nova", "Ghost", "Fire", "Byte", "Raven"]

FICHIER_COMPTES = DOSSIER / "compte-auto.json"
DECK_SIZE = 6  # même valeur que duels.mjs
# Secondes. Chaque script fait jusqu'à 2 connexions et le serveur les limite, sauf si elles sont réutilisées.
PAUSE_ENTRE_SCRIPTS = 3 if os.environ.get("REF_SESSIONS") else 4
#PAUSE_ENTRE_SCRIPTS = 0
 
def generer_pseudo(lettre=None):
    """Renvoie un pseudo crédible dont la première lettre est entre U et Z.
 
    lettre : optionnel, force la première lettre (U, V, W, X, Y ou Z).
    """
    lettre = (lettre or random.choice("UVWXYZ")).upper()
    if lettre not in DEBUTS:
        raise ValueError("La lettre doit être entre U et Z.")
 
    nom = random.choice(DEBUTS[lettre]) + random.choice(MILIEUX) + random.choice(FINS)
 
    style = random.random()
    if style < 0.25:                      # ex. Zorath_42
        nom += random.choice(["_", ""]) + str(random.randint(1, 999))
    elif style < 0.45:                    # ex. VeloxStorm
        nom += random.choice(MOTS)
    elif style < 0.55:                    # ex. xenrix
        nom = nom.lower()
    return nom



def lire_comptes():
    """Renvoie les comptes de compte-auto.json, le compte principal en premier."""
    if not FICHIER_COMPTES.exists():
        return []
    comptes = json.loads(FICHIER_COMPTES.read_text(encoding="utf-8"))
    return comptes if isinstance(comptes, list) else [comptes]


def rapatrier(joueur, principal, gen, adversaire=None):
    """Ouvre les boosters, joue les duels contre l'adversaire s'il y en a un, puis renvoie tout au principal.

    Un échec est signalé sans arrêter le programme.
    """
    try:
        for compte in filter(None, (joueur, adversaire)):
            ouvrir_boosters(compte["email"], compte["password"], gen)
        if adversaire is None:
            transferer(joueur["email"], joueur["password"], principal["email"], principal["password"])
        else:
            jouer_duels(  # renvoie aussi tout au principal, même si un duel échoue
                joueur["email"], joueur["password"],
                adversaire["email"], adversaire["password"],
                principal["email"], principal["password"],
            )
    except subprocess.CalledProcessError:
        print(f"Échec pour {joueur['pseudo']} : il sera retenté au prochain lancement.")


def creer_compte(email, pseudo=None, password=None, gen=2):
    """Renvoie (email, password, pseudo), en générant le pseudo et le mot de passe absents.

    gen : génération (1 ou 2) des boosters ouverts juste après la création.
    Le compte est aussi ajouté à compte-auto.json. Lève CalledProcessError si le script échoue.
    """
    pseudo = pseudo or f"Joueur{secrets.token_hex(4)}"
    password = password or secrets.token_urlsafe(18)
    _lancer(
        [
            "node",
            str(DOSSIER / "creer-compte.mjs"),
            f"--email={email}",
            f"--password={password}",
            f"--pseudo={pseudo}",
            f"--gen={gen}",
        ],
    )
    return email, password, pseudo

def ouvrir_boosters(email, password, gen):
    """Ouvre les boosters de la génération gen (1 ou 2) de ce compte.

    Lève CalledProcessError si le script échoue.
    """
    _lancer(
        [
            "node",
            str(DOSSIER / "ouvrir.mjs"),
            f"--email={email}",
            f"--password={password}",
            f"--gen={gen}",
        ],
    )


def transferer(email_source, password_source, email, password, completer=None, uniques=False, kheys=None):
    """Transfère cartes et Kheys du compte source vers le compte (email, password).

    completer : si indiqué, envoie seulement les cartes qui manquent à la destination pour
    avoir ce nombre de cartes différentes jouables en deck, sans les Kheys.
    uniques : si vrai, envoie une seule instance de chaque carte différente (pas les doublons).
    kheys : si indiqué (plus de 1), envoie seulement ce nombre de Kheys, sans aucune carte ;
    la destination en rend 1, la contrepartie de l'échange.
    Lève CalledProcessError si le script échoue.
    """
    commande = [
        "node",
        str(DOSSIER / "transferer.mjs"),
        f"--source-email={email_source}",
        f"--source-password={password_source}",
        f"--email={email}",
        f"--password={password}",
    ]
    if completer is not None:
        commande.append(f"--completer={completer}")
    if uniques:
        commande.append("--uniques")
    if kheys is not None:
        commande.append(f"--kheys={kheys}")
    _lancer(commande)


def cartes_compte(email, password, gen=None):
    """Renvoie (nombre_de_cartes_manquantes, cartes) pour ce compte.

    gen : 1 ou 2 pour se limiter à cette génération, toutes les générations par défaut.
    Chaque carte est un dictionnaire : n, nom, gen, rarete (C, R, E ou L), exemplaires, holos.
    Lève CalledProcessError si le script échoue.
    """
    infos = _lire_json("cartes.mjs", email, password)
    if gen is None:
        return infos["manquantes"], infos["cartes"]
    return infos["manquantes_par_gen"].get(str(gen), 0), [c for c in infos["cartes"] if c["gen"] == gen]


def recuperer_albums(email, password):
    """Réclame les récompenses des albums complétés et non réclamés de ce compte, toutes générations.

    Renvoie la liste des récompenses obtenues : [{"album": ..., "kheys": ...}].
    Les albums de la génération 2 ont le préfixe "2:" (par exemple "2:*" pour l'album complet).
    Lève CalledProcessError si le script échoue.
    """
    return _lire_json("albums.mjs", email, password)


def duels_restants(email, password):
    """Renvoie le nombre de duels récompensés qu'il reste aujourd'hui à ce compte.

    Lève CalledProcessError si le script échoue.
    """
    return _lire_json("duels-restants.mjs", email, password)


def jouer_duels(
    email,
    password,
    email_bot,
    password_bot,
    email_principal,
    password_principal,
    mode="abandon",
    nombre=None,
    dry=False,
):
    """Joue les duels du jour de ce compte contre le compte bot, avec les cartes du principal.

    Le compte principal prête les cartes qui manquent aux deux comptes, puis tout ce qu'ils
    possèdent (cartes et Kheys) lui est renvoyé, même si un duel échoue. S'il ne reste aucun
    duel récompensé aujourd'hui, rien n'est prêté ni joué, et seul le renvoi a lieu.

    mode : "abandon" (le bot abandonne) ou "jouer" (coup par coup). nombre : maximum de
    duels, tous ceux qui restent par défaut. dry : vérifie les comptes et les decks sans
    jouer ni déplacer de cartes, donc avec les cartes que les comptes ont déjà.
    Le compte rendu est écrit dans duels.md, à la racine du repo.
    Lève CalledProcessError si le prêt échoue, ou si le script échoue ou un duel n'aboutit
    pas. Un renvoi raté est seulement signalé, pour tenter quand même l'autre compte.
    """
    commande = ["node", str(RACINE / "duels.mjs"), f"--mode={mode}"]
    if nombre is not None:
        commande.append(f"--nombre={nombre}")
    if dry:
        commande.append("--dry")

    try:
        if not dry:
            restants = duels_restants(email, password)
            duels = restants if nombre is None else min(nombre, restants)
            if duels == 0:
                print(f"Plus de duel récompensé aujourd'hui pour {_pseudo(email)} : aucun prêt de cartes.")
                return

            # Le bot perd une carte par duel et doit encore avoir un deck complet au dernier.
            # Il est servi d'abord : c'est lui qui a besoin du plus grand nombre de cartes différentes.
            transferer(
                email_principal, password_principal, email_bot, password_bot,
                completer=DECK_SIZE + duels - 1,
            )
            transferer(email_principal, password_principal, email, password, completer=DECK_SIZE)
        _lancer(
            commande,
            cwd=RACINE,
            env={
                **os.environ,
                "REF_EMAIL": email,
                "REF_PASS": password,
                "BOT_EMAIL": email_bot,
                "BOT_PASS": password_bot,
            },
        )
    finally:
        if not dry:
            for email_joueur, password_joueur in ((email, password), (email_bot, password_bot)):
                try:
                    transferer(email_joueur, password_joueur, email_principal, password_principal)
                except subprocess.CalledProcessError:
                    print(f"Renvoi impossible depuis {_pseudo(email_joueur)} : ses cartes sont restées sur ce compte.")


def _pseudo(email):
    """Renvoie le pseudo du compte de compte-auto.json, ou l'e-mail tronqué s'il n'y figure pas."""
    for compte in lire_comptes():
        if compte["email"] == email:
            return compte["pseudo"]
    return f"{email[:3]}***"


def _lancer(commande, **options):
    """Lance un script Node. Son échec lève CalledProcessError, sans jamais montrer ses arguments."""
    time.sleep(PAUSE_ENTRE_SCRIPTS)
    try:
        return subprocess.run(commande, check=True, **options)
    except subprocess.CalledProcessError as erreur:
        # Le message d'origine contient la commande complète, donc les mots de passe
        raise subprocess.CalledProcessError(erreur.returncode, Path(commande[1]).name) from None


def _lire_json(script, email, password):
    """Lance un script Node sur ce compte et renvoie le JSON de sa sortie standard."""
    resultat = _lancer(
        [
            "node",
            str(DOSSIER / script),
            f"--email={email}",
            f"--password={password}",
        ],
        stdout=subprocess.PIPE,
        encoding="utf-8",
    )
    return json.loads(resultat.stdout)

if __name__ == "__main__":

    new = input("Créer de nouveaux comptes ? (o/N) ")

    ## ETAPE 1 : reprendre les comptes déjà créés, sinon créer le compte principal

    joueurs = lire_comptes()

    if not joueurs:
        try:
            pseudo = generer_pseudo()
            email, password, pseudo = creer_compte(f"{pseudo.lower()}@exemple.com", pseudo)
            joueurs.append({"email": email, "password": password, "pseudo": pseudo})
        except subprocess.CalledProcessError as erreur:
            sys.exit(erreur.returncode)

    principal = joueurs[0]
    email_principal, password_principal = principal["email"], principal["password"]
    print("Compte principal :", principal['pseudo'], "| comptes repris :", len(joueurs))

    cartes_manquantes_gen2, cartes_gen2 = cartes_compte(email_principal, password_principal, 2)
    if cartes_manquantes_gen2 > 0:
        print(f"Le compte principal a {cartes_manquantes_gen2} cartes manquantes de génération 2 : elles seront rapatriées.")
        gen = 2
    else:
        gen = 1

    ouvrir_boosters(email_principal, password_principal, gen)

    # Rapatrie ce qui serait resté sur les comptes secondaires lors d'une exécution coupée,
    # après les avoir fait jouer deux par deux. En nombre impair, le dernier joue contre l'avant-dernier.
    secondaires = joueurs[1:]
    if len(secondaires) % 2 and len(secondaires) > 1:
        secondaires.append(secondaires[-2])
    for joueur, adversaire in zip_longest(secondaires[::2], secondaires[1::2]):
        rapatrier(joueur, principal, gen, adversaire)

    ### ETAPE 2 : créer des comptes secondaires et transférer leurs cartes vers le compte principal

    # Le compteur suit la génération que les nouveaux comptes ouvrent : un compte de Gén. 2
    # n'apporte rien à la Gén. 1, donc un compteur toutes générations ne baisserait plus.
    while True:
        cartes_manquantes, cartes = cartes_compte(email_principal, password_principal, gen)
        if cartes_manquantes == 0 and gen == 2:
            print("Génération 2 complète : les comptes suivants ouvriront la génération 1.")
            gen = 1
            continue
        print("Nb_joueurs:", len(joueurs), f"Nb_cartes_manquantes (Gén. {gen}):", cartes_manquantes)
        if new.lower() != "o":
            exit(0)
        if cartes_manquantes == 0:
            break
        try:
            pseudo = generer_pseudo()
            email, password, pseudo = creer_compte(f"{pseudo.lower()}@exemple.com", pseudo, gen=gen)
            joueurs.append({"email": email, "password": password, "pseudo": pseudo})
            # Ici un échec arrête tout : sinon on créerait des comptes sans jamais avancer
            transferer(email, password, email_principal, password_principal)
        except subprocess.CalledProcessError as erreur:
            sys.exit(erreur.returncode)


    ### ETAPE 3 : récupérer les récompenses des albums complétés et non réclamés des comptes


    for i in range(len(joueurs)):
        joueur = joueurs[i]
        joueur_suivant = joueurs[i + 1] if i + 1 < len(joueurs) else None
        try:
            print(f"Récupération des récompenses des albums pour {joueur['pseudo']}...")
            recompenses = recuperer_albums(joueur["email"], joueur["password"])
            if joueur_suivant:
                transferer(
                    joueur["email"], joueur["password"], joueur_suivant["email"], joueur_suivant["password"], uniques=True
                )
        except subprocess.CalledProcessError:
            print(f"Albums illisibles pour {joueur['pseudo']} : compte ignoré.")
            continue

    # La chaîne a rassemblé les cartes uniques sur le dernier joueur : tout retourne au compte principal
    if len(joueurs) > 1:
        dernier = joueurs[-1]
        try:
            print(f"Retour de tout vers le compte principal depuis {dernier['pseudo']}...")
            transferer(dernier["email"], dernier["password"], email_principal, password_principal)
        except subprocess.CalledProcessError:
            print(f"Retour impossible depuis {dernier['pseudo']}.")

    print("FINI ! Nombre de comptes créés :", len(joueurs))
    fin = cartes_compte(email_principal, password_principal)
    print(f"Nombre de cartes du compte principal : {fin[1]}")