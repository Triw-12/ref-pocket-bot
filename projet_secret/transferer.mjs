// Transfère les cartes et les Kheys d'un compte vers un autre, en passant par les échanges du jeu.
//
//   npm run transferer -- --source-email=source@exemple.com --source-password='mdp_source' \
//     --email=destination@exemple.com --password='mdp_destination'
//
// Les cartes en vente ou déjà dans un échange ne bougent pas. En cas d'arrêt, relancer le
// script transfère ce qui reste.
//
// Avec --completer=N, seules les cartes qui manquent à la destination pour avoir N cartes
// différentes jouables en deck sont envoyées, les moins rares d'abord, et sans les Kheys.
//
// Avec --uniques, une seule instance de chaque carte différente est envoyée (pas les doublons),
// ce qui suffit pour compléter les albums. Les Kheys sont envoyés comme d'habitude.
//
// Avec --kheys=N, seuls N Kheys sont envoyés, sans aucune carte. La destination en rend 1
// (la contrepartie de l'échange) : elle en gagne donc N - 1.

import { ouvrirSession } from "../session.mjs";

const TAILLE_LOT = 10; // maximum du jeu par échange
const CONTREPARTIE = 1; // Kheys versés en retour : le jeu exige que le receveur propose quelque chose
const DECK_MAX = { L: 1, E: 2 }; // mêmes limites par deck que le site
const ORDRE_RARETES = ["C", "R", "E", "L"];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const stop = (msg) => {
  log(msg);
  process.exit(1);
};
const option = (nom) =>
  process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);

const sourceEmail = option("source-email")?.trim();
const sourcePass = option("source-password");
const destEmail = option("email")?.trim();
const destPass = option("password");
if (!sourceEmail || !sourcePass || !destEmail || !destPass) {
  stop("Indique les deux comptes : --source-email=… --source-password=… --email=… --password=…");
}
if (destEmail.toLowerCase() === sourceEmail.toLowerCase()) {
  stop("La destination doit être un autre compte que la source.");
}
const completer = option("completer") === undefined ? null : Number(option("completer"));
if (completer !== null && (!Number.isInteger(completer) || completer < 1)) {
  stop("--completer doit être un entier positif.");
}

const uniques = process.argv.includes("--uniques");
if (uniques && completer !== null) stop("--uniques et --completer sont incompatibles.");

const montant = option("kheys") === undefined ? null : Number(option("kheys"));
if (montant !== null && (!Number.isInteger(montant) || montant <= CONTREPARTIE)) {
  stop(`--kheys doit être un entier supérieur à ${CONTREPARTIE}.`);
}
if (montant !== null && (uniques || completer !== null)) stop("--kheys est incompatible avec --uniques et --completer.");

async function connecter(email, password) {
  const masque = `${email.slice(0, 3)}***`; // ces messages peuvent finir dans des logs publics
  const { sb, error } = await ouvrirSession(email, password);
  if (error) stop(`Connexion impossible (${masque}) : ${error.message}`);
  const p = await sb.rpc("my_profile");
  if (p.error || !p.data?.id) stop(`Profil introuvable (${masque}) : ${p.error?.message ?? "vide"}`);
  return { sb, me: p.data };
}

const source = await connecter(sourceEmail, sourcePass);
const dest = await connecter(destEmail, destPass);
log(`Transfert de ${source.me.pseudo} vers ${dest.me.pseudo}.`);

// Les échanges ne sont possibles qu'entre amis
async function lienAmi() {
  const { data, error } = await source.sb.from("friendships").select("*")
    .or(`and(requester.eq.${source.me.id},addressee.eq.${dest.me.id}),and(requester.eq.${dest.me.id},addressee.eq.${source.me.id})`);
  if (error) stop(`Amitié illisible : ${error.message}`);
  return data.find((f) => f.status === "accepted") ?? data.find((f) => f.status === "pending") ?? null;
}

let ami = await lienAmi();
if (!ami) {
  const r = await source.sb.rpc("friend_request", { p_pseudo: dest.me.pseudo });
  if (r.error) stop(`Demande d'ami impossible : ${r.error.message}`);
  ami = await lienAmi();
}
if (ami?.status === "pending") {
  const repondant = ami.addressee === dest.me.id ? dest : source;
  const r = await repondant.sb.rpc("friend_respond", { p_id: ami.id, p_accept: true });
  if (r.error) stop(`Acceptation de l'ami impossible : ${r.error.message}`);
}
if (ami?.status !== "accepted" && (await lienAmi())?.status !== "accepted") {
  stop("Les deux comptes ne sont toujours pas amis.");
}

async function offresOuvertes() {
  const { data, error } = await source.sb.from("trades").select("id,status")
    .eq("from_user", source.me.id).eq("to_user", dest.me.id).in("status", ["open", "countered"]);
  if (error) stop(`Échanges illisibles : ${error.message}`);
  return data;
}

// Une exécution coupée peut laisser une offre en attente : on libère ses cartes avant de reprendre
for (const { id, status } of await offresOuvertes()) {
  const r = status === "open"
    ? await source.sb.rpc("cancel_trade", { p_trade: id })
    : await source.sb.rpc("respond_trade", { p_trade: id, p_accept: false });
  if (r.error) stop(`Offre ${id} impossible à annuler : ${r.error.message}`);
  log(`Offre ${id} restée en attente : annulée.`);
}

