#!/usr/bin/env python3
"""Entretient le compte principal : boosters, rapatriement, amélioration et défausse des surplus.

    python3 projet_secret/maintenir.py [--gen=1|2]

Le compte principal est le premier de compte-auto.json (créé s'il n'y en a aucun). Dans l'ordre :
ouverture des boosters, rapatriement des cartes restées sur les comptes secondaires (après les
avoir fait jouer deux par deux), amélioration des cartes (ameliore-cartes.mjs), puis défausse des
exemplaires en trop des cartes déjà au niveau 5 (defausser.mjs), et enfin les tours de machine à
sous (machine.mjs, 10 K par tour) : le principal d'abord, puis chaque compte secondaire à qui le
principal prête les Kheys nécessaires, et qui lui renvoie tout aussitôt après. Le compte rendu de
la machine est écrit dans machine.md.
"""

import json
import os
import subprocess
import sys
from itertools import zip_longest

from projet_secret import (
    DOSSIER,
    RACINE,
    _lancer,
    _lire_json,
    creer_compte,
    generer_pseudo,
    lire_comptes,
    ouvrir_boosters,
    rapatrier,
    transferer,
)

CONTREPARTIE = 1  # Kheys rendus à chaque échange (même valeur que transferer.mjs)
MISE = 10  # Kheys par tour de machine : la cagnotte GRAND n'est gagnée en entier qu'à 10 K


def choisir_gen(email, password):
    """Renvoie la génération dont ouvrir les boosters : 1 ou 2.

    Celle où il manque le plus de doublons pour monter toutes les cartes au niveau max (niveaux.mjs) ;
    à égalité, la 2, la plus récente. --gen=1 ou --gen=2 impose le choix.
    """
    for argument in sys.argv[1:]:
        if argument in ("--gen=1", "--gen=2"):
            return int(argument[-1])
    manque = {int(g): infos["manque"] for g, infos in _lire_json("niveaux.mjs", email, password).items()}
    gen = 1 if manque[1] > manque[2] else 2
    print(f"Doublons manquants pour le niveau max : Gén. 1 : {manque[1]}, Gén. 2 : {manque[2]} -> boosters de Gén. {gen}.")
    return gen


def ameliorer(email, password):
    """Améliore toutes les cartes du compte qui peuvent l'être (compte rendu dans ameliorations.md).

    Lève CalledProcessError si le script échoue.
    """
    commande = ["node", str(RACINE / "ameliore-cartes.mjs")]
    _lancer(commande, cwd=RACINE, env={**os.environ, "REF_EMAIL": email, "REF_PASS": password})


def defausser_surplus(email, password):
    """Défausse les exemplaires en surplus des cartes au niveau maximum.

    Lève CalledProcessError si le script échoue.
    """
    commande = [
        "node",
        str(DOSSIER / "defausser.mjs"),
        f"--email={email}",
        f"--password={password}",
    ]
    _lancer(commande)


def etat_machine(email, password):
    """Renvoie {"tours": tours payants restants aujourd'hui, "gratuits": ..., "kheys": solde}.

    Lève CalledProcessError si le script échoue.
    """
    return _lire_json("machine-restants.mjs", email, password)


def tourner(email, password):
    """Fait les tours de machine à sous du compte : les gratuits, puis les payants à MISE Kheys
    jusqu'à la limite du jour ou au bout de ses Kheys. Le compte rendu s'ajoute à machine.md.

    Lève CalledProcessError si le script échoue.
    """
    _lancer(
        ["node", str(RACINE / "machine.mjs"), f"--mise={MISE}", "--ajouter"],
        cwd=RACINE,
        env={**os.environ, "REF_EMAIL": email, "REF_PASS": password},
    )


