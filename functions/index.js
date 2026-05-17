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
 *   • Garten-Regen-Alert (Open-Meteo) → ca. 30 min vor Niederschlag, Polster rein
 *   • Kontaktformular → WhatsApp-Gruppe
 *
 *  Bot-Ansprache in Gruppen: z. B. "@gustav" oder "@bot", "!bot", "haus am see",
 *  (case-insensitive). In Privatchats reagiert er immer.
 *  Optional: OPENAI_API_KEY → LLM interpretiert Nachrichten zuerst (Kontext → Befehl), dann
 *  regelbasiert; GUSTAV_LLM_RULES_FIRST=1 kehrt die Reihenfolge um.
 */

const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

// Smart-Plug-Provider: "tuya" (Default, für Smart Life / Maxcio / Tapo-Tuya-Varianten)
// oder "meross" (für Refoss / Meross). Beide Module haben die gleiche Schnittstelle.
const PLUG_PROVIDER = (process.env.PLUG_PROVIDER || "tuya").toLowerCase();
const plugs = require(PLUG_PROVIDER === "meross" ? "./meross" : "./tuya");
const llmRouter = require("./llmRouter");

initializeApp();
const db = getFirestore();

setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

/* ==========================================================================
   Konstanten
   ========================================================================== */

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

// Wetter-Alert (Open-Meteo) – dieselbe Lage wie die Homepage
const WEATHER_LAT = 47.3656;
const WEATHER_LON = 8.7808;
/** Min. vor Stundenanfang, ab dem nass laut Vorschau; Alert-Fenster ~30 min davor (siehe checkGartenRegenPolster) */
const RAIN_ALERT_MIN_MINUTES = 20;
const RAIN_ALERT_MAX_MINUTES = 42;
const GARTEN_POLSTER_ALERT_DOC = "config/gartenPolsterRainAlert";

const BEWOHNER = ["Corina", "Jasmin", "Dino", "Andy", "Manu", "Hugues", "Fanny", "Elliot", "Oscar"];
const KIDS = new Set(["Elliot", "Oscar"]);
const ADULTS = BEWOHNER.filter((n) => !KIDS.has(n));

// Bewässerung: harte Sicherheitsgrenzen für Steckdosen-Timer.
const PUMP_DEFAULT_MINUTES = 20; // Default-Bewässerungsdauer (Minuten)
const PUMP_MAX_MINUTES = 60;     // Länger lassen wir die Pumpe NIE laufen

// Garten-Sequenz: Bewässerungscomputer → Pumpe (mit Vorlauf/Nachlauf)
const GARTEN_SEQUENZ_VORLAUF_SEC = 30;   // Sekunden nach Bewässerungscomputer AN bevor Pumpe AN
const GARTEN_SEQUENZ_NACHLAUF_SEC = 30;  // Sekunden nach Pumpe AUS bevor Bewässerungscomputer AUS
const GARTEN_DEVICE_COMPUTER = "Bewässerungscomputer"; // Smart Life Gerätename
const GARTEN_DEVICE_PUMPE = "Pumpe";                   // Smart Life Gerätename

// Geräte ohne Auto-Off-Timer (bleiben an bis manuell ausgeschaltet)
const NO_TIMER_DEVICES = ["lichterkette", "licht"];

// Nachrichten die mit einem dieser Tokens beginnen → direkt an den Bot gerichtet (in Gruppen)
// (alles in Kleinbuchstaben; Abgleich läuft über toLowerCase())
const BOT_MENTIONS = [
  "@gustav", "gustav,", "gustav:", "gustav ",
  "@bot", "!bot", "/bot", "haus am see bot", "haus am see", "@haus", "bot,", "bot:", "bot ",
];

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

