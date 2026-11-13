// Ref Pocket : met en vente, à prix réduit, les exemplaires qui ne te servent plus,
// baisse peu à peu le prix de ceux qui ne partent pas, puis les défausse.
//
// Ce qui est vendu :
//   - les holos en double : on en garde 1 par carte, car il suffit d'en posséder une
//     pour la jouer en duel (Éclat holo : +3 dégâts) ; les suivantes ne servent à rien
//     (les holos ne comptent jamais comme doublons pour les améliorations) ;
//   - sur une carte au niveau maximum (5), tout ce qui dépasse 2 exemplaires : elle ne
//     peut plus monter, donc ses doublons n'ont plus d'usage. Les holos partent d'abord
//     s'il y en a plusieurs, puis les normales, et on garde toujours 1 holo.
//
// Règles communes :
//   - pour varier les offres, une carte n'a qu'une annonce à la fois : tant qu'un
//     exemplaire est en vente, les autres attendent, et une relance du script met le
//     suivant en vente une fois le premier parti ;
//   - un exemplaire déjà en vente ou dans un échange (« lock ») n'est jamais touché, et
//     ne compte pas parmi ceux qu'on garde ;
//   - le prix de référence est celui proposé par le jeu (valeur de la rareté, × 3 pour
//     une holo, la même pour toutes les générations), moins la remise, sans jamais
//     descendre sous ce que rapporterait une défausse de la carte. Une remise négative
//     est une majoration : --remise=-30 met en vente 30 % au-dessus de la référence.
//
// Baisse progressive (à chaque lancement, avant de créer les nouvelles annonces) :
//   - une annonce de surplus restée sans acheteur depuis --palier heures (24 par défaut)
//     est retirée puis remise en vente --baisse % du prix de référence moins cher (10 par
//     défaut) ;
//   - dès que ce prix atteindrait la valeur de défausse, personne n'en veut et la vendre à
//     ce prix ne rapporterait pas plus : elle est défaussée tout de suite, ainsi que tout ce
//     qui dépasse 3 exemplaires disponibles de cette carte (normales d'abord, holos gardés). Pareil
//     pour une carte dont le prix de départ tombe déjà sur la valeur de défausse (grosse
//     remise). Avec --sans-defausse, rien n'est défaussé : elle reste en vente à ce prix ;
//   - seules les annonces de surplus au prix de départ du script ou moins cher sont
//     concernées : une annonce posée à la main plus cher, ou sur une carte qui n'est
//     pas en surplus, n'est jamais touchée.
//
//   REF_EMAIL=... REF_PASS=... node vendre.mjs      -> met en vente / baisse / défausse
//   ... node vendre.mjs --dry                       -> n'affiche que ce qui serait fait
//   ... node vendre.mjs --remise=40                 -> remise de départ en % (20 par défaut)
//   ... node vendre.mjs --remise=-30                -> majoration : 30 % au-dessus de la référence
//   ... node vendre.mjs --remise-gen2=-50           -> remise propre à une génération (--remise-gen1,
//                                                      --remise-gen2), --remise pour les autres
//   ... node vendre.mjs --baisse=15 --palier=12     -> baisse de 15 % toutes les 12 h
//   ... node vendre.mjs --sans-defausse             -> ne défausse jamais rien
//   ... node vendre.mjs --retirer                   -> retire toutes tes annonces ouvertes
//   ... node vendre.mjs --retirer=141,176           -> retire seulement ces numéros de carte (ceux
//                                                      du site, qui repartent à 1 en Gén. 2 : ajoute
//                                                      --gen pour viser une seule génération)
//   ... node vendre.mjs --gen=2                     -> seulement cette génération, 1 ou 2 (toutes par défaut) :
//                                                      annonces, baisses, défausses et retraits
//   npm run vendre -- --dry     (lit le .env en local ; secrets sur GitHub Actions)
//
// Écrit un compte rendu dans ventes.md.

import { writeFileSync } from "node:fs";
import { connecter, lireTout } from "./session.mjs";
import { numerosSite } from "./numeros.mjs";

