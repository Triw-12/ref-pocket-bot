// Ref Pocket : compare ta collection avec celle de tes amis pour préparer des échanges.
//
//   REF_EMAIL=... REF_PASS=... node amis-echanges.mjs            -> tous tes amis
//   REF_EMAIL=... REF_PASS=... node amis-echanges.mjs Lucas Ratio -> seulement ces pseudos
//   ... node amis-echanges.mjs --json                             -> écrit aussi echanges.json
//
// Le rapport est affiché dans le terminal et enregistré dans rapport-echanges.md.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const URL = "https://driraijgakhmnsxepuot.supabase.co";
const KEY = "sb_publishable_BgXnR1FLTcLLajt3id9q_A_RI6JAw1N";
const { REF_EMAIL, REF_PASS } = process.env;
if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const args = process.argv.slice(2);
const WANT_JSON = args.includes("--json");
const FILTER = args.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const die = (msg) => { console.error(msg); process.exit(1); };

const RAR = { L: "Légendaire", E: "Épique", R: "Rare", C: "Commune" };
const PIP = { L: "★★★", E: "★★ ", R: "★  ", C: "·  " };
const ORDER = ["L", "E", "R", "C"];

// ---------- Connexion ----------
{
  const { error } = await sb.auth.signInWithPassword({ email: REF_EMAIL, password: REF_PASS });
  if (error) die("Connexion impossible : " + error.message);
}
const meR = await sb.rpc("my_profile");
if (meR.error || !meR.data?.id) die("Profil introuvable : " + (meR.error?.message || "pas de profil"));
const me = meR.data;

// ---------- Outils ----------
// Supabase renvoie 1000 lignes max par requête : on pagine
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
// Regroupe des exemplaires par carte : total, holos, libres (ni en vente ni en échange)
function tally(rows) {
  const m = new Map();
  for (const r of rows) {
    const t = m.get(r.card_id) || { total: 0, holo: 0, free: 0 };
    t.total++;
    if (r.holo) t.holo++;
    if (!r.lock) t.free++;
    m.set(r.card_id, t);
  }
  return m;
}
// Exemplaires qu'on peut donner en gardant toujours au moins une carte
const spare = (t) => (t ? Math.max(0, Math.min(t.free, t.total - 1)) : 0);

// ---------- Catalogue et ma collection ----------
const cards = await fetchAll(() => sb.from("cards").select("id,name,r:rarity,n,active").order("n"));
const BYID = Object.fromEntries(cards.map((c) => [c.id, c]));
const sortCards = (a, b) => ORDER.indexOf(BYID[a].r) - ORDER.indexOf(BYID[b].r) || BYID[a].n - BYID[b].n;

const mine = tally(await fetchAll(() =>
  sb.from("card_instances").select("id,card_id,holo,lock").eq("owner", me.id).order("id")));

// ---------- Amis ----------
const fr = await sb.from("friendships").select("requester,addressee,status").eq("status", "accepted");
if (fr.error) die("Amis : " + fr.error.message);
const friendIds = [...new Set(fr.data
  .filter((f) => f.requester === me.id || f.addressee === me.id)
  .map((f) => (f.requester === me.id ? f.addressee : f.requester)))];

const pr = await sb.from("profiles").select("id,pseudo,showcase");
if (pr.error) die("Joueurs : " + pr.error.message);
const PLAYERS = Object.fromEntries(pr.data.map((p) => [p.id, p]));

let friends = friendIds.map((id) => PLAYERS[id]).filter(Boolean);
if (FILTER.length) friends = friends.filter((p) => FILTER.some((f) => p.pseudo.toLowerCase().includes(f)));
if (!friends.length) die(FILTER.length ? "Aucun ami ne correspond à ces pseudos." : "Tu n'as pas encore d'amis dans le jeu.");

// ---------- Collection d'un ami ----------
// 1) fonction friend_collection (voir friend_collection.sql) ; 2) lecture directe ;
// 3) à défaut, ce qu'on voit publiquement : ses annonces au marché et sa vitrine.
async function collectionOf(p) {
  const rpc = await sb.rpc("friend_collection", { p_friend: p.id });
  if (!rpc.error && Array.isArray(rpc.data)) {
    const m = new Map();
    for (const x of rpc.data) m.set(x.card_id, { total: x.total, holo: x.holos, free: x.libres ?? x.total });
    return { m, full: true };
  }

  const rows = await fetchAll(() =>
    sb.from("card_instances").select("id,card_id,holo,lock").eq("owner", p.id).order("id")).catch(() => []);
  const page = await sb.rpc("player_page", { p_user: p.id });
  const distinct = page.error ? null : page.data?.distinct ?? null;
  const m = tally(rows);
  if (rows.length && (distinct == null || m.size >= distinct)) return { m, full: true };

  // Vue partielle
  const ls = await sb.from("listings")
    .select("price,inst:card_instances(card_id,holo)").eq("status", "open").eq("seller", p.id);
  for (const l of ls.data || []) {
    if (!l.inst) continue;
    const t = m.get(l.inst.card_id) || { total: 0, holo: 0, free: 0 };
    t.total++; if (l.inst.holo) t.holo++;
    t.sale = Math.min(t.sale ?? Infinity, l.price);
    m.set(l.inst.card_id, t);
  }
  for (const v of p.showcase || []) {
    const id = String(v).replace("*", "");
    if (!m.has(id)) m.set(id, { total: 1, holo: v.endsWith("*") ? 1 : 0, free: 0, vitrine: true });
  }
  return { m, full: false, distinct };
}

