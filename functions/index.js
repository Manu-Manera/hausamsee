/**
 * Haus am See – Cloud Functions (WhatsApp Bot + Kontakt-Forwarding + Scheduler)
 *
 * Features:
 *   • Events anlegen / löschen / auflisten
 *   • Putzplan: eintragen, Woche anzeigen
 *   • Anwesenheit (Wochenende): Status setzen, Liste
 *   • Schäden melden (inkl. Foto)
 *   • RSVP zu Events
 *   • Foto-Upload in Galerie / Event-Fotos
 *   • Gästebuch-Eintrag
 *   • Erinnerungen (Datum + Uhrzeit)
 *   • Daily Digest (Montag 8 Uhr)
 *   • Kontaktformular → WhatsApp-Gruppe
 *
 *  Bot-Ansprache in Gruppen: Nachricht beginnt mit "@bot", "!bot", "haus am see",
 *  oder "bot" (case-insensitive). In Privatchats reagiert er immer.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/* ==========================================================================
   Konstanten
   ========================================================================== */

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

const BEWOHNER = ["Corina", "Jasmin", "Dino", "Andy", "Manu", "Hugues", "Fanny", "Elliot", "Oscar"];
const KIDS = new Set(["Elliot", "Oscar"]);
const ADULTS = BEWOHNER.filter((n) => !KIDS.has(n));

// Nachrichten die mit einem dieser Tokens beginnen → direkt an den Bot gerichtet (in Gruppen)
const BOT_MENTIONS = ["@bot", "!bot", "/bot", "haus am see bot", "haus am see", "@haus", "bot,", "bot:", "bot "];

/* ==========================================================================
   Config
   ========================================================================== */

function cfg() {
  return {
    token: process.env.WHATSAPP_TOKEN || "",
    phoneId: process.env.WHATSAPP_PHONE_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    recipients: (process.env.WHATSAPP_GROUP_RECIPIENTS || "")
      .split(",").map((s) => s.trim()).filter(Boolean),
  };
}

async function debugLog(kind, data) {
  try {
    await db.collection("whatsapp_debug").add({
      kind, ...data, at: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.error("debugLog failed", e);
  }
}

/* ==========================================================================
   WhatsApp API (send text / download media)
   ========================================================================== */

async function sendWhatsApp(to, text) {
  const { token, phoneId } = cfg();
  if (!token || !phoneId) {
    await debugLog("send_skipped", { to, reason: "no_token_or_phone_id" });
    return;
  }
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4000) },
      }),
    });
  } catch (e) {
    await debugLog("send_crash", { to, error: String(e) });
    return;
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    await debugLog("send_failed", { to, status: res.status, response: bodyText.slice(0, 2000) });
  } else {
    await debugLog("send_ok", { to, status: res.status });
  }
}

async function broadcast(text) {
  const { recipients } = cfg();
  if (!recipients.length) return;
  await Promise.all(recipients.map((r) => sendWhatsApp(r, text)));
}

async function downloadMedia(mediaId) {
  const { token } = cfg();
  if (!token || !mediaId) return null;
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      await debugLog("media_meta_failed", { mediaId, status: metaRes.status });
      return null;
    }
    const meta = await metaRes.json();
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) {
      await debugLog("media_download_failed", { mediaId, status: binRes.status });
      return null;
    }
    const buf = Buffer.from(await binRes.arrayBuffer());
    const mimeType = meta.mime_type || "image/jpeg";
    if (buf.length > 3_500_000) {
      await debugLog("media_too_big", { mediaId, size: buf.length });
      return null;
    }
    return `data:${mimeType};base64,${buf.toString("base64")}`;
  } catch (e) {
    await debugLog("media_error", { mediaId, error: String(e) });
    return null;
  }
}

/* ==========================================================================
   Helpers: Bewohner, Datum, Uhrzeit
   ========================================================================== */

function resolveResident(input, onlyAdults = false) {
  if (!input) return null;
  const needle = String(input).toLowerCase().trim();
  const pool = onlyAdults ? ADULTS : BEWOHNER;
  const exact = pool.find((n) => n.toLowerCase() === needle);
  if (exact) return exact;
  const starts = pool.find((n) => n.toLowerCase().startsWith(needle));
  if (starts) return starts;
  const contains = pool.find((n) => n.toLowerCase().includes(needle));
  return contains || null;
}

function startOfDay(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x;
}

function toISODate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("de-CH", { dateStyle: "short", timeStyle: "short" });
}

const WEEKDAYS = {
  so: 0, sonntag: 0,
  mo: 1, montag: 1,
  di: 2, dienstag: 2,
  mi: 3, mittwoch: 3,
  do: 4, donnerstag: 4,
  fr: 5, freitag: 5,
  sa: 6, samstag: 6,
};

// Parse Datum aus einem Token: "heute", "morgen", "Mo", "15.8.", "15.8.2026", "3/8"
function parseLooseDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/\.$/, "");
  const now = new Date();
  if (s === "heute") return startOfDay(now);
  if (s === "morgen") { const d = new Date(now); d.setDate(d.getDate() + 1); return startOfDay(d); }
  if (s === "übermorgen" || s === "uebermorgen") {
    const d = new Date(now); d.setDate(d.getDate() + 2); return startOfDay(d);
  }
  if (s in WEEKDAYS) {
    const target = WEEKDAYS[s];
    const d = new Date(now);
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return startOfDay(d);
  }
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    let yyyy = m[3] ? parseInt(m[3], 10) : now.getFullYear();
    if (yyyy < 100) yyyy += 2000;
    const d = new Date(yyyy, mm - 1, dd);
    if (isNaN(d.getTime())) return null;
    if (!m[3] && d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
    return d;
  }
  return null;
}

// Finde Datum in einem Satz; return {date, cleaned} – cleaned ist der Rest ohne das Datum
function extractDate(rest) {
  const re = /(?:\bam\s+)?\b(heute|morgen|übermorgen|uebermorgen|so|mo|di|mi|do|fr|sa|sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)\b|(?:\bam\s+)?\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\.?/i;
  const m = rest.match(re);
  if (!m) return { date: null, cleaned: rest };
  const token = m[1] ? m[1] : `${m[2]}.${m[3]}${m[4] ? "." + m[4] : "."}`;
  const date = parseLooseDate(token);
  if (!date) return { date: null, cleaned: rest };
  return { date, cleaned: rest.replace(m[0], " ") };
}