async function lireTout(construire) {
  const lignes = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await construire().range(from, from + 999);
    if (error) stop(`Cartes illisibles : ${error.message}`);
    lignes.push(...data);
    if (data.length < 1000) break;
  }
  return lignes;
}

const cartesDe = (compte) =>
  lireTout(() =>
    compte.sb.from("card_instances").select("id,card_id,holo,lock").eq("owner", compte.me.id).order("id"),
  );

// Instances à envoyer pour que la destination ait `completer` cartes différentes jouables en deck
async function cartesACompleter(disponibles) {
  const catalogue = await lireTout(() => source.sb.from("cards").select("id,rarity").order("id"));
  const rarete = new Map(catalogue.map((c) => [c.id, c.rarity]));

  const parRarete = {};
  const dejaLa = new Set();
  let jouables = 0;
  const compter = (idCarte) => {
    const r = rarete.get(idCarte);
    if (dejaLa.has(idCarte) || (DECK_MAX[r] !== undefined && (parRarete[r] ?? 0) >= DECK_MAX[r])) return false;
    dejaLa.add(idCarte);
    parRarete[r] = (parRarete[r] ?? 0) + 1;
    jouables++;
    return true;
  };

  for (const c of await cartesDe(dest)) if (!c.lock) compter(c.card_id);

  const rang = (c) => ORDRE_RARETES.indexOf(rarete.get(c.card_id));
  const candidates = [...disponibles].sort((a, b) => rang(a) - rang(b) || a.holo - b.holo);
  const choisies = [];
  for (const c of candidates) {
    if (jouables >= completer) break;
    if (compter(c.card_id)) choisies.push(c.id);
  }
  if (jouables < completer) {
    stop(`${source.me.pseudo} n'a pas assez de cartes : ${dest.me.pseudo} n'en aurait que ${jouables} jouables sur ${completer}.`);
  }
  return choisies;
}

const cartes = await cartesDe(source);
const disponibles = cartes.filter((c) => !c.lock);
// Une instance par carte différente, en gardant la moins précieuse (non holo d'abord)
const uniquesDe = (liste) => {
  const parCarte = new Map();
  for (const c of [...liste].sort((a, b) => a.holo - b.holo || a.id - b.id)) {
    if (!parCarte.has(c.card_id)) parCarte.set(c.card_id, c.id);
  }
  return [...parCarte.values()];
};
if (montant !== null && montant > (source.me.kheys ?? 0)) {
  stop(`${source.me.pseudo} n'a que ${source.me.kheys ?? 0} K : impossible d'en envoyer ${montant}.`);
}
const aEnvoyer = montant !== null ? []
  : completer !== null ? await cartesACompleter(disponibles)
  : uniques ? uniquesDe(disponibles) : disponibles.map((c) => c.id);
const kheys = montant ?? (completer === null ? (source.me.kheys ?? 0) : CONTREPARTIE);
const bloquees = cartes.length - disponibles.length;

const lots = [];
for (let i = 0; i < aEnvoyer.length; i += TAILLE_LOT) lots.push(aEnvoyer.slice(i, i + TAILLE_LOT));
if (!lots.length && kheys > CONTREPARTIE) lots.push([]);
if (!lots.length) {
  log(`Rien à transférer (${bloquees} cartes bloquées).`);
  process.exit(0);
}
log(`À transférer : ${aEnvoyer.length} cartes et ${kheys} K (${bloquees} cartes bloquées).`);
if ((dest.me.kheys ?? 0) < CONTREPARTIE) {
  stop(`${dest.me.pseudo} doit avoir au moins ${CONTREPARTIE} K pour répondre aux échanges.`);
}

for (const [i, lot] of lots.entries()) {
  // Tous les Kheys partent au premier échange, puis chaque échange renvoie la contrepartie reçue
  const kheysLot = i === 0 ? kheys : CONTREPARTIE;
  const offre = await source.sb.rpc("propose_trade", {
    p_to: dest.me.id,
    p_give: lot,
    p_take: [],
    p_kheys_give: kheysLot,
    p_kheys_take: 0,
  });
  if (offre.error) stop(`Offre ${i + 1}/${lots.length} refusée : ${offre.error.message}`);

  const [ouverte] = await offresOuvertes();
  if (!ouverte) stop(`Offre ${i + 1}/${lots.length} introuvable après son envoi.`);

  const contre = await dest.sb.rpc("counter_trade", {
    p_trade: ouverte.id,
    p_give: [],
    p_kheys: CONTREPARTIE,
  });
  if (contre.error) {
    await source.sb.rpc("cancel_trade", { p_trade: ouverte.id }); // libère les cartes du lot
    stop(`Contre-proposition ${i + 1}/${lots.length} refusée : ${contre.error.message}`);
  }

  const reponse = await source.sb.rpc("respond_trade", { p_trade: ouverte.id, p_accept: true });
  if (reponse.error || reponse.data !== "accepted") {
    await source.sb.rpc("respond_trade", { p_trade: ouverte.id, p_accept: false }); // libère les cartes du lot
    stop(`Échange ${i + 1}/${lots.length} impossible : ${reponse.error?.message ?? reponse.data}`);
  }
  log(`Échange ${i + 1}/${lots.length} : ${lot.length} cartes et ${kheysLot} K contre ${CONTREPARTIE} K.`);
}

log(`Terminé : ${aEnvoyer.length} cartes transférées.`);
