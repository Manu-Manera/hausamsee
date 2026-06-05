/**
 * Geburtstags- & Jubiläums-Erinnerungen (memberPrefs.birthDate als MM-DD oder YYYY-MM-DD).
 */

const GIFT_IDEAS = [
  "🎁 Blumen oder Pflanze fürs Zimmer",
  "🍫 Lieblings-Schoki oder Gipfeli-Frühstück",
  "🎮 Gutschein fürs gemeinsame Spieleabend-Snack",
  "🍷 Flasche Wein/Saft für den Abend am See",
  "📸 Collage mit WG-Fotos",
  "🧁 Selbst gebackener Kuchen",
  "🎵 Playlist «Happy Birthday» in der Haus-Musik",
];

function parseBirthDate(raw) {
  const s = String(raw || "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return { month: +iso[2], day: +iso[3], year: +iso[1] };
  const md = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (md) return { month: +md[2] || +md[1], day: +md[1] || +md[2], year: null };
  const md2 = s.match(/^(\d{2})-(\d{2})$/);
  if (md2) return { month: +md2[1], day: +md2[2], year: null };
  return null;
}

function isBirthdayOn(date, birth, offsetDays = 0) {
  if (!birth) return false;
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  const zurich = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const m = +zurich.find((p) => p.type === "month").value;
  const day = +zurich.find((p) => p.type === "day").value;
  return m === birth.month && day === birth.day;
}

function ageTurning(birth, yearNow) {
  if (!birth.year || !yearNow) return null;
  return yearNow - birth.year;
}

function pickGiftIdea(name, seed = 0) {
  const idx = (name.charCodeAt(0) + seed) % GIFT_IDEAS.length;
  return GIFT_IDEAS[idx];
}

function buildBirthdayMessage(name, { tomorrow = false, age = null } = {}) {
  const when = tomorrow ? "morgen" : "heute";
  const ageLine = age != null ? ` – wird *${age}*!` : "";
  const gift = pickGiftIdea(name, tomorrow ? 1 : 0);
  return (
    `🎂 *Geburtstag ${when}!*\n\n` +
    `*${name}* hat ${when} Geburtstag${ageLine} 🎉\n\n` +
    `💡 Geschenk-Idee: ${gift}\n\n` +
    `_Geburtstag in Profil-Einstellungen (MM-TT) pflegen_`
  );
}

function parseBirthdaySetCommand(raw, resident) {
  const s = String(raw || "").trim();
  const m = s.match(/^geburtstag\s*(?:setzen|eintragen)?\s*[:\-–]?\s*(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{4})?)\s*$/i);
  if (!m || !resident) return null;
  const bd = parseBirthDate(m[1]);
  if (!bd) return null;
  const iso =
    bd.year != null
      ? `${bd.year}-${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`
      : `${String(bd.month).padStart(2, "0")}-${String(bd.day).padStart(2, "0")}`;
  return { birthDate: iso, resident };
}

module.exports = {
  parseBirthDate,
  isBirthdayOn,
  ageTurning,
  buildBirthdayMessage,
  parseBirthdaySetCommand,
  pickGiftIdea,
};
