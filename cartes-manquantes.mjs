// Ref Pocket : liste les cartes du catalogue que tu n'as pas encore.
// Se reconnecte et relit ta collection à chaque exécution (rien n'est mis en cache).
//
//   REF_EMAIL=... REF_PASS=... node cartes-manquantes.mjs
//   npm run manquantes          (lit le .env en local ; secrets sur GitHub Actions)
//
// Écrit cartes-manquantes.md et affiche la liste dans le terminal.

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

const RAR = { L: "Légendaires", E: "Épiques", R: "Rares", C: "Communes" };
const ORDER = ["L", "E", "R", "C"];

const cards = await fetchAll(() => sb.from("cards").select("id,name,rarity,n,active").order("n"));
const mineIds = new Set((await fetchAll(() => sb.from("card_instances").select("card_id").eq("owner", me.id))).map((r) => r.card_id));
const missing = cards.filter((c) => !mineIds.has(c.id));

const lines = [`# Cartes manquantes pour ${me.pseudo}`, "", `Au ${new Date().toISOString()} : ${missing.length} manquante(s) sur ${cards.length} (tu en as ${mineIds.size}).`, ""];
console.log(`${me.pseudo} : ${mineIds.size}/${cards.length} cartes. Il te manque ${missing.length} cartes.\n`);
for (const r of ORDER) {
  const g = missing.filter((c) => c.rarity === r).sort((a, b) => a.n - b.n);
  if (!g.length) continue;
  console.log(`=== ${RAR[r]} (${g.length}) ===`);
  lines.push(`## ${RAR[r]} (${g.length})`);
  for (const c of g) {
    const suffix = c.active ? "" : " (hors boosters)";
    console.log(`  n°${c.n} ${c.name}${suffix}`);
    lines.push(`- n°${c.n} ${c.name}${suffix}`);
  }
  console.log("");
  lines.push("");
}
if (!missing.length) lines.push("Collection complète, félicitations !");

writeFileSync("cartes-manquantes.md", lines.join("\n") + "\n");
console.log("Liste écrite dans cartes-manquantes.md.");
