/**
 * Mitbringen-Liste, Kino-heute, Bewerber-Status, Poll-Deadline, Erinner-Buttons.
 */

const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

/* --- Mitbringen --- */

function parseBringCommand(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^mitbringen\s*[:\-–]\s*(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "add", eventHint: m[1].trim(), item: m[2].trim() };
  m = s.match(/^wer\s+bringt\s+was\s*(?:zu|zum|bei)?\s*(.+?)\s*[?.!]*$/i);
  if (m) return { action: "list", eventHint: m[1].trim() };
  m = s.match(/^mitbringen\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "add", eventHint: m[1].trim(), item: m[2].trim() };
  return null;
}

async function addBringItem(db, { eventId, eventTitle, who, item }) {
  await db.collection("eventBring").add({
    eventId: eventId || "",
    eventTitle: eventTitle || "",
    who: who || "",
    item: String(item || "").slice(0, 120),
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function listBringItems(db, eventId) {
  const snap = await db.collection("eventBring").where("eventId", "==", eventId).get();
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items;
}

function formatBringList(eventTitle, items) {
  if (!items.length) {
    return `🥗 *Wer bringt was – ${eventTitle}*\n\nNoch niemand eingetragen.\n\n_Mitbringen Spieleabend: Salat_`;
  }
  const lines = items.map((x) => `• *${x.who}*: ${x.item}`);
  return `🥗 *Wer bringt was – ${eventTitle}*\n\n${lines.join("\n")}`;
}

/* --- Kino heute --- */

function parseKinoHeuteCommand(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^kino\s+heute\s+(.+)$/i);
  if (!m) return null;
  const title = m[1].trim().replace(/\?+$/, "");
  if (!title) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(20, 0, 0, 0);
  if (start.getTime() < now.getTime()) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setHours(22, 30, 0, 0);
  return { title, startAt: start, endAt: end };
}

/* --- Bewerber Status --- */

const KANDIDAT_STATUS = new Set([
  "offen", "eingeladen", "kennengelernt", "zusage", "abgesagt", "eingezogen", "abgelehnt",
]);

const STATUS_LABEL = {
  offen: "⏳ Offen",
  eingeladen: "📩 Eingeladen",
  kennengelernt: "🤝 Kennengelernt",
  zusage: "💚 Zusage",
  abgesagt: "❌ Abgesagt",
  eingezogen: "🏠 Eingezogen",
  abgelehnt: "🚫 Abgelehnt",
};

function parseBewerberStatusCommand(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^bewerber\s+status\s*[:\-–]\s*(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) {
    const status = m[2].trim().toLowerCase();
    if (KANDIDAT_STATUS.has(status)) return { action: "set", name: m[1].trim(), status };
  }
  m = s.match(/^bewerber\s+(.+?)\s*$/i);
  if (m && !/^(liste|status|innen)$/i.test(m[1])) return { action: "show", name: m[1].trim() };
  return null;
}

function formatBewerberDetail(k) {
  const st = STATUS_LABEL[k.status] || k.status;
  const lines = [
    `🚪 *${k.name}*`,
    `Status: ${st}`,
    k.alter ? `Alter: ${k.alter}` : "",
    k.kontakt ? `📞 ${k.kontakt}` : "",
    k.info ? `ℹ️ ${k.info.slice(0, 200)}${k.info.length > 200 ? "…" : ""}` : "",
    "",
    `${WEBSITE_URL}/#kandidaten`,
  ].filter(Boolean);
  return lines.join("\n");
}

/* --- Poll Deadline --- */

function parsePollDeadline(whenLabel, extraPart) {
  const parts = [whenLabel, extraPart].filter(Boolean).join(" ");
  const m = parts.match(/\bbis\s+(.+?)(?:\s*\||$)/i) || parts.match(/\bdeadline\s+(.+)$/i);
  if (!m) return null;
  return m[1].trim();
}

/* --- Erinner-Button Token --- */

async function createRemindButtonToken(db, { from, text, dateIso, resident }) {
  const token = crypto.randomBytes(10).toString("hex");
  await db.collection("gustavRemindPending").doc(token).set({
    from: String(from || "").replace(/\D/g, ""),
    text: String(text || "").slice(0, 500),
    date: dateIso,
    resident: resident || "",
    createdAt: FieldValue.serverTimestamp(),
  });
  return token;
}

async function consumeRemindButtonToken(db, token) {
  const ref = db.collection("gustavRemindPending").doc(String(token || ""));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  await ref.delete();
  return data;
}

module.exports = {
  parseBringCommand,
  addBringItem,
  listBringItems,
  formatBringList,
  parseKinoHeuteCommand,
  parseBewerberStatusCommand,
  formatBewerberDetail,
  KANDIDAT_STATUS,
  STATUS_LABEL,
  parsePollDeadline,
  createRemindButtonToken,
  consumeRemindButtonToken,
};
