#!/usr/bin/env node
/**
 * Einmalig: Bewässerungs-Info an alle WG-Erwachsenen via Gustav/WhatsApp.
 * node scripts/send-bewaesserung-announce.js
 */
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const PHONES = {
  Manu: "41798385590",
  Corina: "41784082785",
  Jasmin: "41789561100",
  Dino: "41798489999",
  Andi: "41765740020",
  Hugues: "41795911251",
  Fannie: "41795553906",
};

const MSG_CH = (name) =>
  `🦆 *Gustav · Garte-Bewässerig*

Hoi ${name}! 👋 Mir händ jetzt *zwei Weg*, wie de Garte bewässeret wird:

*1) Automatisch über d Website*
• Pro Zone eigene Wucheplan (Zitzone Züri)
• Wetter: bi Regen im ±6h-Fenster wird automatisch übersprunge
• Website → Kalender → *Garte* → «Automatik global aktiv» + Zone im Tab wähle

*2) Manuell überschtüüre* (Website oder WhatsApp)
• Website: «Jetzt bewässern» / «Bewässerung stoppen» (für d aktive Zone)
• Oder mir (Gustav) schribe:

*D Wasserhähne & Zone:*
• *Wasserhahn 2 (Wintergarten)* → *Beetbewässerung* (nur Ventil)
• *Wasserhahn 1 links* → *Salatbeete* (nur Ventil)
• *Wasserhahn 1 rechts* → *Tomatenbewässerung* (Ventil + Pumpe, mit Sicherheits-Check)

*Befehl an Gustav:*
• *giesse beet* / *giesse die blumen* → Beet
• *giesse salat* / *giesse schlauch* / *giesse links* → Salatbeete
• *giesse tomaten* / *giesse rechts* → Tomaten (+ Pumpe)
• *pumpe an* → Tomaten-Zone
• *garten status* / *bewässerung zonen* → Überblick
• *bewässerung stopp* → alles stoppe

💡 D physische Hähne chönd wie bisher *von Hand* uf- und zuegmacht werde – d Smart-Steuerig isch zuesätzlich.

Frage? Einfach reply! 🌿`;

const MSG_DE = (name) =>
  `🦆 *Gustav · Neue Garten-Bewässerung*

Hallo ${name}! 👋 Wir haben jetzt *zwei Ebenen* der Steuerung:

*1) Automatisch über die Website*
• Pro Zone eigener Wochenplan (Europe/Zürich)
• Wetterdaten (Open-Meteo): bei Regen im ±6h-Fenster wird automatisch übersprungen
• Website → Kalender → *Garten* → «Automatik global aktiv» + Zonen-Tab

*2) Manuell überschreiben* (Website oder WhatsApp)
• Website: «Jetzt bewässern» / «Bewässerung stoppen» (aktive Zone im Tab)
• Oder Gustav per WhatsApp:

*Wasserhähne & Zonen:*
• *Wasserhahn 2 (Wintergarten)* → *Beetbewässerung* (nur Ventil)
• *Wasserhahn 1 links* → *Salatbeete* (nur Ventil)
• *Wasserhahn 1 rechts* → *Tomatenbewässerung* (Ventil + Pumpe, mit Sicherheits-Check)

*Gustav-Befehle:*
• *giesse beet* / *giesse die blumen* → Beet
• *giesse salat* / *giesse schlauch* / *giesse links* → Salatbeete
• *giesse tomaten* / *giesse rechts* → Tomaten (+ Pumpe)
• *pumpe an* → Tomaten-Zone
• *garten status* / *bewässerung zonen* → Überblick
• *bewässerung stopp* → alles stoppen

💡 Beide Wasserhähne können weiterhin *handbetätigt* geöffnet und geschlossen werden – die Smart-Steuerung kommt zusätzlich dazu.

Fragen? Einfach antworten! 🌿`;

const MSG_FR = (name) =>
  `🦆 *Gustav · Nouvel arrosage du jardin*

Salut ${name}! 👋 On a maintenant *deux modes* pour arroser :

*1) Automatique via le site*
• Planning hebdomadaire par zone (fuseau Zurich)
• Météo : si pluie prévue (±6 h), l'arrosage est sauté automatiquement
• Site → Calendrier → *Jardin* → activer l'automatique + choisir la zone

*2) Manuel* (site ou WhatsApp)
• Site : « Jetzt bewässern » / « Bewässerung stoppen » (zone active)
• Ou écris-moi (Gustav) :

*Robinets & zones :*
• *Robinet 2 (hivernacle)* → *Plates-bandes* (vanne seule)
• *Robinet 1 gauche* → *Tuyau de jardin* (vanne seule)
• *Robinet 1 droite* → *Tomates* (vanne + pompe, avec contrôle de sécurité)

*Commandes Gustav :*
• *giesse beet* / *giesse die blumen* → plates-bandes
• *giesse schlauch* / *giesse links* → tuyau
• *giesse tomaten* / *giesse rechts* → tomates (+ pompe)
• *pumpe an* → zone tomates
• *garten status* / *bewässerung zonen* → aperçu
• *bewässerung stopp* → tout arrêter

💡 Les robinets physiques peuvent toujours être ouverts/fermés *à la main* – la smart-steuerung est en plus.

Des questions ? Réponds-moi ! 🌿`;

const RECIPIENTS = [
  { name: "Corina", lang: "ch", msg: MSG_CH("Corina") },
  { name: "Jasmin", lang: "ch", msg: MSG_CH("Jasmin") },
  { name: "Dino", lang: "ch", msg: MSG_CH("Dino") },
  { name: "Andi", lang: "de", msg: MSG_DE("Andi") },
  { name: "Manu", lang: "de", msg: MSG_DE("Manu") },
  { name: "Hugues", lang: "de", msg: MSG_DE("Hugues") },
  { name: "Fannie", lang: "fr", msg: MSG_FR("Fannie") },
];

async function resolvePhoneId() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: "haus-am-see-d91ef" });
  }
  const snap = await admin.firestore().collection("config").doc("whatsappMeta").get();
  const fromFs = snap.exists ? snap.data()?.phoneNumberId : null;
  if (fromFs) return String(fromFs);
  const envId = process.env.WHATSAPP_PHONE_ID;
  if (!envId) throw new Error("Keine phoneNumberId in Firestore oder .env");
  return String(envId);
}

async function sendWhatsApp(to, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = await resolvePhoneId();
  if (!token || !phoneId) throw new Error("WHATSAPP_TOKEN oder Phone-ID fehlt");
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(to).replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: text.slice(0, 4000) },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  return true;
}

async function main() {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  for (const r of RECIPIENTS) {
    const phone = PHONES[r.name];
    if (!phone) {
      results.push({ name: r.name, ok: false, error: "keine Nummer" });
      continue;
    }
    try {
      await sendWhatsApp(phone, r.msg);
      results.push({ name: r.name, ok: true, lang: r.lang });
      console.log(`✓ ${r.name} (${r.lang})`);
    } catch (e) {
      results.push({ name: r.name, ok: false, error: e.message });
      console.error(`✗ ${r.name}: ${e.message}`);
    }
    await delay(1500);
  }
  const ok = results.filter((x) => x.ok).length;
  console.log(`\nFertig: ${ok}/${results.length} gesendet`);
  if (ok < results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