/** phoneIdOpt: pro Webhook-Event von value.metadata.phone_number_id (eingehende Nummer). Ohne: WHATSAPP_PHONE_ID. */
async function sendWhatsApp(to, text, phoneIdOpt) {
  const { token, phoneId: defaultPid } = cfg();
  const phoneId = phoneIdOpt || defaultPid;
  if (!token || !phoneId) {
    logger.error("sendWhatsApp: fehlendes WHATSAPP_TOKEN oder WHATSAPP_PHONE_ID");
    await debugLog("send_skipped", { to, reason: "no_token_or_phone_id" });
    return false;
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
    logger.error("sendWhatsApp: fetch fehlgeschlagen", e);
    await debugLog("send_crash", { to, error: String(e) });
    return false;
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    logger.warn("sendWhatsApp: Graph API Fehler", { status: res.status, body: bodyText.slice(0, 500) });
    await debugLog("send_failed", { to, status: res.status, response: bodyText.slice(0, 2000) });
    return false;
  }
  await debugLog("send_ok", { to, status: res.status, phoneId });
  return true;
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

/** WhatsApp-Absender einer Bewohner-Person zuordnen (Profilname, dann Telefon aus memberPrefs / Fallback). */
async function resolveResidentFromWhatsApp(from, senderName) {
  const byName = resolveResident(senderName, true);
  if (byName) return byName;
  const normFrom = String(from || "").replace(/\D/g, "");
  if (!normFrom) return null;
  try {
    const prefsSnap = await db.collection("config").doc("memberPrefs").get();
    const prefs = prefsSnap.exists ? prefsSnap.data() : {};
    for (const [name, val] of Object.entries(prefs)) {
      if (!ADULTS.includes(name)) continue;
      const p = val && val.phone ? String(val.phone).replace(/\D/g, "") : "";
      if (p && p === normFrom) return name;
    }
  } catch (e) {
    logger.warn("resolveResidentFromWhatsApp: memberPrefs", e);
  }
  const phonebook = {
    Manu: "41798385590",
    Corina: "41795553906",
    Jasmin: "41762988934",
    Dino: "41765740020",
    Andy: "41798489999",
    Hugues: "41795911251",
    Fanny: "41789561100",
  };
  for (const [name, num] of Object.entries(phonebook)) {
    if (num === normFrom && ADULTS.includes(name)) return name;
  }
  return null;
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
  return new Date(d).toLocaleDateString("de-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtDateTime(d) {
  return new Date(d).toLocaleString("de-CH", { timeZone: "Europe/Zurich", dateStyle: "short", timeStyle: "short" });
}
function fmtTimeZurich(d) {
  return new Date(d).toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
}

function gartenRegenPolsterEnabled() {
  const v = String(process.env.GARTEN_RAIN_ALERT || "").toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

function rainAlertRecipients() {
  const raw = process.env.WHATSAPP_RAIN_ALERT_RECIPIENTS || process.env.WHATSAPP_GROUP_RECIPIENTS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Niederschlag oder WMO-Code (Regen/Schauer/Gewitter; leichter Schnee zählt für Polster) */
function hourLooksRainy(precipMm, wmoCode) {
  const p = Number(precipMm);
  if (!Number.isNaN(p) && p > 0.1) return true;
  const c = Number(wmoCode);
  if (Number.isNaN(c)) return p > 0.05;
  if (c >= 51 && c <= 67) return true;
  if (c >= 80 && c <= 82) return true;
  if (c >= 95) return true;
  if (c >= 71 && c <= 77) return true;
  if (c >= 85 && c <= 86) return true;
  return p > 0.05;
}

/**
 * Erster zukünftiger Stunden-Slot mit Niederschlag (Open-Meteo hourly, time = Stundenbeginn).
 * @returns {{ slotUnix: number, whenLabel: string } | null}
 */
function findNextRainyHourSlot(hourly) {
  const times = hourly?.time;
  const prec = hourly?.precipitation;
  const codes = hourly?.weathercode;
  if (!Array.isArray(times) || !times.length) return null;
  const nowMs = Date.now();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const slotMs = typeof t === "number" ? t * 1000 : Number(t) * 1000;
    if (Number.isNaN(slotMs) || slotMs <= nowMs) continue;
    const p = prec?.[i];
    const w = codes?.[i];
    if (hourLooksRainy(p, w)) {
      const whenLabel = fmtTimeZurich(new Date(slotMs));
      return { slotUnix: Math.floor(slotMs / 1000), whenLabel };
    }
  }
  return null;
}

async function fetchOpenMeteoPfaeffikon() {
  const params = new URLSearchParams({
    latitude: String(WEATHER_LAT),
    longitude: String(WEATHER_LON),
    hourly: "precipitation,weathercode",
    timezone: "Europe/Zurich",
    forecast_days: "2",
    timeformat: "unixtime",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`open-meteo ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

/** Garten: Vergangenheit + Vorschau für Regen-Check (Open-Meteo) */
let gartenMeteoCache = { t: 0, data: null };
const GARTEN_METEO_TTL_MS = 15 * 60 * 1000;

async function getOpenMeteoGartenForRain() {
  if (gartenMeteoCache.data && Date.now() - gartenMeteoCache.t < GARTEN_METEO_TTL_MS) {
    return gartenMeteoCache.data;
  }
  const params = new URLSearchParams({
    latitude: String(WEATHER_LAT),
    longitude: String(WEATHER_LON),
    hourly: "precipitation,weathercode",
    timezone: "Europe/Zurich",
    past_days: "2",
    forecast_days: "2",
    timeformat: "unixtime",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`open-meteo ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  gartenMeteoCache = { t: Date.now(), data };
  return data;
}

/** Log nur einmal pro Kalendertag (Zürich), um Log-Noise zu begrenzen */
let gartenRainSkipLoggedYmd = null;

/**
 * Echte Überschneidung [ws,we] (ms) und Stunden-Intervall [hs,he).
 * Irgendwo in ±6h um die geplante «Ein»-Zeit: Regen? → Gießplan für den Tag weglassen.
 */
function gartenHourlyRainOverlapsWindow(hourly, ws, we) {
  const times = hourly?.time;
  const prec = hourly?.precipitation;
  const codes = hourly?.weathercode;
  if (!Array.isArray(times) || !times.length) return false;
  for (let i = 0; i < times.length; i++) {
    const raw = times[i];
    const hs = (typeof raw === "number" ? raw : Number(raw)) * 1000;
    if (Number.isNaN(hs)) continue;
    const he = hs + 3600 * 1000;
    if (hs >= we || he <= ws) continue;
    if (hourLooksRainy(prec?.[i], codes?.[i])) return true;
  }
  return false;
}

function gartenYmdZurichNow() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

/**
 * Wenn in den ±6h um eine geplante Gieß-Ein-Zeit Regen (oder Schnee) fällt/— hat:
 * true → ganzer Gießplan an diesem Tag (dieses dayKey) wird nicht geschaltet.
 * API-Fehler: false (Gießplan normal; lieber wässern als dauernd zu blocken).
 */
async function gartenDayShouldSkipDueToRain(slots, ymd) {
  if (!Array.isArray(slots) || !slots.length || !ymd) return false;
  let data;
  try {
    data = await getOpenMeteoGartenForRain();
  } catch (e) {
    logger.warn("Garten-Regen-Check: open-meteo", e?.message || e);
    return false;
  }
  const hourly = data?.hourly;
  if (!hourly) return false;
  const parts = ymd.split("-").map((x) => parseInt(x, 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return false;
  const [Y, M, D] = parts;
  for (const slot of slots) {
    const onT = normHM(slot?.on);
    if (!onT) continue;
    const th = onT.split(":");
    const h = parseInt(th[0], 10);
    const m = parseInt(th[1] || "0", 10);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const onMs = zurichWallToUtcDate(Y, M, D, h, m).getTime();
    const ws = onMs - 6 * 60 * 60 * 1000;
    const we = onMs + 6 * 60 * 60 * 1000;
    if (gartenHourlyRainOverlapsWindow(hourly, ws, we)) return true;
  }
  return false;
}

function gartenSlotSkipKey(ymd, dayKey, idx) {
  return `${ymd}|${dayKey}|${idx}`;
}

/** Wand-Uhrzeit in Europe/Zurich (y,m,d,h,min) → UTC als Date (Cloud Functions laufen in UTC) */
function zurichWallToUtcDate(y, m, d, h, min) {
  let guess = Date.UTC(y, m - 1, d, h, min, 0);
  for (let i = 0; i < 20; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(guess));
    const p = (t) => +parts.find((x) => x.type === t).value;
    const Y = p("year");
    const M = p("month");
    const D = p("day");
    const H = p("hour");
    const Mi = p("minute");
    if (Y === y && M === m && D === d && H === h && Mi === min) {
      return new Date(guess);
    }
    guess += (h * 60 + min - (H * 60 + Mi)) * 60 * 1000;
  }
  return new Date(guess);
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

// Entfernt Bot-Mentions ("@gustav", "@bot", "haus am see", …) und liefert true, falls welche da waren
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
  // DE: events, termine | EN: events, upcoming | FR: événements
  return /^(events?|termine?|liste|anstehendes|upcoming\s*events?|evenements?|evenement)\s*(auflisten|anzeigen|zeigen|list|show)?\s*[?.!]*$/i.test(String(raw).trim());
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
  // DE: wer putzt | EN: who's cleaning, cleaning schedule | FR: qui nettoie, planning ménage
  return /^(wer\s+putzt|putzplan|putz\s*liste|putz\s*woche|who'?s\s*cleaning|cleaning\s*(schedule|list)|qui\s+nettoie|planning\s*menage)\s*[?.!]*$/i.test(String(raw).trim());
}

// "Bin weg 1.5." | "Bin weg 1.5.-8.5." | "Bin da" | "Bin heute weg" | "Bin übers WE weg"
function parseAnwesenheit(raw) {
  const s = String(raw).trim();
  // DE: "bin da/weg" | EN: "I'm home/away" | FR: "je suis là/absent"
  const m = s.match(/^(?:ich\s+)?(?:bin|i'?m|je\s+suis)\s+(.+)$/i);
  if (!m) return null;
  const rest = m[1];
  const isWeg = /\b(weg|fort|nicht\s+da|nicht\s+zuhause|ausser\s*haus|away|out|absent|parti)\b/i.test(rest);
  const isDa = /\b(da|hier|zuhause|home|here|there|la|ici|present)\b/i.test(rest);
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
  // DE: wer ist da | EN: who's home | FR: qui est là
  return /^(wer\s+ist\s+(heute\s+)?(da|hier|zuhause|weg|wo)|anwesenheit|wer\s+ist\s+am\s+wochenende(\s+(da|weg))?|wer\s+ist\s+zuhause|who'?s\s*(home|there|here|around)|who\s+is\s*(home|there|here|around)|attendance|qui\s+est\s+(la|ici|present))\s*[?.!]*$/i.test(s);
}

// "Schaden: Waschmaschine tropft | Küche | hoch" oder Slashes: "… / Garten / hoch"
function parseSchadenMessage(raw) {
  const s = String(raw).trim();
  // DE: "Schaden: ..." | EN: "Damage: ..." | FR: "Dommage: ..."
  const re = /^(schaden|damage|dommage)(?:\s+(melden|report|signaler))?\s*[:\-–]?\s*(.+)$/i;
  const m = s.match(re);
  if (!m) return null;
  const rest = m[3];
  const parts = (rest.includes("|") ? rest.split("|") : rest.split(/\s*\/\s*/)).map((p) => p.trim());
  const titel = parts[0] || "";
  if (!titel) return null;
  const ort = parts[1] || "";
  const prioRaw = (parts[2] || "").toLowerCase();
  let prio = "medium";
  if (/(niedrig|low|klein|faible|bas)/.test(prioRaw)) prio = "low";
  else if (/(hoch|high|dringend|urgent|eleve|critique)/.test(prioRaw)) prio = "high";
  return {
    titel: titel.slice(0, 120),
    ort: ort.slice(0, 80),
    beschreibung: (parts.slice(3).join(" | ") || "").slice(0, 500),
    prio,
  };
}

function isSchadenListCommand(raw) {
  // DE: schäden | EN: damages | FR: dommages
  return /^(schäden?|schaden\s*liste|offene\s+schäden|damages?|open\s+damages?|dommages?)\s*[?.!]*$/i.test(String(raw).trim());
}

// "Schaden erledigt: Rasenmäher" / "Schaden löschen: Waschmaschine"
function parseSchadenErledigtMessage(raw) {
  const s = String(raw).trim();
  // DE: "Schaden erledigt: ..."
  const deRe = /^schaden\s+(erledigt|gelöst|geloest|behoben|repariert|löschen|loeschen|entfernen)\s*[:\-–]?\s*(.+)$/i;
  const deM = s.match(deRe);
  if (deM) return { titel: deM[2].trim() };
  // EN: "Damage done: ..." / "Damage fixed: ..."
  const enRe = /^damage\s+(done|fixed|repaired|resolved|removed)\s*[:\-–]?\s*(.+)$/i;
  const enM = s.match(enRe);
  if (enM) return { titel: enM[2].trim() };
  // FR: "Dommage réparé: ..."
  const frRe = /^dommage\s+(repare|resolu|fait|supprime)\s*[:\-–]?\s*(.+)$/i;
  const frM = s.match(frRe);
  if (frM) return { titel: frM[2].trim() };
  return null;
}

// "Ja Sommerfest", "Nein Bierkastenlauf", "Zu Sommerfest: ja"
function parseRSVPMessage(raw) {
  const s = String(raw).trim();
  // "Ja/Nein/Yes/No/Oui/Non <title>"
  let m = s.match(/^(ja|nein|yes|no|oui|non|maybe|vielleicht|peut-etre|zusage|absage|dabei|nicht\s+dabei)\s+(?:zu[rm]?\s+|for\s+|pour\s+)?(.+)$/i);
  if (m) {
    const yes = /(ja|yes|oui|zusage|dabei)/i.test(m[1]) && !/nicht/i.test(m[1]);
    return { wantsIn: yes, title: m[2].trim() };
  }
  return null;
}

function parseRSVPListCommand(raw) {
  // DE: wer kommt zum ... | EN: who's coming to ... | FR: qui vient à ...
  const deM = String(raw).trim().match(/^wer\s+kommt\s+(?:zu[rm]?\s+|zum\s+)?(.+?)\s*[?.!]*$/i);
  if (deM) return { title: deM[1].trim() };
  const enM = String(raw).trim().match(/^who'?s?\s+coming\s+(?:to\s+)?(.+?)\s*[?.!]*$/i);
  if (enM) return { title: enM[1].trim() };
  const frM = String(raw).trim().match(/^qui\s+vient\s+(?:a\s+|au\s+)?(.+?)\s*[?.!]*$/i);
  if (frM) return { title: frM[1].trim() };
  return null;
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

/** WhatsApp: «Zimmer teilen» → formatierter Inserat-Text (Broadcast an WG-Empfänger). */
function isZimmerShareCommand(raw) {
  const s = String(raw || "").trim();
  return (
    /^(zimmer|wg-zimmer)\s+(teilen|link|inserat|post|share)\s*$/i.test(s) ||
    /^inserat\s+zimmer\s*$/i.test(s) ||
    /^zimmer\s+inserat\s*$/i.test(s) ||
    /^wg-inserat\s*$/i.test(s)
  );
}

function buildZimmerBroadcastMessage(ro) {
  const url = `${WEBSITE_URL}/#zimmer`;
  const titleLine = `🚪 *${(ro.title || "Zimmer frei – Haus am See").trim()}*`;
  const factBits = [];
  if (ro.miete) factBits.push(`💰 ${ro.miete}`);
  if (ro.groesse) factBits.push(`📐 ${ro.groesse}`);
  if (ro.freiAb) factBits.push(`📅 Frei ab ${ro.freiAb}`);
  const factLine = factBits.join(" · ");
  const desc = (ro.description || "").trim();
  const shortDesc = desc.length > 350 ? `${desc.slice(0, 347)}…` : desc;
  const lines = [
    "📣 *Zimmer frei – zum Weiterleiten*",
    "",
    titleLine,
    factLine,
    "",
    shortDesc,
    "",
    url,
    "",
    "_Instagram/Facebook: manuell posten oder Story mit Link (automatisch nur mit Meta Business API)._",
  ];
  return lines
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

// "Erinner mich am 30.4. um 8:00 an: Rechnung zahlen" / "Erinner mich 23.04. um 15:40 Uhr an: …"
// Zeit ist immer in Europe/Zurich (nicht UTC – setHours in der Cloud wäre sonst 1–2h falsch)
function parseErinnerungMessage(raw) {
  const re = /^(?:erinner(?:e|ung)?\s*(?:mich|uns)?|reminde?r?)\s*(?:am\s+)?(.+?)(?:\s+(?:an|für|zu|to))\s*[:\-–]?\s*(.+)$/i;
  const m = String(raw).trim().match(re);
  if (!m) return null;
  const when = m[1];
  const what = m[2].trim();

  let { date, cleaned } = extractDate(when);
  if (!date) date = startOfDay(new Date());
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const da = date.getUTCDate();
  const { hh, mi } = extractTime(cleaned);
  const h = hh === null ? 9 : hh;
  const dUtc = zurichWallToUtcDate(y, mo, da, h, mi);
  if (dUtc.getTime() <= Date.now()) return null;

  return { date: dUtc.toISOString(), text: what.slice(0, 500) };
}

/* --- Bewässerung / Smart Plugs --- */

// Umgangssprache: "Giesse die Blumen", "Garten bewässern 15 min" → Garten-Sequenz mit Bewässerungscomputer + Pumpe
function parseGiessenUmgang(sIn) {
  const s = String(sIn).trim();
  if (!s) return null;
  if (/^wie\s+(gie|kann|soll|muss|funk|warum|wieso)\b/i.test(s)) return null; // reine Wissensfrage, keine Aktion
  if (/^(pumpe|beet|rasen|steckdose|plug)\b/i.test(s)) return null; // normaler Pumpe-Pfad (ohne "bewässerung")
  const gieAktion =
    // Deutsch
    /(giess|gieß|giesse|giessen|gewässer|\bbewäss\w+|\bwässer(?!-))/i.test(s) ||
    /kannst du (noch|mal|bitte)?\s*(giess|gie(ß|ss)|\bwässer\w*|\bbewäss\w*)/i.test(s) ||
    /(bitte|sofort|schnell|hey)\s*(giess|gie(ß|ss)|\bwäss\w*)/i.test(s) ||
    /\b(garten|blu-?m|pflanz|bett?)\b.*(giess|gie(ß|ss)|\bwässer\w*|\bbewäss)/i.test(s) ||
    /(giess|gie(ß|ss)|\bwässer\w*|\bbewäss\w*).*\b(garten|blu-?m|pflanz|bett?)\b/i.test(s) ||
    // English: water the plants/garden/flowers
    /\bwater\s+(the\s+)?(plant|garden|flower|yard)/i.test(s) ||
    /(plant|garden|flower|yard).*\bwater/i.test(s) ||
    /^water\s+(them|it|please)?$/i.test(s) ||
    // French: arrose les plantes/jardin/fleurs
    /\barrose\s+(les?\s+)?(plante|jardin|fleur)/i.test(s) ||
    /(plante|jardin|fleur).*\barrose/i.test(s) ||
    /^arrosage$/i.test(s);
  if (!gieAktion) return null;
  const kontext = /(blu-?m|garten|pflanz|bett?|balkon|draus|aussen|aussen|tropf|kra-?ut|hecke|rasen|beet(?!$))/i.test(s);
  const anBot = /(@gustav|@g\b|@bot\b|gustav|kannst du|könnt|bitte|hey|hallo|mach mal|sofort|schnell)/i.test(s) || s.length < 100;
  if (!kontext && !anBot) return null;
  const willAus =
    /(hör( mir)?\s*auf|aufhören|stopp?|abstell|schalte (die )?pumpe aus|genug|lass(es)?\s+\w*aus|wasser (ab|aus)|bewässerung\s*(aus|stop))/i.test(s) &&
    /(pumpe|giess|gieß|wäss|bewäss|garten|blu-?m)/i.test(s) &&
    !/\b(noch|weiter|an|länger|mehr|start|los)\b/i.test(s);
  if (willAus) {
    // Stopp: beide Geräte aus
    return { gartenSequenz: true, on: false, minutes: null };
  }
  const timeMatch = s.match(/(\d{1,2})\s*(?:min(?:ute[n]?)?|m)(?:\b|[.,])/i);
  const minutes = timeMatch
    ? Math.max(1, Math.min(PUMP_MAX_MINUTES, parseInt(timeMatch[1], 10)))
    : PUMP_DEFAULT_MINUTES;
  // Garten-Sequenz starten: Bewässerungscomputer → Pumpe
  return { gartenSequenz: true, on: true, minutes };
}

/**
 * Startet die Garten-Bewässerungssequenz:
 *   1. Bewässerungscomputer AN (sofort)
 *   2. Pumpe AN (nach VORLAUF Sekunden)
 *   3. Pumpe AUS (nach Bewässerungsdauer)
 *   4. Bewässerungscomputer AUS (nach NACHLAUF Sekunden)
 * 
 * @param {number} minutes - Bewässerungsdauer in Minuten
 * @param {string} requestedBy - WhatsApp-Nummer des Anfordernden
 * @param {object} config - Optionale Konfiguration aus gartenPlan
 * @returns {Promise<{success: boolean, message: string, sequenzId?: string}>}
 */
async function startGartenSequenz(minutes, requestedBy, config = {}) {
  // Gerätenamen aus Config oder Defaults
  const deviceComputer = config.deviceComputer || GARTEN_DEVICE_COMPUTER;
  const devicePumpe = config.devicePumpe || GARTEN_DEVICE_PUMPE;
  const vorlaufSec = config.vorlaufSec ?? GARTEN_SEQUENZ_VORLAUF_SEC;
  const nachlaufSec = config.nachlaufSec ?? GARTEN_SEQUENZ_NACHLAUF_SEC;
  
  // Regen-Check
  try {
    const raining = await isCurrentlyRaining();
    if (raining) {
      return {
        success: false,
        message: `🌧️ Es regnet gerade – Bewässerung übersprungen!\n\nDer Himmel übernimmt das Giessen für euch. 🦆💧`,
        skippedRain: true,
      };
    }
  } catch (e) {
    logger.warn("startGartenSequenz: Wetter-Check fehlgeschlagen, fahre fort", e?.message);
  }
  
  // Prüfe ob Tuya konfiguriert ist
  if (!plugs.isConfigured()) {
    return {
      success: false,
      message: `⚠️ Smart Plugs nicht konfiguriert (TUYA_ACCESS_ID etc. in functions/.env).`,
    };
  }
  
  const now = Date.now();
  const sequenzId = `seq_${now}`;
  
  // Zeitpunkte berechnen
  const t1_computerAn = now;
  const t2_pumpeAn = now + vorlaufSec * 1000;
  const t3_pumpeAus = t2_pumpeAn + minutes * 60 * 1000;
  const t4_computerAus = t3_pumpeAus + nachlaufSec * 1000;
  
  // 1) Bewässerungscomputer sofort einschalten
  try {
    await plugs.setPower(deviceComputer, true);
    await debugLog("garten_seq_computer_on", { sequenzId, deviceComputer });
  } catch (e) {
    return {
      success: false,
      message: `😕 Konnte *${deviceComputer}* nicht einschalten:\n${e.message || e}`,
    };
  }
  
  // Tasks für die späteren Schritte anlegen
  const tasks = [
    {
      sequenzId,
      step: 2,
      action: "on",
      device: devicePumpe,
      executeAt: new Date(t2_pumpeAn).toISOString(),
      requestedBy,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
    },
    {
      sequenzId,
      step: 3,
      action: "off",
      device: devicePumpe,
      executeAt: new Date(t3_pumpeAus).toISOString(),
      requestedBy,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
    },
    {
      sequenzId,
      step: 4,
      action: "off",
      device: deviceComputer,
      executeAt: new Date(t4_computerAus).toISOString(),
      requestedBy,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
    },
  ];
  
  for (const task of tasks) {
    await db.collection("bewaesserung_tasks").add(task);
  }
  
  await debugLog("garten_seq_started", { sequenzId, minutes, deviceComputer, devicePumpe, vorlaufSec, nachlaufSec });
  
  const pumpeAnTime = new Date(t2_pumpeAn).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  const pumpeAusTime = new Date(t3_pumpeAus).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  const endeTime = new Date(t4_computerAus).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  
  return {
    success: true,
    sequenzId,
    message: `🌿 *Garten-Bewässerung gestartet!*\n\n` +
      `💧 Bewässerungscomputer: AN\n` +
      `💧 Pumpe AN: ${pumpeAnTime} Uhr (in ${vorlaufSec}s)\n` +
      `⏱️ Dauer: *${minutes} Minuten*\n` +
      `⏹️ Pumpe AUS: ${pumpeAusTime} Uhr\n` +
      `🔌 Ende: ${endeTime} Uhr\n\n` +
      `Zum Stoppen: "Bewässerung stopp" oder "Garten aus"`,
  };
}

/**
 * Stoppt alle laufenden Garten-Bewässerungssequenzen sofort.
 */
async function stopGartenSequenz(requestedBy) {
  const deviceComputer = GARTEN_DEVICE_COMPUTER;
  const devicePumpe = GARTEN_DEVICE_PUMPE;
  
  if (!plugs.isConfigured()) {
    return { success: false, message: `⚠️ Smart Plugs nicht konfiguriert.` };
  }
  
  // Beide Geräte ausschalten
  const errors = [];
  try {
    await plugs.setPower(devicePumpe, false);
  } catch (e) {
    errors.push(`Pumpe: ${e.message || e}`);
  }
  try {
    await plugs.setPower(deviceComputer, false);
  } catch (e) {
    errors.push(`Bewässerungscomputer: ${e.message || e}`);
  }
  
  // Alle offenen Tasks als erledigt markieren
  const snap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
  const ops = [];
  snap.forEach((doc) => {
    const d = doc.data();
    const dev = (d.device || "").toLowerCase();
    if (dev.includes("pump") || dev.includes("bewässerung") || d.sequenzId) {
      ops.push(doc.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp(), cancelledBy: requestedBy }));
    }
  });
  await Promise.all(ops);
  
  await debugLog("garten_seq_stopped", { requestedBy, tasksCleared: ops.length });
  
  if (errors.length) {
    return {
      success: false,
      message: `⚠️ Teilweise Fehler beim Stoppen:\n${errors.join("\n")}\n\nOffene Tasks wurden gelöscht.`,
    };
  }
  
  return {
    success: true,
    message: `⏹️ *Garten-Bewässerung gestoppt!*\n\n` +
      `🔌 Pumpe: AUS\n` +
      `🔌 Bewässerungscomputer: AUS\n\n` +
      `${ops.length} geplante Schritte abgebrochen.`,
  };
}

/**
 * Bricht eine Garten-Sequenz wegen Sicherheitsproblem ab.
 * Alle offenen Tasks der Sequenz werden als abgebrochen markiert,
 * Bewässerungscomputer wird ausgeschaltet, User wird benachrichtigt.
 */
async function abortGartenSequenz(sequenzId, requestedBy, reason, userMessage) {
  // Alle offenen Tasks dieser Sequenz abbrechen
  const snap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
  const ops = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.sequenzId === sequenzId) {
      ops.push(doc.ref.update({ 
        done: true, 
        cancelledAt: FieldValue.serverTimestamp(), 
        reason: "safety",
        safetyReason: reason,
      }));
    }
  });
  await Promise.all(ops);
  
  // Bewässerungscomputer sicherheitshalber ausschalten
  try {
    await plugs.setPower(GARTEN_DEVICE_COMPUTER, false);
  } catch (e) {
    logger.warn("abortGartenSequenz: Konnte Bewässerungscomputer nicht ausschalten", e?.message);
  }
  
  // User benachrichtigen
  if (requestedBy && userMessage) {
    await sendWhatsApp(requestedBy, userMessage);
  }
  
  await debugLog("garten_seq_aborted", { sequenzId, reason, tasksCleared: ops.length });
  logger.warn(`Garten-Sequenz ${sequenzId} abgebrochen: ${reason}`);
}

// Erkennt Bewässerungs-Befehle:
//   "Pumpe an" / "Pumpe aus" / "Pumpe 15 Min" → Gerät "Pumpe" (Smart-Life-Name)
//   "Beet aus" / "Steckdose Beet aus"         → { device: "beet", on: false }
//   "Bewässerung Rasen 20 Min"                → { device: "rasen", on: true, minutes: 20 }
function parseBewaesserungMessage(raw) {
  const s = String(raw).trim();
  const giessen = parseGiessenUmgang(s);
  if (giessen) return giessen;
  const firstWord = (s.split(/\s+/)[0] || "").toLowerCase();
  const re = /^(?:bewässerung|bewaesserung|pumpe|steckdose|plug)\s+(?:für\s+)?(.+?)$/i;
  const m = s.match(re);
  let rest = null;
  if (m) {
    rest = m[1].trim();
  } else {
    // Erlaubt direkt "Pumpe an" / "Lichterkette an" ohne Präfix (DE/EN/FR)
    const short = s.match(/^(pumpe|pump|pompe|beet|rasen|garten|terrasse|hecke|tropf|bewässerung|bewaesserung|lichterkette|licht|lights?|lumieres?)\s+(.+)$/i);
    if (!short) return null;
    rest = `${short[1]} ${short[2]}`;
  }

  // Zeitangabe finden: "15 min" / "20 minuten" / "5m"
  let minutes = null;
  const timeMatch = rest.match(/(\d{1,3})\s*(?:min(?:ute[n]?)?|m)\b/i);
  if (timeMatch) {
    minutes = Math.max(1, Math.min(PUMP_MAX_MINUTES, parseInt(timeMatch[1], 10)));
    rest = rest.replace(timeMatch[0], "").trim();
  }

  // On/Off
  let on = null;
  if (/\b(aus|off|stop+|stopp)\b/i.test(rest)) {
    on = false;
    rest = rest.replace(/\b(aus|off|stop+|stopp)\b/gi, "").trim();
  } else if (/\b(an|ein|on|start(?:en)?)\b/i.test(rest)) {
    on = true;
    rest = rest.replace(/\b(an|ein|on|start(?:en)?)\b/gi, "").trim();
  } else if (minutes !== null) {
    // "Pumpe 15 Min" ohne explizites "an" → implizit an
    on = true;
  } else {
    return null;
  }

  let device = rest.replace(/[,.;:!?]/g, " ").replace(/\s+/g, " ").trim();
  // "Pumpe an" / "Pumpe aus" / "Pumpe 15 Min" — in Smart Life heisst das Gerät oft ebenfalls "Pumpe"
  // EN: "pump on" → Pumpe | FR: "pompe on" → Pumpe
  if (!device && (firstWord === "pumpe" || firstWord === "pump" || firstWord === "pompe")) {
    device = "Pumpe";
  }
  // "Lichterkette an" / "Licht an" → Gerät "Lichterkette"
  // EN: "lights on" → Lichterkette | FR: "lumières on" → Lichterkette
  if (!device && (firstWord === "lichterkette" || firstWord === "licht" || firstWord === "lights" || firstWord === "light" || firstWord === "lumieres" || firstWord === "lumiere")) {
    device = "Lichterkette";
  }
  if (!device) return null;

  return { device, on, minutes };
}

function isPumpListCommand(raw) {
  // DE: pumpen, steckdosen | EN: pumps, plugs | FR: pompes, prises
  return /^(pumpen?|pumps?|pompes?|steckdosen|smartplugs?|plugs?|prises?|bewässerung|bewaesserung)\s*(?:status|liste|list|\?)?\s*[?.!]*$/i.test(String(raw).trim());
}

// Wetter-Befehl erkennen (DE/EN/FR)
function isWetterCommand(raw) {
  return /^(wetter|weather|meteo|wie\s+ist\s+(das\s+)?wetter|what'?s?\s+the\s+weather|quel\s+temps|regnet\s+es|is\s+it\s+raining|il\s+pleut|sonne|sun|soleil)\s*[?.!]*$/i.test(String(raw).trim());
}

/** Nächster Soll-Giesstermin (wie Scheduler), nur Datum 0:00 lokal. */
function giessplanNextDueDatePlain(data) {
  const intervalDays = data.intervalDays || 3;
  const lastWatered = data.lastWatered ? new Date(data.lastWatered) : null;
  let nextDate;
  if (lastWatered) {
    nextDate = startOfDay(new Date(lastWatered));
    nextDate.setDate(nextDate.getDate() + intervalDays);
  } else {
    nextDate = startOfDay(new Date());
  }
  return nextDate;
}

function giessplanIsDueOrOverdueData(data) {
  const today = startOfDay(new Date());
  const next = giessplanNextDueDatePlain(data);
  return next.getTime() <= today.getTime();
}

function giessplanPlantMatchesHint(plant, hint) {
  const p = String(plant || "").toLowerCase().trim();
  const h = String(hint || "").toLowerCase().trim();
  if (!h) return true;
  return p.includes(h) || h.includes(p);
}

/**
 * Giessplan-Innenpflanzen: «gegossen», «gegossen Wohnzimmer», LLM: *Giessplan gegossen: …*
 */
function parseGiessplanWateredMessage(raw) {
  let s = String(raw || "").trim().replace(/^\*+|\*+$/g, "").trim();
  if (!s) return null;
  const llmWith = /^(?:giessplan|blumenplan|zimmerpflanzen)\s+gegossen(?:\s*[:\-–]\s*|\s+)(.+)$/i.exec(s);
  if (llmWith) return { plantHint: llmWith[1].trim() };
  if (/^(?:giessplan|blumenplan|zimmerpflanzen)\s+gegossen\.?$/i.test(s)) return { plantHint: null };
  const de = /^(gegossen|habe\s+gegossen)(?:\s+(.+))?$/i.exec(s);
  if (de) return { plantHint: ((de[2] || "").trim()) || null };
  const en = /^(watered|done\s+watering)(?:\s+(.+))?$/i.exec(s);
  if (en) return { plantHint: ((en[2] || "").trim()) || null };
  const fr = /^(arros[ée]|j'ai\s+arrosé|jai\s+arrosé)(?:\s+(.+))?$/i.exec(s);
  if (fr) return { plantHint: ((fr[2] || "").trim()) || null };
  const rev = /^(.{2,60})\s+(gegossen|watered|arros[ée])\.?$/i.exec(s);
  if (rev && !/\b(pumpe|garten|rasen|beet|bewässerung|bewaesserung)\b/i.test(rev[1])) {
    return { plantHint: rev[1].trim() };
  }
  return null;
}

// WMO Weather Code zu Emoji + Text
function wmoToWeather(code) {
  const c = Number(code);
  if (c === 0) return { emoji: "☀️", de: "Klar", en: "Clear", fr: "Clair" };
  if (c === 1) return { emoji: "🌤️", de: "Überwiegend klar", en: "Mostly clear", fr: "Plutôt clair" };
  if (c === 2) return { emoji: "⛅", de: "Teilweise bewölkt", en: "Partly cloudy", fr: "Partiellement nuageux" };
  if (c === 3) return { emoji: "☁️", de: "Bewölkt", en: "Overcast", fr: "Couvert" };
  if (c >= 45 && c <= 48) return { emoji: "🌫️", de: "Nebel", en: "Fog", fr: "Brouillard" };
  if (c >= 51 && c <= 55) return { emoji: "🌧️", de: "Nieselregen", en: "Drizzle", fr: "Bruine" };
  if (c >= 56 && c <= 57) return { emoji: "🌧️❄️", de: "Gefrierender Niesel", en: "Freezing drizzle", fr: "Bruine verglaçante" };
  if (c >= 61 && c <= 65) return { emoji: "🌧️", de: "Regen", en: "Rain", fr: "Pluie" };
  if (c >= 66 && c <= 67) return { emoji: "🌧️❄️", de: "Gefrierender Regen", en: "Freezing rain", fr: "Pluie verglaçante" };
  if (c >= 71 && c <= 77) return { emoji: "🌨️", de: "Schnee", en: "Snow", fr: "Neige" };
  if (c >= 80 && c <= 82) return { emoji: "🌦️", de: "Regenschauer", en: "Rain showers", fr: "Averses" };
  if (c >= 85 && c <= 86) return { emoji: "🌨️", de: "Schneeschauer", en: "Snow showers", fr: "Averses de neige" };
  if (c >= 95 && c <= 99) return { emoji: "⛈️", de: "Gewitter", en: "Thunderstorm", fr: "Orage" };
  return { emoji: "🌡️", de: "Unbekannt", en: "Unknown", fr: "Inconnu" };
}

// Aktuelles Wetter holen (erweiterte API)
async function fetchCurrentWeather() {
  const params = new URLSearchParams({
    latitude: String(WEATHER_LAT),
    longitude: String(WEATHER_LON),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    timezone: "Europe/Zurich",
    forecast_days: "2",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`open-meteo ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

// Wetter-Text formatieren
function formatWeatherText(data, lang = "de") {
  const c = data.current;
  const hourly = data.hourly;
  const weather = wmoToWeather(c.weather_code);
  
  const temp = Math.round(c.temperature_2m);
  const feelsLike = Math.round(c.apparent_temperature);
  const humidity = c.relative_humidity_2m;
  const wind = Math.round(c.wind_speed_10m);
  const precip = c.precipitation;
  
  // Nächste Stunden Vorschau
  const now = new Date();
  const currentHour = now.getHours();
  const forecast = [];
  
  if (hourly && hourly.time) {
    for (let i = 0; i < hourly.time.length && forecast.length < 6; i++) {
      const t = new Date(hourly.time[i]);
      if (t.getHours() > currentHour || t.getDate() > now.getDate()) {
        const hw = wmoToWeather(hourly.weather_code[i]);
        const hTemp = Math.round(hourly.temperature_2m[i]);
        const hRain = hourly.precipitation_probability?.[i] || 0;
        forecast.push({ hour: t.getHours(), emoji: hw.emoji, temp: hTemp, rain: hRain });
      }
    }
  }
  
  if (lang === "en") {
    let text = `${weather.emoji} *Weather at Haus am See*\n\n`;
    text += `🌡️ ${temp}°C (feels like ${feelsLike}°C)\n`;
    text += `💧 Humidity: ${humidity}%\n`;
    text += `💨 Wind: ${wind} km/h\n`;
    if (precip > 0) text += `🌧️ Precipitation: ${precip} mm\n`;
    text += `\n*Condition:* ${weather.en}\n`;
    if (forecast.length) {
      text += `\n*Next hours:*\n`;
      forecast.slice(0, 4).forEach(f => {
        text += `${f.hour}:00 ${f.emoji} ${f.temp}°C ${f.rain > 20 ? `(${f.rain}% rain)` : ""}\n`;
      });
    }
    return text.trim();
  }
  
  if (lang === "fr") {
    let text = `${weather.emoji} *Météo à Haus am See*\n\n`;
    text += `🌡️ ${temp}°C (ressenti ${feelsLike}°C)\n`;
    text += `💧 Humidité: ${humidity}%\n`;
    text += `💨 Vent: ${wind} km/h\n`;
    if (precip > 0) text += `🌧️ Précipitations: ${precip} mm\n`;
    text += `\n*Conditions:* ${weather.fr}\n`;
    if (forecast.length) {
      text += `\n*Prochaines heures:*\n`;
      forecast.slice(0, 4).forEach(f => {
        text += `${f.hour}:00 ${f.emoji} ${f.temp}°C ${f.rain > 20 ? `(${f.rain}% pluie)` : ""}\n`;
      });
    }
    return text.trim();
  }
  
  // Default: Deutsch
  let text = `${weather.emoji} *Wetter am Haus am See*\n\n`;
  text += `🌡️ ${temp}°C (gefühlt ${feelsLike}°C)\n`;
  text += `💧 Luftfeuchtigkeit: ${humidity}%\n`;
  text += `💨 Wind: ${wind} km/h\n`;
  if (precip > 0) text += `🌧️ Niederschlag: ${precip} mm\n`;
  text += `\n*Aktuell:* ${weather.de}\n`;
  if (forecast.length) {
    text += `\n*Nächste Stunden:*\n`;
    forecast.slice(0, 4).forEach(f => {
      text += `${f.hour}:00 ${f.emoji} ${f.temp}°C ${f.rain > 20 ? `(${f.rain}% Regen)` : ""}\n`;
    });
  }
  return text.trim();
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

async function findSchadenByTitle(needle) {
  const snap = await db.collection("schaeden").get();
  const n = needle.toLowerCase();
  let best = null;
  snap.forEach((doc) => {
    const d = doc.data();
    if (d?.status === "erledigt") return;
    const t = (d.titel || "").toLowerCase();
    if (t === n) best = { id: doc.id, ...d };
    else if (!best && t.includes(n)) best = { id: doc.id, ...d };
  });
  return best;
}

async function markSchadenErledigt(id) {
  await db.collection("schaeden").doc(id).update({
    status: "erledigt",
    erledigtAt: FieldValue.serverTimestamp(),
  });
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
  `👋 Hoi! Ich heisse *Gustav* (Haus am See). Du kannst mich (1:1 oder in Gruppen mit *@gustav* / @bot) **auch** allgemein etwas fragen – wie ChatGPT, plus unsere Befehle unten.\n\n` +
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
  `✅ "Schaden erledigt: Rasenmäher" — als repariert markieren\n` +
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
  `📋 "Bewerber"\n` +
  `📣 "Zimmer teilen" / "Inserat Zimmer" — Inserat-Text + Link (→ WHATSAPP_GROUP_RECIPIENTS)\n\n` +
  `*Bewässerung / Smart Plugs*\n` +
  `💧 Auch: *"Giesse die Blumen"*, *"Garten bewässern"*, *"kannst du giesen"* (→ *Pumpe* ${PUMP_DEFAULT_MINUTES} min, Zahl in der Nachricht = Minuten; Stop: *Pumpe aus*)\n` +
  `💧 "Pumpe an" / "Pumpe aus" (auto-aus nach ${PUMP_DEFAULT_MINUTES} Min)\n` +
  `💧 "Pumpe 20 Min" (auto-aus nach 20 Min, max. ${PUMP_MAX_MINUTES})\n` +
  `💧 "Beet 20 Min" — andere Steckdose per Name\n` +
  `💡 "Lichterkette an" / "Licht aus"\n` +
  `📋 "Pumpen" — Status aller Steckdosen\n\n` +
  `🌐 ${WEBSITE_URL}`;

const HELP_TEXT_EN =
  `👋 Hi! I'm *Gustav*, the bot for "Haus am See" (lakehouse WG in Switzerland). You can ask me anything – like ChatGPT, plus our house commands below.\n\n` +
  `*Events*\n` +
  `➕ "New event: Summer party 15.8. 6pm | BBQ by the lake"\n` +
  `🗑️ "Delete event: Summer party"\n` +
  `📅 "Events"\n\n` +
  `*Cleaning schedule*\n` +
  `➕ "Cleaning: Manu 20.4. Kitchen"\n` +
  `📋 "Who's cleaning?"\n\n` +
  `*Attendance*\n` +
  `✅ "I'm here" / "I'm away"\n` +
  `📋 "Who's home?"\n\n` +
  `*Damages*\n` +
  `🔧 "Damage: Washing machine leaks | Basement | high"\n` +
  `    (attach photo = saved with report)\n` +
  `✅ "Damage done: Lawn mower" — mark as fixed\n` +
  `📋 "Damages"\n\n` +
  `*Event RSVP*\n` +
  `✅ "Yes Summer party" / "No Beer run"\n` +
  `📋 "Who's coming to Summer party?"\n\n` +
  `*Photos* (Image + Caption)\n` +
  `🏠 "Photo house garden" — for house images\n` +
  `🎉 "Photo Summer party" — for event photos\n` +
  `🖼️ "Photo" — to gallery\n\n` +
  `*Guestbook*\n` +
  `📝 "Guestbook: Had an amazing time!"\n\n` +
  `*Reminders*\n` +
  `🔔 "Remind me 30.4. at 8am: Pay bill"\n\n` +
  `*Room applicants*\n` +
  `➕ "Applicant: Lisa, 25 | Student, very friendly | +41 79 123 45 67"\n` +
  `📋 "Applicants"\n` +
  `📣 "Share room listing"\n\n` +
  `*Watering / Smart Plugs*\n` +
  `💧 "Water the plants" / "Water the garden" (→ Pump ${PUMP_DEFAULT_MINUTES} min)\n` +
  `💧 "Pump on" / "Pump off" (auto-off after ${PUMP_DEFAULT_MINUTES} min)\n` +
  `💧 "Pump 20 min" (auto-off after 20 min, max. ${PUMP_MAX_MINUTES})\n` +
  `💡 "Lights on" / "Lights off"\n` +
  `📋 "Pumps" — status of all plugs\n\n` +
  `🌐 ${WEBSITE_URL}`;

const HELP_TEXT_FR =
  `👋 Salut! Je suis *Gustav*, le bot de "Haus am See" (colocation au bord du lac en Suisse). Tu peux me poser n'importe quelle question – comme ChatGPT, plus nos commandes ci-dessous.\n\n` +
  `*Événements*\n` +
  `➕ "Nouvel événement: Fête d'été 15.8. 18h | BBQ au lac"\n` +
  `🗑️ "Supprimer événement: Fête d'été"\n` +
  `📅 "Événements"\n\n` +
  `*Planning ménage*\n` +
  `➕ "Ménage: Manu 20.4. Cuisine"\n` +
  `📋 "Qui nettoie?"\n\n` +
  `*Présence*\n` +
  `✅ "Je suis là" / "Je suis absent"\n` +
  `📋 "Qui est là?"\n\n` +
  `*Dommages*\n` +
  `🔧 "Dommage: Machine à laver fuit | Cave | élevé"\n` +
  `    (joindre photo = enregistrée avec le rapport)\n` +
  `✅ "Dommage réparé: Tondeuse" — marquer comme réparé\n` +
  `📋 "Dommages"\n\n` +
  `*Inscription événement*\n` +
  `✅ "Oui Fête d'été" / "Non Course de bière"\n` +
  `📋 "Qui vient à la Fête d'été?"\n\n` +
  `*Photos* (Image + Légende)\n` +
  `🏠 "Photo maison jardin" — pour images de la maison\n` +
  `🎉 "Photo Fête d'été" — pour photos d'événement\n` +
  `🖼️ "Photo" — dans la galerie\n\n` +
  `*Livre d'or*\n` +
  `📝 "Livre d'or: J'ai passé un moment incroyable!"\n\n` +
  `*Rappels*\n` +
  `🔔 "Rappelle-moi 30.4. à 8h: Payer facture"\n\n` +
  `*Candidats chambre*\n` +
  `➕ "Candidat: Lisa, 25 | Étudiante, très sympa | +41 79 123 45 67"\n` +
  `📋 "Candidats"\n` +
  `📣 "Partager annonce chambre"\n\n` +
  `*Arrosage / Prises connectées*\n` +
  `💧 "Arrose les plantes" / "Arrose le jardin" (→ Pompe ${PUMP_DEFAULT_MINUTES} min)\n` +
  `💧 "Pompe on" / "Pompe off" (arrêt auto après ${PUMP_DEFAULT_MINUTES} min)\n` +
  `💧 "Pompe 20 min" (arrêt auto après 20 min, max. ${PUMP_MAX_MINUTES})\n` +
  `💡 "Lumières on" / "Lumières off"\n` +
  `📋 "Pompes" — statut des prises\n\n` +
  `🌐 ${WEBSITE_URL}`;

/**
 * Spracherkennung anhand typischer Wörter.
 * @returns {"de"|"en"|"fr"}
 */
function detectLanguage(text) {
  const s = String(text || "").toLowerCase().trim();
  
  // 1) Eindeutige einzelne Wörter / kurze Phrasen zuerst (höchste Priorität)
  // Französisch - eindeutige Wörter
  if (/^(salut|bonjour|bonsoir|merci|aide|commandes?|oui|non|qui|quoi|comment|dommages?|evenements?|arrose|lumieres?|pompe\s+(on|off)|je\s+suis)/.test(s)) {
    return "fr";
  }
  // Englisch - eindeutige Wörter  
  if (/^(hello|hey\s+there|good\s+(morning|evening)|thanks|thank\s+you|help|commands?|yes|no|who'?s|what'?s|how|please|damage|lights?\s+(on|off)|pump\s+(on|off)|water\s+the|i'?m\s+(home|away|here))/.test(s)) {
    return "en";
  }
  
  // 2) Für längere Texte: Marker zählen
  const enMarkers = (s.match(/\b(the|is|are|what|who|where|how|please|yes|no|turn|water|plants|lights|home|away|coming|damage|remind|guestbook|cleaning|applicants|upcoming)\b/g) || []).length;
  const frMarkers = (s.match(/\b(le|la|les|qui|quoi|comment|est|sont|oui|non|lumiere|pompe|arrose|dommage|evenement|rappelle|livre|menage|candidats|chambre)\b/g) || []).length;
  const deMarkers = (s.match(/\b(ist|bitte|hilfe|ja|nein|wer|was|wie|wo|schaden|pumpe|licht|garten|wasser|bin|da|weg|putzt|bewerber|zimmer|hallo|danke)\b/g) || []).length;
  
  // Sprache mit den meisten Markern gewinnt
  if (enMarkers > deMarkers && enMarkers > frMarkers && enMarkers >= 1) return "en";
  if (frMarkers > deMarkers && frMarkers > enMarkers && frMarkers >= 1) return "fr";
  
  // 3) Default: Deutsch (Schweizer WG)
  return "de";
}

/**
 * Gibt den Hilfetext in der erkannten Sprache zurück.
 */
function getHelpText(lang) {
  if (lang === "en") return HELP_TEXT_EN;
  if (lang === "fr") return HELP_TEXT_FR;
  return HELP_TEXT;
}

/**
 * Versucht, die Nachricht als einen bestimmten Command zu verarbeiten.
 * Return: true wenn behandelt, false wenn nichts zutraf.
 */
async function dispatch(ctx) {
  const { from, text, mediaId, caption, senderName, phoneId: replyPhoneId } = ctx;
  const rawInput = text || caption || "";
  const reply = (t) => sendWhatsApp(from, t, replyPhoneId);

  // Bild mit oder ohne Caption?
  if (mediaId) {
    return await handlePhotoUpload(from, mediaId, caption, rawInput, replyPhoneId);
  }

  if (!rawInput) {
    return false;
  }

  // 0) Hilfe-Befehl → wird vom LLM behandelt (erkennt Sprache automatisch)
  //    Nicht mehr regelbasiert, damit das LLM in der richtigen Sprache antworten kann

  // 0.5) Wetter-Befehl
  if (isWetterCommand(rawInput)) {
    try {
      const lang = detectLanguage(rawInput);
      const weatherData = await fetchCurrentWeather();
      const weatherText = formatWeatherText(weatherData, lang);
      await reply(weatherText);
    } catch (e) {
      logger.error("Wetter-Abfrage fehlgeschlagen", e);
      await reply("🌡️ Ups, konnte das Wetter gerade nicht abrufen. Versuch's später nochmal!");
    }
    return true;
  }

  // 1) Lösch-Befehl für Events
  const del = parseDeleteMessage(rawInput);
  if (del) {
    const result = await deleteEventByTitle(del.title);
    if (result.deleted === 0) {
      await reply(`🤷 Kein Event mit "${del.title}" gefunden.\n\nSchick "Events" für eine Liste.`);
    } else if (result.deleted === 1) {
      const m = result.matches[0];
      const d = m.date ? fmtDateTime(m.date) : "";
      await reply(`🗑️ Gelöscht: "${m.title}"${d ? ` am ${d}` : ""}`);
    } else {
      const list = result.matches.map((m) => `• ${m.title}`).join("\n");
      await reply(`🗑️ ${result.deleted} Events gelöscht:\n${list}`);
    }
    return true;
  }

  // 2) Events auflisten
  if (isListEventsCommand(rawInput)) {
    const items = await listUpcomingEvents(10);
    if (!items.length) {
      await reply(`📅 Keine kommenden Events.`);
    } else {
      const lines = items.map((e) => `• ${e.title} – ${fmtDateTime(e.date)}`);
      await reply(`📅 *Kommende Events:*\n${lines.join("\n")}\n\n${WEBSITE_URL}/#events`);
    }
    return true;
  }

  // 3) Neues Event
  const newEv = parseEventMessage(rawInput);
  if (newEv) {
    const id = await createEvent(newEv, from);
    const desc = newEv.description ? `\n📝 ${newEv.description}` : "";
    await reply(`✅ Event angelegt: *${newEv.title}*\n📅 ${fmtDateTime(newEv.date)}${desc}\n\n${WEBSITE_URL}/#events`);
    await debugLog("event_created", { id, from, title: newEv.title });
    return true;
  }

  // 4) Putzplan auflisten
  if (isPutzListCommand(rawInput)) {
    const items = await listPutzWeek();
    if (!items.length) {
      await reply(`🧹 Diese Woche kein Putzplan-Eintrag.`);
    } else {
      const lines = items.map((p) => {
        const when = p.when ? fmtDate(p.when) : "";
        const status = p.done ? "✅" : "⏳";
        return `${status} ${p.task}${p.who ? ` – ${p.who}` : ""}${when ? ` (${when})` : ""}`;
      });
      await reply(`🧹 *Putzplan diese Woche:*\n${lines.join("\n")}`);
    }
    return true;
  }

  // 5) Putz eintragen
  const putz = parsePutzAdd(rawInput);
  if (putz) {
    await addPutz(putz);
    const whoTxt = putz.who ? ` von ${putz.who}` : "";
    await reply(`🧹 Eingetragen: *${putz.task}*${whoTxt} am ${fmtDate(putz.when)}`);
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
    await reply(lines.join("\n"));
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
      await reply(`❓ Ich weiss nicht wer du bist. Schreib z.B.: "Manu ist weg 1.5."`);
      return true;
    }
    await setAnwesend(resident, anw.status);
    const icon = anw.status === "da" ? "✅" : "❌";
    await reply(`${icon} ${resident} am Wochenende: *${anw.status === "da" ? "da" : "weg"}*`);
    return true;
  }

  // 8) Schäden auflisten
  if (isSchadenListCommand(rawInput)) {
    const items = await listOffeneSchaeden(15);
    if (!items.length) {
      await reply(`🔧 Keine offenen Schäden. 🎉`);
    } else {
      const prioEmoji = { high: "🔴", medium: "🟡", low: "🟢" };
      const lines = items.map((s) => `${prioEmoji[s.prio] || "🟡"} *${s.titel}*${s.ort ? ` – ${s.ort}` : ""}`);
      await reply(`🔧 *Offene Schäden:*\n${lines.join("\n")}`);
    }
    return true;
  }

  // 9a) Schaden erledigt / löschen
  const erledigtCmd = parseSchadenErledigtMessage(rawInput);
  if (erledigtCmd) {
    const found = await findSchadenByTitle(erledigtCmd.titel);
    if (!found) {
      await reply(`🤷 Kein offener Schaden mit "${erledigtCmd.titel}" gefunden.\n\nSchick "Schäden" für die Liste.`);
    } else {
      await markSchadenErledigt(found.id);
      await reply(`✅ Schaden erledigt: *${found.titel}*${found.ort ? ` (${found.ort})` : ""}\n\n🎉 Super, danke fürs Reparieren!`);
    }
    return true;
  }

  // 9b) Schaden melden (ohne Foto; mit Foto s. handlePhotoUpload)
  const schaden = parseSchadenMessage(rawInput);
  if (schaden) {
    const id = await addSchaden(schaden, senderName || from);
    await reply(`🔧 Schaden erfasst: *${schaden.titel}*${schaden.ort ? ` (${schaden.ort})` : ""}\n\n${WEBSITE_URL}/#schaeden`);
    return true;
  }

  // 10) RSVP auflisten
  const rsvpList = parseRSVPListCommand(rawInput);
  if (rsvpList) {
    const ev = await findEventByTitle(rsvpList.title);
    if (!ev) {
      await reply(`🤷 Kein Event mit "${rsvpList.title}" gefunden.`);
    } else {
      const items = await listRSVPs(ev.id);
      if (!items.length) {
        await reply(`🎉 Noch keine Anmeldungen für *${ev.title}*.`);
      } else {
        const lines = items.map((r) => `• ${r.name}${r.partnerName ? ` + ${r.partnerName}` : r.needsPartner ? " (sucht Partner)" : ""}`);
        await reply(`🎉 *${ev.title}* – ${items.length} Anmeldungen:\n${lines.join("\n")}`);
      }
    }
    return true;
  }

  // 11) RSVP (Ja/Nein)
  const rsvp = parseRSVPMessage(rawInput);
  if (rsvp) {
    const ev = await findEventByTitle(rsvp.title);
    if (!ev) {
      await reply(`🤷 Kein Event mit "${rsvp.title}" gefunden.\nSchick "Events" für die Liste.`);
      return true;
    }
    const name = senderName || "Gast";
    if (rsvp.wantsIn) {
      await addRSVP(ev.id, name);
      await reply(`✅ ${name} angemeldet für *${ev.title}* (${fmtDateTime(ev.date)}).`);
    } else {
      const removed = await removeRSVP(ev.id, name);
      await reply(removed ? `❌ ${name} abgemeldet von *${ev.title}*.` : `ℹ️ Du warst nicht angemeldet für *${ev.title}*.`);
    }
    return true;
  }

  // 12a) Bewerber auflisten
  if (isBewerberListCommand(rawInput)) {
    const items = await listOffeneKandidaten(15);
    if (!items.length) {
      await reply(`🚪 Keine offenen Bewerber:innen.`);
    } else {
      const statusEmoji = { offen: "⏳", eingeladen: "📩", kennengelernt: "🤝", zusage: "💚", abgesagt: "❌" };
      const lines = items.map((k) => {
        const ico = statusEmoji[k.status] || "⏳";
        const alter = k.alter ? ` (${k.alter})` : "";
        const kontakt = k.kontakt ? `\n   📞 ${k.kontakt}` : "";
        const info = k.info ? `\n   ℹ️ ${k.info.slice(0, 100)}${k.info.length > 100 ? "…" : ""}` : "";
        return `${ico} *${k.name}*${alter}${info}${kontakt}`;
      });
      await reply(`🚪 *Bewerber:innen (${items.length}):*\n\n${lines.join("\n\n")}\n\n${WEBSITE_URL}/#kandidaten`);
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
    await reply(`🚪 Bewerber:in gespeichert: *${bew.name}*${alter}${extra ? "\n\n" + extra : ""}\n\n💡 Foto nachreichen: schick ein Bild mit Caption "Foto Bewerber ${bew.name}"\n\n${WEBSITE_URL}/#kandidaten`);
    await debugLog("kandidat_created", { id, from, name: bew.name });
    return true;
  }

  // 12c) Zimmer-Inserat teilen (Broadcast)
  if (isZimmerShareCommand(rawInput)) {
    let snap;
    try {
      snap = await db.doc("config/roomOffer").get();
    } catch (e) {
      await reply(`😕 Konnte das Inserat nicht laden: ${e.message || e}`);
      return true;
    }
    const ro = snap.exists ? snap.data() : null;
    if (!ro?.active) {
      await reply(
        "🚪 Das Zimmer-Inserat ist gerade *nicht aktiv*. Aktiviere es unter WG-Intern → Zimmer frei, dann z.B. «Zimmer teilen» erneut."
      );
      return true;
    }
    const msg = buildZimmerBroadcastMessage(ro);
    const { recipients } = cfg();
    if (recipients.length) {
      await broadcast(msg);
      await reply(
        `✅ Inserat wurde an *${recipients.length}* eingetragene Empfänger geschickt.\n\n💡 Facebook/Instagram postet ihr am besten selbst – der Bot hat dafür keine Meta-Freigabe.`
      );
    } else {
      await reply(
        `${msg}\n\n_(WHATSAPP_GROUP_RECIPIENTS ist leer – Nachricht nur an dich.)_`
      );
    }
    return true;
  }

  // 13) Gästebuch
  const gb = parseGaestebuchMessage(rawInput);
  if (gb) {
    await addGaestebuchEntry(senderName || "WhatsApp", gb.text);
    await reply(`📝 Eintrag gespeichert – danke dir! 🌿\n\n${WEBSITE_URL}/#gaestebuch`);
    return true;
  }

  // 13) Erinnerung
  const er = parseErinnerungMessage(rawInput);
  if (er) {
    await addErinnerung(er, from);
    await reply(`🔔 Okay, ich melde mich am ${fmtDateTime(er.date)}:\n"${er.text}"`);
    return true;
  }

  // 13b) Giessplan (Zimmerpflanzen): als gegossen markieren — stoppt taegliche Erinnerungen bis naechster Termin
  let giessParseText = rawInput.trim();
  let giessplanResidentOverride = null;
  const giessNameLead = /^([A-Za-zäöüÄÖÜ]+)\s+(gegossen|watered|arros[ée])\b/i.exec(giessParseText);
  if (giessNameLead) {
    const rLead = resolveResident(giessNameLead[1], true);
    if (rLead) {
      giessplanResidentOverride = rLead;
      giessParseText = giessParseText.slice(giessNameLead[1].length).trim();
    }
  }
  const giessMark = parseGiessplanWateredMessage(giessParseText);
  if (giessMark) {
    let resident = giessplanResidentOverride || (await resolveResidentFromWhatsApp(from, senderName));
    if (!resident) {
      await reply(
        "❓ Ich weiss nicht, wer du bist. Schreib z.B. *gegossen Wohnzimmer* von deiner Nummer aus, oder *Manu gegossen Wohnzimmer*."
      );
      return true;
    }
    let snap;
    try {
      snap = await db.collection("giessplan").get();
    } catch (e) {
      logger.error("giessplan load", e);
      await reply("😕 Giessplan konnte nicht geladen werden.");
      return true;
    }
    const items = [];
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
    const whoEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    let candidates = items.filter((it) => whoEq(it.who, resident));
    if (giessMark.plantHint) {
      candidates = candidates.filter((it) => giessplanPlantMatchesHint(it.plant, giessMark.plantHint));
    }
    if (candidates.length === 0) {
      await reply(
        giessMark.plantHint
          ? `🤷 Keine Pflanze «${giessMark.plantHint}» für *${resident}* im Giessplan.`
          : `🤷 Kein Giessplan-Eintrag für *${resident}*.`
      );
      return true;
    }
    if (candidates.length === 1) {
      const one = candidates[0];
      try {
        await db.collection("giessplan").doc(one.id).update({ lastWatered: new Date().toISOString() });
      } catch (e) {
        logger.error("giessplan update", e);
        await reply(`😕 Konnte nicht speichern: ${e.message || e}`);
        return true;
      }
      await reply(`✅ *${one.plant}* als gegossen markiert – danke *${resident}*! 💦🌿\n\n${WEBSITE_URL}/#kalender`);
      return true;
    }
    if (giessMark.plantHint) {
      const lines = candidates.map((c) => `• *${c.plant}*`).join("\n");
      await reply(`💧 Welche meinst du?\n\n${lines}\n\nAntwort z.B.: *gegossen Wohnzimmer*`);
      return true;
    }
    const due = candidates.filter(giessplanIsDueOrOverdueData);
    if (due.length === 1) {
      const one = due[0];
      try {
        await db.collection("giessplan").doc(one.id).update({ lastWatered: new Date().toISOString() });
      } catch (e) {
        logger.error("giessplan update", e);
        await reply(`😕 Konnte nicht speichern: ${e.message || e}`);
        return true;
      }
      await reply(`✅ *${one.plant}* als gegossen markiert – danke *${resident}*! 💦🌿\n\n${WEBSITE_URL}/#kalender`);
      return true;
    }
    if (due.length === 0) {
      const lines = candidates.map((c) => `• *${c.plant}*`).join("\n");
      await reply(
        `💡 Alle deine Pflanzen sind laut Plan noch nicht fällig. Welche hast du trotzdem gegossen?\n\n${lines}\n\n*z.B. gegossen Wohnzimmer*`
      );
      return true;
    }
    const lines = due.map((c) => `• *${c.plant}*`).join("\n");
    await reply(`💧 Mehrere Pflanzen fällig – welche?\n\n${lines}\n\n*z.B. gegossen Wohnzimmer*`);
    return true;
  }

  // 14a) Steckdosen-Status / Liste
  if (isPumpListCommand(rawInput)) {
    if (!plugs.isConfigured()) {
      await reply(`⚠️ Smart Plugs nicht konfiguriert (TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_UID in functions/.env).`);
      return true;
    }
    try {
      const items = await plugs.getAllStatus();
      if (!items.length) {
        await reply(`🔌 Keine Smart Plugs gefunden. Sind sie im Refoss-Account eingerichtet?`);
      } else {
        const lines = items.map((d) => {
          if (!d.online) return `📴 ${d.name} — offline`;
          if (d.on === null) return `❓ ${d.name} — Status unbekannt`;
          return d.on ? `🟢 ${d.name} — AN` : `⚪ ${d.name} — aus`;
        });
        await reply(`🔌 *Smart Plugs:*\n\n${lines.join("\n")}`);
      }
    } catch (e) {
      await reply(`😕 Konnte die Smart-Plug-Cloud nicht erreichen: ${e.message || e}`);
      await debugLog("plug_error", { cmd: "list", error: String(e.message || e) });
    }
    return true;
  }

  // 14b) Garten-Bewässerung (Sequenz: Bewässerungscomputer → Pumpe)
  const pump = parseBewaesserungMessage(rawInput);
  if (pump) {
    // Garten-Sequenz: "giesse die blumen", "garten bewässern", etc.
    if (pump.gartenSequenz) {
      if (pump.on) {
        // Sequenz starten
        const result = await startGartenSequenz(pump.minutes, from);
        await reply(result.message);
        if (result.success) {
          await debugLog("garten_seq_whatsapp", { sequenzId: result.sequenzId, minutes: pump.minutes, from });
        }
      } else {
        // Sequenz stoppen
        const result = await stopGartenSequenz(from);
        await reply(result.message);
      }
      return true;
    }
    
    // Einzelgerät-Steuerung: "Pumpe an", "Lichterkette aus", etc.
    if (!plugs.isConfigured()) {
      await reply(`⚠️ Smart Plugs nicht konfiguriert (TUYA_ACCESS_ID / TUYA_ACCESS_SECRET / TUYA_UID in functions/.env).`);
      return true;
    }
    try {
      const result = await plugs.setPower(pump.device, pump.on);
      const deviceLower = (result.name || pump.device || "").toLowerCase();
      const skipTimer = NO_TIMER_DEVICES.some((n) => deviceLower.includes(n));
      const isPumpDevice = deviceLower.includes("pump") || deviceLower.includes("beet") || deviceLower.includes("garten") || deviceLower.includes("rasen");
      
      if (pump.on) {
        if (skipTimer) {
          // Kein Timer für Lichterkette etc. – bleibt an
          await reply(`💡 *${result.name}* ist an.\n\nAusschalten? Schreib "${result.name} aus".`);
        } else {
          // Regen-Check: Warnung wenn es regnet oder bald regnet
          let rainWarning = "";
          if (isPumpDevice) {
            try {
              const raining = await isCurrentlyRaining();
              if (raining) {
                rainWarning = "\n\n🌧️ *Achtung:* Es regnet gerade! Die Bewässerung wird automatisch gestoppt falls der Regen anhält.";
              }
            } catch (e) {
              // Ignorieren wenn Wetter-Check fehlschlägt
            }
          }
          
          // Auto-Off planen: entweder explizit (pump.minutes) oder Default
          const minutes = pump.minutes ?? PUMP_DEFAULT_MINUTES;
          const offAt = new Date(Date.now() + minutes * 60000);
          await db.collection("bewaesserung_tasks").add({
            device: result.name,
            offAt: offAt.toISOString(),
            requestedBy: from,
            createdAt: FieldValue.serverTimestamp(),
            done: false,
          });
          const bis = offAt.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
          await reply(
            `💧 *${result.name}* läuft. Automatisch aus in *${minutes} Min* (${bis} Uhr).\n\nSchneller aus? Schreib "${result.name} aus".${rainWarning}`
          );
        }
      } else {
        // Bei Aus: alle offenen Timer zu diesem Gerät schliessen (nur done==false, Rest im Code filtern = kein Zusatz-Index)
        const openSnap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
        const ops = [];
        openSnap.forEach((d) => {
          if (d.data().device === result.name) {
            ops.push(d.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp() }));
          }
        });
        await Promise.all(ops);
        await reply(`⏹️ *${result.name}* ist aus.`);
      }
      await debugLog("plug_action", { device: result.name, on: pump.on, minutes: pump.minutes });
    } catch (e) {
      await reply(`😕 Steckdose konnte nicht geschaltet werden:\n${e.message || e}`);
      await debugLog("plug_error", { cmd: "set", device: pump.device, on: pump.on, error: String(e.message || e) });
    }
    return true;
  }

  // 15) Help / unbekannt
  return false;
}

async function handlePhotoUpload(from, mediaId, caption, rawInput, phoneId) {
  const fotoCmd = parseFotoCommand(caption);
  const reply = (t) => sendWhatsApp(from, t, phoneId);
  await debugLog("photo_received", { from, mediaId, caption, fotoCmd });

  const src = await downloadMedia(mediaId);
  if (!src) {
    await reply(`😕 Konnte das Bild nicht laden. Versuchs nochmal?`);
    return true;
  }

  // Foto zu einem Schaden? ("Schaden: ..." als Caption)
  const schaden = parseSchadenMessage(rawInput);
  if (schaden) {
    const id = await addSchaden(schaden, from, src);
    await reply(`🔧 Schaden mit Foto erfasst: *${schaden.titel}*\n\n${WEBSITE_URL}/#schaeden`);
    return true;
  }

  // Foto + Bewerber-Kommando in einem? ("Bewerber: Lisa, 25 | …" als Caption)
  const bewInline = parseBewerberMessage(rawInput);
  if (bewInline) {
    const id = await addKandidat(bewInline, from, src);
    const alter = bewInline.alter ? ` (${bewInline.alter})` : "";
    await reply(`🚪 Bewerber:in mit Foto gespeichert: *${bewInline.name}*${alter}\n\n${WEBSITE_URL}/#kandidaten`);
    return true;
  }

  // Foto-Command?
  if (fotoCmd) {
    if (fotoCmd.kind === "hausbild") {
      await addHausbild(fotoCmd.featureId, src);
      await reply(`🏠 Hausbild für *${fotoCmd.featureId}* gespeichert.\n\n${WEBSITE_URL}/#haus`);
      return true;
    }
    if (fotoCmd.kind === "kandidat") {
      const k = await findKandidatByName(fotoCmd.name);
      if (k) {
        await attachFotoToKandidat(k.id, src);
        await reply(`🚪 Foto zu *${k.name}* gespeichert.\n\n${WEBSITE_URL}/#kandidaten`);
      } else {
        const id = await addKandidat({ name: fotoCmd.name, alter: null, info: "", kontakt: "" }, from, src);
        await reply(`🚪 Neue:r Bewerber:in angelegt: *${fotoCmd.name}* (mit Foto).\n\nMehr Infos? z.B. "Bewerber ${fotoCmd.name}, 25 | kurze Beschreibung | Kontakt"\n\n${WEBSITE_URL}/#kandidaten`);
      }
      return true;
    }
    if (fotoCmd.kind === "event-or-galerie") {
      const ev = await findEventByTitle(fotoCmd.target);
      if (ev) {
        await addEventFoto(ev.id, src);
        await reply(`📸 Foto zu *${ev.title}* hinzugefügt.\n\n${WEBSITE_URL}/#events`);
        return true;
      }
      await addGalerieBild(src, fotoCmd.target);
      await reply(`🖼️ In die Galerie gepackt: "${fotoCmd.target}"\n\n${WEBSITE_URL}/#galerie`);
      return true;
    }
  }

  // Fallback: ab in die Galerie
  await addGalerieBild(src, caption || "");
  await reply(`🖼️ Foto in der Galerie gespeichert.\n\n${WEBSITE_URL}/#galerie\n\n💡 Tipp: Mit Caption "Foto Sommerfest" landet's bei einem Event, mit "Schaden: …" bei den Schäden.`);
  return true;
}

/* ==========================================================================
   Webhook (Meta WhatsApp Cloud API)
   ========================================================================== */

exports.whatsappWebhook = onRequest(
  { cors: false, invoker: "public", timeoutSeconds: 120, memory: "512MiB" },
  async (req, res) => {
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
        /** Muss fürs Senden passen, sonst antwortet die API mit einer anderen Nummer / still. */
        const replyPhoneId = value.metadata?.phone_number_id;
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        // Echte Gruppen: Meta liefert `group_id` am Message-Objekt (s. Groups Messaging
        // Doku) – nicht nur `context.group_id`. NICHT `from_me === false` verwenden:
        // das trifft auf normale 1:1-User-Nachrichten zu und würde sie fälschlich als
        // Gruppe werten → Bot ignoriert ohne @bot/Heuristik.
        const isGroup = messages.some((m) => Boolean(m?.group_id || m?.context?.group_id));

        for (const msg of messages) {
          const from = msg.from;
          const answer = (t) => sendWhatsApp(from, t, replyPhoneId);
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

          // Gruppen-Filter: Nur reagieren, wenn direkt angesprochen. In Privatchats immer.
          const combined = text || caption;
          const mention = stripBotMention(combined);
          const isPrivate = !isGroup;
          await debugLog("message", {
            from,
            senderName,
            phoneNumberId: replyPhoneId,
            type,
            text: text.slice(0, 200),
            caption: caption.slice(0, 200),
            hasMedia: !!mediaId,
            isGroup,
            isPrivate,
            hasGroupId: messages.some((m) => Boolean(m?.group_id || m?.context?.group_id)),
          });

          // Zusätzliche Heuristik: WhatsApp Cloud API liefert derzeit für Gruppen wenig Metadaten.
          // Wenn der Text mit einem Trigger-Wort beginnt ("Neues Event", "Schaden", "Putz", …), akzeptieren wir trotzdem.
          const looksLikeDirectCommand = /^(neue[rs]?\s+)?(event|termin|anlass|party|geburtstag|apero|schaden|putz|gäste?buch|erinner|foto|bild|bewerber|bewerberin|kandidat|kandidatin|zimmer|bewässerung|bewaesserung|pumpe|pumpen|steckdose[n]?|smartplugs?|plugs?|beet|rasen|garten|terrasse|hecke|tropf|lichterkette|licht|events?|termine?|liste|wer\s+(putzt|ist|kommt)|bin\s+(da|hier|weg|fort)|ja\s+|nein\s+)/i.test(combined.trim());
          const looksLikeGiesBewaesser =
            /(giess|gieß|giesse|giessen|bewäss\w*|\bgarten\s+\w*|\bblu-?m|kannst du.*(giess|wässer|bewäss|gies)|@gustav)/i.test(combined) &&
            /(giess|gie(ß|ss)|\bwässer\w*|\bbewäss\w*|\bgarten|blu-?m|kannst du|@g|gustav|hey)/i.test(combined);

          if (!isPrivate && !mention.addressed && !looksLikeDirectCommand && !looksLikeGiesBewaesser) {
            await debugLog("group_ignored", { from, senderName, preview: combined.slice(0, 80) });
            continue;
          }

          // Nachricht reinigen: Wenn angesprochen wurde, den Bot-Präfix entfernen
          const effectiveText = mention.addressed ? mention.text : (text || caption);
          const effectiveCaption = mediaId ? (mention.addressed ? mention.text : caption) : caption;
          // LLM: nur Text; in Gruppen nur @gustav / @bot o. Standard: LLM **zuerst** (Kontext), dann regelbasiert.
          // Optional: GUSTAV_LLM_RULES_FIRST=1 → alte Reihenfolge.
          const allowLlm = !mediaId && (isPrivate || mention.addressed);
          const useLlm = allowLlm && llmRouter.isLlmEnabled();
          const rulesFirst = llmRouter.isLlmRulesFirst();

          let plan = { command: null, antwort: null };
          let handled = false;

          if (mediaId) {
            handled = await dispatch({
              from,
              senderName,
              text: "",
              caption: effectiveCaption,
              mediaId,
              phoneId: replyPhoneId,
            });
          } else if (useLlm && !rulesFirst) {
            try {
              plan = await llmRouter.naturalLanguageToCommand(effectiveText, { senderName });
              await debugLog("llm_interpret", {
                from,
                order: "llm_first",
                hasCommand: !!plan.command,
                hasAntwort: !!plan.antwort,
                preview: JSON.stringify(plan).slice(0, 2000),
              });
              if (plan.command) {
                handled = await dispatch({
                  from,
                  senderName,
                  text: plan.command,
                  caption: "",
                  mediaId: null,
                  phoneId: replyPhoneId,
                });
              }
            } catch (llmErr) {
              logger.error("llm_interpret", llmErr);
              await debugLog("llm_error", { error: String(llmErr?.message || llmErr) });
            }
            if (!handled) {
              handled = await dispatch({
                from,
                senderName,
                text: effectiveText,
                caption: "",
                mediaId: null,
                phoneId: replyPhoneId,
              });
            }
            if (!handled && plan.antwort) {
              await answer(plan.antwort);
              handled = true;
            }
          } else if (useLlm && rulesFirst) {
            handled = await dispatch({
              from,
              senderName,
              text: effectiveText,
              caption: "",
              mediaId: null,
              phoneId: replyPhoneId,
            });
            if (!handled) {
              try {
                plan = await llmRouter.naturalLanguageToCommand(effectiveText, { senderName });
                await debugLog("llm_interpret", {
                  from,
                  order: "rules_first",
                  hasCommand: !!plan.command,
                  hasAntwort: !!plan.antwort,
                  preview: JSON.stringify(plan).slice(0, 2000),
                });
                if (plan.command) {
                  handled = await dispatch({
                    from,
                    senderName,
                    text: plan.command,
                    caption: "",
                    mediaId: null,
                    phoneId: replyPhoneId,
                  });
                }
                if (!handled && plan.antwort) {
                  await answer(plan.antwort);
                  handled = true;
                }
              } catch (llmErr) {
                logger.error("llm_interpret", llmErr);
                await debugLog("llm_error", { error: String(llmErr?.message || llmErr) });
              }
            }
          } else {
            handled = await dispatch({
              from,
              senderName,
              text: effectiveText,
              caption: "",
              mediaId: null,
              phoneId: replyPhoneId,
            });
          }

          if (!handled) {
            await debugLog("no_match", { from, text: effectiveText });
            await answer(HELP_TEXT);
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
  const header = isBewerbung
    ? "🚪 *Bewerbung über Kontaktformular:*"
    : "✉️ *Nachricht über Kontaktformular:*";
  const lines = [
    header, "",
    `*Von:* ${data.name || "Anonym"}`,
    data.email ? `*Mail:* ${data.email}` : "",
    isBewerbung && data.alter ? `*Alter:* ${data.alter}` : "",
    isBewerbung && data.einzug ? `*Einzug ab:* ${data.einzug}` : "",
    "",
    data.message || data.nachricht || "",
    "",
    `→ ${WEBSITE_URL}/#wg-intern`,
  ].filter(Boolean);
  await broadcast(lines.join("\n"));
});

/* ==========================================================================
   Scheduler: Erinnerungen – jede Minute (kein Composite-Index; Zeit = ISO in UTC)
   ========================================================================== */

exports.checkReminders = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Europe/Zurich" },
  async () => {
    const nowISO = new Date().toISOString();
    const snap = await db.collection("erinnerungen").where("sent", "==", false).get();
    const due = snap.docs.filter((doc) => {
      const x = doc.data().date;
      return x && String(x) <= nowISO;
    });

    const promises = [];
    due.forEach((doc) => {
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
    if (promises.length) logger.info(`Reminders sent: ${promises.length}`);
  }
);

/* ==========================================================================
   Scheduler: Giessplan-Erinnerungen – täglich 8:00 Uhr
   ========================================================================== */

// Mapping von Bewohner-Namen zu WhatsApp-Nummern (aus memberPrefs oder hardcoded)
async function getBewohnerPhone(name) {
  // Versuche zuerst memberPrefs zu laden
  const prefsSnap = await db.collection("config").doc("memberPrefs").get();
  const prefs = prefsSnap.exists ? prefsSnap.data() : {};
  if (prefs[name]?.phone) return prefs[name].phone.replace(/\D/g, "");
  
  // Fallback: Hardcoded Mapping (kann erweitert werden)
  const phonebook = {
    "Manu": "41798385590",
    "Corina": "41795553906",
    "Jasmin": "41762988934",
    "Dino": "41765740020",
    "Andy": "41798489999",
    "Hugues": "41795911251",
    "Fanny": "41789561100",
  };
  return phonebook[name] || null;
}

exports.checkGiessplanReminders = onSchedule(
  { schedule: "every day 08:00", timeZone: "Europe/Zurich" },
  async () => {
    const snap = await db.collection("giessplan").get();
    if (snap.empty) return;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const duePlants = [];
    
    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (!d.reminder) return; // Nur wenn Erinnerung aktiviert
      
      const lastWatered = d.lastWatered ? new Date(d.lastWatered) : null;
      const intervalDays = d.intervalDays || 3;
      
      let nextDate;
      if (lastWatered) {
        nextDate = new Date(lastWatered);
        nextDate.setDate(nextDate.getDate() + intervalDays);
      } else {
        // Noch nie gegossen → heute fällig
        nextDate = today;
      }
      nextDate.setHours(0, 0, 0, 0);
      
      // Heute oder überfällig?
      if (nextDate <= today) {
        duePlants.push({
          id: doc.id,
          plant: d.plant,
          who: d.who,
          intervalDays,
          lastWatered: d.lastWatered,
          overdue: nextDate < today,
        });
      }
    });
    
    if (duePlants.length === 0) {
      logger.info("Giessplan: Heute keine Pflanzen fällig");
      return;
    }
    
    // Gruppiere nach Person
    const byPerson = {};
    duePlants.forEach((p) => {
      if (!byPerson[p.who]) byPerson[p.who] = [];
      byPerson[p.who].push(p);
    });
    
    // Sende Erinnerungen
    const promises = [];
    for (const [name, plants] of Object.entries(byPerson)) {
      const phone = await getBewohnerPhone(name);
      if (!phone) {
        logger.warn(`Giessplan: Keine Telefonnummer für ${name}`);
        continue;
      }
      
      const plantList = plants.map((p) => {
        const icon = p.overdue ? "⚠️" : "💧";
        return `${icon} ${p.plant}${p.overdue ? " (überfällig!)" : ""}`;
      }).join("\n");
      
      const msg = `🌱 *Giess-Erinnerung für ${name}*\n\nHeute bitte giessen:\n${plantList}\n\n🦆 Deine Pflanzen danken dir!`;
      
      promises.push(sendWhatsApp(phone, msg));
    }
    
    await Promise.all(promises);
    logger.info(`Giessplan: ${promises.length} Erinnerungen gesendet an ${Object.keys(byPerson).length} Personen`);
  }
);

/* ==========================================================================
   Garten: Wochenplan (Europe/Zurich) — zur vollen Minute schalten
   ========================================================================== */

function zurichWeekdayKeyAndHM() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const map = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
  const dayKey = map[wd] || "mon";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return { dayKey, hm };
}

function normHM(t) {
  if (!t || typeof t !== "string") return "";
  const m = t.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${String(parseInt(m[1], 10)).padStart(2, "0")}:${m[2]}`;
}

async function runGartenPlanTick() {
  if (!plugs.isConfigured()) return;
  let planSnap;
  try {
    planSnap = await db.doc("config/gartenPlan").get();
  } catch (e) {
    logger.warn("gartenPlan read failed", e?.message || e);
    return;
  }
  if (!planSnap.exists) return;
  const data = planSnap.data();
  if (!data?.enabled) return;
  
  // Sequenz-Konfiguration aus dem Plan lesen (oder Defaults)
  const useSequenz = data.useSequenz !== false; // Default: Sequenz aktiv
  const deviceComputer = String(data.deviceComputer || GARTEN_DEVICE_COMPUTER).trim();
  const devicePumpe = String(data.deviceName || GARTEN_DEVICE_PUMPE).trim();
  
  const days = data.days && typeof data.days === "object" ? data.days : {};
  const { dayKey, hm } = zurichWeekdayKeyAndHM();
  const slots = Array.isArray(days[dayKey]) ? days[dayKey] : [];
  const ymd = gartenYmdZurichNow();
  const sk = data.slotSkips && typeof data.slotSkips === "object" ? data.slotSkips : {};

  if (slots.length) {
    if (await gartenDayShouldSkipDueToRain(slots, ymd)) {
      if (gartenRainSkipLoggedYmd !== ymd) {
        gartenRainSkipLoggedYmd = ymd;
        await debugLog("garten_plan_skip_rain", { ymd, dayKey });
        logger.info(`Garten: Gießplan heute (${dayKey}) wegen Niederschlag im ±6h-Fenster übersprungen.`);
      }
      return;
    }
    gartenRainSkipLoggedYmd = null;
  }

  let idx = 0;
  for (const slot of slots) {
    const onT = normHM(slot.on);
    const offT = normHM(slot.off);
    if (!onT || !offT) {
      idx += 1;
      continue;
    }
    if (sk[gartenSlotSkipKey(ymd, dayKey, idx)] === true) {
      idx += 1;
      continue;
    }
    
    // Startzeit: Sequenz oder direkt Pumpe
    if (onT === hm) {
      if (useSequenz) {
        // Bewässerungsdauer aus Ein/Aus-Zeit berechnen
        const [onH, onM] = onT.split(":").map(Number);
        const [offH, offM] = offT.split(":").map(Number);
        const minutes = Math.max(1, (offH * 60 + offM) - (onH * 60 + onM));
        
        try {
          const result = await startGartenSequenz(minutes, null, {
            deviceComputer,
            devicePumpe,
            vorlaufSec: data.vorlaufSec ?? GARTEN_SEQUENZ_VORLAUF_SEC,
            nachlaufSec: data.nachlaufSec ?? GARTEN_SEQUENZ_NACHLAUF_SEC,
          });
          await debugLog("garten_plan_seq_start", { hm, dayKey, slotIndex: idx, minutes, result: result.success });
          if (!result.success) {
            logger.warn("garten_plan_seq_start failed:", result.message);
          }
        } catch (e) {
          logger.error("garten_plan_seq_start", e?.message || e);
        }
      } else {
        // Legacy: Nur Pumpe einschalten
        try {
          await plugs.setPower(devicePumpe, true);
          await debugLog("garten_plan_on", { device: devicePumpe, hm, dayKey, slotIndex: idx });
        } catch (e) {
          logger.error("garten_plan_on", e?.message || e);
        }
      }
    }
    
    // Ausschaltzeit nur bei Legacy-Modus (Sequenz macht das automatisch)
    if (!useSequenz && offT === hm) {
      try {
        await plugs.setPower(devicePumpe, false);
        await debugLog("garten_plan_off", { device: devicePumpe, hm, dayKey, slotIndex: idx });
      } catch (e) {
        logger.error("garten_plan_off", e?.message || e);
      }
    }
    idx += 1;
  }
}

/* ==========================================================================
   Scheduler: Bewässerung Auto-Off + Garten Wochenplan – jede Minute
   ========================================================================== */

// Prüft ob es aktuell regnet (für Bewässerungs-Unterbrechung)
async function isCurrentlyRaining() {
  try {
    const data = await fetchCurrentWeather();
    const code = data?.current?.weather_code;
    const precip = data?.current?.precipitation || 0;
    // Regen/Niesel/Schauer Codes: 51-67 (Niesel/Regen), 80-82 (Schauer), 95-99 (Gewitter)
    const rainyCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
    return rainyCode || precip > 0.1;
  } catch (e) {
    logger.warn("isCurrentlyRaining: Wetter-Check fehlgeschlagen", e?.message);
    return false; // Im Zweifel weiterlaufen lassen
  }
}

exports.checkBewaesserung = onSchedule(
  { schedule: "every 1 minutes", timeZone: "Europe/Zurich" },
  async () => {
    const nowISO = new Date().toISOString();
    const snap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
    
    // 0) REGEN-CHECK: Wenn es regnet, alle laufenden Bewässerungen sofort stoppen!
    const raining = await isCurrentlyRaining();
    if (raining && snap.docs.length > 0 && plugs.isConfigured()) {
      const activePumpTasks = snap.docs.filter(d => {
        const device = (d.data().device || "").toLowerCase();
        return device.includes("pump") || device.includes("beet") || device.includes("garten") || device.includes("rasen");
      });
      
      for (const doc of activePumpTasks) {
        const d = doc.data();
        try {
          await plugs.setPower(d.device, false);
          await doc.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp(), reason: "rain" });
          if (d.requestedBy) {
            await sendWhatsApp(d.requestedBy, `🌧️ *${d.device}* automatisch gestoppt – es regnet! 🦆💧\n\nKein Grund zu giessen wenn der Himmel das übernimmt!`);
          }
          await debugLog("plug_rain_stop", { device: d.device });
          logger.info(`Bewässerung ${d.device} wegen Regen gestoppt`);
        } catch (e) {
          logger.error(`Rain-Stop failed for ${d.device}:`, e.message || e);
        }
      }
    }
    
    // 0b) 🔒 TROCKENLAUF-SCHUTZ: Prüfen ob Bewässerungscomputer noch AN ist während Pumpe läuft
    if (!raining && snap.docs.length > 0 && plugs.isConfigured()) {
      // Finde aktive Pumpe-Tasks (step 3 = Pumpe AUS steht noch aus, d.h. Pumpe läuft gerade)
      const activePumpeSequenzen = snap.docs.filter(d => {
        const data = d.data();
        return data.sequenzId && data.step === 3 && data.action === "off" && !data.done;
      });
      
      if (activePumpeSequenzen.length > 0) {
        try {
          const computerStatus = await plugs.isDeviceOn(GARTEN_DEVICE_COMPUTER);
          
          // Wenn Bewässerungscomputer AUS oder offline → Pumpe sofort stoppen!
          if (!computerStatus.on || !computerStatus.online) {
            logger.error(`🚨 TROCKENLAUF-SCHUTZ: Bewässerungscomputer ist ${!computerStatus.online ? "offline" : "AUS"} während Pumpe läuft!`);
            
            // Pumpe sofort ausschalten
            try {
              await plugs.setPower(GARTEN_DEVICE_PUMPE, false);
              logger.info("Pumpe wegen Trockenlauf-Schutz ausgeschaltet");
            } catch (e) {
              logger.error("Konnte Pumpe nicht ausschalten:", e?.message);
            }
            
            // Alle betroffenen Sequenzen abbrechen
            for (const doc of activePumpeSequenzen) {
              const d = doc.data();
              await abortGartenSequenz(d.sequenzId, d.requestedBy, "computer_turned_off",
                `🚨 *NOTFALL-STOPP!*\n\nDer Bewässerungscomputer ist ${!computerStatus.online ? "offline gegangen" : "ausgegangen"} – Pumpe wurde SOFORT gestoppt um Trockenlauf zu verhindern!\n\n⚠️ Bitte prüfe die Anlage!`);
            }
            await debugLog("garten_dry_run_prevention", { 
              computerOnline: computerStatus.online, 
              computerOn: computerStatus.on,
              sequenzenAbgebrochen: activePumpeSequenzen.length,
            });
          }
        } catch (e) {
          logger.warn("Trockenlauf-Check fehlgeschlagen (ignoriert):", e?.message);
        }
      }
    }
    
    // 1) Sequenz-Tasks (executeAt + action: on/off) – z.B. Garten-Bewässerung
    const sequenzTasks = snap.docs.filter((d) => {
      const data = d.data();
      return data.executeAt && data.action && String(data.executeAt) <= nowISO;
    });
    
    if (sequenzTasks.length && plugs.isConfigured()) {
      // Sortiere nach step um Reihenfolge einzuhalten
      sequenzTasks.sort((a, b) => (a.data().step || 0) - (b.data().step || 0));
      
      for (const doc of sequenzTasks) {
        const d = doc.data();
        if (d.reason === "rain" || d.reason === "safety") continue;
        
        // Bei Regen: Sequenz-Tasks überspringen wenn es ums Giessen geht
        const dev = (d.device || "").toLowerCase();
        const isGartenDevice = dev.includes("pump") || dev.includes("bewässerung");
        if (raining && isGartenDevice && d.action === "on") {
          await doc.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp(), reason: "rain" });
          if (d.requestedBy && d.step === 2) {
            await sendWhatsApp(d.requestedBy, `🌧️ Bewässerung wegen Regen abgebrochen – der Himmel übernimmt! 🦆💧`);
          }
          continue;
        }
        
        // 🔒 SICHERHEITSCHECK: Vor Pumpe-Einschalten prüfen ob Bewässerungscomputer AN ist
        const isPumpeStart = d.step === 2 && d.action === "on" && dev.includes("pump");
        if (isPumpeStart) {
          try {
            const computerStatus = await plugs.isDeviceOn(GARTEN_DEVICE_COMPUTER);
            if (!computerStatus.found) {
              logger.error(`Sicherheitsstopp: Bewässerungscomputer "${GARTEN_DEVICE_COMPUTER}" nicht gefunden!`);
              await abortGartenSequenz(d.sequenzId, d.requestedBy, "computer_not_found",
                `🚨 *SICHERHEITSSTOPP!*\n\nBewässerungscomputer nicht gefunden – Pumpe wurde NICHT gestartet um Trockenlauf zu verhindern.\n\nBitte prüfe die Smart Life App.`);
              continue;
            }
            if (!computerStatus.online) {
              logger.error(`Sicherheitsstopp: Bewässerungscomputer "${GARTEN_DEVICE_COMPUTER}" ist offline!`);
              await abortGartenSequenz(d.sequenzId, d.requestedBy, "computer_offline",
                `🚨 *SICHERHEITSSTOPP!*\n\nBewässerungscomputer ist offline – Pumpe wurde NICHT gestartet um Trockenlauf zu verhindern.\n\nBitte prüfe WLAN und Stromversorgung.`);
              continue;
            }
            if (!computerStatus.on) {
              logger.error(`Sicherheitsstopp: Bewässerungscomputer "${GARTEN_DEVICE_COMPUTER}" ist AUS!`);
              await abortGartenSequenz(d.sequenzId, d.requestedBy, "computer_off",
                `🚨 *SICHERHEITSSTOPP!*\n\nBewässerungscomputer ist AUS – Pumpe wurde NICHT gestartet um Trockenlauf zu verhindern!\n\n🔧 Prüfe:\n• Ist der Wasserhahn offen?\n• Funktioniert der Bewässerungscomputer?`);
              continue;
            }
            await debugLog("garten_safety_check_ok", { sequenzId: d.sequenzId, computerStatus });
            logger.info(`Sicherheitscheck OK: Bewässerungscomputer ist AN, Pumpe wird gestartet.`);
          } catch (e) {
            logger.error(`Sicherheitscheck fehlgeschlagen:`, e.message || e);
            await abortGartenSequenz(d.sequenzId, d.requestedBy, "safety_check_failed",
              `🚨 *SICHERHEITSSTOPP!*\n\nKonnte Bewässerungscomputer-Status nicht prüfen – Pumpe wurde NICHT gestartet.\n\nFehler: ${e.message || e}`);
            continue;
          }
        }
        
        try {
          const turnOn = d.action === "on";
          await plugs.setPower(d.device, turnOn);
          await doc.ref.update({ done: true, executedAt: FieldValue.serverTimestamp() });
          await debugLog("garten_seq_step", { sequenzId: d.sequenzId, step: d.step, device: d.device, action: d.action });
          logger.info(`Sequenz ${d.sequenzId} Step ${d.step}: ${d.device} ${d.action}`);
        } catch (e) {
          logger.error(`Sequenz-Step failed for ${d.device}:`, e.message || e);
          await debugLog("garten_seq_step_error", { sequenzId: d.sequenzId, step: d.step, device: d.device, error: String(e.message || e) });
          // Bei kritischen Steps (Pumpe an) trotzdem als done markieren nach 10 Min
          const createdAt = d.createdAt?.toMillis?.() || 0;
          const age = Date.now() - createdAt;
          if (age > 10 * 60 * 1000) {
            await doc.ref.update({ done: true, failedAt: FieldValue.serverTimestamp(), lastError: String(e.message || e) });
          }
        }
      }
    }
    
    // 2) WhatsApp-Timer (einmalig nach X Min ausschalten) – Legacy-Format ohne executeAt
    // Nur where("done","==",false) — dann in Memory nach offAt filtern, damit kein
    // Firestore-Composite-Index nötig ist (Fehler «index required» = nie ausgeschaltet).
    const due = snap.docs.filter((d) => {
      const data = d.data();
      // Nur alte Tasks ohne executeAt (neue Sequenz-Tasks haben executeAt statt offAt)
      const x = data.offAt;
      return x && !data.executeAt && String(x) <= nowISO;
    });

    if (due.length && plugs.isConfigured()) {
      for (const doc of due) {
        const d = doc.data();
        if (d.reason === "rain") continue; // Schon wegen Regen gestoppt
        try {
          await plugs.setPower(d.device, false);
          await doc.ref.update({ done: true, offDoneAt: FieldValue.serverTimestamp() });
          if (d.requestedBy) {
            await sendWhatsApp(d.requestedBy, `⏹️ *${d.device}* automatisch aus (Timer abgelaufen).`);
          }
          await debugLog("plug_auto_off", { device: d.device });
        } catch (e) {
          logger.error(`Auto-Off failed for ${d.device}:`, e.message || e);
          await debugLog("plug_auto_off_error", { device: d.device, error: String(e.message || e) });
          const createdAt = d.createdAt?.toMillis?.() || 0;
          const age = Date.now() - createdAt;
          if (age > 70 * 60 * 1000) {
            await doc.ref.update({ done: true, failedAt: FieldValue.serverTimestamp(), lastError: String(e.message || e) });
          }
        }
      }
    } else if (due.length) {
      logger.warn("Smart Plugs nicht konfiguriert – Auto-Off übersprungen");
    }

    // 2) Wochenplan (WG-Intern → config/gartenPlan)
    try {
      await runGartenPlanTick();
    } catch (e) {
      logger.error("runGartenPlanTick", e);
    }
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

/* ==========================================================================
   Scheduler: Regen-Alert (Gartenpolster) – ca. 30 min vor Stunden-Slot, Open-Meteo
   Einschalten: GARTEN_RAIN_ALERT=1, Empfänger: WHATSAPP_RAIN_ALERT_RECIPIENTS
   (Fallback: WHATSAPP_GROUP_RECIPIENTS)
   ========================================================================== */

exports.checkGartenRegenPolster = onSchedule(
  { schedule: "every 10 minutes", timeZone: "Europe/Zurich" },
  async () => {
    if (!gartenRegenPolsterEnabled()) return;

    const targets = rainAlertRecipients();
    if (!targets.length) {
      logger.warn("Garten-Regen-Alert: keine Empfänger (setze WHATSAPP_RAIN_ALERT_RECIPIENTS oder WHATSAPP_GROUP_RECIPIENTS)");
      return;
    }

    let data;
    try {
      data = await fetchOpenMeteoPfaeffikon();
    } catch (e) {
      logger.error("checkGartenRegenPolster: open-meteo", e?.message || e);
      return;
    }

    const slot = findNextRainyHourSlot(data?.hourly);
    if (!slot) return;

    const minutesUntil = (slot.slotUnix * 1000 - Date.now()) / 60000;
    if (minutesUntil < RAIN_ALERT_MIN_MINUTES || minutesUntil > RAIN_ALERT_MAX_MINUTES) {
      return;
    }

    const ref = db.doc(GARTEN_POLSTER_ALERT_DOC);
    const prev = await ref.get();
    const last = prev.exists ? prev.data()?.lastRainSlotUnix : null;
    if (last != null && Number(last) === slot.slotUnix) {
      return;
    }

    const mRound = Math.max(1, Math.round(minutesUntil));
    const text = `🌧️🌤️ *Achtung Wetter!*

In ca. *${mRound} Minuten* könnte es in Pfäffikon nass werden (Stunde ab *${slot.whenLabel}* Uhr) 🌦️

🪴🛋️ *Gartenpolster rein bringen!* — bevor’s tropft 💦

Trocken bleiben! 🌿✨`;

    const results = await Promise.all(targets.map((to) => sendWhatsApp(to, text)));
    const anyOk = results.some(Boolean);
    if (anyOk) {
      await ref.set(
        {
          lastRainSlotUnix: slot.slotUnix,
          whenLabel: slot.whenLabel,
          minutesUntilApprox: Math.round(minutesUntil * 10) / 10,
          sentAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      await debugLog("garten_regen_polster_sent", {
        slotUnix: slot.slotUnix,
        whenLabel: slot.whenLabel,
        minutesUntil: Math.round(minutesUntil * 10) / 10,
      });
    } else {
      logger.warn("checkGartenRegenPolster: alle WhatsApp-Sends fehlgeschlagen");
    }
  }
);
