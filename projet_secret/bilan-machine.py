#!/usr/bin/env python3
"""La machine à sous est-elle rentable sur la durée ? Bilan de tout l'historique des runs.

    python3 projet_secret/bilan-machine.py [--courant=machine.jsonl]

Marche sur GitHub Actions (GH_TOKEN et la permission actions: read suffisent) comme en local
(avec gh connecté). L'historique complet est gardé dans l'artifact « historique-machine » :
chaque lancement le récupère, y ajoute les nouvelles sessions, et l'écrit dans
historique-machine/historique.jsonl pour que le workflow le renvoie. GitHub efface un artifact
au bout de 90 jours : l'historique tient tant qu'un bilan est fait au moins tous les 90 jours
(le workflow Maintenir en fait un à chaque lancement).

Sources fusionnées, sans doublon :
- le dernier artifact « historique-machine » ;
- les artifacts « machine » de chaque run (Maintenir et Machine à sous) créés depuis : deux
  bilans lancés en même temps ne perdent ainsi aucune session ;
- --courant=fichier : les sessions du run en cours (son artifact n'est pas encore lu).

Le bilan est affiché et écrit dans bilan-machine.md :
- le retour observé (gagné / misé) et son intervalle de confiance à 95 % : tant qu'il contient
  100 %, on ne peut pas encore dire si la machine rapporte ou coûte ;
- le même retour sans le plus gros gain de chaque session, pour voir la part des jackpots ;
- le bilan jour par jour.
"""

import json
import math
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
CACHE = RACINE / "historique-machine"
HISTORIQUE = CACHE / "historique.jsonl"
RAPPORT = RACINE / "bilan-machine.md"
SUR_ACTIONS = os.environ.get("GITHUB_ACTIONS") == "true"
MARGE_COURSE = timedelta(days=1)  # plus long que le plus long run (6 h)


def gh(*arguments):
    return subprocess.run(["gh", *arguments], check=True, capture_output=True, encoding="utf-8").stdout


def date_github(texte):
    return datetime.fromisoformat(texte.replace("Z", "+00:00"))


def lister(depot, nom):
    """Artifacts de ce nom encore disponibles, du plus récent au plus ancien."""
    pages = json.loads(gh("api", "--paginate", "--slurp", f"repos/{depot}/actions/artifacts?name={nom}&per_page=100"))
    artifacts = [a for page in pages for a in page["artifacts"] if not a["expired"]]
    return sorted(artifacts, key=lambda a: a["created_at"], reverse=True)


def telecharger(artifact, nom, dossier):
    """Télécharge l'artifact dans dossier, sauf s'il y est déjà (cache local)."""
    if dossier.exists():
        return
    gh("run", "download", str(artifact["workflow_run"]["id"]), "-n", nom, "-D", str(dossier))


def recuperer():
    """Télécharge le dernier historique cumulé et les sessions des runs créés depuis."""
    depot = os.environ.get("GITHUB_REPOSITORY") or gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner").strip()
    cumuls = lister(depot, "historique-machine")
    depuis = None
    if cumuls:
        telecharger(cumuls[0], "historique-machine", CACHE / "cumul" / str(cumuls[0]["id"]))
        depuis = date_github(cumuls[0]["created_at"]) - MARGE_COURSE
    runs = [a for a in lister(depot, "machine") if depuis is None or date_github(a["created_at"]) >= depuis]
    for artifact in runs:
        telecharger(artifact, "machine", CACHE / "runs" / str(artifact["id"]))
    print(f"Historique cumulé : {'trouvé' if cumuls else 'aucun, premier bilan'} ; {len(runs)} run(s) récents lus.")


def lire_sessions(courants):
    fichiers = [HISTORIQUE, *CACHE.glob("cumul/*/historique.jsonl"), *CACHE.glob("runs/*/machine.jsonl"), *courants]
    vues = {}
    for fichier in fichiers:
        if not fichier.exists():
            continue
        for ligne in fichier.read_text(encoding="utf-8").splitlines():
            if ligne.strip():
                session = json.loads(ligne)
                vues[json.dumps(session, sort_keys=True)] = session  # une même session vient de plusieurs sources
    return sorted(vues.values(), key=lambda s: s["date"])


