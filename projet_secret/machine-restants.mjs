// Affiche en JSON l'état de la machine à sous pour ce compte :
// {"tours": tours payants restants aujourd'hui, "gratuits": tours gratuits en attente, "kheys": solde}
//
//   node projet_secret/machine-restants.mjs --email=adresse@exemple.com --password='mot_de_passe'
//
// La sortie standard ne contient que le JSON : les erreurs partent sur la sortie d'erreur.

import { ouvrirSession } from "../session.mjs";

const stop = (msg) => {
  console.error(msg);
  process.exit(1);
};
const option = (nom) =>
  process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);

const email = option("email")?.trim();
const password = option("password");
if (!email || !password) stop("Indique le compte : --email=… --password=…");

const { sb, error } = await ouvrirSession(email, password);
if (error) stop(`Connexion impossible : ${error.message}`);

const { data: me, error: erreurProfil } = await sb.rpc("my_profile");
if (erreurProfil || !me?.id) stop(`Profil introuvable : ${erreurProfil?.message ?? "vide"}`);

const { data: info, error: erreurMachine } = await sb.rpc("slot_info");
if (erreurMachine) stop(`Machine indisponible : ${erreurMachine.message}`);

console.log(JSON.stringify({
  tours: Math.max(0, (info.cap || 500) - (info.spins || 0)),
  gratuits: info.free || 0,
  kheys: me.kheys ?? 0,
}));
