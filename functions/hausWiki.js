/**
 * Haus-Wiki: Antworten aus config/hausWiki + roomOffer (ohne Halluzination).
 */

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

const DEFAULT_WIKI = {
  muell: "Mülltonnen beim Carport. Kehricht/Altpapier/Grüngut getrennt – Details am schwarzen Plan im Gang.",
  wlan: "WLAN-Name und Passwort stehen im WG-Intern-Bereich der Website (nach Login).",
  notfall: "Notfall: 117 (Polizei), 118 (Feuer), 144 (Sanität). Vermieterin (Schelly) über die WG.",
  adresse: "Haus am See, Pilatusstrasse 40, 8330 Pfäffikon ZH.",
};

function parseWikiQuery(raw) {
  const low = String(raw || "").toLowerCase();
  if (/\b(wlan|wifi|passwort|internet)\b/i.test(low)) return { key: "wlan" };
  if (/\b(müll|muell|abfall|kehricht|entsorgung)\b/i.test(low)) return { key: "muell" };
  if (/\b(notfall|nummer|polizei|feuerwehr)\b/i.test(low)) return { key: "notfall" };
  if (/\b(adresse|wo\s+wohn|pfäffikon|pfaefikon)\b/i.test(low)) return { key: "adresse" };
  if (/\b(haus\s*wiki|wg\s*wiki|infos?\s+zum\s+haus)\b/i.test(low)) return { key: "_index" };
  return null;
}

async function buildWikiReply(db, query) {
  const q = typeof query === "string" ? parseWikiQuery(query) : query;
  if (!q) return null;

  let wiki = { ...DEFAULT_WIKI };
  try {
    const snap = await db.doc("config/hausWiki").get();
    if (snap.exists) wiki = { ...wiki, ...snap.data() };
  } catch {
    /* defaults */
  }

  if (q.key === "_index") {
    const keys = Object.keys(wiki);
    const lines = keys.map((k) => `• *${k}* – frag einfach «${k}?»`);
    return `📖 *Haus-Wiki*\n\n${lines.join("\n")}\n\n🌐 ${WEBSITE_URL}/#wg-intern`;
  }

  const text = wiki[q.key];
  if (!text) return null;
  const titles = {
    wlan: "📶 WLAN",
    muell: "🗑️ Müll",
    notfall: "🚨 Notfall",
    adresse: "📍 Adresse",
  };
  return `${titles[q.key] || "📖 Info"}\n\n${text}\n\n🌐 ${WEBSITE_URL}`;
}

module.exports = { parseWikiQuery, buildWikiReply, DEFAULT_WIKI };
