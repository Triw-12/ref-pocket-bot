// Ref Pocket : audit de ce que la base expose sur les profils des joueurs.
// Se connecte comme un joueur ordinaire (clé publique) et récupère TOUT ce qu'il
// peut lire sur les autres, pour voir ce qui fuite.
//
//   REF_EMAIL=... REF_PASS=... node profils.mjs
//   npm run profils           (lit le .env en local ; secrets sur GitHub Actions)
//
// Écrit profils.json (tout le détail) et affiche un résumé + une alerte sur les
// colonnes sensibles visibles par n'importe qui.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const URL = "https://driraijgakhmnsxepuot.supabase.co";
const KEY = "sb_publishable_BgXnR1FLTcLLajt3id9q_A_RI6JAw1N";
const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const die = (m) => { console.error(m); process.exit(1); };

{
  const { error } = await sb.auth.signInWithPassword({ email: REF_EMAIL, password: REF_PASS });
  if (error) die("Connexion impossible : " + error.message);
}
const me = (await sb.rpc("my_profile")).data;
if (!me?.id) die("Profil introuvable.");

// Pagination (Supabase : 1000 lignes max par requête)
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

const profiles = await fetchAll(() => sb.from("profiles").select("*").order("created_at"));

// Colonnes qu'on ne s'attendrait pas à voir pour TOUS les joueurs.
const SENSITIVE = ["kheys", "boosters", "pity", "daily_day", "daily_n", "last_refill", "is_admin"];
const cols = profiles.length ? Object.keys(profiles[0]) : [];
const leaking = SENSITIVE.filter((c) => cols.includes(c));

console.log(`Connecté comme ${me.pseudo} (joueur ordinaire, clé publique).`);
console.log(`\n${profiles.length} profils lisibles, ${cols.length} colonnes chacun :`);
console.log("  " + cols.join(", "));

console.log(`\nColonnes sensibles exposées pour TOUS les joueurs (${leaking.length}) :`);
if (!leaking.length) console.log("  aucune — rien de sensible ne fuite.");
else {
  for (const c of leaking) console.log("  ⚠️  " + c);
  console.log("\n  → N'importe quel joueur peut lire ces champs sur tout le monde.");
  console.log("    Ce n'est pas une faille de MODIFICATION (l'écriture reste bloquée),");
  console.log("    mais une exposition d'informations. Pour la corriger : une vue qui ne");
  console.log("    renvoie que les colonnes publiques, et RLS SELECT limité au propriétaire.");
}

// Aperçu : admins et plus gros soldes, histoire de voir concrètement la fuite.
const admins = profiles.filter((p) => p.is_admin);
if (admins.length) console.log(`\nAdmins visibles : ${admins.map((a) => a.pseudo).join(", ")}`);
if (cols.includes("kheys")) {
  const top = [...profiles].sort((a, b) => (b.kheys ?? 0) - (a.kheys ?? 0)).slice(0, 5);
  console.log("\nTop 5 des soldes kheys (visibles par tous) :");
  for (const p of top) console.log(`  ${p.pseudo.padEnd(16)} ${p.kheys} K`);
}

writeFileSync("profils.json", JSON.stringify({ date: new Date().toISOString(), colonnes: cols, colonnes_sensibles_exposees: leaking, profils: profiles }, null, 2));
console.log(`\nDétail complet écrit dans profils.json.`);