const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const DRY = process.argv.includes("--dry");
const SANS_DEFAUSSE = process.argv.includes("--sans-defausse");
const intArg = (nom, defaut, min, max) => {
  const a = process.argv.find((x) => x.startsWith(`--${nom}=`));
  const v = a ? Number(a.slice(nom.length + 3)) : defaut;
  if (!Number.isInteger(v) || v < min || v > max) throw new Error(`--${nom} doit être un entier entre ${min} et ${max}`);
  return v;
};
// Négative, la remise devient une majoration (jusqu'à 6 fois le prix de référence).
const REMISE = intArg("remise", 20, -500, 90);
const REMISES = { 1: intArg("remise-gen1", REMISE, -500, 90), 2: intArg("remise-gen2", REMISE, -500, 90) };
const remiseDe = (c) => REMISES[c?.gen || 1] ?? REMISE;
const texteRemise = (r) => (r >= 0 ? `remise de ${r} %` : `majoration de ${-r} %`);
const BAISSE = intArg("baisse", 10, 1, 90);
const PALIER_H = intArg("palier", 24, 1, 24 * 30);

const retirerArg = process.argv.find((a) => a === "--retirer" || a.startsWith("--retirer="));
const NUMEROS = retirerArg?.includes("=") ? retirerArg.slice("--retirer=".length).split(",").map((x) => x.trim()) : null;
if (NUMEROS && !NUMEROS.every((x) => /^\d+$/.test(x))) throw new Error("--retirer= attend des numéros de carte séparés par des virgules (ex. --retirer=141,176)");

// Un « --gen 2 » mal écrit doit arrêter le script : sinon il toucherait toutes les générations
const genArg = process.argv.find((a) => a.startsWith("--gen"));
const GEN = genArg ? Number(genArg.split("=")[1]) : null;
if (GEN !== null && GEN !== 1 && GEN !== 2) throw new Error("--gen attend 1 ou 2 (ex. --gen=2)");
const genVisee = (c) => GEN === null || (!!c && (c.gen || 1) === GEN);
const gensTexte = GEN === null ? "toutes" : `Gén. ${GEN}`;
// Remises des générations traitées, pour les comptes rendus
const remisesTexte = (() => {
  const gens = GEN === null ? [1, 2] : [GEN];
  const textes = gens.map((g) => texteRemise(REMISES[g]));
  return new Set(textes).size === 1 ? textes[0] : gens.map((g, i) => `Gén. ${g} : ${textes[i]}`).join(", ");
})();

const NIVEAU_MAX = 5; // LVL_MAX dans cartes.js du site
const GARDER = 1; // exemplaires disponibles conservés sur une carte qui peut encore monter
const GARDER_NIVEAU_MAX = 2; // ... et sur une carte au niveau maximum
const GARDER_PLANCHER = 3; // exemplaires gardés quand le prix plancher est atteint : le reste est défaussé
// Un cron quotidien ne tombe jamais pile à la même seconde : on tolère 10 % d'avance.
const PALIER_MS = PALIER_H * 3600e3 * 0.9;

const die = (m) => { console.error(m); process.exit(1); };

const { sb, me, error } = await connecter(REF_EMAIL, REF_PASS);
if (error) die(error);

// Mêmes valeurs que RARITIES dans cartes.js du site (elles n'existent que côté client).
const RAR = {
  L: { name: "Légendaires", value: 800, discard: 200 },
  E: { name: "Épiques", value: 200, discard: 50 },
  R: { name: "Rares", value: 60, discard: 15 },
  C: { name: "Communes", value: 20, discard: 5 },
};
const ORDER = ["L", "E", "R", "C"];
const mult = (holo) => (holo ? 3 : 1);
const plancherDe = (r, holo) => RAR[r].discard * mult(holo);
const prixDe = (c, holo) => Math.max(plancherDe(c.rarity, holo), Math.round((RAR[c.rarity].value * mult(holo) * (100 - remiseDe(c))) / 100));
const pasDe = (r, holo) => Math.max(1, Math.round((RAR[r].value * mult(holo) * BAISSE) / 100));