def machine_pour_tous(principal, secondaires):
    """Fait tourner la machine au principal, puis à chaque compte secondaire avec ses Kheys.

    Un compte secondaire à qui il reste des tours reçoit de quoi miser sur tous ses tours payants
    (dans la limite de ce que le principal possède), joue, puis renvoie tout au
    principal, même si ses tours échouent. Un renvoi raté est seulement signalé : le rapatriement
    du prochain lancement le rattrape. Les comptes sont servis un par un, le principal récupérant
    les gains de chacun avant de prêter au suivant.
    """
    email_principal, password_principal = principal["email"], principal["password"]
    for fichier in ("machine.md", "machine.jsonl"):
        (RACINE / fichier).unlink(missing_ok=True)
    try:
        kheys_avant = etat_machine(email_principal, password_principal)["kheys"]
    except subprocess.CalledProcessError:
        kheys_avant = None

    print(f"Machine à sous de {principal['pseudo']} (compte principal)...")
    try:
        tourner(email_principal, password_principal)
    except subprocess.CalledProcessError:
        print("Machine impossible pour le compte principal : les comptes secondaires jouent quand même.")

    for bot in secondaires:
        try:
            etat = etat_machine(bot["email"], bot["password"])
            if etat["tours"] == 0 and etat["gratuits"] == 0:
                print(f"{bot['pseudo']} a déjà fait tous ses tours aujourd'hui.")
                continue
            disponible = etat_machine(email_principal, password_principal)["kheys"]
        except subprocess.CalledProcessError:
            print(f"État de la machine illisible pour {bot['pseudo']} : compte ignoré.")
            continue

        # Le compte garde les Kheys qu'il a déjà ; le principal complète jusqu'au besoin de la journée
        envoi = min(disponible, max(0, etat["tours"] * MISE - etat["kheys"]))
        if envoi <= CONTREPARTIE:
            envoi = 0  # un échange de 1 K ne rapporterait rien : la contrepartie le reprend
        if etat["gratuits"] == 0 and etat["kheys"] + max(0, envoi - CONTREPARTIE) < MISE:
            print(f"Pas assez de Kheys sur le compte principal pour {bot['pseudo']} : compte ignoré.")
            continue

        print(f"Machine à sous de {bot['pseudo']} : {etat['tours']} tours payants, {etat['gratuits']} gratuits, {envoi} K prêtés.")
        try:
            if envoi:
                transferer(email_principal, password_principal, bot["email"], bot["password"], kheys=envoi)
            tourner(bot["email"], bot["password"])
        except subprocess.CalledProcessError:
            print(f"Machine impossible pour {bot['pseudo']} : ses Kheys sont quand même renvoyés.")
        finally:
            try:
                transferer(bot["email"], bot["password"], email_principal, password_principal)
            except subprocess.CalledProcessError:
                print(f"Renvoi impossible depuis {bot['pseudo']} : il sera rapatrié au prochain lancement.")

    try:
        kheys_apres = etat_machine(email_principal, password_principal)["kheys"]
    except subprocess.CalledProcessError:
        kheys_apres = None
    bilan_machine(kheys_avant, kheys_apres)


def bilan_machine(kheys_avant, kheys_apres):
    """Ajoute en tête de machine.md le bilan de tous les comptes, à partir de machine.jsonl.

    La variation des Kheys du principal est la mesure qui compte : elle inclut tout, et un
    renvoi raté y apparaît comme une perte, rattrapée au prochain rapatriement.
    """
    chemin = RACINE / "machine.jsonl"
    sessions = [json.loads(l) for l in chemin.read_text(encoding="utf-8").splitlines() if l] if chemin.exists() else []
    total = {cle: sum(s[cle] for s in sessions) for cle in ("payes", "gratuits", "mise_totale", "gains", "boosters", "cartes", "jackpots")}
    net = total["gains"] - total["mise_totale"]
    retour = f"{100 * total['gains'] / total['mise_totale']:.1f} %" if total["mise_totale"] else "—"
    variation = (
        f"{kheys_avant} K → {kheys_apres} K ({kheys_apres - kheys_avant:+d} K)"
        if kheys_avant is not None and kheys_apres is not None else "illisible"
    )
    lignes = [
        "## Bilan de tous les comptes",
        "",
        "| | |",
        "|---|---|",
        f"| Comptes qui ont joué | {len(sessions)} |",
        f"| Tours | {total['payes']} payants, {total['gratuits']} gratuits |",
        f"| Misé / gagné | {total['mise_totale']} K / {total['gains']} K |",
        f"| **Bilan des tours** | **{net:+d} K** (retour {retour}) |",
        f"| Kheys du principal | {variation} |",
        f"| Boosters / cartes épiques / jackpots | {total['boosters']} / {total['cartes']} / {total['jackpots']} |",
        "",
    ]
    print(f"Machine à sous : {len(sessions)} comptes, {net:+d} K (retour {retour}), Kheys du principal : {variation}.")
    rapport = RACINE / "machine.md"
    ancien = rapport.read_text(encoding="utf-8") if rapport.exists() else ""
    rapport.write_text("\n".join(lignes) + "\n" + ancien, encoding="utf-8")


if __name__ == "__main__":
    ## Reprendre les comptes déjà créés, sinon créer le compte principal

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
    print("Compte principal :", principal["pseudo"], "| comptes repris :", len(joueurs))

    try:
        gen = choisir_gen(email_principal, password_principal)
        ouvrir_boosters(email_principal, password_principal, gen)

        # Rapatrie ce qui serait resté sur les comptes secondaires lors d'une exécution coupée,
        # après les avoir fait jouer deux par deux. En nombre impair, le dernier joue contre l'avant-dernier.
        secondaires = joueurs[1:]
        if len(secondaires) % 2 and len(secondaires) > 1:
            secondaires.append(secondaires[-2])
        for joueur, adversaire in zip_longest(secondaires[::2], secondaires[1::2]):
            rapatrier(joueur, principal, gen, adversaire)

        print("Amélioration des cartes...")
        ameliorer(email_principal, password_principal)
        print("Défausse des surplus au niveau max...")
        defausser_surplus(email_principal, password_principal)
    except subprocess.CalledProcessError as erreur:
        sys.exit(erreur.returncode)

    # En dernier : l'amélioration des cartes passe avant les mises
    machine_pour_tous(principal, joueurs[1:])