def retour(sessions, sans_plus_gros=False):
    """Renvoie (retour, demi-largeur de l'intervalle à 95 %), en fractions (1.0 = 100 %).

    Chaque session est un tirage : estimateur par quotient, son écart-type vient de la
    dispersion des sessions autour du retour moyen.
    """
    payantes = [s for s in sessions if s["mise_totale"] > 0]
    gains = [s["gains"] - (s["plus_gros"] if sans_plus_gros else 0) for s in payantes]
    mises = [s["mise_totale"] for s in payantes]
    if not mises:
        return None, None
    r = sum(gains) / sum(mises)
    n = len(mises)
    if n < 2:
        return r, None
    moyenne_mise = sum(mises) / n
    variance = sum((g - r * m) ** 2 for g, m in zip(gains, mises)) / (n - 1)
    return r, 1.96 * math.sqrt(variance / n) / moyenne_mise


def pourcent(x):
    return "—" if x is None else f"{100 * x:.1f} %"


def intervalle(r, marge):
    return pourcent(r) + (f" (95 % : {pourcent(r - marge)} à {pourcent(r + marge)})" if marge else "")


def rapport(sessions):
    if not sessions:
        return ["# Bilan de la machine à sous", "", "Aucune session dans l'historique pour l'instant.", ""]

    mise = sum(s["mise_totale"] for s in sessions)
    gains = sum(s["gains"] for s in sessions)
    r, marge = retour(sessions)
    r_sans, marge_sans = retour(sessions, sans_plus_gros=True)
    par_jour = defaultdict(lambda: [0, 0, 0])  # sessions, misé, gagné
    for s in sessions:
        jour = par_jour[s["date"][:10]]
        jour[0] += 1
        jour[1] += s["mise_totale"]
        jour[2] += s["gains"]

    if marge is None:
        verdict = "pas encore assez de sessions pour conclure."
    elif r - marge > 1:
        verdict = "**rentable** : le retour est au-dessus de 100 %, même dans le pire cas de l'intervalle."
    elif r + marge < 1:
        verdict = "**pas rentable** : le retour est sous 100 %, même dans le meilleur cas de l'intervalle."
    else:
        verdict = "pas encore tranché : l'intervalle contient 100 %, il faut plus de sessions."

    lignes = [
        "# Bilan de la machine à sous",
        "",
        f"{len(sessions)} sessions sur {len(par_jour)} jour(s), du {sessions[0]['date'][:10]} au {sessions[-1]['date'][:10]}.",
        "",
        "| | |",
        "|---|---|",
        f"| Tours | {sum(s['payes'] for s in sessions)} payants, {sum(s['gratuits'] for s in sessions)} gratuits |",
        f"| Misé / gagné | {mise} K / {gains} K |",
        f"| **Bilan** | **{gains - mise:+d} K** ({(gains - mise) / len(par_jour):+.0f} K par jour) |",
        f"| Retour observé | {intervalle(r, marge)} |",
        f"| Sans le plus gros gain de chaque session | {intervalle(r_sans, marge_sans)} |",
        f"| Boosters / cartes épiques / jackpots | {sum(s['boosters'] for s in sessions)} / {sum(s['cartes'] for s in sessions)} / {sum(s['jackpots'] for s in sessions)} |",
        "",
        f"Verdict : {verdict}",
        "",
        "| Jour | Sessions | Misé | Gagné | Bilan | Cumul |",
        "|---|--:|--:|--:|--:|--:|",
    ]
    cumul = 0
    for jour, (n, m, g) in sorted(par_jour.items()):
        cumul += g - m
        lignes.append(f"| {jour} | {n} | {m} | {g} | {g - m:+d} | {cumul:+d} |")
    return lignes + [""]


if __name__ == "__main__":
    courants = [Path(a.split("=", 1)[1]) for a in sys.argv[1:] if a.startswith("--courant=")]
    CACHE.mkdir(exist_ok=True)
    try:
        recuperer()
    except (subprocess.CalledProcessError, FileNotFoundError) as erreur:
        detail = getattr(erreur, "stderr", None) or erreur
        # Sur GitHub, un historique incomplet renvoyé comme le plus récent effacerait l'ancien
        if SUR_ACTIONS:
            sys.exit(f"Historique illisible ({detail}) : rien n'est écrit, l'ancien historique reste intact.")
        print(f"Téléchargement impossible ({detail}) : bilan sur l'historique local seulement.", file=sys.stderr)

    sessions = lire_sessions(courants)
    if sessions:
        HISTORIQUE.write_text("".join(json.dumps(s) + "\n" for s in sessions), encoding="utf-8")
    texte = "\n".join(rapport(sessions))
    RAPPORT.write_text(texte, encoding="utf-8")
    print(texte)
