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
    file: "beet-giessen",
    name: "Beet gießen",
    phrase: "Beet gießen",
    desc: "Beetbewässerung · Wasserhahn 2 · 20 Min · nur Ventil",
    color: 4282601983,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh2-wintergarten"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "salat-giessen",
    name: "Salat gießen",
    phrase: "Salat gießen",
    desc: "Salatbeete · Wasserhahn 1 links · 20 Min · nur Ventil",
    color: 4292093695,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh1-salat"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "tomaten-giessen",
    name: "Tomaten gießen",
    phrase: "Tomaten gießen",
    desc: "Tomatenbewässerung · Wasserhahn 1 rechts · mit Pumpe · 20 Min",
    color: 4251333119,
    webhookUrl: q([["action", "garten"], ["cmd", "start"], ["zoneId", "wh1-rechts"], ["minutes", "20"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "bewaesserung",
    file: "bewaesserung-stoppen",
    name: "Bewässerung stoppen",
    phrase: "Bewässerung stoppen",
    desc: "Stoppt Pumpe und alle Ventile sofort",
    color: 463140863,
    webhookUrl: q([["action", "garten"], ["cmd", "stop"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "licht",
    categoryLabel: "Lichterkette",
    file: "lichterkette-an",
    name: "Lichterkette an",
    phrase: "Lichterkette an",
    desc: "Lichterkette im Garten einschalten",
    color: 2071128575,
    webhookUrl: q([["action", "licht"], ["cmd", "an"], ["format", "plain"], ["secret", SECRET]]),
  },
  {
    category: "licht",
    file: "lichterkette-aus",
    name: "Lichterkette aus",
    phrase: "Lichterkette aus",
    desc: "Lichterkette im Garten ausschalten",
    color: 2846468607,
    webhookUrl: q([["action", "licht"], ["cmd", "aus"], ["format", "plain"], ["secret", SECRET]]),
  },
];

module.exports = { SECRET, BASE, PLAIN, CATALOG };
