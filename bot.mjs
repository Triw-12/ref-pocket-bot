import { createClient } from "@supabase/supabase-js";

const URL = "https://driraijgakhmnsxepuot.supabase.co";
const KEY = "sb_publishable_BgXnR1FLTcLLajt3id9q_A_RI6JAw1N";
const { REF_EMAIL, REF_PASS } = process.env;

if (!REF_EMAIL || !REF_PASS) throw new Error("REF_EMAIL / REF_PASS manquants");

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const log = (...a) => console.log(new Date().toISOString(), ...a);

const { error: e0 } = await sb.auth.signInWithPassword({
  email: REF_EMAIL,
  password: REF_PASS,
});
if (e0) {
  log("Connexion impossible :", e0.message);
  process.exit(1);
}

const me = await sb.rpc("my_profile");
if (me.error) {
  log("Profil :", me.error.message);
  process.exit(1);
}

const p = me.data;
const stock = Math.min(
  2,
  p.boosters + Math.floor((Date.now() - new Date(p.last_refill)) / 3600e3),
);
log(`Stock estimé : ${stock}`);

for (let i = 0; i < stock; i++) {
  const r = await sb.rpc("open_booster", { p_paid: false });
  if (r.error) {
    log("Refusé :", r.error.message);
    break;
  }
  log(
    `Booster ouvert : ${r.data.length} cartes, ${r.data.filter((x) => x.is_new).length} nouvelles`,
  );
}