// ---------- Rapport ----------
const lines = [];
const out = (s = "") => { lines.push(s); console.log(s); };
const json = { date: new Date().toISOString(), moi: me.pseudo, amis: [] };

out(`# Échanges possibles pour ${me.pseudo}`);
out(`${mine.size} cartes différentes dans ta collection · ${friends.length} ami${friends.length > 1 ? "s" : ""} analysé${friends.length > 1 ? "s" : ""}`);

for (const p of friends.sort((a, b) => a.pseudo.localeCompare(b.pseudo, "fr"))) {
  const { m, full, distinct } = await collectionOf(p);

  // Ce qu'il a et que je n'ai pas
  const iMiss = [...m.keys()].filter((id) => BYID[id] && !mine.has(id)).sort(sortCards);
  // Ce que j'ai et qu'il n'a pas (seulement si on voit toute sa collection)
  const theyMiss = full ? [...mine.keys()].filter((id) => BYID[id] && !m.has(id)).sort(sortCards) : [];

  out();
  out(`## ${p.pseudo}`);
  if (!full) out(`⚠️  Vue partielle : seulement ses annonces au marché et sa vitrine${distinct != null ? ` (il possède ${distinct} cartes différentes)` : ""}. Installe friend_collection.sql pour tout voir.`);

  out();
  out(`### Il a, tu ne l'as pas (${iMiss.length})`);
  if (!iMiss.length) out("  rien");
  for (const id of iMiss) {
    const c = BYID[id], t = m.get(id), tags = [];
    if (full) tags.push(`×${t.total} chez lui`);
    if (spare(t) > 0) tags.push("il a un double");
    if (t.holo) tags.push(`${t.holo} holo`);
    if (t.sale != null) tags.push(`en vente ${t.sale} K`);
    if (t.vitrine) tags.push("dans sa vitrine");
    if (!c.active) tags.push("hors boosters");
    out(`  ${PIP[c.r]} ${c.name} (n°${c.n}, ${RAR[c.r]})${tags.length ? " — " + tags.join(", ") : ""}`);
  }

  if (full) {
    out();
    out(`### Tu l'as, il ne l'a pas (${theyMiss.length})`);
    if (!theyMiss.length) out("  rien");
    for (const id of theyMiss) {
      const c = BYID[id], t = mine.get(id);
      const tags = [spare(t) > 0 ? `${spare(t)} double${spare(t) > 1 ? "s" : ""} à donner` : "exemplaire unique"];
      if (t.holo) tags.push(`${t.holo} holo`);
      if (t.free < t.total) tags.push(`${t.total - t.free} en vente/échange`);
      out(`  ${PIP[c.r]} ${c.name} (n°${c.n}, ${RAR[c.r]}) — ${tags.join(", ")}`);
    }

    // Échanges « gagnant-gagnant » : un de mes doubles contre un de ses doubles, même rareté d'abord
    const mySpare = theyMiss.filter((id) => spare(mine.get(id)) > 0);
    const hisSpare = iMiss.filter((id) => spare(m.get(id)) > 0);
    const deals = [], used = new Set();
    for (const r of ORDER) {
      const a = mySpare.filter((id) => BYID[id].r === r), b = hisSpare.filter((id) => BYID[id].r === r);
      for (let i = 0; i < Math.min(a.length, b.length); i++) { deals.push([a[i], b[i]]); used.add(a[i]); used.add(b[i]); }
    }
    out();
    out(`### Échanges idéaux (tes doubles contre ses doubles)`);
    if (!deals.length) out("  aucun échange double contre double de même rareté");
    for (const [a, b] of deals) out(`  ⇄ ton « ${BYID[a].name} » contre son « ${BYID[b].name} » (${RAR[BYID[a].r]})`);
    const restMine = mySpare.filter((id) => !used.has(id)).length;
    const restHis = hisSpare.filter((id) => !used.has(id)).length;
    if (restMine || restHis) out(`  Il reste ${restMine} de tes doubles et ${restHis} des siens sans équivalent de même rareté.`);
  }

  json.amis.push({
    pseudo: p.pseudo, complet: full,
    il_a_pas_moi: iMiss.map((id) => ({ id, nom: BYID[id].name, rarete: BYID[id].r, ...m.get(id) })),
    jai_pas_lui: theyMiss.map((id) => ({ id, nom: BYID[id].name, rarete: BYID[id].r, ...mine.get(id) })),
  });
}

writeFileSync("rapport-echanges.md", lines.join("\n") + "\n");
if (WANT_JSON) writeFileSync("echanges.json", JSON.stringify(json, null, 2));
console.log(`\nRapport enregistré dans rapport-echanges.md${WANT_JSON ? " et echanges.json" : ""}.`);
