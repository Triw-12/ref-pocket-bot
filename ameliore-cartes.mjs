// Ref Pocket : améliore automatiquement toutes les cartes qui peuvent l'être.
//
// Améliorer une carte monte son niveau en consommant des doublons (exemplaires
// non-holo et non mis en vente). Le k-ième niveau coûte k doublons : la 1re
// amélioration coûte 1 doublon, la 2e en coûte 2, etc. La fonction serveur
// upgrade_card(p_card) applique la règle et refuse s'il manque des doublons ;
// le bot se contente de l'appeler en boucle pour chaque carte, tant que ça passe.
//
//   REF_EMAIL=... REF_PASS=... node ameliore-cartes.mjs         -> améliore pour de vrai
//   ... node ameliore-cartes.mjs --dry                          -> liste seulement, ne touche à rien
//   npm run ameliore            (lit le .env en local ; secrets sur GitHub Actions)
//
// Écrit un compte rendu dans ameliorations.md.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const URL = "https://driraijgakhmnsxepuot.supabase.co";
const KEY = "sb_publishable_BgXnR1FLTcLLajt3id9q_A_RI6JAw1N";
const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const DRY = process.argv.includes("--dry");
const MAX_PER_CARD = 30; // garde-fou : personne n'a de quoi dépasser ça (1+2+...+30 = 465 doublons)

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

// Nombre de doublons disponibles par carte (non-holo, non en vente).
function countPlain(rows) {
  const m = new Map();
  for (const r of rows) if (!r.holo && !r.lock) m.set(r.card_id, (m.get(r.card_id) || 0) + 1);
  return m;
}
let plain = countPlain(await fetchAll(() => sb.from("card_instances").select("card_id,holo,lock").eq("owner", me.id)));

// On ne tente que les cartes avec au moins 2 exemplaires simples
// (la 1re amélioration coûte 1 doublon = il faut garder 1 carte + 1 doublon).
const candidates = [...plain.entries()]
  .filter(([, n]) => n >= 2)
  .map(([id, n]) => ({ id, n, name: cards[id]?.name || id, r: cards[id]?.rarity || "C" }))
  .sort((a, b) => ORDER[a.r] - ORDER[b.r] || b.n - a.n);

console.log(`${me.pseudo} : ${candidates.length} carte(s) avec des doublons à tenter d'améliorer.${DRY ? "  (DRY-RUN : rien ne sera modifié)" : ""}`);

const done = []; // { id, name, r, levels:[...], consumed }
let totalUpgrades = 0;

for (const c of candidates) {
  if (DRY) { console.log(`  [dry] ${c.name} — ${c.n} exemplaires simples`); continue; }
  const levels = [];
  for (let i = 0; i < MAX_PER_CARD; i++) {
    const r = await sb.rpc("upgrade_card", { p_card: c.id });
    if (r.error) {
      // "Il te faut N doubles..." = plus assez de doublons, on passe à la carte suivante.
      if (!/te faut/i.test(r.error.message)) console.log(`  ⚠️  ${c.name} : ${r.error.message}`);
      break;
    }
    levels.push(r.data); // niveau atteint
    totalUpgrades++;
  }
  if (levels.length) {
    done.push({ ...c, levels, newLevel: levels[levels.length - 1] });
    console.log(`  ✦ ${c.name} (${RAR[c.r]}) : +${levels.length} amélioration(s) → niveau ${levels[levels.length - 1]}`);
  }
}

// ---------- Compte rendu ----------
const stamp = new Date().toISOString();
if (DRY) {
  const lines = [`# Améliorations possibles pour ${me.pseudo}`, "", `${candidates.length} carte(s) avec des doublons (dry-run du ${stamp}).`, ""];
  for (const c of candidates) lines.push(`- ${c.name} (${RAR[c.r]}) — ${c.n} exemplaires simples`);
  writeFileSync("ameliorations.md", lines.join("\n") + "\n");
  console.log(`\nDry-run terminé. Liste écrite dans ameliorations.md.`);
} else {
  const lines = [`# Améliorations effectuées pour ${me.pseudo}`, "", `${stamp}`, "", `${totalUpgrades} amélioration(s) sur ${done.length} carte(s).`, ""];
  for (const r of ["L", "E", "R", "C"]) {
    const g = done.filter((d) => d.r === r);
    if (!g.length) continue;
    lines.push(`## ${RAR[r]} (${g.length})`);
    for (const d of g) lines.push(`- ${d.name} : +${d.levels.length} → niveau ${d.newLevel}`);
    lines.push("");
  }
  if (!done.length) lines.push("Aucune carte à améliorer (pas assez de doublons).");
  writeFileSync("ameliorations.md", lines.join("\n") + "\n");
  console.log(`\nTerminé : ${totalUpgrades} amélioration(s) sur ${done.length} carte(s). Compte rendu dans ameliorations.md.`);
}
