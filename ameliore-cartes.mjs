// Ref Pocket : améliore automatiquement toutes les cartes qui peuvent l'être.
//
// Améliorer une carte monte son niveau en consommant des doublons. Règle du jeu,
// vérifiée côté serveur par upgrade_card(p_card) :
//   - le k-ième niveau coûte k doublons (1re amélioration = 1 doublon, 2e = 2, etc.) ;
//   - SEULS comptent les exemplaires « simples » : ni holos, ni cartes en vente ;
//   - il faut toujours garder au moins 1 exemplaire.
// Conséquence importante (c'est la réponse à « pourquoi une carte simple + holo
// ne s'améliore pas ») : un holo n'est JAMAIS compté ni consommé. Si tu n'as qu'un
// seul exemplaire simple, tu as 0 doublon utilisable, donc rien ne peut monter,
// même avec des holos à côté.
//
//   REF_EMAIL=... REF_PASS=... node ameliore-cartes.mjs      -> améliore pour de vrai
//   ... node ameliore-cartes.mjs --dry                       -> n'améliore rien, explique seulement
//   npm run ameliore            (lit le .env en local ; secrets sur GitHub Actions)
//
// Écrit un compte rendu dans ameliorations.md (ce qui a été amélioré ET pourquoi
// le reste ne l'a pas été).

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const URL = "https://driraijgakhmnsxepuot.supabase.co";
const KEY = "sb_publishable_BgXnR1FLTcLLajt3id9q_A_RI6JAw1N";
const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const DRY = process.argv.includes("--dry");
const MAX_PER_CARD = 30; // garde-fou : 1+2+...+30 = 465 doublons, hors de portée

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const die = (m) => { console.error(m); process.exit(1); };

{
  const { error } = await sb.auth.signInWithPassword({ email: REF_EMAIL, password: REF_PASS });
  if (error) die("Connexion impossible : " + error.message);
}
const me = (await sb.rpc("my_profile")).data;
if (!me?.id) die("Profil introuvable.");

async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const cards = Object.fromEntries((await fetchAll(() => sb.from("cards").select("id,name,rarity"))).map((c) => [c.id, c]));
const RAR = { L: "Légendaire", E: "Épique", R: "Rare", C: "Commune" };
const ORDER = { L: 0, E: 1, R: 2, C: 3 };

// Compte, par carte : exemplaires simples (ni holo, ni en vente), holos, en vente.
const m = new Map();
for (const r of await fetchAll(() => sb.from("card_instances").select("card_id,holo,lock").eq("owner", me.id))) {
  const t = m.get(r.card_id) || { simple: 0, holo: 0, vente: 0 };
  if (r.holo) t.holo++; else if (r.lock) t.vente++; else t.simple++;
  m.set(r.card_id, t);
}

// On examine toute carte possédée au moins en double sous une forme ou une autre.
const examined = [...m.entries()]
  .filter(([, t]) => t.simple + t.holo + t.vente >= 2)
  .map(([id, t]) => ({ id, ...t, name: cards[id]?.name || id, r: cards[id]?.rarity || "C" }))
  .sort((a, b) => ORDER[a.r] - ORDER[b.r] || b.simple - a.simple);

console.log(`${me.pseudo} : ${examined.length} carte(s) en plusieurs exemplaires examinée(s).${DRY ? "  (DRY-RUN : rien ne sera modifié)" : ""}`);

const upgraded = [];       // { name, r, levels, newLevel }
const blockedHolo = [];    // 1 seul simple, bloqué parce que les holos ne comptent pas
const blockedLack = [];    // des simples mais pas assez pour le prochain niveau { name, r, simple, besoin }

// "Il te faut N doubles..." -> N (coût du prochain niveau)
const needOf = (msg) => { const x = /te faut (\d+)/i.exec(msg || ""); return x ? +x[1] : null; };

for (const c of examined) {
  const levels = [];
  let lastErr = null;
  // En dry-run on ne fait qu'un diagnostic sans jamais améliorer.
  if (!DRY) {
    for (let i = 0; i < MAX_PER_CARD; i++) {
      const r = await sb.rpc("upgrade_card", { p_card: c.id });
      if (r.error) { lastErr = r.error.message; break; }
      levels.push(r.data);
    }
  } else {
    // Diagnostic : on ne peut connaître le coût exact qu'en tentant, donc en dry-run
    // on déduit seulement les cas clairs à partir des exemplaires simples.
    lastErr = c.simple >= 2 ? "indéterminé (lance sans --dry pour tenter)" : "il te faut au moins 1 doublon simple";
  }

  if (levels.length) {
    upgraded.push({ name: c.name, r: c.r, levels, newLevel: levels[levels.length - 1] });
    console.log(`  ✦ ${c.name} (${RAR[c.r]}) : +${levels.length} → niveau ${levels[levels.length - 1]}`);
  } else if (c.simple <= 1 && (c.holo > 0 || c.vente > 0)) {
    blockedHolo.push(c);
  } else {
    const besoin = needOf(lastErr);
    blockedLack.push({ ...c, besoin });
  }
}

// ---------- Compte rendu ----------
const stamp = new Date().toISOString();
const L = [`# Améliorations pour ${me.pseudo}`, "", stamp, ""];
const totalUp = upgraded.reduce((s, u) => s + u.levels.length, 0);

if (DRY) L.push("DRY-RUN : aucune amélioration effectuée.", "");
L.push(`## Améliorées (${upgraded.length} cartes, ${totalUp} niveaux)`, "");
if (!upgraded.length) L.push("_Aucune._", "");
for (const key of ["L", "E", "R", "C"]) {
  const g = upgraded.filter((u) => u.r === key);
  if (!g.length) continue;
  L.push(`### ${RAR[key]} (${g.length})`);
  for (const u of g) L.push(`- ${u.name} : +${u.levels.length} → niveau ${u.newLevel}`);
  L.push("");
}

L.push(`## Bloquées : un seul exemplaire simple (${blockedHolo.length})`, "",
  "Ces cartes ont des holos et/ou des cartes en vente, mais **les holos et les cartes en vente ne comptent pas** comme doublons. Avec un seul exemplaire simple, il n'y a aucun doublon à sacrifier.", "");
for (const c of blockedHolo) L.push(`- ${c.name} (${RAR[c.r]}) : 1 simple, ${c.holo} holo(s)${c.vente ? `, ${c.vente} en vente` : ""}`);
L.push("");

L.push(`## Bloquées : pas assez de doublons pour le niveau suivant (${blockedLack.length})`, "");
for (const c of blockedLack) L.push(`- ${c.name} (${RAR[c.r]}) : ${c.simple} simple(s)${c.besoin ? `, il en faut ${c.besoin} pour le prochain niveau` : ""}`);
L.push("");

writeFileSync("ameliorations.md", L.join("\n") + "\n");
console.log(`\n${DRY ? "Diagnostic" : "Terminé"} : ${totalUp} amélioration(s) sur ${upgraded.length} carte(s).`);
console.log(`Bloquées faute de doublon simple (holos ignorés) : ${blockedHolo.length} · Bloquées faute de doublons : ${blockedLack.length}.`);
console.log("Compte rendu dans ameliorations.md.");