// Extrahiere Uhrzeit aus Satz; return {hh, mi, cleaned}
function extractTime(rest) {
  const colon = rest.match(/(?:\bum\s+)?\b(\d{1,2})[:.h](\d{2})\b/i);
  const uhr = rest.match(/(?:\bum\s+)?\b(\d{1,2})\s*(?:uhr|h)\b/i);
  const um = rest.match(/\bum\s+(\d{1,2})\b(?!\s*(?:uhr|:|\.|h))/i);

  let hh = null, mi = 0, raw = null;
  if (colon) { hh = +colon[1]; mi = +colon[2]; raw = colon[0]; }
  else if (uhr) { hh = +uhr[1]; raw = uhr[0]; }
  else if (um) { hh = +um[1]; raw = um[0]; }

  if (hh === null || isNaN(hh) || hh > 23) return { hh: null, mi: 0, cleaned: rest };
  if (isNaN(mi) || mi > 59) mi = 0;
  return { hh, mi, cleaned: rest.replace(raw, " ") };
}

function cleanTail(s) {
  return (s || "").replace(/\s{2,}/g, " ")
    .replace(/^[\s.,;:\-–|]+|[\s.,;:\-–|]+$/g, "")
    .trim();
}

/* ==========================================================================
   Parser
   ========================================================================== */

// Entfernt Bot-Mentions ("@bot", "haus am see", …) und liefert true, falls welche da waren
function stripBotMention(text) {
  let s = String(text || "").trim();
  const lower = s.toLowerCase();
  for (const m of BOT_MENTIONS) {
    if (lower.startsWith(m)) {
      s = s.slice(m.length).trim();
      return { addressed: true, text: s.replace(/^[,:\s\-–]+/, "") };
    }
  }
  return { addressed: false, text: s };
}

// "Neues Event: Sommerfest 15.8. 18 Uhr | Beschreibung"
function parseEventMessage(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const trigger = /^(?:neue[rs]?\s+)?(event|termin|anlass|party|geburtstag|apero)\s*[:\-–]?\s*/i;
  const triggerMatch = text.match(trigger);
  if (!triggerMatch) return null;
  const triggerWord = triggerMatch[1].charAt(0).toUpperCase() + triggerMatch[1].slice(1);
  let rest = text.replace(trigger, "");

  const { date, cleaned: afterDate } = extractDate(rest);
  if (!date) return null;
  rest = afterDate;

  const { hh, mi, cleaned: afterTime } = extractTime(rest);
  rest = afterTime;

  rest = rest.replace(/\s{2,}/g, " ").trim();
  const parts = rest.split("|").map((s) => cleanTail(s));
  const mainTitle = parts[0] || triggerWord;
  const description = parts.slice(1).join(" | ").trim();

  const d = new Date(date);
  d.setHours(hh === null ? 19 : hh, mi, 0, 0);

  return {
    title: (mainTitle || triggerWord).slice(0, 120),
    date: d.toISOString(),
    description: description.slice(0, 500),
    location: "",
    emoji: "🎉",
  };
}

