// Fait tourner la machine à sous « Fortune Khey » : d'abord les tours gratuits en attente,
// puis les tours payants jusqu'à la limite du jour (500), tant qu'il reste assez de Kheys.
// Le tirage se fait sur le serveur (slot_spin), comme sur le site : le script ne fait que
// lancer les tours et noter ce qu'ils rapportent dans machine.md.
//
// Options :
//   --mise=10      mise des tours payants : 1, 5 ou 10 K (par défaut 10 : la cagnotte GRAND
//                  n'est gagnée en entier qu'à 10 K)
//   --tours=N      au plus N tours payants (par défaut : jusqu'à la limite du jour).
//                  Les tours gratuits sont toujours joués : --tours=0 ne joue qu'eux.
//   --reserve=K    ne jamais descendre sous K Kheys avec les tours payants (par défaut 0)
//   --dry          affiche l'état de la machine sans jouer
//   --ajouter      ajoute le rapport à la fin de machine.md, sous le pseudo du compte,
//                  au lieu de le remplacer (plusieurs comptes à la suite)

import { appendFileSync, writeFileSync } from "node:fs";
import { connecter } from "./session.mjs";

const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

// Sans « -- » après le nom du script, npm garde les options pour lui (npm_config_*)
const opt = (nom) => {
  const a = process.argv.find((x) => x === `--${nom}` || x.startsWith(`--${nom}=`));
  if (a) return a.includes("=") ? a.slice(a.indexOf("=") + 1) : "true";
  return process.env[`npm_config_${nom}`];
};
const entier = (nom, defaut) => {
  const v = opt(nom);
  if (v === undefined || v === "") return defaut;
  if (!/^\d+$/.test(v)) throw new Error(`--${nom} attend un nombre entier positif (reçu : ${v})`);
  return Number(v);
};

const MISE = entier("mise", 10);
if (![1, 5, 10].includes(MISE)) throw new Error("--mise attend 1, 5 ou 10");
const MAX_PAYES = entier("tours", Infinity);
const RESERVE = entier("reserve", 0);
const DRY = opt("dry") === "true";
const AJOUTER = opt("ajouter") === "true";
const GARDE_FOU = 3000; // nombre maximum d'appels, gratuits compris

const log = (...a) => console.log(new Date().toISOString(), ...a);
const k = (n) => `${Math.round(n).toLocaleString("fr-FR")} K`;

const { sb, me, error } = await connecter(REF_EMAIL, REF_PASS);
if (error) {
  log(error);
  process.exit(1);
}

const info = await sb.rpc("slot_info");
if (info.error) {
  log(`Machine indisponible : ${info.error.message}`);
  process.exit(1);
}
const I = info.data;
const cap = I.cap || 500;
let etat = { free: I.free || 0, fbet: I.fbet || MISE, spins: I.spins || 0, kheys: Number(me.kheys) };
const depart = etat.kheys;
const kheysConnus = () => Number.isFinite(etat.kheys);

log(
  `Machine : ${etat.spins}/${cap} tours payants aujourd'hui, ${etat.free} tour(s) gratuit(s) en attente, ` +
    `cagnotte GRAND ${k(I.pool || 0)}, appareils de Nils ${I.cam || 0}/9.`,
);
log(kheysConnus() ? `Solde : ${k(etat.kheys)}.` : "Solde inconnu : le serveur dira quand il n'y a plus assez de Kheys.");

const stats = {
  payes: 0, gratuits: 0, mise: 0, gains: 0, meilleur: null,
  jackpots: [], roues: [], boosters: 0, cartes: [], arret: "",
};