const catalogue = await lireTout(() => sb.from("cards").select("id,name,rarity,n,gen,active").order("id"));
const cards = Object.fromEntries(catalogue.map((c) => [c.id, c]));
const numero = numerosSite(catalogue); // numéro du site : chaque génération repart à 1
const noDe = (c) => (c ? numero.get(c.id) ?? "HS" : "?");
const mesAnnonces = () => lireTout(() => sb.from("listings").select("id,price,created_at,instance_id,inst:card_instances(card_id,holo)").eq("seller", me.id).eq("status", "open").order("id"));
const nomDe = (c) => `${(c?.gen || 1) > 1 ? `[Gén. ${c.gen}] ` : ""}${c?.name || "?"}`;
const ligne = (signe, c, holo, suite) => `  ${signe} n°${String(noDe(c)).padEnd(4)} ${nomDe(c).slice(0, 44).padEnd(44)} ${(holo ? "holo" : "normale").padEnd(8)} ${suite}`;

// ---------- Mode --retirer : retire des annonces au lieu d'en créer ----------
if (retirerArg) {
  const annonces = await mesAnnonces();
  const visees = annonces
    .map((l) => ({ id: l.id, prix: l.price, holo: l.inst?.holo, carte: cards[l.inst?.card_id] }))
    .filter((l) => genVisee(l.carte) && (!NUMEROS || NUMEROS.includes(String(noDe(l.carte)))));
  const sansAnnonce = (NUMEROS || []).filter((x) => !visees.some((l) => String(noDe(l.carte)) === x));

  console.log(`${me.pseudo} : ${visees.length} annonce(s) à retirer sur ${annonces.length} ouverte(s), générations : ${gensTexte}.${DRY ? "  (DRY-RUN : rien ne sera retiré)" : ""}\n`);

  const retirees = [];
  const echecs = []; // { name, message }
  for (const l of visees) {
    const name = l.carte?.name || `annonce #${l.id}`;
    if (!DRY) {
      const r = await sb.rpc("cancel_listing", { p_listing: l.id });
      if (r.error) {
        echecs.push({ name, message: r.error.message });
        console.error(`  ✗ ${name} : ${r.error.message}`);
        continue;
      }
    }
    retirees.push(l);
    console.log(ligne(DRY ? "·" : "✓", l.carte, l.holo, `${l.prix} K`));
  }

  const verbe = DRY ? "à retirer" : "retirée(s)";
  const R = [`# Annonces retirées pour ${me.pseudo}`, "", new Date().toISOString(), ""];
  if (DRY) R.push("DRY-RUN : rien n'a été retiré.", "");
  R.push(`${retirees.length} annonce(s) ${verbe} sur ${annonces.length} ouverte(s). Générations traitées : ${gensTexte}.`, "");
  if (retirees.length) {
    R.push("| N° | Carte | Exemplaire | Prix |", "|---:|---|---|---:|");
    for (const l of retirees) R.push(`| ${noDe(l.carte)} | ${l.carte ? nomDe(l.carte) : `annonce #${l.id}`} | ${l.holo ? "Holo" : "Normale"} | ${l.prix} K |`);
    R.push("");
  }
  if (sansAnnonce.length) R.push(`Aucune annonce ouverte pour : ${sansAnnonce.map((x) => `n°${x}`).join(", ")}.`, "");
  if (echecs.length) {
    R.push(`## Échecs (${echecs.length})`, "");
    for (const e of echecs) R.push(`- ${e.name} : ${e.message}`);
    R.push("");
  }
  writeFileSync("ventes.md", R.join("\n") + "\n");

  console.log(`\n${retirees.length} annonce(s) ${verbe}.${echecs.length ? ` ${echecs.length} échec(s).` : ""}`);
  if (sansAnnonce.length) console.log(`Aucune annonce ouverte pour : ${sansAnnonce.map((x) => `n°${x}`).join(", ")}.`);
  console.log("Compte rendu dans ventes.md.");
  process.exit(echecs.length ? 1 : 0);
}

const niveaux = Object.fromEntries((await lireTout(() => sb.from("card_levels").select("card_id,level").eq("owner", me.id).order("card_id"))).map((l) => [l.card_id, l.level]));
const estNiveauMax = (id) => (niveaux[id] || 0) >= NIVEAU_MAX;

// Regroupe les exemplaires par carte (triés : on garde les plus anciens).
const parCarte = new Map();
for (const i of await lireTout(() => sb.from("card_instances").select("id,card_id,holo,lock").eq("owner", me.id).order("id"))) {
  const t = parCarte.get(i.card_id) || { holos: [], simples: [], enVente: 0 };
  if (!i.lock) (i.holo ? t.holos : t.simples).push(i.id);
  else if (i.lock === "listing") t.enVente++;
  parCarte.set(i.card_id, t);
}

// L'exemplaire à mettre en vente pour cette carte, ou null s'il n'y en a aucun.
function choisir(t, niveauMax) {
  if (t.enVente > 0) return null;
  if (t.holos.length + t.simples.length <= (niveauMax ? GARDER_NIVEAU_MAX : GARDER)) return null;
  if (t.holos.length > 1) return { instance: t.holos.at(-1), holo: true };
  if (niveauMax && t.simples.length > 0) return { instance: t.simples.at(-1), holo: false };
  return null;
}

const echecs = []; // { name, message }
const echec = (c, message) => {
  echecs.push({ name: c?.name || "?", message });
  console.error(`  ✗ ${c?.name || "?"} : ${message}`);
};

// ---------- Baisse progressive des annonces qui ne partent pas ----------
const baissees = []; // { carte, holo, avant, apres }
const defaussees = []; // { carte, holo, nombre, gain }
const enAttente = []; // { carte, holo, prix, prochaine }

// Défausse `premier` (un exemplaire qu'on vient de retirer de la vente, ou null), puis
// tout ce qui dépasse GARDER_PLANCHER exemplaires disponibles de cette carte (normales
// d'abord, les holos sont gardés en priorité) : si
// personne n'en veut au prix plancher, personne n'en voudra des autres.
async function defausser(c, holo, t, premier) {
  let nombre = 0, gain = 0;
  const jeter = async (instance, h) => {
    if (DRY) { gain += plancherDe(c.rarity, h); nombre++; return true; }
    const r = await sb.rpc("discard_card", { p_instance: instance });
    if (r.error) { echec(c, `défausse : ${r.error.message}`); return false; }
    gain += Number(r.data) || 0;
    nombre++;
    return true;
  };
  const ok = premier == null || (await jeter(premier, holo));
  if (ok && t.enVente === 0) {
    while (t.holos.length + t.simples.length > GARDER_PLANCHER) {
      const h = t.simples.length === 0;
      if (!(await jeter((h ? t.holos : t.simples).at(-1), h))) break;
      (h ? t.holos : t.simples).pop();
    }
  }
  if (nombre) {
    defaussees.push({ carte: c, holo, nombre, gain });
    console.log(ligne(DRY ? "·" : "🗑", c, holo, `défaussée${nombre > 1 ? ` ×${nombre}` : ""} : +${gain} K`));
  }
}

for (const l of await mesAnnonces()) {
  const id = l.inst?.card_id, holo = !!l.inst?.holo, c = cards[id], t = parCarte.get(id);
  if (!c || !t || !RAR[c.rarity] || !genVisee(c)) continue;
  // Annonce de surplus ? On la remet parmi les exemplaires disponibles et on regarde si
  // le script l'aurait choisie (même genre holo / normale).
  const avec = { holos: [...t.holos], simples: [...t.simples], enVente: t.enVente - 1 };
  (holo ? avec.holos : avec.simples).push(l.instance_id);
  const choix = choisir(avec, estNiveauMax(id));
  if (!choix || choix.holo !== holo || l.price > prixDe(c, holo)) continue; // pas à nous de la toucher

  const plancher = plancherDe(c.rarity, holo);
  const auPlancher = l.price <= plancher;
  if (auPlancher && SANS_DEFAUSSE) continue; // elle reste en vente au prix plancher

  // Une annonce déjà au prix plancher se défausse tout de suite ; les autres attendent le palier.
  const age = Date.now() - new Date(l.created_at).getTime();
  if (!auPlancher && age < PALIER_MS) {
    enAttente.push({ carte: c, holo, prix: l.price, prochaine: new Date(new Date(l.created_at).getTime() + PALIER_MS) });
    continue;
  }
  const apres = Math.max(plancher, l.price - pasDe(c.rarity, holo));
  // La vendre à la valeur de défausse rapporterait autant que la défausser : on défausse direct.
  const aJeter = !SANS_DEFAUSSE && apres <= plancher;

  if (!DRY) {
    const r = await sb.rpc("cancel_listing", { p_listing: l.id });
    if (r.error) { echec(c, `retrait de l'annonce : ${r.error.message}`); continue; }
  }
  t.enVente--;

  if (!aJeter) {
    if (!DRY) {
      const r = await sb.rpc("list_card", { p_instance: l.instance_id, p_price: apres });
      // L'exemplaire est retiré mais pas remis en vente : il repartira au prix de départ au prochain lancement.
      if (r.error) { echec(c, `remise en vente à ${apres} K : ${r.error.message}`); continue; }
    }
    t.enVente++;
    baissees.push({ carte: c, holo, avant: l.price, apres });
    console.log(ligne(DRY ? "·" : "↓", c, holo, `${l.price} K → ${apres} K${apres === plancher ? "  (prix plancher)" : ""}`));
    continue;
  }

  // Personne n'en veut : défausse de cet exemplaire et du surplus du même genre.
  await defausser(c, holo, t, l.instance_id);
}

// ---------- Nouvelles annonces ----------
const aVendre = [];
const ignorees = []; // rareté inconnue : pas de prix fiable, on saute la carte
for (const [id, t] of parCarte) {
  const niveauMax = estNiveauMax(id);
  const choix = choisir(t, niveauMax);
  if (!choix) continue;
  const c = cards[id];
  if (!genVisee(c)) continue;
  if (!RAR[c?.rarity]) { ignorees.push(c?.name || id); continue; }
  const prix = prixDe(c, choix.holo);
  // Avec une grosse remise, le prix de départ tombe sur la valeur de défausse : on défausse direct.
  if (!SANS_DEFAUSSE && prix <= plancherDe(c.rarity, choix.holo)) { await defausser(c, choix.holo, t, null); continue; }
  aVendre.push({ ...c, ...choix, niveauMax, prix });
}
if (baissees.length || defaussees.length) console.log("");
// La génération la plus récente d'abord.
aVendre.sort((a, b) => (b.gen || 1) - (a.gen || 1) || ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.n - b.n);

console.log(`${me.pseudo} : ${aVendre.length} carte(s) à mettre en vente (1 annonce par carte), ${remisesTexte}, générations : ${gensTexte}.${DRY ? "  (DRY-RUN : rien ne sera fait)" : ""}\n`);

for (const c of aVendre) {
  if (!DRY) {
    const r = await sb.rpc("list_card", { p_instance: c.instance, p_price: c.prix });
    if (r.error) { c.echec = true; echec(c, r.error.message); continue; }
  }
  console.log(ligne(DRY ? "·" : "✓", c, c.holo, `${c.prix} K${c.niveauMax ? "  (niveau max)" : ""}`));
}
const vendues = aVendre.filter((c) => !c.echec);
const total = vendues.reduce((s, c) => s + c.prix, 0);

// ---------- Compte rendu ----------
const verbe = DRY ? "à mettre en vente" : "mise(s) en vente";
const genre = (holo) => (holo ? "Holo" : "Normale");
const L = [`# Ventes pour ${me.pseudo}`, "", new Date().toISOString(), ""];
if (DRY) L.push("DRY-RUN : rien n'a été fait.", "");
L.push(
  `${vendues.length} carte(s) ${verbe} (${remisesTexte}), pour ${total} K au total si tout part. Une annonce à la fois par carte.`,
  "",
  `Générations traitées : ${gensTexte}.`,
  "",
  `Sans acheteur après ${PALIER_H} h, une annonce baisse de ${BAISSE} % du prix de référence, ${SANS_DEFAUSSE ? "jusqu'à la valeur de défausse." : "et la carte est défaussée dès qu'elle atteindrait la valeur de défausse."}`,
  "",
);
for (const gen of [...new Set(vendues.map((c) => c.gen || 1))].sort((a, b) => b - a)) for (const r of ORDER) {
  const g = vendues.filter((c) => (c.gen || 1) === gen && c.rarity === r);
  if (!g.length) continue;
  L.push(`## Génération ${gen} · ${RAR[r].name}`, "", "| N° | Carte | Exemplaire | Prix | Niveau max |", "|---:|---|---|---:|---|");
  for (const c of g) L.push(`| ${noDe(c)} | ${c.name} | ${genre(c.holo)} | ${c.prix} K | ${c.niveauMax ? "Oui" : "Non"} |`);
  L.push("");
}
if (baissees.length) {
  L.push(`## Prix baissés (${baissees.length})`, "", "| N° | Carte | Exemplaire | Avant | Après |", "|---:|---|---|---:|---:|");
  for (const b of baissees) L.push(`| ${noDe(b.carte)} | ${nomDe(b.carte)} | ${genre(b.holo)} | ${b.avant} K | ${b.apres} K |`);
  L.push("");
}
if (defaussees.length) {
  const gain = defaussees.reduce((s, d) => s + d.gain, 0);
  L.push(`## Défaussées, personne n'en voulait (${defaussees.reduce((s, d) => s + d.nombre, 0)} exemplaire(s), +${gain} K)`, "", "| N° | Carte | Exemplaire | Nombre | Gain |", "|---:|---|---|---:|---:|");
  for (const d of defaussees) L.push(`| ${noDe(d.carte)} | ${nomDe(d.carte)} | ${genre(d.holo)} | ${d.nombre} | ${d.gain} K |`);
  L.push("");
}
if (enAttente.length) {
  L.push(`## En vente, prochaine baisse plus tard (${enAttente.length})`, "", "| N° | Carte | Exemplaire | Prix | Prochaine baisse |", "|---:|---|---|---:|---|");
  for (const a of enAttente) L.push(`| ${noDe(a.carte)} | ${nomDe(a.carte)} | ${genre(a.holo)} | ${a.prix} K | après ${a.prochaine.toISOString().slice(0, 16).replace("T", " ")} UTC |`);
  L.push("");
}
if (echecs.length) {
  L.push(`## Échecs (${echecs.length})`, "");
  for (const e of echecs) L.push(`- ${e.name} : ${e.message}`);
  L.push("");
}
if (ignorees.length) {
  L.push(`## Ignorées, rareté inconnue (${ignorees.length})`, "");
  for (const n of ignorees) L.push(`- ${n}`);
  L.push("");
}
writeFileSync("ventes.md", L.join("\n") + "\n");

console.log(`\n${vendues.length} carte(s) ${verbe}, ${total} K au total si tout part.${echecs.length ? ` ${echecs.length} échec(s).` : ""}`);
if (baissees.length) console.log(`${baissees.length} prix baissé(s).`);
if (defaussees.length) console.log(`${defaussees.reduce((s, d) => s + d.nombre, 0)} exemplaire(s) défaussé(s).`);
if (enAttente.length) console.log(`${enAttente.length} annonce(s) en attente de la prochaine baisse.`);
if (ignorees.length) console.log(`${ignorees.length} carte(s) ignorée(s), rareté inconnue.`);
console.log("Compte rendu dans ventes.md.");
if (echecs.length) process.exitCode = 1;