// "Event löschen: Sommerfest"
function parseDeleteMessage(raw) {
  if (!raw) return null;
  const re = /^(?:(?:event|termin)\s+)?(?:lösch(?:en|e)?|delete|entferne?n?|streich(?:en|e)?)\s*(?:event|termin)?\s*[:\-–]?\s*(.+)$/i;
  const m = String(raw).trim().match(re);
  if (!m) return null;
  const title = m[1].trim().replace(/^["'»]+|["'«]+$/g, "");
  return title ? { title } : null;
}

function isListEventsCommand(raw) {
  return /^(events?|termine?|liste|anstehendes)\s*(auflisten|anzeigen|zeigen)?\s*[?.!]*$/i.test(String(raw).trim());
}

// "Putz: Manu 20.4. Küche" oder "Putzen Manu 20.4."
function parsePutzAdd(raw) {
  const s = String(raw).trim();
  const re = /^(?:neu(?:er|e|es)?\s+)?(?:putz(?:plan|en|tag)?)\s*[:\-–]?\s*(.+)$/i;
  const m = s.match(re);
  if (!m) return null;
  let rest = m[1];

  const { date, cleaned } = extractDate(rest);
  if (!date) return null;
  rest = cleaned;

  // Erstes Wort = Bewohner, Rest = Aufgabe
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const who = resolveResident(tokens[0], true);
  const task = who ? tokens.slice(1).join(" ").trim() : tokens.join(" ").trim();

  return {
    task: (task || "Putzen").slice(0, 100),
    who: who || "",
    when: toISODate(date),
  };
}

function isPutzListCommand(raw) {
  return /^(wer\s+putzt|putzplan|putz\s*liste|putz\s*woche)\s*[?.!]*$/i.test(String(raw).trim());
}

// "Bin weg 1.5." | "Bin weg 1.5.-8.5." | "Bin da" | "Bin heute weg" | "Bin übers WE weg"
function parseAnwesenheit(raw) {
  const s = String(raw).trim();
  const m = s.match(/^(?:ich\s+)?(?:bin|i'?m)\s+(.+)$/i);
  if (!m) return null;
  const rest = m[1];
  const isWeg = /\b(weg|fort|nicht\s+da|nicht\s+zuhause|ausser\s*haus|away|out)\b/i.test(rest);
  const isDa = /\b(da|hier|zuhause|home)\b/i.test(rest);
  if (!isWeg && !isDa) return null;
  const status = isWeg ? "weg" : "da";
  const { date } = extractDate(rest);
  return {
    status,
    date: date || startOfDay(new Date()),
  };
}

function isAnwesenheitListCommand(raw) {
  const s = String(raw).trim();
  return /^(wer\s+ist\s+(heute\s+)?(da|hier|zuhause|weg|wo)|anwesenheit|wer\s+ist\s+am\s+wochenende(\s+(da|weg))?|wer\s+ist\s+zuhause)\s*[?.!]*$/i.test(s);
}

// "Schaden: Waschmaschine tropft | Küche | hoch"
function parseSchadenMessage(raw) {
  const re = /^schaden(?:\s+melden)?\s*[:\-–]?\s*(.+)$/i;
  const m = String(raw).trim().match(re);
  if (!m) return null;
  const parts = m[1].split("|").map((s) => s.trim());
  const titel = parts[0] || "";
  if (!titel) return null;
  const ort = parts[1] || "";
  const prioRaw = (parts[2] || "").toLowerCase();
  let prio = "medium";
  if (/(niedrig|low|klein)/.test(prioRaw)) prio = "low";
  else if (/(hoch|high|dringend|urgent)/.test(prioRaw)) prio = "high";
  return {
    titel: titel.slice(0, 120),
    ort: ort.slice(0, 80),
    beschreibung: (parts.slice(3).join(" | ") || "").slice(0, 500),
    prio,
  };
}

function isSchadenListCommand(raw) {
  return /^(schäden?|schaden\s*liste|offene\s+schäden)\s*[?.!]*$/i.test(String(raw).trim());
}

// "Ja Sommerfest", "Nein Bierkastenlauf", "Zu Sommerfest: ja"
function parseRSVPMessage(raw) {
  const s = String(raw).trim();
  // "Ja/Nein <title>"
  let m = s.match(/^(ja|nein|yes|no|maybe|vielleicht|zusage|absage|dabei|nicht\s+dabei)\s+(?:zu[rm]?\s+|for\s+)?(.+)$/i);
  if (m) {
    const yes = /(ja|yes|zusage|dabei)/i.test(m[1]) && !/nicht/i.test(m[1]);
    return { wantsIn: yes, title: m[2].trim() };
  }
  return null;
}

function parseRSVPListCommand(raw) {
  const m = String(raw).trim().match(/^wer\s+kommt\s+(?:zu[rm]?\s+|zum\s+)?(.+?)\s*[?.!]*$/i);
  return m ? { title: m[1].trim() } : null;
}

// "Foto: Hausbild Garten" oder "Foto Sommerfest" — gilt wenn Bild mit Caption
function parseFotoCommand(caption) {
  if (!caption) return null;
  const s = String(caption).trim();
  const m = s.match(/^(?:foto|bild|pic)\s*[:\-–]?\s*(.+)$/i);
  if (!m) return null;
  const target = m[1].trim();
  // "hausbild Garten" → hausbild-feature
  const houseMatch = target.match(/^hausbild\s+(.+)$/i);
  if (houseMatch) {
    return { kind: "hausbild", featureId: houseMatch[1].toLowerCase().trim() };
  }
  // "Bewerber Lisa" / "Kandidat Tom" → Kandidat-Foto
  const bewMatch = target.match(/^(?:bewerber(?:in)?|kandidat(?:in)?)\s+(.+)$/i);
  if (bewMatch) {
    return { kind: "kandidat", name: bewMatch[1].trim() };
  }
  // sonst: ist es ein Event-Titel?
  return { kind: "event-or-galerie", target };
}

// "Gästebuch: ..."
function parseGaestebuchMessage(raw) {
  const m = String(raw).trim().match(/^(?:gäste?buch|guestbook)\s*[:\-–]?\s*(.+)$/is);
  return m ? { text: m[1].trim() } : null;
}

// "Bewerber: Lisa, 25 | Studentin, super sympatisch | +41 79 123 45 67"
// "Kandidat Tom | cooler Typ | tom@example.com"
function parseBewerberMessage(raw) {
  const re = /^(?:neue[rs]?\s+)?(bewerber|bewerberin|kandidat|kandidatin|zimmer\s*bewerber)\s*[:\-–]?\s*(.+)$/is;
  const m = String(raw).trim().match(re);
  if (!m) return null;
  const parts = m[2].split("|").map((s) => s.trim());
  const head = parts[0] || "";
  if (!head) return null;

  // "Lisa, 25" oder "Lisa 25" – Alter optional
  const nameAge = head.match(/^(.+?)[,;]?\s+(\d{1,2})\s*$/);
  let name = head, alter = null;
  if (nameAge) {
    name = nameAge[1].trim();
    const a = parseInt(nameAge[2], 10);
    if (a >= 16 && a <= 120) alter = a;
    else name = head;
  }
  return {
    name: name.slice(0, 80),
    alter,
    info: (parts[1] || "").slice(0, 500),
    kontakt: (parts[2] || "").slice(0, 200),
  };
}

function isBewerberListCommand(raw) {
  return /^(bewerber(\s*liste)?|bewerberinnen|kandidat(en|innen)?(\s*liste)?|zimmer\s*bewerber)\s*[?.!]*$/i.test(String(raw).trim());
}

// "Erinner mich am 30.4. um 8:00 an: Rechnung zahlen"
function parseErinnerungMessage(raw) {
  const re = /^(?:erinner(?:e|ung)?\s*(?:mich|uns)?|reminde?r?)\s*(?:am\s+)?(.+?)(?:\s+(?:an|für|zu|to))\s*[:\-–]?\s*(.+)$/i;
  const m = String(raw).trim().match(re);
  if (!m) return null;
  const when = m[1];
  const what = m[2].trim();

  // Erst Datum, dann Zeit aus "when"
  let { date, cleaned } = extractDate(when);
  if (!date) date = startOfDay(new Date());
  const { hh, mi } = extractTime(cleaned);
  const d = new Date(date);
  d.setHours(hh === null ? 9 : hh, mi, 0, 0);
  if (d < new Date()) return null;

  return { date: d.toISOString(), text: what.slice(0, 500) };
}

/* ==========================================================================
   Firestore-Operationen
   ========================================================================== */

async function createEvent(payload, author) {
  const doc = { ...payload, createdBy: `whatsapp:${author || "unknown"}`, source: "whatsapp", createdAt: FieldValue.serverTimestamp() };
  const ref = await db.collection("events").add(doc);
  return ref.id;
}

async function deleteEventByTitle(title) {
  const snap = await db.collection("events").get();
  const needle = title.toLowerCase();
  const matches = [];
  snap.forEach((doc) => {
    const t = String(doc.data()?.title || "").toLowerCase();
    if (t && (t === needle || t.includes(needle) || needle.includes(t))) {
      matches.push({ id: doc.id, title: doc.data()?.title, date: doc.data()?.date });
    }
  });
  if (!matches.length) return { deleted: 0, matches: [] };
  const exact = matches.find((m) => String(m.title).toLowerCase() === needle);
  const chosen = exact ? [exact] : matches;
  await Promise.all(chosen.map((m) => db.collection("events").doc(m.id).delete()));
  return { deleted: chosen.length, matches: chosen };
}

async function listUpcomingEvents(limit = 10) {
  const snap = await db.collection("events").get();
  const nowISO = new Date().toISOString();
  const items = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.date && d.date >= nowISO) items.push({ id: doc.id, ...d });
  });
  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return items.slice(0, limit);
}

async function findEventByTitle(title) {
  const snap = await db.collection("events").get();
  const needle = title.toLowerCase();
  let best = null, bestScore = -1;
  snap.forEach((doc) => {
    const t = String(doc.data()?.title || "").toLowerCase();
    if (!t) return;
    let score = 0;
    if (t === needle) score = 100;
    else if (t.startsWith(needle) || needle.startsWith(t)) score = 70;
    else if (t.includes(needle) || needle.includes(t)) score = 40;
    if (score > bestScore) { bestScore = score; best = { id: doc.id, ...doc.data() }; }
  });
  return bestScore > 0 ? best : null;
}

async function addPutz(entry) {
  const ref = await db.collection("putzplan").add({
    task: entry.task, who: entry.who || "", when: entry.when,
    done: false, source: "whatsapp", createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function listPutzWeek() {
  const snap = await db.collection("putzplan").get();
  const now = startOfDay(new Date());
  const plus7 = new Date(now); plus7.setDate(plus7.getDate() + 7);
  const items = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d) return;
    const when = d.when ? new Date(d.when) : null;
    if (!when) return;
    if (when >= now && when <= plus7) items.push({ id: doc.id, ...d });
  });
  items.sort((a, b) => String(a.when).localeCompare(String(b.when)));
  return items;
}

function getWeekendKey(date = new Date()) {
  const day = date.getDay();
  const diffToSat = (6 - day + 7) % 7;
  const sat = new Date(date);
  sat.setDate(date.getDate() + diffToSat);
  return sat.toISOString().slice(0, 10);
}

async function setAnwesend(name, status) {
  const key = getWeekendKey();
  await db.collection("anwesenheit").doc(key).set({ [name]: status }, { merge: true });
  return key;
}

async function getAnwesenheit() {
  const key = getWeekendKey();
  const doc = await db.collection("anwesenheit").doc(key).get();
  return { key, data: doc.exists ? doc.data() : {} };
}

async function addSchaden(entry, addedBy, image) {
  const payload = {
    titel: entry.titel,
    ort: entry.ort,
    beschreibung: entry.beschreibung,
    prio: entry.prio,
    zustaendig: "",
    status: "offen",
    addedBy: addedBy || "WhatsApp",
    source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (image) payload.image = image;
  const ref = await db.collection("schaeden").add(payload);
  return ref.id;
}

async function listOffeneSchaeden(limit = 10) {
  const snap = await db.collection("schaeden").get();
  const items = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.status !== "erledigt") items.push({ id: doc.id, ...d });
  });
  const prioWeight = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => (prioWeight[a.prio] ?? 1) - (prioWeight[b.prio] ?? 1));
  return items.slice(0, limit);
}

