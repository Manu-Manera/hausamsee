/**
 * Einmalige Bewässerungs-Ankündigung an alle WG-Erwachsenen (personalisierte Sprache).
 */

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
  { name: "Corina", msg: MSG_CH("Corina") },
  { name: "Jasmin", msg: MSG_CH("Jasmin") },
  { name: "Dino", msg: MSG_CH("Dino") },
  { name: "Andi", msg: MSG_DE("Andi") },
  { name: "Manu", msg: MSG_DE("Manu") },
  { name: "Hugues", msg: MSG_DE("Hugues") },
  { name: "Fannie", msg: MSG_FR("Fannie") },
];

async function sendBewaesserungAnnounce({ getBewohnerPhone, sendWhatsApp, logger, onlyName = null } = {}) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const list = onlyName ? RECIPIENTS.filter((r) => r.name === onlyName) : RECIPIENTS;
  for (const r of list) {
    const phone = await getBewohnerPhone(r.name);
    if (!phone) {
      results.push({ name: r.name, ok: false, error: "keine Telefonnummer" });
      continue;
    }
    try {
      const ok = await sendWhatsApp(phone, r.msg);
      results.push({ name: r.name, ok: !!ok, phone: phone.slice(-4) });
      if (!ok) results[results.length - 1].error = "Versand fehlgeschlagen";
      await delay(1200);
    } catch (e) {
      results.push({ name: r.name, ok: false, error: e.message });
    }
  }
  const sent = results.filter((x) => x.ok).length;
  logger.info(`Bewässerung-Ankündigung: ${sent}/${results.length}`, { results });
  return { sent, total: results.length, results };
}

module.exports = { sendBewaesserungAnnounce, RECIPIENTS };