if (DRY) {
  stats.arret = "Test à blanc : aucun tour joué.";
} else {
  for (let n = 0; ; n++) {
    const gratuit = etat.free > 0;
    if (n >= GARDE_FOU) { stats.arret = `Garde-fou atteint (${GARDE_FOU} tours).`; break; }
    if (!gratuit) {
      if (stats.payes >= MAX_PAYES) { stats.arret = `Limite demandée atteinte (${MAX_PAYES} tours payants).`; break; }
      if (etat.spins >= cap) { stats.arret = `Limite du jour atteinte (${cap} tours payants).`; break; }
      if (kheysConnus() && etat.kheys - MISE < RESERVE) {
        stats.arret = `Plus assez de Kheys pour miser ${k(MISE)} en gardant ${k(RESERVE)} de réserve.`;
        break;
      }
    }

    // Pendant les tours gratuits, la mise est celle du tour qui les a gagnés (comme le site)
    const r = await sb.rpc("slot_spin", { p_bet: gratuit ? etat.fbet : MISE });
    if (r.error) { stats.arret = `Tour refusé par le serveur : ${r.error.message}`; break; }
    const o = r.data;

    const paye = o.paid ?? !gratuit;
    if (paye) { stats.payes++; stats.mise += o.bet; } else stats.gratuits++;
    stats.gains += o.win || 0;
    if (o.win > 0 && (!stats.meilleur || o.win > stats.meilleur.win)) stats.meilleur = { win: o.win, bet: o.bet };

    const quoi = [];
    for (const j of o.bonus?.jackpots || []) quoi.push(`jackpot ${j.toUpperCase()}`);
    for (const e of o.events || []) if (e.t === "grand") quoi.push(`GRAND (${k(e.v)})`);
    if (o.wheel) {
      const w = o.wheel.t === "w" ? `roue de Nils ×${o.wheel.v} (${k(o.wheel.amount)})` : `roue de Nils : ${o.wheel.v} tours gratuits à ${k(o.bet)}`;
      stats.roues.push(w);
      quoi.push(w);
    }
    if (o.prize?.t === "boosters") { stats.boosters += o.prize.n; quoi.push(`${o.prize.n} booster(s)`); }
    if (o.prize?.t === "card") { stats.cartes.push(o.prize.card); quoi.push("une carte épique"); }
    stats.jackpots.push(...quoi.filter((q) => q.startsWith("jackpot") || q.startsWith("GRAND")));

    if (quoi.length || o.win >= 20 * o.bet) {
      log(`Tour ${paye ? "payant" : "gratuit"} : +${k(o.win || 0)}${quoi.length ? ` · ${quoi.join(" · ")}` : ""}`);
    }

    etat = { free: o.free || 0, fbet: o.bet, spins: o.spins ?? etat.spins + (paye ? 1 : 0), kheys: Number(o.kheys) };
    const total = stats.payes + stats.gratuits;
    if (total % 50 === 0) log(`${total} tours joués, bilan ${stats.gains - stats.mise >= 0 ? "+" : ""}${k(stats.gains - stats.mise)}.`);
  }
}
log(stats.arret);

// Noms des cartes gagnées, seulement s'il y en a
let noms = {};
if (stats.cartes.length) {
  const c = await sb.from("cards").select("id,name,gen").in("id", stats.cartes);
  if (!c.error) noms = Object.fromEntries(c.data.map((x) => [x.id, `${x.name} (Gén. ${x.gen})`]));
}

const net = stats.gains - stats.mise;
const lignes = [
  AJOUTER ? `## ${me.pseudo}` : "# Machine à sous Fortune Khey",
  "",
  `${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} · mise ${k(MISE)}${RESERVE ? ` · réserve ${k(RESERVE)}` : ""}`,
  "",
  "| | |",
  "|---|---|",
  `| Tours payants | ${stats.payes} (${etat.spins}/${cap} aujourd'hui) |`,
  `| Tours gratuits | ${stats.gratuits}${etat.free ? ` (${etat.free} encore en attente)` : ""} |`,
  `| Misé | ${k(stats.mise)} |`,
  `| Gagné | ${k(stats.gains)} |`,
  `| **Bilan** | **${net >= 0 ? "+" : ""}${k(net)}** |`,
  kheysConnus() && Number.isFinite(depart) ? `| Solde | ${k(depart)} → ${k(etat.kheys)} |` : null,
  stats.meilleur ? `| Plus gros gain | ${k(stats.meilleur.win)} (×${Math.round(stats.meilleur.win / stats.meilleur.bet)}) |` : null,
  stats.boosters ? `| Boosters gagnés | ${stats.boosters} |` : null,
  "",
  ...(stats.jackpots.length ? ["**Jackpots** : " + stats.jackpots.join(", "), ""] : []),
  ...(stats.roues.length ? ["**Roues de Nils** : " + stats.roues.join(", "), ""] : []),
  ...(stats.cartes.length ? ["**Cartes épiques** : " + stats.cartes.map((id) => noms[id] ?? id).join(", "), ""] : []),
  `Arrêt : ${stats.arret}`,
  "",
].filter((l) => l !== null);
(AJOUTER ? appendFileSync : writeFileSync)("machine.md", lignes.join("\n") + (AJOUTER ? "\n" : ""));
log(`Bilan : ${stats.payes} payant(s), ${stats.gratuits} gratuit(s), ${net >= 0 ? "+" : ""}${k(net)}. Rapport : machine.md`);

// Un refus du serveur dès le premier tour mérite un run rouge
if (!DRY && stats.payes + stats.gratuits === 0 && stats.arret.startsWith("Tour refusé")) process.exit(1);