async function addRSVP(eventId, name) {
  const ref = await db.collection("anmeldungen").add({
    eventId, name, source: "whatsapp", createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function removeRSVP(eventId, name) {
  const snap = await db.collection("anmeldungen")
    .where("eventId", "==", eventId).get();
  const needle = name.toLowerCase();
  const matches = [];
  snap.forEach((doc) => {
    const n = String(doc.data()?.name || "").toLowerCase();
    if (n === needle) matches.push(doc.id);
  });
  await Promise.all(matches.map((id) => db.collection("anmeldungen").doc(id).delete()));
  return matches.length;
}

async function listRSVPs(eventId) {
  const snap = await db.collection("anmeldungen")
    .where("eventId", "==", eventId).get();
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  return items;
}

async function addGaestebuchEntry(name, text) {
  await db.collection("gaestebuch").add({
    name: name || "Anonym", text: text.slice(0, 1000),
    kind: "text", source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function addKandidat(entry, addedBy, image) {
  const payload = {
    name: entry.name,
    alter: entry.alter,
    info: entry.info || "",
    kontakt: entry.kontakt || "",
    status: "offen",
    votes: {},
    addedBy: addedBy || "WhatsApp",
    source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
  };
  if (image) payload.foto = image;
  const ref = await db.collection("kandidaten").add(payload);
  return ref.id;
}

async function listOffeneKandidaten(limit = 15) {
  const snap = await db.collection("kandidaten").get();
  const items = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.status !== "abgelehnt" && d?.status !== "eingezogen") {
      items.push({ id: doc.id, ...d });
    }
  });
  items.sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  return items.slice(0, limit);
}

async function findKandidatByName(name) {
  const snap = await db.collection("kandidaten").get();
  const needle = String(name).toLowerCase().trim();
  let best = null, bestScore = -1;
  snap.forEach((doc) => {
    const n = String(doc.data()?.name || "").toLowerCase();
    if (!n) return;
    let score = 0;
    if (n === needle) score = 100;
    else if (n.startsWith(needle) || needle.startsWith(n)) score = 70;
    else if (n.includes(needle) || needle.includes(n)) score = 40;
    if (score > bestScore) { bestScore = score; best = { id: doc.id, ...doc.data() }; }
  });
  return bestScore > 0 ? best : null;
}

async function attachFotoToKandidat(kandidatId, src) {
  await db.collection("kandidaten").doc(kandidatId).update({ foto: src });
}

async function addErinnerung(entry, owner) {
  const ref = await db.collection("erinnerungen").add({
    ...entry, owner: owner || "",
    sent: false, createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

async function addHausbild(featureId, src) {
  await db.collection("hausbilder").doc(featureId).set({
    src, updatedAt: FieldValue.serverTimestamp(),
  });
}

async function addGalerieBild(src, caption) {
  await db.collection("galerie").add({
    src, caption: caption || "", source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function addEventFoto(eventId, src) {
  await db.collection("eventfotos").add({
    eventId, src, source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
  });
}

/* ==========================================================================
   Command-Dispatcher
   ========================================================================== */

const HELP_TEXT =
  `👋 Hoi! Ich bin der *Haus Am See Bot*.\n\n` +
  `*Events*\n` +
  `➕ "Neues Event: Sommerfest 15.8. 18 Uhr | Grillen am See"\n` +
  `🗑️ "Event löschen: Sommerfest"\n` +
  `📅 "Events"\n\n` +
  `*Putzplan*\n` +
  `➕ "Putz: Manu 20.4. Küche"\n` +
  `📋 "Wer putzt?"\n\n` +
  `*Anwesenheit*\n` +
  `✅ "Bin da" / "Bin weg 1.5."\n` +
  `📋 "Wer ist da?"\n\n` +
  `*Schäden*\n` +
  `🔧 "Schaden: Waschmaschine tropft | Keller | hoch"\n` +
  `    (Foto mitschicken = wird angehängt)\n` +
  `📋 "Schäden"\n\n` +
  `*Event-Anmeldung*\n` +
  `✅ "Ja Sommerfest" / "Nein Bierkastenlauf"\n` +
  `📋 "Wer kommt zum Sommerfest?"\n\n` +
  `*Fotos* (Bild + Caption)\n` +
  `🏠 "Foto Hausbild garten" — für Hausbilder\n` +
  `🎉 "Foto Sommerfest" — für Event-Fotos\n` +
  `🖼️ "Foto" — in die Galerie\n\n` +
  `*Gästebuch*\n` +
  `📝 "Gästebuch: Hatte ne mega Zeit bei euch"\n\n` +
  `*Erinnerungen*\n` +
  `🔔 "Erinner mich 30.4. um 8 Uhr an: Rechnung zahlen"\n\n` +
  `*Zimmer-Bewerber*\n` +
  `➕ "Bewerber: Lisa, 25 | Studentin, super sympatisch | +41 79 123 45 67"\n` +
  `📸 Foto + Caption "Foto Bewerber Lisa" — Foto anhängen\n` +
  `📋 "Bewerber"\n\n` +
  `🌐 ${WEBSITE_URL}`;

/**
 * Versucht, die Nachricht als einen bestimmten Command zu verarbeiten.
 * Return: true wenn behandelt, false wenn nichts zutraf.
 */
async function dispatch(ctx) {
  const { from, text, mediaId, caption, senderName } = ctx;
  const rawInput = text || caption || "";

  // Bild mit oder ohne Caption?
  if (mediaId) {
    return await handlePhotoUpload(from, mediaId, caption, rawInput);
  }

  if (!rawInput) {
    return false;
  }

  // 1) Lösch-Befehl für Events
  const del = parseDeleteMessage(rawInput);
  if (del) {
    const result = await deleteEventByTitle(del.title);
    if (result.deleted === 0) {
      await sendWhatsApp(from, `🤷 Kein Event mit "${del.title}" gefunden.\n\nSchick "Events" für eine Liste.`);
    } else if (result.deleted === 1) {
      const m = result.matches[0];
      const d = m.date ? fmtDateTime(m.date) : "";
      await sendWhatsApp(from, `🗑️ Gelöscht: "${m.title}"${d ? ` am ${d}` : ""}`);
    } else {
      const list = result.matches.map((m) => `• ${m.title}`).join("\n");
      await sendWhatsApp(from, `🗑️ ${result.deleted} Events gelöscht:\n${list}`);
    }
    return true;
  }

  // 2) Events auflisten
  if (isListEventsCommand(rawInput)) {
    const items = await listUpcomingEvents(10);
    if (!items.length) {
      await sendWhatsApp(from, `📅 Keine kommenden Events.`);
    } else {
      const lines = items.map((e) => `• ${e.title} – ${fmtDateTime(e.date)}`);
      await sendWhatsApp(from, `📅 *Kommende Events:*\n${lines.join("\n")}\n\n${WEBSITE_URL}/#events`);
    }
    return true;
  }

  // 3) Neues Event
  const newEv = parseEventMessage(rawInput);
  if (newEv) {
    const id = await createEvent(newEv, from);
    const desc = newEv.description ? `\n📝 ${newEv.description}` : "";
    await sendWhatsApp(from, `✅ Event angelegt: *${newEv.title}*\n📅 ${fmtDateTime(newEv.date)}${desc}\n\n${WEBSITE_URL}/#events`);
    await debugLog("event_created", { id, from, title: newEv.title });
    return true;
  }

  // 4) Putzplan auflisten
  if (isPutzListCommand(rawInput)) {
    const items = await listPutzWeek();
    if (!items.length) {
      await sendWhatsApp(from, `🧹 Diese Woche kein Putzplan-Eintrag.`);
    } else {
      const lines = items.map((p) => {
        const when = p.when ? fmtDate(p.when) : "";
        const status = p.done ? "✅" : "⏳";
        return `${status} ${p.task}${p.who ? ` – ${p.who}` : ""}${when ? ` (${when})` : ""}`;
      });
      await sendWhatsApp(from, `🧹 *Putzplan diese Woche:*\n${lines.join("\n")}`);
    }
    return true;
  }

  // 5) Putz eintragen
  const putz = parsePutzAdd(rawInput);
  if (putz) {
    await addPutz(putz);
    const whoTxt = putz.who ? ` von ${putz.who}` : "";
    await sendWhatsApp(from, `🧹 Eingetragen: *${putz.task}*${whoTxt} am ${fmtDate(putz.when)}`);
    return true;
  }

  // 6) Anwesenheit – abfragen
  if (isAnwesenheitListCommand(rawInput)) {
    const { key, data } = await getAnwesenheit();
    const da = [], weg = [], unklar = [];
    for (const n of ADULTS) {
      const s = data[n];
      if (s === "da") da.push(n);
      else if (s === "weg") weg.push(n);
      else unklar.push(n);
    }
    const lines = [
      `🏠 *Wochenende ${fmtDate(key)}:*`,
      `✅ Da: ${da.join(", ") || "–"}`,
      `❌ Weg: ${weg.join(", ") || "–"}`,
      `❓ Keine Angabe: ${unklar.join(", ") || "–"}`,
    ];
    await sendWhatsApp(from, lines.join("\n"));
    return true;
  }

  // 7) Anwesenheit – setzen (nur wenn wir den Absender einem Bewohner zuordnen können)
  const anw = parseAnwesenheit(rawInput);
  if (anw) {
    // Wer bist du? Erst aus dem Namen (senderName), dann aus der Nachricht.
    let resident = resolveResident(senderName, true);
    // Fallback: Suche Name in Nachricht: "Manu ist weg" etc.
    if (!resident) {
      for (const n of ADULTS) {
        if (new RegExp(`\\b${n}\\b`, "i").test(rawInput)) { resident = n; break; }
      }
    }
    if (!resident) {
      await sendWhatsApp(from, `❓ Ich weiss nicht wer du bist. Schreib z.B.: "Manu ist weg 1.5."`);
      return true;
    }
    await setAnwesend(resident, anw.status);
    const icon = anw.status === "da" ? "✅" : "❌";
    await sendWhatsApp(from, `${icon} ${resident} am Wochenende: *${anw.status === "da" ? "da" : "weg"}*`);
    return true;
  }

  // 8) Schäden auflisten
  if (isSchadenListCommand(rawInput)) {
    const items = await listOffeneSchaeden(15);
    if (!items.length) {
      await sendWhatsApp(from, `🔧 Keine offenen Schäden. 🎉`);
    } else {
      const prioEmoji = { high: "🔴", medium: "🟡", low: "🟢" };
      const lines = items.map((s) => `${prioEmoji[s.prio] || "🟡"} *${s.titel}*${s.ort ? ` – ${s.ort}` : ""}`);
      await sendWhatsApp(from, `🔧 *Offene Schäden:*\n${lines.join("\n")}`);
    }
    return true;
  }

  // 9) Schaden melden (ohne Foto; mit Foto s. handlePhotoUpload)
  const schaden = parseSchadenMessage(rawInput);
  if (schaden) {
    const id = await addSchaden(schaden, senderName || from);
    await sendWhatsApp(from, `🔧 Schaden erfasst: *${schaden.titel}*${schaden.ort ? ` (${schaden.ort})` : ""}\n\n${WEBSITE_URL}/#schaeden`);
    return true;
  }

  // 10) RSVP auflisten
  const rsvpList = parseRSVPListCommand(rawInput);
  if (rsvpList) {
    const ev = await findEventByTitle(rsvpList.title);
    if (!ev) {
      await sendWhatsApp(from, `🤷 Kein Event mit "${rsvpList.title}" gefunden.`);
    } else {
      const items = await listRSVPs(ev.id);
      if (!items.length) {
        await sendWhatsApp(from, `🎉 Noch keine Anmeldungen für *${ev.title}*.`);
      } else {
        const lines = items.map((r) => `• ${r.name}${r.partnerName ? ` + ${r.partnerName}` : r.needsPartner ? " (sucht Partner)" : ""}`);
        await sendWhatsApp(from, `🎉 *${ev.title}* – ${items.length} Anmeldungen:\n${lines.join("\n")}`);
      }
    }
    return true;
  }

  // 11) RSVP (Ja/Nein)
  const rsvp = parseRSVPMessage(rawInput);
  if (rsvp) {
    const ev = await findEventByTitle(rsvp.title);
    if (!ev) {
      await sendWhatsApp(from, `🤷 Kein Event mit "${rsvp.title}" gefunden.\nSchick "Events" für die Liste.`);
      return true;
    }
    const name = senderName || "Gast";
    if (rsvp.wantsIn) {
      await addRSVP(ev.id, name);
      await sendWhatsApp(from, `✅ ${name} angemeldet für *${ev.title}* (${fmtDateTime(ev.date)}).`);
    } else {
      const removed = await removeRSVP(ev.id, name);
      await sendWhatsApp(from, removed ? `❌ ${name} abgemeldet von *${ev.title}*.` : `ℹ️ Du warst nicht angemeldet für *${ev.title}*.`);
    }
    return true;
  }

  // 12a) Bewerber auflisten
  if (isBewerberListCommand(rawInput)) {
    const items = await listOffeneKandidaten(15);
    if (!items.length) {
      await sendWhatsApp(from, `🚪 Keine offenen Bewerber:innen.`);
    } else {
      const statusEmoji = { offen: "⏳", eingeladen: "📩", kennengelernt: "🤝", zusage: "💚", abgesagt: "❌" };
      const lines = items.map((k) => {
        const ico = statusEmoji[k.status] || "⏳";
        const alter = k.alter ? ` (${k.alter})` : "";
        const kontakt = k.kontakt ? `\n   📞 ${k.kontakt}` : "";
        const info = k.info ? `\n   ℹ️ ${k.info.slice(0, 100)}${k.info.length > 100 ? "…" : ""}` : "";
        return `${ico} *${k.name}*${alter}${info}${kontakt}`;
      });
      await sendWhatsApp(from, `🚪 *Bewerber:innen (${items.length}):*\n\n${lines.join("\n\n")}\n\n${WEBSITE_URL}/#kandidaten`);
    }
    return true;
  }

  // 12b) Neuen Bewerber anlegen
  const bew = parseBewerberMessage(rawInput);
  if (bew) {
    const id = await addKandidat(bew, senderName || from);
    const alter = bew.alter ? ` (${bew.alter})` : "";
    const extra = [
      bew.info ? `ℹ️ ${bew.info}` : "",
      bew.kontakt ? `📞 ${bew.kontakt}` : "",
    ].filter(Boolean).join("\n");
    await sendWhatsApp(from, `🚪 Bewerber:in gespeichert: *${bew.name}*${alter}${extra ? "\n\n" + extra : ""}\n\n💡 Foto nachreichen: schick ein Bild mit Caption "Foto Bewerber ${bew.name}"\n\n${WEBSITE_URL}/#kandidaten`);
    await debugLog("kandidat_created", { id, from, name: bew.name });
    return true;
  }

  // 13) Gästebuch
  const gb = parseGaestebuchMessage(rawInput);
  if (gb) {
    await addGaestebuchEntry(senderName || "WhatsApp", gb.text);
    await sendWhatsApp(from, `📝 Eintrag gespeichert – danke dir! 🌿\n\n${WEBSITE_URL}/#gaestebuch`);
    return true;
  }

  // 13) Erinnerung
  const er = parseErinnerungMessage(rawInput);
  if (er) {
    await addErinnerung(er, from);
    await sendWhatsApp(from, `🔔 Okay, ich melde mich am ${fmtDateTime(er.date)}:\n"${er.text}"`);
    return true;
  }

  // 14) Help / unbekannt
  return false;
}

async function handlePhotoUpload(from, mediaId, caption, rawInput) {
  const fotoCmd = parseFotoCommand(caption);
  await debugLog("photo_received", { from, mediaId, caption, fotoCmd });

  const src = await downloadMedia(mediaId);
  if (!src) {
    await sendWhatsApp(from, `😕 Konnte das Bild nicht laden. Versuchs nochmal?`);
    return true;
  }

  // Foto zu einem Schaden? ("Schaden: ..." als Caption)
  const schaden = parseSchadenMessage(rawInput);
  if (schaden) {
    const id = await addSchaden(schaden, from, src);
    await sendWhatsApp(from, `🔧 Schaden mit Foto erfasst: *${schaden.titel}*\n\n${WEBSITE_URL}/#schaeden`);
    return true;
  }

  // Foto + Bewerber-Kommando in einem? ("Bewerber: Lisa, 25 | …" als Caption)
  const bewInline = parseBewerberMessage(rawInput);
  if (bewInline) {
    const id = await addKandidat(bewInline, from, src);
    const alter = bewInline.alter ? ` (${bewInline.alter})` : "";
    await sendWhatsApp(from, `🚪 Bewerber:in mit Foto gespeichert: *${bewInline.name}*${alter}\n\n${WEBSITE_URL}/#kandidaten`);
    return true;
  }

  // Foto-Command?
  if (fotoCmd) {
    if (fotoCmd.kind === "hausbild") {
      await addHausbild(fotoCmd.featureId, src);
      await sendWhatsApp(from, `🏠 Hausbild für *${fotoCmd.featureId}* gespeichert.\n\n${WEBSITE_URL}/#haus`);
      return true;
    }
    if (fotoCmd.kind === "kandidat") {
      const k = await findKandidatByName(fotoCmd.name);
      if (k) {
        await attachFotoToKandidat(k.id, src);
        await sendWhatsApp(from, `🚪 Foto zu *${k.name}* gespeichert.\n\n${WEBSITE_URL}/#kandidaten`);
      } else {
        const id = await addKandidat({ name: fotoCmd.name, alter: null, info: "", kontakt: "" }, from, src);
        await sendWhatsApp(from, `🚪 Neue:r Bewerber:in angelegt: *${fotoCmd.name}* (mit Foto).\n\nMehr Infos? z.B. "Bewerber ${fotoCmd.name}, 25 | kurze Beschreibung | Kontakt"\n\n${WEBSITE_URL}/#kandidaten`);
      }
      return true;
    }
    if (fotoCmd.kind === "event-or-galerie") {
      const ev = await findEventByTitle(fotoCmd.target);
      if (ev) {
        await addEventFoto(ev.id, src);
        await sendWhatsApp(from, `📸 Foto zu *${ev.title}* hinzugefügt.\n\n${WEBSITE_URL}/#events`);
        return true;
      }
      await addGalerieBild(src, fotoCmd.target);
      await sendWhatsApp(from, `🖼️ In die Galerie gepackt: "${fotoCmd.target}"\n\n${WEBSITE_URL}/#galerie`);
      return true;
    }
  }

  // Fallback: ab in die Galerie
  await addGalerieBild(src, caption || "");
  await sendWhatsApp(from, `🖼️ Foto in der Galerie gespeichert.\n\n${WEBSITE_URL}/#galerie\n\n💡 Tipp: Mit Caption "Foto Sommerfest" landet's bei einem Event, mit "Schaden: …" bei den Schäden.`);
  return true;
}

/* ==========================================================================
   Webhook (Meta WhatsApp Cloud API)
   ========================================================================== */

exports.whatsappWebhook = onRequest({ cors: false, invoker: "public" }, async (req, res) => {
  logger.info("📨 Incoming", { method: req.method, path: req.path });

  // GET: Verify
  if (req.method === "GET") {
    const { verifyToken } = cfg();
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === verifyToken) return res.status(200).send(challenge);
    return res.status(403).send("forbidden");
  }
  if (req.method !== "POST") return res.status(405).send("method not allowed");

  try {
    const body = req.body || {};
    await debugLog("incoming", {
      object: body.object,
      bodyPreview: JSON.stringify(body).slice(0, 3000),
    });

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const value = change.value || {};
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        const isGroup = !!value.metadata?.phone_number_id && messages.some((m) => m.context?.group_id || m.from_me === false);

        for (const msg of messages) {
          const from = msg.from;
          const contact = contacts.find((c) => c.wa_id === from);
          const senderName = contact?.profile?.name || "";
          const type = msg.type;

          let text = "";
          let caption = "";
          let mediaId = null;

          if (type === "text") text = msg.text?.body || "";
          else if (type === "image") { mediaId = msg.image?.id; caption = msg.image?.caption || ""; }
          else if (type === "button") text = msg.button?.text || "";
          else if (type === "interactive") text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
          else if (type === "audio") text = "[Sprachnachricht]";
          else if (type === "video") { mediaId = msg.video?.id; caption = msg.video?.caption || ""; }

          await debugLog("message", { from, senderName, type, text: text.slice(0, 200), caption: caption.slice(0, 200), hasMedia: !!mediaId });

          // Gruppen-Filter: Nur reagieren, wenn direkt angesprochen. In Privatchats immer.
          const combined = text || caption;
          const mention = stripBotMention(combined);
          const isPrivate = !isGroup;

          // Zusätzliche Heuristik: WhatsApp Cloud API liefert derzeit für Gruppen wenig Metadaten.
          // Wenn der Text mit einem Trigger-Wort beginnt ("Neues Event", "Schaden", "Putz", …), akzeptieren wir trotzdem.
          const looksLikeDirectCommand = /^(neue[rs]?\s+)?(event|termin|anlass|party|geburtstag|apero|schaden|putz|gäste?buch|erinner|foto|bild|bewerber|bewerberin|kandidat|kandidatin|zimmer|events?|termine?|liste|wer\s+(putzt|ist|kommt)|bin\s+(da|hier|weg|fort)|ja\s+|nein\s+)/i.test(combined.trim());

          if (!isPrivate && !mention.addressed && !looksLikeDirectCommand) {
            await debugLog("group_ignored", { from, senderName, preview: combined.slice(0, 80) });
            continue;
          }

          // Nachricht reinigen: Wenn angesprochen wurde, den Bot-Präfix entfernen
          const effectiveText = mention.addressed ? mention.text : (text || caption);
          const effectiveCaption = mediaId ? (mention.addressed ? mention.text : caption) : caption;

          const handled = await dispatch({
            from,
            senderName,
            text: mediaId ? "" : effectiveText,
            caption: effectiveCaption,
            mediaId,
          });

          if (!handled) {
            await debugLog("no_match", { from, text: effectiveText });
            await sendWhatsApp(from, HELP_TEXT);
          }
        }
      }
    }
    return res.status(200).send("ok");
  } catch (e) {
    logger.error("❌ webhook error", e);
    await debugLog("webhook_error", { error: String(e), stack: e?.stack || "" });
    return res.status(200).send("ok"); // Meta-Retry vermeiden
  }
});

/* ==========================================================================
   Kontaktformular → WhatsApp
   ========================================================================== */

exports.onNewNachricht = onDocumentCreated("nachrichten/{id}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const isBewerbung = data.type === "bewerbung";
  const header = isBewerbung ? "🚪 *Neue Bewerbung – Zimmer frei*" : "✉️ *Neue Nachricht auf hausamsee*";
  const lines = [
    header, "",
    `*Von:* ${data.name || "Anonym"}`,
    data.email ? `*Mail:* ${data.email}` : "",
    isBewerbung && data.alter ? `*Alter:* ${data.alter}` : "",
    isBewerbung && data.einzug ? `*Einzug ab:* ${data.einzug}` : "",
    "",
    data.message || data.nachricht || "",
    "",
    `→ ${WEBSITE_URL}/#kontakt`,
  ].filter(Boolean);
  await broadcast(lines.join("\n"));
});

/* ==========================================================================
   Scheduler: Erinnerungen – alle 15 Minuten prüfen
   ========================================================================== */

exports.checkReminders = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Europe/Zurich" },
  async () => {
    const nowISO = new Date().toISOString();
    const snap = await db.collection("erinnerungen")
      .where("sent", "==", false)
      .where("date", "<=", nowISO).get();

    const promises = [];
    snap.forEach((doc) => {
      const d = doc.data();
      const target = d.owner || (cfg().recipients[0] || "");
      if (!target) return;
      promises.push((async () => {
        await sendWhatsApp(target, `🔔 *Erinnerung:*\n${d.text}`);
        await db.collection("erinnerungen").doc(doc.id).update({
          sent: true, sentAt: FieldValue.serverTimestamp(),
        });
      })());
    });
    await Promise.all(promises);
    logger.info(`Reminders sent: ${promises.length}`);
  }
);

/* ==========================================================================
   Scheduler: Daily Digest – Montag 8:00 in die WG-Gruppe(n)
   ========================================================================== */

exports.dailyDigest = onSchedule(
  { schedule: "every monday 08:00", timeZone: "Europe/Zurich" },
  async () => {
    const [events, putz, anw, schaeden] = await Promise.all([
      listUpcomingEvents(5),
      listPutzWeek(),
      getAnwesenheit(),
      listOffeneSchaeden(5),
    ]);

    const lines = [`☀️ *Haus-am-See-Update* – Woche ab ${fmtDate(new Date())}`, ""];

    lines.push("*📅 Kommende Events:*");
    if (events.length) {
      events.forEach((e) => lines.push(`• ${e.title} – ${fmtDateTime(e.date)}`));
    } else lines.push("_keine_");
    lines.push("");

    lines.push("*🧹 Putzplan diese Woche:*");
    if (putz.length) {
      putz.forEach((p) => lines.push(`• ${p.task}${p.who ? ` – ${p.who}` : ""}${p.when ? ` (${fmtDate(p.when)})` : ""}`));
    } else lines.push("_nichts eingetragen_");
    lines.push("");

    lines.push(`*🏠 Wochenende ${fmtDate(anw.key)}:*`);
    const da = [], weg = [];
    for (const n of ADULTS) {
      if (anw.data[n] === "da") da.push(n);
      else if (anw.data[n] === "weg") weg.push(n);
    }
    lines.push(`✅ Da: ${da.join(", ") || "–"}`);
    lines.push(`❌ Weg: ${weg.join(", ") || "–"}`);
    lines.push("");

    if (schaeden.length) {
      lines.push("*🔧 Offene Schäden:*");
      schaeden.forEach((s) => lines.push(`• ${s.titel}${s.ort ? ` (${s.ort})` : ""}`));
      lines.push("");
    }

    lines.push(`🌐 ${WEBSITE_URL}`);
    await broadcast(lines.join("\n"));
  }
);
