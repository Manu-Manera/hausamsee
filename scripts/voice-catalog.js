/** Gemeinsamer Katalog für iOS-Kurzbefehle, Android-cURL und die Download-Seite. */
const SECRET = "HausAmSee2026Garten";
const BASE = "https://siriwebhook-dcl7qtm3uq-ew.a.run.app";
const PLAIN = "format=plain";

function q(params) {
  return `${BASE}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

const CATALOG = [
  {
    category: "bewaesserung",
    categoryLabel: "Bewässerung",
    file: "gustav-beet-giessen",
    name: "Gustav Beet gießen",
    phrase: "Gustav Beet gießen",
    desc: "Beetbewässerung · Wasserhahn 2 · 20 Min · nur Ventil",
    color: 4282601983,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh2-wintergarten"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-salat-giessen",
    name: "Gustav Salat gießen",
    phrase: "Gustav Salat gießen",
    desc: "Salatbeete · Wasserhahn 1 links · 20 Min · nur Ventil",
    color: 4292093695,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh1-salat"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-tomaten-giessen",
    name: "Gustav Tomaten gießen",
    phrase: "Gustav Tomaten gießen",
    desc: "Tomatenbewässerung · Wasserhahn 1 rechts · mit Pumpe · 20 Min",
    color: 4251333119,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh1-rechts"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-bewaesserung-stoppen",
    name: "Gustav Bewässerung stoppen",
    phrase: "Gustav Bewässerung stoppen",
    desc: "Stoppt Pumpe und alle Ventile sofort",
    color: 463140863,
    webhookUrl: q([["action", "garten"], ["cmd", "stop"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-bewaesserung-status",
    name: "Gustav Bewässerung Status",
    phrase: "Gustav Bewässerung Status",
    desc: "Status aller Bewässerungszonen",
    color: 1440408063,
    webhookUrl: q([["action", "garten"], ["cmd", "status"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-beet-status",
    name: "Gustav Beet Status",
    phrase: "Gustav Beet Status",
    desc: "Status Beetbewässerung",
    color: 4282601983,
    webhookUrl: q([["action", "garten"], ["cmd", "status"], ["zoneId", "wh2-wintergarten"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-salat-status",
    name: "Gustav Salat Status",
    phrase: "Gustav Salat Status",
    desc: "Status Salatbeete",
    color: 4292093695,
    webhookUrl: q([["action", "garten"], ["cmd", "status"], ["zoneId", "wh1-salat"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-tomaten-status",
    name: "Gustav Tomaten Status",
    phrase: "Gustav Tomaten Status",
    desc: "Status Tomatenbewässerung",
    color: 4251333119,
    webhookUrl: q([["action", "garten"], ["cmd", "status"], ["zoneId", "wh1-rechts"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "gustav-bewaesserungszonen",
    name: "Gustav Bewässerungszonen",
    phrase: "Gustav Bewässerungszonen",
    desc: "Liste aller Zonen vorlesen",
    color: 431817727,
    webhookUrl: q([["action", "garten"], ["cmd", "zones"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "licht",
    categoryLabel: "Licht",
    file: "gustav-licht-an",
    name: "Gustav Licht an",
    phrase: "Gustav Licht an",
    desc: "Lichterkette einschalten",
    color: 2071128575,
    webhookUrl: q([["action", "licht"], ["cmd", "an"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "licht",
    file: "gustav-licht-aus",
    name: "Gustav Licht aus",
    phrase: "Gustav Licht aus",
    desc: "Lichterkette ausschalten",
    color: 2846468607,
    webhookUrl: q([["action", "licht"], ["cmd", "aus"], ["format", "plain"], ["secret", SECRET]]),
  },
];

module.exports = { SECRET, BASE, PLAIN, CATALOG };
