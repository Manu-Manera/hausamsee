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
 *  Mit OPENAI_API_KEY ist Gustav auch ChatGPT-ähnlicher Assistent (Chat-Verlauf pro Nummer).
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
const chatHistory = require("./chatHistory");
const tasksOverview = require("./tasksOverview");
const deinTag = require("./deinTag");
const einkaufsliste = require("./einkaufsliste");
const hausWiki = require("./hausWiki");
const wifiQr = require("./wifiQr");
const birthdays = require("./birthdays");
const gustavExtras = require("./gustavExtras");
const { saturday10Iso } = require("./calendarIcs");
const blueriiot = require("./blueriiot");

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
/** Min./Max. vor Regen-Stundenbeginn; Scheduler alle 5 Min (siehe checkGartenRegenPolster) */
const RAIN_ALERT_MIN_MINUTES = 10;
const RAIN_ALERT_MAX_MINUTES = 55;
/** Mindestabstand zwischen zwei Polster-Alerts (Dauerregen = sonst jede Stunde ein neuer Slot) */
const RAIN_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const GARTEN_POLSTER_ALERT_DOC = "config/gartenPolsterRainAlert";

const BEWOHNER = ["Corina", "Jasmin", "Dino", "Andy", "Manu", "Hugues", "Fanny", "Eliot", "Oscar"];
const KIDS = new Set(["Eliot", "Oscar"]);
const ADULTS = BEWOHNER.filter((n) => !KIDS.has(n));

// Bewässerung: harte Sicherheitsgrenzen für Steckdosen-Timer.
const PUMP_DEFAULT_MINUTES = 20; // Default-Bewässerungsdauer (Minuten)
const PUMP_MAX_MINUTES = 60;     // Länger lassen wir die Pumpe NIE laufen

// Garten-Sequenz: Bewässerungscomputer → Pumpe (mit Status-Check)
const GARTEN_STATUS_CHECK_DELAY_MS = 2000; // Millisekunden zwischen Status-Checks
const GARTEN_SEQUENZ_NACHLAUF_SEC = 30;   // Sekunden nach Pumpe AUS bevor Bewässerungscomputer AUS
const GARTEN_DEVICE_WH2 = "Wasserhahn 2 (Wintergarten)";
const GARTEN_DEVICE_WH1 = "Wasserhahn 1 (Manu)";
const GARTEN_DEVICE_COMPUTER = GARTEN_DEVICE_WH2; // Legacy-Alias / Default-Zone
const GARTEN_DEVICE_PUMPE = "Pumpe";

const GARTEN_DEFAULT_ZONES = [
  {
    id: "wh2-wintergarten",
    label: "Wasserhahn 2 (Wintergarten)",
    device: GARTEN_DEVICE_WH2,
    valveType: "irrigation",
    channel: null,
    enabled: true,
  },
  {
    id: "wh1-links",
    label: "Wasserhahn 1 – links (Manu)",
    device: GARTEN_DEVICE_WH1,
    valveType: "dual",
    channel: 1,
    enabled: true,
  },
  {
    id: "wh1-rechts",
    label: "Wasserhahn 1 – rechts (Manu)",
    device: GARTEN_DEVICE_WH1,
    valveType: "dual",
    channel: 2,
    enabled: true,
  },
];

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

const WA_META_DOC = "whatsappMeta";
const waPhoneStatusCache = new Map();

async function getWhatsAppMetaConfig() {
  try {
    const snap = await db.collection("config").doc(WA_META_DOC).get();
    return snap.exists ? snap.data() : {};
  } catch (e) {
    logger.warn("getWhatsAppMetaConfig", e);
    return {};
  }
}

/** Webhook liefert die funktionierende ID; Scheduler nutzen dieselbe (nicht nur .env). */
async function rememberWhatsAppPhoneId(phoneId) {
  if (!phoneId) return;
  const id = String(phoneId);
  await db.collection("config").doc(WA_META_DOC).set(
    { phoneNumberId: id, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function fetchWhatsAppPhoneStatus(phoneId) {
  if (!phoneId) return null;
  const cached = waPhoneStatusCache.get(phoneId);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.status;
  const { token } = cfg();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${phoneId}?fields=status,display_phone_number`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const j = await res.json();
    const status = j?.status || (j?.error ? "ERROR" : null);
    if (status) waPhoneStatusCache.set(phoneId, { status, at: Date.now() });
    return status;
  } catch (e) {
    logger.warn("fetchWhatsAppPhoneStatus", e);
    return null;
  }
}

/**
 * Absender-ID: Webhook-Argument > Firestore-Cache (letzter Chat) > .env (nur wenn CONNECTED).
 * .env mit PENDING-Nummer (z. B. eigene DE-Nummer aus Schritt 2) → Erinnerungen scheitern mit #133010.
 */
async function resolveWhatsAppPhoneId(phoneIdOpt) {
  if (phoneIdOpt) return String(phoneIdOpt);
  const meta = await getWhatsAppMetaConfig();
  if (meta.phoneNumberId) return String(meta.phoneNumberId);
  const envId = cfg().phoneId;
  if (!envId) return "";
  const st = await fetchWhatsAppPhoneStatus(envId);
  if (st && st !== "CONNECTED") {
    logger.warn(
      `WHATSAPP_PHONE_ID ${envId} status=${st} – proaktive Nachrichten nutzen nur Webhook-Cache. ` +
        "Einmal Gustav schreiben (Hilfe), dann erneut testen."
    );
    return meta.phoneNumberId ? String(meta.phoneNumberId) : "";
  }
  return envId;
}

/** phoneIdOpt: pro Webhook-Event von value.metadata.phone_number_id (eingehende Nummer). */
async function sendWhatsAppDetailed(to, text, phoneIdOpt) {
  const { token } = cfg();
  const phoneId = await resolveWhatsAppPhoneId(phoneIdOpt);
  if (!token || !phoneId) {
    logger.error("sendWhatsApp: fehlendes WHATSAPP_TOKEN oder WHATSAPP_PHONE_ID");
    await debugLog("send_skipped", { to, reason: "no_token_or_phone_id" });
    return { ok: false, reason: "no_token_or_phone_id" };
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
    return { ok: false, reason: "fetch_failed", error: String(e) };
  }
  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    let metaCode = null;
    let metaMessage = null;
    try {
      const j = JSON.parse(bodyText);
      metaCode = j?.error?.code ?? null;
      metaMessage = j?.error?.message ?? null;
    } catch (_) { /* ignore */ }
    logger.warn("sendWhatsApp: Graph API Fehler", { status: res.status, body: bodyText.slice(0, 500) });
    await debugLog("send_failed", { to, status: res.status, response: bodyText.slice(0, 2000), metaCode });
    return { ok: false, status: res.status, metaCode, metaMessage, error: bodyText };
  }
  await debugLog("send_ok", { to, status: res.status, phoneId });
  return { ok: true };
}

async function sendWhatsApp(to, text, phoneIdOpt) {
  const r = await sendWhatsAppDetailed(to, text, phoneIdOpt);
  return r.ok;
}

/** Bild an WhatsApp senden (PNG/JPEG-Buffer, z. B. WLAN-QR). */
async function uploadWhatsAppMedia(buffer, mimeType, filename, phoneIdOpt) {
  const { token } = cfg();
  const phoneId = await resolveWhatsAppPhoneId(phoneIdOpt);
  if (!token || !phoneId || !buffer?.length) return null;
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([buffer], { type: mimeType }), filename || "image.png");
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const raw = await res.text();
    if (!res.ok) {
      logger.warn("uploadWhatsAppMedia failed", { status: res.status, body: raw.slice(0, 300) });
      return null;
    }
    const j = JSON.parse(raw);
    return j.id || null;
  } catch (e) {
    logger.error("uploadWhatsAppMedia", e);
    return null;
  }
}

async function sendWhatsAppImage(to, imageBuffer, caption, phoneIdOpt) {
  const mediaId = await uploadWhatsAppMedia(imageBuffer, "image/png", "wlan-qr.png", phoneIdOpt);
  if (!mediaId) return false;
  const { token } = cfg();
  const phoneId = await resolveWhatsAppPhoneId(phoneIdOpt);
  if (!token || !phoneId) return false;
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: {
          id: mediaId,
          caption: caption ? String(caption).slice(0, 1024) : undefined,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("sendWhatsAppImage failed", { status: res.status, body: body.slice(0, 300) });
      return false;
    }
    return true;
  } catch (e) {
    logger.error("sendWhatsAppImage", e);
    return false;
  }
}

/** WhatsApp Interactive Reply Buttons (max. 3, Titel je max. 20 Zeichen). */
/** WhatsApp CTA-URL-Button (öffnet Link, z. B. Google Calendar). */
async function sendWhatsAppCtaUrl(to, { body, displayText, url, footer }, phoneIdOpt) {
  const { token } = cfg();
  const phoneId = await resolveWhatsAppPhoneId(phoneIdOpt);
  if (!token || !phoneId || !url) {
    return { ok: false, reason: "no_token_or_phone_id_or_url" };
  }
  const apiUrl = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const interactive = {
    type: "cta_url",
    body: { text: String(body || "").slice(0, 1024) },
    action: {
      name: "cta_url",
      parameters: {
        display_text: String(displayText || "Öffnen").slice(0, 20),
        url: String(url).slice(0, 2000),
      },
    },
  };
  if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive,
      }),
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      logger.warn("sendWhatsAppCtaUrl failed", { status: res.status, body: bodyText.slice(0, 300) });
      return { ok: false, status: res.status, error: bodyText };
    }
    return { ok: true };
  } catch (e) {
    logger.error("sendWhatsAppCtaUrl", e);
    return { ok: false, reason: "fetch_failed" };
  }
}

async function sendWhatsAppInteractiveButtons(to, { body, footer, buttons }, phoneIdOpt) {
  const { token } = cfg();
  const phoneId = await resolveWhatsAppPhoneId(phoneIdOpt);
  if (!token || !phoneId) {
    return { ok: false, reason: "no_token_or_phone_id" };
  }
  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
  const interactive = {
    type: "button",
    body: { text: String(body || "").slice(0, 1024) },
    action: {
      buttons: (buttons || []).slice(0, 3).map((b) => ({
        type: "reply",
        reply: {
          id: String(b.id || "").slice(0, 256),
          title: String(b.title || "").slice(0, 20),
        },
      })),
    },
  };
  if (footer) interactive.footer = { text: String(footer).slice(0, 60) };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive,
      }),
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      logger.warn("sendWhatsAppInteractiveButtons failed", { status: res.status, body: bodyText.slice(0, 300) });
      return { ok: false, status: res.status, error: bodyText };
    }
    return { ok: true };
  } catch (e) {
    logger.error("sendWhatsAppInteractiveButtons", e);
    return { ok: false, reason: "fetch_failed" };
  }
}

function whatsAppProactiveErrorHint(sendResult) {
  if (sendResult?.metaCode === 133010) {
    return (
      "Meta blockiert proaktive Nachrichten (#133010 – Empfänger nicht registriert oder kein 24h-Fenster). " +
      "Schreib Gustav zuerst eine Nachricht im Chat, dann z.B. *testmsg gartentodo*."
    );
  }
  return sendResult?.metaMessage || sendResult?.reason || "WhatsApp-Versand fehlgeschlagen";
}

async function broadcast(text) {
  const { recipients } = cfg();
  if (!recipients.length) return;
  await Promise.all(recipients.map((r) => sendWhatsApp(r, text)));
}

/** WG-WhatsApp (Alias für broadcast). */
const broadcastToWG = broadcast;

async function notifyGartenPlanStarted(zoneLabel, minutes, onT, offT, opts = {}) {
  const queuedNote = opts.queued ? "\n📋 (aus Warteschlange)" : "";
  await broadcastToWG(
    `🌿 *Automatische Garten-Bewässerung*\n\n` +
    `📍 ${zoneLabel}\n` +
    `⏱️ Dauer: ${minutes} Min\n` +
    `📅 Zeitplan: ${onT} – ${offT}${queuedNote}\n\n` +
    `Zum Stoppen: «Garten aus»`
  );
}

async function notifyGartenRainSkipped(zoneLabel) {
  await broadcastToWG(
    `🌧️ *Garten-Zeitplan übersprungen*\n\n` +
    `📍 ${zoneLabel}\n` +
    `Regen im ±6h-Fenster um die geplante Zeit – heute nicht gegossen.`
  );
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

async function updateMemberPrefField(name, fields) {
  if (!name || !ADULTS.includes(name)) return;
  await db.collection("config").doc("memberPrefs").set(
    { [name]: { ...fields, updatedAt: FieldValue.serverTimestamp() } },
    { merge: true }
  );
}

async function getMemberPrefs(name) {
  try {
    const snap = await db.collection("config").doc("memberPrefs").get();
    const data = snap.exists ? snap.data() : {};
    return name ? data[name] || {} : data;
  } catch {
    return {};
  }
}

/** Speichert WhatsApp-Nummer eines Bewohners für spätere proaktive Nachrichten */
async function saveWhatsAppNumber(name, whatsappNumber) {
  if (!name || !whatsappNumber || !ADULTS.includes(name)) return;
  const num = String(whatsappNumber).replace(/\D/g, "");
  if (!num) return;
  try {
    await db.collection("config").doc("whatsappNumbers").set(
      { [name]: num, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    logger.warn("saveWhatsAppNumber failed", e);
  }
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
  return raw.split(",").map((s) => s.replace(/\D/g, "")).filter(Boolean);
}

/** Env-Liste + gespeicherte WhatsApp-Nummern (Bot-Chat) + memberPrefs */
async function rainAlertRecipientsResolved() {
  const set = new Set(rainAlertRecipients());
  for (const name of ADULTS) {
    try {
      const phone = await getBewohnerPhone(name);
      if (phone) set.add(phone);
    } catch (e) {
      logger.warn(`rainAlertRecipients: ${name}`, e?.message);
    }
  }
  return [...set];
}

function buildPolsterRainAlertText(whenLabel, minutesUntil) {
  const mRound = Math.max(1, Math.round(minutesUntil));
  return `🌧️🌤️ *Achtung Wetter!*

In ca. *${mRound} Minuten* könnte es in Pfäffikon nass werden (Stunde ab *${whenLabel}* Uhr) 🌦️

🪴🛋️ *Gartenpolster rein bringen!* — bevor's tropft 💦

Trocken bleiben! 🌿✨`;
}

function hourlySlotMs(raw) {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isNaN(n) ? null : n * 1000;
}

/** Index der laufenden Open-Meteo-Stunde (Stundenbeginn ≤ jetzt < +1h). */
function getCurrentHourlyIndex(hourly) {
  const times = hourly?.time;
  if (!Array.isArray(times) || !times.length) return -1;
  const nowMs = Date.now();
  for (let i = 0; i < times.length; i++) {
    const slotMs = hourlySlotMs(times[i]);
    if (slotMs == null) continue;
    if (slotMs <= nowMs && nowMs < slotMs + 3600 * 1000) return i;
  }
  return -1;
}

/** Läuft es in der aktuellen Stunde schon (laut Forecast)? → Polster-Hinweis zu spät. */
function isCurrentlyRaining(hourly) {
  const i = getCurrentHourlyIndex(hourly);
  if (i < 0) return false;
  return hourLooksRainy(hourly.precipitation?.[i], hourly.weathercode?.[i]);
}

/**
 * Nächster Polster-Alert-Slot: erster Wechsel trocken → nass (nicht jede weitere Regenstunde).
 * Kein Alert, wenn es in der laufenden Stunde schon regnet.
 */
function findRainAlertSlot(hourly) {
  if (isCurrentlyRaining(hourly)) return null;

  const times = hourly?.time;
  const prec = hourly?.precipitation;
  const codes = hourly?.weathercode;
  if (!Array.isArray(times) || !times.length) return null;

  const nowMs = Date.now();
  for (let i = 0; i < times.length; i++) {
    const slotMs = hourlySlotMs(times[i]);
    if (slotMs == null || slotMs <= nowMs) continue;
    if (!hourLooksRainy(prec?.[i], codes?.[i])) continue;

    const prevIdx = i - 1;
    if (prevIdx >= 0 && hourLooksRainy(prec?.[prevIdx], codes?.[prevIdx])) {
      continue;
    }

    const whenLabel = fmtTimeZurich(new Date(slotMs));
    return { slotUnix: Math.floor(slotMs / 1000), whenLabel };
  }
  return null;
}

async function sendPolsterRainAlertToTargets(targets, slot, minutesUntil) {
  const text = buildPolsterRainAlertText(slot.whenLabel, minutesUntil);
  const results = await Promise.all(
    targets.map(async (to) => ({ to, ok: await sendWhatsApp(to, text) }))
  );
  const okList = results.filter((r) => r.ok).map((r) => r.to);
  const failList = results.filter((r) => !r.ok).map((r) => r.to);
  return { text, okList, failList, anyOk: okList.length > 0 };
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

function emptyGartenDays() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function normalizeGartenPlanZones(raw) {
  const emptyDays = emptyGartenDays();
  if (raw?.zones && Array.isArray(raw.zones) && raw.zones.length) {
    return raw.zones.map((z, i) => {
      const def = GARTEN_DEFAULT_ZONES[i] || GARTEN_DEFAULT_ZONES[0];
      const days = { ...emptyDays };
      "mon tue wed thu fri sat sun".split(" ").forEach((k) => {
        const arr = z.days?.[k];
        days[k] = Array.isArray(arr)
          ? arr.map((s) => ({
            on: String(s.on || "07:00").slice(0, 5),
            off: String(s.off || "07:15").slice(0, 5),
          }))
          : [];
      });
      return {
        id: String(z.id || def.id).trim() || def.id,
        label: String(z.label || def.label).trim() || def.label,
        device: String(z.device || def.device).trim() || def.device,
        valveType: z.valveType === "dual" ? "dual" : "irrigation",
        channel: z.valveType === "dual" ? (z.channel === 2 ? 2 : 1) : null,
        enabled: z.enabled !== false,
        days,
      };
    });
  }

  const legacyDays = { ...emptyDays };
  "mon tue wed thu fri sat sun".split(" ").forEach((k) => {
    const arr = raw?.days?.[k];
    legacyDays[k] = Array.isArray(arr)
      ? arr.map((s) => ({
        on: String(s.on || "07:00").slice(0, 5),
        off: String(s.off || "07:15").slice(0, 5),
      }))
      : [];
  });
  const legacyDevice = String(raw?.deviceComputer || GARTEN_DEVICE_WH2).trim() || GARTEN_DEVICE_WH2;

  return GARTEN_DEFAULT_ZONES.map((def) => ({
    ...def,
    device: def.id === "wh2-wintergarten" ? legacyDevice : def.device,
    days: def.id === "wh2-wintergarten" ? legacyDays : { ...emptyDays },
  }));
}

function gartenSlotSkipKey(ymd, dayKey, idx, zoneId = "wh2-wintergarten") {
  return `${ymd}|${dayKey}|${idx}|${zoneId}`;
}

function isGartenSlotSkipped(sk, ymd, dayKey, idx, zoneId) {
  if (!sk || typeof sk !== "object") return false;
  if (sk[gartenSlotSkipKey(ymd, dayKey, idx, zoneId)] === true) return true;
  if (zoneId === "wh2-wintergarten" && sk[`${ymd}|${dayKey}|${idx}`] === true) return true;
  return false;
}

function resolveGartenZoneFromPlan(planData, zoneId) {
  const zones = normalizeGartenPlanZones(planData || {});
  if (zoneId) {
    const hit = zones.find((z) => z.id === zoneId);
    if (hit) return hit;
  }
  return zones.find((z) => z.id === "wh2-wintergarten") || zones[0];
}

function gartenZoneFromConfig(config = {}) {
  if (config.zoneId || config.valveType || config.channel != null) {
    return {
      id: config.zoneId || "wh2-wintergarten",
      label: config.zoneLabel || config.device || GARTEN_DEVICE_WH2,
      device: config.device || config.deviceComputer || GARTEN_DEVICE_WH2,
      valveType: config.valveType === "dual" ? "dual" : "irrigation",
      channel: config.valveType === "dual" ? (config.channel === 2 ? 2 : 1) : null,
    };
  }
  return {
    id: "wh2-wintergarten",
    label: config.deviceComputer || GARTEN_DEVICE_WH2,
    device: config.deviceComputer || GARTEN_DEVICE_WH2,
    valveType: "irrigation",
    channel: null,
  };
}

async function startGartenValve(zone, minutes) {
  if (zone.valveType === "dual") {
    return plugs.startIrrigationChannel(zone.device, minutes, zone.channel);
  }
  return plugs.startIrrigation(zone.device, minutes);
}

async function stopGartenValve(zone) {
  if (zone.valveType === "dual") {
    return plugs.stopIrrigationChannel(zone.device, zone.channel);
  }
  return plugs.stopIrrigation(zone.device);
}

async function isGartenValveOn(zone) {
  return plugs.isIrrigationChannelOn(zone.device, zone.channel);
}

async function stopAllGartenValves(planData) {
  const zones = normalizeGartenPlanZones(planData || {});
  const seen = new Set();
  for (const z of zones) {
    const key = `${z.device}|${z.valveType}|${z.channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await stopGartenValve(z);
    } catch (e) {
      logger.warn(`stopAllGartenValves: ${z.label}`, e?.message || e);
    }
  }
}

async function isGartenSequenzActive() {
  const snap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
  return snap.docs.some((d) => !!d.data().sequenzId);
}

function gartenQueueEntryKey(entry) {
  return `${entry?.ymd || ""}|${entry?.zoneId || ""}|${entry?.slotIndex ?? ""}`;
}

async function enqueueGartenStart(entry) {
  const ref = db.doc("config/gartenPlan");
  const key = gartenQueueEntryKey(entry);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const q = Array.isArray(snap.data()?.pendingStarts) ? snap.data().pendingStarts : [];
    if (q.some((x) => gartenQueueEntryKey(x) === key)) return;
    t.set(ref, {
      pendingStarts: [...q, { ...entry, queueId: `q_${Date.now()}_${entry.zoneId}` }],
    }, { merge: true });
  });
}

async function processGartenStartQueue(planData) {
  if (!planData?.enabled || !plugs.isConfigured()) return;
  if (await isGartenSequenzActive()) return;

  const ref = db.doc("config/gartenPlan");
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data();
  const queue = Array.isArray(data.pendingStarts) ? data.pendingStarts : [];
  if (!queue.length) return;

  const next = queue[0];
  const devicePumpe = String(planData.deviceName || data.deviceName || GARTEN_DEVICE_PUMPE).trim();
  const result = await startGartenSequenz(next.minutes, null, {
    devicePumpe,
    nachlaufSec: planData.nachlaufSec ?? data.nachlaufSec ?? GARTEN_SEQUENZ_NACHLAUF_SEC,
    zoneId: next.zoneId,
    zoneLabel: next.zoneLabel,
    device: next.device,
    valveType: next.valveType,
    channel: next.channel,
    waterLogSource: "plan",
    dayKey: next.dayKey,
    slotIndex: next.slotIndex,
    allowQueue: false,
  });

  if (result.success && !result.queued) {
    const rest = queue.slice(1);
    await ref.update({ pendingStarts: rest });
    if (next.ymd && next.zoneId) {
      await setGartenWaterLog(next.ymd, next.zoneId, {
        status: "started",
        source: "plan",
        dayKey: next.dayKey,
        slotIndex: next.slotIndex,
        slotOn: next.slotOn,
        slotOff: next.slotOff,
        minutes: next.minutes,
        zoneLabel: next.zoneLabel,
        queued: true,
      });
    }
    await debugLog("garten_plan_queue_start", { zoneId: next.zoneId, remaining: rest.length });
    if (next.slotOn && next.slotOff) {
      await notifyGartenPlanStarted(next.zoneLabel || next.zoneId, next.minutes, next.slotOn, next.slotOff, { queued: true });
    }
  } else if (!result.success && !result.busy) {
    const rest = queue.slice(1);
    await ref.update({ pendingStarts: rest });
    logger.warn("garten_plan_queue_drop", { zoneId: next.zoneId, reason: result.message });
  }
}

/** ±6h um jetzt (Europe/Zurich): Regen in Vergangenheit oder Vorschau? */
async function gartenRainAroundNow() {
  let data;
  try {
    data = await getOpenMeteoGartenForRain();
  } catch (e) {
    logger.warn("gartenRainAroundNow: open-meteo", e?.message || e);
    return { rainy: false, error: true };
  }
  const hourly = data?.hourly;
  if (!hourly) return { rainy: false, error: false };
  const now = Date.now();
  const ws = now - 6 * 60 * 60 * 1000;
  const we = now + 6 * 60 * 60 * 1000;
  return { rainy: gartenHourlyRainOverlapsWindow(hourly, ws, we), error: false };
}

const GARTEN_MANUAL_MINUTES = 30;

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
    const maybe = /(vielleicht|maybe|peut-?etre)/i.test(m[1]);
    const yes = /(ja|yes|oui|zusage|dabei)/i.test(m[1]) && !/nicht/i.test(m[1]);
    return { wantsIn: maybe ? null : yes, maybe, title: m[2].trim() };
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
  
  // Explizite Stopp-Befehle (DE/EN/FR) – OHNE "giess" Keyword
  // WICHTIG: "Pumpe aus" stoppt auch die ganze Sequenz (Pumpe erst, dann Computer)
  const explicitStop = 
    /^(bewässerung|bewaesserung|garten|pumpe)\s*(aus|stop+|stopp?|off|end|quit)$/i.test(s) ||
    /^stop\s*(watering|irrigation|garden|the\s+garden|the\s+pump|pump)?$/i.test(s) ||
    /^(arr[eê]te|stop+)\s*(l['']?arrosage|le\s+jardin|la\s+pompe)?$/i.test(s) ||
    /^(watering|irrigation|pump)\s*(off|stop+)$/i.test(s);
  if (explicitStop) {
    return { gartenSequenz: true, on: false, minutes: null };
  }
  
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
  
  // Einfacher Check: endet mit "aus", "stop", "off", "stoppen" etc.?
  const endsWithStop = /\s*(aus|stop+|stopp?|off|beenden|aufhören|abstellen)$/i.test(s);
  // Oder enthält klare Stopp-Phrasen?
  const hasStopPhrase = /(hör\s*auf|aufhören|stopp?\s*(das|die|es)?|abstell|genug|lass.*aus|wasser\s*(ab|aus))/i.test(s);
  // Keine "weiter/an" Wörter die das negieren
  const noContradiction = !/\b(noch|weiter|an|länger|mehr|start|los|bitte\s+an)\b/i.test(s);
  
  if ((endsWithStop || hasStopPhrase) && noContradiction) {
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
 * Kleine Hilfsfunktion zum Warten
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Startet die Garten-Bewässerungssequenz:
 *   1. Bewässerungscomputer AN
 *   2. Doppelter Status-Check (prüft ob Computer wirklich AN ist)
 *   3. Pumpe AN (sofort nach erfolgreichem Check)
 *   4. Pumpe AUS (nach Bewässerungsdauer)
 *   5. Bewässerungscomputer AUS (nach NACHLAUF Sekunden)
 * 
 * @param {number} minutes - Bewässerungsdauer in Minuten
 * @param {string} requestedBy - WhatsApp-Nummer des Anfordernden
 * @param {object} config - Optionale Konfiguration aus gartenPlan
 * @returns {Promise<{success: boolean, message: string, sequenzId?: string}>}
 */
async function startGartenSequenz(minutes, requestedBy, config = {}) {
  const zone = gartenZoneFromConfig(config);
  const devicePumpe = config.devicePumpe || GARTEN_DEVICE_PUMPE;
  const nachlaufSec = config.nachlaufSec ?? GARTEN_SEQUENZ_NACHLAUF_SEC;

  if (await isGartenSequenzActive()) {
    if (config.allowQueue && config.zoneId && config.ymd != null) {
      await enqueueGartenStart({
        zoneId: zone.id,
        zoneLabel: zone.label,
        device: zone.device,
        valveType: zone.valveType,
        channel: zone.channel,
        minutes,
        ymd: config.ymd,
        dayKey: config.dayKey,
        slotIndex: config.slotIndex,
        slotOn: config.slotOn,
        slotOff: config.slotOff,
      });
      return {
        success: true,
        queued: true,
        message: `📋 *${zone.label}* steht in der Warteschlange (andere Zone läuft noch).`,
      };
    }
    return {
      success: false,
      busy: true,
      message: `⏳ Es läuft bereits eine Bewässerung (*${zone.label}* kann nicht parallel starten).\n\nZuerst stoppen: «Bewässerung stopp»`,
    };
  }
  
  // Regen-Check (WhatsApp/Siri: aktuelles Regen; Website «Jetzt bewässern» kann skipRainCheck setzen)
  if (!config.skipRainCheck) {
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
  }
  
  // Prüfe ob Tuya konfiguriert ist
  if (!plugs.isConfigured()) {
    return {
      success: false,
      message: `⚠️ Smart Plugs nicht konfiguriert (TUYA_ACCESS_ID etc. in functions/.env).`,
    };
  }
  
  const sequenzId = `seq_${Date.now()}`;
  
  // 1) Ventil der Zone starten (mit Timer für Gesamtdauer + Nachlauf)
  const valveLaufzeit = minutes + Math.ceil(nachlaufSec / 60) + 1; // Extra Minute Puffer
  try {
    await startGartenValve(zone, valveLaufzeit);
    await debugLog("garten_seq_valve_on", { sequenzId, zone, valveLaufzeit });
    logger.info(`Sequenz ${sequenzId}: ${zone.label} gestartet für ${valveLaufzeit} Min`);
  } catch (e) {
    return {
      success: false,
      message: `😕 Konnte *${zone.label}* nicht einschalten:\n${e.message || e}`,
    };
  }
  
  // 2) Status-Check: Nur zur Info, KEIN Abbruch!
  await sleep(GARTEN_STATUS_CHECK_DELAY_MS);
  
  let valveStatus = "gesendet"; // "an", "aus", "gesendet"
  let valveWarnung = "";
  try {
    const check = await isGartenValveOn(zone);
    await debugLog("garten_seq_check", { sequenzId, zone, check });
    
    if (!check.online) {
      valveStatus = "gesendet";
      valveWarnung = `\n\n⚠️ *Hinweis:* ${zone.label} meldet offline – Befehl wurde gesendet!`;
      logger.warn(`Sequenz ${sequenzId}: Ventil meldet offline nach Einschalten`);
    } else if (check.on === false) {
      valveStatus = "aus";
      valveWarnung = `\n\n⚠️ *Hinweis:* ${zone.label} meldet AUS – Befehl wurde gesendet, aber Gerät reagiert nicht!`;
      logger.warn(`Sequenz ${sequenzId}: Ventil meldet AUS nach Einschalten`);
    } else if (check.on === null) {
      valveStatus = "gesendet";
      valveWarnung = `\n\n⚠️ *Hinweis:* Status unklar. Einschaltbefehl wurde gesendet!`;
      logger.warn(`Sequenz ${sequenzId}: Ventil-Status unklar. Codes: ${check.statusCodes?.join(", ")}`);
    } else {
      valveStatus = "an";
      logger.info(`Sequenz ${sequenzId}: Ventil-Check OK – meldet AN`);
    }
  } catch (e) {
    valveStatus = "gesendet";
    valveWarnung = `\n\n⚠️ *Hinweis:* Status-Check fehlgeschlagen. Einschaltbefehl wurde gesendet!`;
    logger.warn(`Sequenz ${sequenzId}: Status-Check Exception`, e?.message);
  }
  
  // 3) Pumpe einschalten (optional - Bewässerungscomputer bleibt AN auch wenn Pumpe offline!)
  let pumpeStatus = "gesendet";
  let pumpeWarnung = "";
  try {
    await plugs.setPower(devicePumpe, true);
    await debugLog("garten_seq_pumpe_on", { sequenzId, devicePumpe });
    pumpeStatus = "an";
    logger.info(`Sequenz ${sequenzId}: Pumpe eingeschaltet`);
  } catch (e) {
    pumpeStatus = "offline";
    pumpeWarnung = `\n\n⚠️ *Hinweis:* Pumpe konnte nicht eingeschaltet werden (${e.message || "offline"}).`;
    logger.warn(`Sequenz ${sequenzId}: Pumpe-Einschaltung fehlgeschlagen`, e?.message);
  }
  
  // 5) Tasks für die späteren Schritte anlegen (nur noch AUS-Befehle)
  const now = Date.now();
  const t_pumpeAus = now + minutes * 60 * 1000;
  const t_computerAus = t_pumpeAus + nachlaufSec * 1000;
  
  const tasks = [
    {
      sequenzId,
      step: 3,
      action: "off",
      deviceKind: "pump",
      device: devicePumpe,
      zoneId: zone.id,
      zoneLabel: zone.label,
      valveDevice: zone.device,
      valveType: zone.valveType,
      channel: zone.channel,
      executeAt: new Date(t_pumpeAus).toISOString(),
      requestedBy,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
    },
    {
      sequenzId,
      step: 4,
      action: "off",
      deviceKind: "valve",
      device: zone.device,
      valveType: zone.valveType,
      channel: zone.channel,
      zoneId: zone.id,
      zoneLabel: zone.label,
      executeAt: new Date(t_computerAus).toISOString(),
      requestedBy,
      done: false,
      sendSuccessMessage: true, // Erfolgsmeldung am Ende senden
      bewässerungsMinuten: minutes, // Für die Meldung
      waterLogSource: config.waterLogSource || (requestedBy ? "whatsapp" : "manual"),
      createdAt: FieldValue.serverTimestamp(),
    },
  ];
  
  for (const task of tasks) {
    await db.collection("bewaesserung_tasks").add(task);
  }
  
  await debugLog("garten_seq_started", { sequenzId, minutes, zone, devicePumpe, nachlaufSec });

  const { dayKey: todayKey } = zurichWeekdayKeyAndHM();
  await setGartenWaterLog(gartenYmdZurichNow(), zone.id, {
    status: "started",
    source: config.waterLogSource || (requestedBy ? "whatsapp" : "manual"),
    dayKey: config.dayKey || todayKey,
    slotIndex: config.slotIndex ?? null,
    by: config.member || null,
    minutes,
    sequenzId,
    zoneLabel: zone.label,
  });
  
  const pumpeAusTime = new Date(t_pumpeAus).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  const endeTime = new Date(t_computerAus).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  
  // Status-Zeilen basierend auf tatsächlichem Status
  const valveLine = valveStatus === "an" 
    ? `✅ ${zone.label}: AN` 
    : valveStatus === "aus"
    ? `❌ ${zone.label}: AUS (reagiert nicht!)`
    : `📤 ${zone.label}: Befehl gesendet`;
    
  const pumpeLine = pumpeStatus === "an"
    ? `✅ Pumpe: AN`
    : pumpeStatus === "offline"
    ? `📴 Pumpe: offline`
    : `📤 Pumpe: Befehl gesendet`;
  
  const allWarnings = valveWarnung + pumpeWarnung;
  
  return {
    success: true,
    sequenzId,
    message: `🌿 *Garten-Bewässerung*\n\n` +
      `📍 Zone: *${zone.label}*\n` +
      `${valveLine}\n` +
      `${pumpeLine}\n` +
      `⏱️ Dauer: *${minutes} Minuten*\n` +
      `⏹️ Pumpe AUS: ${pumpeAusTime} Uhr\n` +
      `🔌 Ende: ${endeTime} Uhr` +
      allWarnings +
      `\n\nZum Stoppen: "Bewässerung stopp" oder "Garten aus"`,
  };
}

/**
 * Stoppt alle laufenden Garten-Bewässerungssequenzen sofort.
 */
async function stopGartenSequenz(requestedBy) {
  const devicePumpe = GARTEN_DEVICE_PUMPE;
  
  if (!plugs.isConfigured()) {
    return { success: false, message: `⚠️ Smart Plugs nicht konfiguriert.` };
  }

  let planData = {};
  try {
    const snap = await db.doc("config/gartenPlan").get();
    if (snap.exists) planData = snap.data();
  } catch (e) {
    logger.warn("stopGartenSequenz: gartenPlan read", e?.message || e);
  }
  
  let pumpeOk = true;
  let valveOk = true;
  
  try {
    await plugs.setPower(devicePumpe, false);
  } catch (e) {
    pumpeOk = false;
  }
  
  try {
    await stopAllGartenValves(planData);
  } catch (e) {
    valveOk = false;
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
  
  await debugLog("garten_seq_stopped", { requestedBy, tasksCleared: ops.length, pumpeOk, valveOk });
  
  const pumpeStatus = pumpeOk ? "🔌 Pumpe: AUS" : "📴 Pumpe: war offline";
  const valveStatus = valveOk ? "🔌 Alle Ventile: AUS" : "⚠️ Ventile: Fehler beim Stoppen";
  
  return {
    success: valveOk,
    message: `⏹️ *Garten-Bewässerung gestoppt!*\n\n` +
      `${valveStatus}\n` +
      `${pumpeStatus}` +
      (ops.length > 0 ? `\n\n${ops.length} geplante Schritte abgebrochen.` : ``),
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
  
  const valveTask = snap.docs.find((d) => {
    const data = d.data();
    return data.sequenzId === sequenzId && data.step === 4;
  });
  const valveData = valveTask?.data();
  if (valveData) {
    try {
      await stopGartenValve({
        device: valveData.device,
        valveType: valveData.valveType || "irrigation",
        channel: valveData.channel ?? null,
      });
    } catch (e) {
      logger.warn("abortGartenSequenz: Konnte Ventil nicht stoppen", e?.message);
    }
  } else {
    try {
      await stopAllGartenValves({});
    } catch (e) {
      logger.warn("abortGartenSequenz: Konnte Ventile nicht stoppen", e?.message);
    }
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

// Wetter-Befehl erkennen (DE/EN/FR) – auch natürliche Fragen
function isWetterCommand(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  const low = s.toLowerCase();
  if (
    /^(wetter|weather|meteo|wie\s+ist\s+(das\s+)?wetter|wie\s+wird\s+(das\s+)?wetter|what'?s?\s+the\s+weather|how'?s?\s+the\s+weather|quel\s+temps|regnet\s+es|is\s+it\s+raining|il\s+pleut|sonne|sun|soleil|wettervorhersage|forecast)\s*[?.!]*$/i.test(s)
  ) {
    return true;
  }
  return (
    /\b(wetter|weather|meteo|regen|rain|forecast|vorhersage|temperatur|grad)\b/i.test(low) &&
    /\b(wie|was|wird|how|what|quel|morgen|heute|weekend|wochenende)\b/i.test(low)
  );
}

function isMieteQuery(raw) {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  return (
    /\b(wie\s+hoch|was\s+kostet|how\s+much|combien)\b.*\b(miete|rent|loyer)\b/i.test(s) ||
    /\b(miete|rent|loyer)\s*(kosten?|preis|höhe|hohe)?\s*\??$/i.test(low) ||
    /\b(zimmerpreis|wg[- ]?miete)\b/i.test(low)
  );
}

async function buildMieteReply() {
  try {
    const snap = await db.doc("config/roomOffer").get();
    const ro = snap.exists ? snap.data() : null;
    if (ro?.miete) {
      const bits = [`💰 *Zimmer-Miete:* ${ro.miete}`];
      if (ro.groesse) bits.push(`📐 ${ro.groesse}`);
      if (ro.freiAb) bits.push(`📅 Frei ab ${ro.freiAb}`);
      bits.push("", `🌐 ${WEBSITE_URL}/#zimmer`);
      return bits.join("\n");
    }
  } catch (e) {
    logger.warn("buildMieteReply", e);
  }
  return null;
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

function snapToGartenSaturdayDate(d) {
  const x = startOfDay(d instanceof Date ? d : new Date(d));
  const daysUntil = (6 - x.getDay() + 7) % 7;
  if (daysUntil > 0) x.setDate(x.getDate() + daysUntil);
  return x;
}

/** Nächster Soll-Termin Garten To-Do (wie Frontend / Scheduler, Samstag). */
function gartenTodoNextDueDatePlain(data) {
  if (data.nextDue) {
    const parts = String(data.nextDue).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (parts) return startOfDay(new Date(+parts[1], +parts[2] - 1, +parts[3]));
  }
  const intervalDays = data.intervalDays || 14;
  const lastDone = data.lastDone ? new Date(data.lastDone) : null;
  if (lastDone) {
    const next = startOfDay(new Date(lastDone));
    next.setDate(next.getDate() + intervalDays);
    return snapToGartenSaturdayDate(next);
  }
  return snapToGartenSaturdayDate(startOfDay(new Date()));
}

function gartenTodoIsoDateAfterInterval(intervalDays) {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() + (intervalDays || 14));
  const sat = snapToGartenSaturdayDate(d);
  const y = sat.getFullYear();
  const m = String(sat.getMonth() + 1).padStart(2, "0");
  const day = String(sat.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function gartenTodoIsDueOrOverdueData(data) {
  const today = startOfDay(new Date());
  const next = gartenTodoNextDueDatePlain(data);
  return next.getTime() <= today.getTime();
}

function gartenTodoDoneToday(data) {
  if (!data.lastDone) return false;
  const today = startOfDay(new Date());
  const next = gartenTodoNextDueDatePlain(data);
  if (next.getTime() > today.getTime()) return false;
  const last = startOfDay(new Date(data.lastDone));
  return last.getTime() === today.getTime();
}

function gartenTodoTaskMatchesHint(task, hint) {
  const t = String(task || "").toLowerCase().trim();
  const h = String(hint || "").toLowerCase().trim();
  if (!h) return true;
  return t.includes(h) || h.includes(t);
}

function gartenTodoPickNextAssignee(currentWho) {
  const adults = [...ADULTS].sort((a, b) => a.localeCompare(b, "de"));
  if (!adults.length) return "";
  const idx = adults.indexOf(currentWho);
  if (idx < 0) return adults[0];
  return adults[(idx + 1) % adults.length];
}

/**
 * Garten To-Do: «garten erledigt», «erledigt Rasen hinten», LLM: *Gartentodo erledigt: …*
 */
function parseGartenTodoDoneMessage(raw) {
  let s = String(raw || "").trim().replace(/^\*+|\*+$/g, "").trim();
  if (!s) return null;
  if (/\b(gegossen|watered|arros)/i.test(s)) return null;
  const llmWith = /^(?:garten(?:\s*todo)?|gartentodo)\s+erledigt(?:\s*[:\-–]\s*|\s+)(.+)$/i.exec(s);
  if (llmWith) return { taskHint: llmWith[1].trim() };
  if (/^(?:garten(?:\s*todo)?|gartentodo)\s+erledigt\.?$/i.test(s)) return { taskHint: null };
  const de = /^(?:erledigt|habe\s+erledigt)(?:\s+(.+))?$/i.exec(s);
  if (de && de[2] && !/\b(putz|küche|kueche|bad|wc)\b/i.test(de[2])) {
    return { taskHint: de[2].trim() };
  }
  const rev = /^(.{2,80})\s+erledigt\.?$/i.exec(s);
  if (rev && /\b(rasen|beet|garten|hecken|mähen|maehen|jäten|jaeten|schnitt)\b/i.test(rev[1])) {
    return { taskHint: rev[1].trim() };
  }
  return null;
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
    zustaendig: entry.zustaendig || "",
    kuemmerer: entry.kuemmerer === "vermieter" ? "vermieter" : "wg",
    status: "offen",
    addedBy: addedBy || "WhatsApp",
    source: "whatsapp",
    createdAt: FieldValue.serverTimestamp(),
    history: [
      {
        at: new Date().toISOString(),
        by: addedBy || "WhatsApp",
        action: "created",
        titel: entry.titel,
        ort: entry.ort || "",
        prio: entry.prio || "medium",
        status: "offen",
        zustaendig: entry.zustaendig || "",
        kuemmerer: entry.kuemmerer === "vermieter" ? "vermieter" : "wg",
      },
    ],
  };
  if (image) payload.image = image;
  if (payload.zustaendig) {
    payload.reminder = entry.reminder !== false;
    payload.reminderEveryDays = normalizeReminderEveryDays(entry.reminderEveryDays, 7);
  }
  const ref = await db.collection("schaeden").add(payload);
  return ref.id;
}

const REMINDER_CADENCE_ALLOWED = [1, 2, 3, 7, 14];

function normalizeReminderEveryDays(raw, fallback = 1) {
  const n = parseInt(raw, 10);
  return REMINDER_CADENCE_ALLOWED.includes(n) ? n : fallback;
}

/** Millisekunden seit letzter WhatsApp-Erinnerung (∞ wenn noch nie). */
function msSinceLastReminder(d) {
  const last = d.lastReminderAt ? new Date(d.lastReminderAt).getTime() : 0;
  if (!last || Number.isNaN(last)) return Infinity;
  return Date.now() - last;
}

/** Erinnerung aktiv und Intervall seit lastReminderAt abgelaufen? */
function whatsappReminderDue(d, defaultEveryDays = 1) {
  if (!d?.reminder) return false;
  const everyMs = normalizeReminderEveryDays(d.reminderEveryDays, defaultEveryDays) * 86400000;
  return msSinceLastReminder(d) >= everyMs;
}

function schadenReminderEnabled(d) {
  if (!d?.zustaendig || d.status === "erledigt") return false;
  return d.reminder !== false;
}

function schadenReminderDue(d) {
  if (!schadenReminderEnabled(d)) return false;
  return whatsappReminderDue(d, 7);
}

function schadenPrioIcon(prio) {
  if (prio === "high") return "⚠️";
  if (prio === "low") return "·";
  return "🔧";
}

function schadenKuemmererTag(kuemmerer) {
  return kuemmerer === "vermieter" ? " · 🏠 Schelly" : " · 🏡 WG";
}

/* ==========================================================================
   Wellness · Jacuzzi-Temp & Belegung Sauna / Kino
   ========================================================================== */

const WELLNESS_RESOURCES = {
  sauna: { emoji: "🧖", label: "Sauna" },
  jacuzzi: { emoji: "🛁", label: "Jacuzzi" },
  kino: { emoji: "🎬", label: "Kino" },
};

const JACUZZI_WARM_TEMP_C = 36;

function wellnessTsMs(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v === "number") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function fmtWellnessTimeRange(startAt, endAt) {
  const opts = { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" };
  const s = new Date(startAt).toLocaleTimeString("de-CH", opts);
  const e = new Date(endAt).toLocaleTimeString("de-CH", opts);
  return `${s}–${e}`;
}

function fmtWellnessDateLabel(startAt) {
  const start = new Date(startAt);
  const today = startOfDay(new Date());
  const day = startOfDay(start);
  if (day.getTime() === today.getTime()) return "heute";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (day.getTime() === tomorrow.getTime()) return "morgen";
  return start.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Zurich",
  });
}

async function getJacuzziStatusDoc() {
  const snap = await db.doc("config/jacuzzi").get();
  return snap.exists ? snap.data() : null;
}

async function getActiveWellnessBooking(resource) {
  const snap = await db.collection("wellnessBookings").where("resource", "==", resource).get();
  const nowMs = Date.now();
  let best = null;
  snap.forEach((doc) => {
    const d = doc.data();
    const start = wellnessTsMs(d.startAt);
    const end = wellnessTsMs(d.endAt);
    if (start == null || end == null || start > nowMs || end <= nowMs) return;
    best = { id: doc.id, ...d };
  });
  return best;
}

function jacuzziEnrichedStatus(status = {}) {
  const tempAmpel = jacuzziWaterAmpelLevel(
    status.tempC,
    status.tempOkMin ?? 30,
    status.tempOkMax ?? 40,
    status.tempWarnLow ?? 5,
    status.tempWarnHigh ?? 50
  );
  const phAmpel = jacuzziWaterAmpelLevel(
    status.ph,
    status.phOkMin,
    status.phOkMax,
    status.phWarnLow,
    status.phWarnHigh
  );
  const orpAmpel = jacuzziWaterAmpelLevel(
    status.orp,
    status.orpOkMin,
    status.orpOkMax,
    status.orpWarnLow,
    status.orpWarnHigh
  );
  return { ...status, tempAmpel, phAmpel, orpAmpel };
}

function buildJacuzziGaugeBar(value, gaugeMin, gaugeMax) {
  const min = Number(gaugeMin);
  const max = Number(gaugeMax);
  const v = Number(value);
  if (Number.isNaN(v) || Number.isNaN(min) || Number.isNaN(max) || max <= min) return "";
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min)));
  const filled = Math.round(pct * 12);
  return `${"▓".repeat(filled)}${"░".repeat(12 - filled)}`;
}

function buildJacuzziGaugeBarForKey(key, status) {
  if (key === "tempC") {
    return buildJacuzziGaugeBar(
      status.tempC,
      status.tempGaugeMin ?? 0,
      status.tempGaugeMax ?? 50
    );
  }
  if (key === "ph") {
    return buildJacuzziGaugeBar(status.ph, status.phGaugeMin ?? 5, status.phGaugeMax ?? 10);
  }
  if (key === "orp") {
    return buildJacuzziGaugeBar(status.orp, status.orpGaugeMin ?? 300, status.orpGaugeMax ?? 1000);
  }
  return "";
}

async function buildJacuzziFullReply() {
  const status = await getJacuzziStatusDoc();
  const booking = await getActiveWellnessBooking("jacuzzi");
  const enriched = jacuzziEnrichedStatus(status || {});
  const lines = ["🛁 *Jacuzzi · Übersicht*", "", "*Wasserqualität* (Blue Connect):", ""];

  let hasMetric = false;
  for (const key of ["tempC", "ph", "orp"]) {
    const metricLine = buildJacuzziWaterMetricLine(key, enriched);
    if (!metricLine) continue;
    hasMetric = true;
    lines.push(metricLine);
    const bar = buildJacuzziGaugeBarForKey(key, enriched);
    if (bar) lines.push(bar);
    lines.push("");
  }

  if (!hasMetric) {
    lines.push(
      blueriiot.blueriiotEnabled()
        ? "Noch keine Messwerte in der Cloud – nach Handy-Messung Sync alle 5 Min."
        : "Keine Messwerte – Blue-Riiot-Sync in functions/.env aktivieren.",
      ""
    );
  } else {
    lines.push("_🟢 Gut · 🟡 Warnung · 🔴 Schlecht_", "");
  }

  const temp = enriched.tempC != null ? Number(enriched.tempC) : null;
  const threshold = enriched.warmThresholdC != null ? Number(enriched.warmThresholdC) : JACUZZI_WARM_TEMP_C;
  if (temp != null && !Number.isNaN(temp)) {
    lines.push(
      temp >= threshold
        ? `♨️ *Warm genug zum Baden* (${temp.toFixed(1)} °C)`
        : `⏳ *Wird noch warm* (${temp.toFixed(1)} °C, Ziel ca. ${enriched.targetTempC || 38} °C)`
    );
  }

  if (booking) {
    const when = fmtWellnessDateLabel(booking.startAt);
    const range = fmtWellnessTimeRange(booking.startAt, booking.endAt);
    lines.push(`📅 Belegt ${when} (*${range}*) – ${booking.who || "?"}`);
  } else {
    lines.push("📅 Gerade *frei*!");
  }

  if (enriched.updatedAt) {
    lines.push(`🕐 Stand: ${fmtTimeZurich(new Date(enriched.updatedAt))} Uhr`);
  }
  lines.push("", `📊 Gauges auf der Website: ${WEBSITE_URL}/#kalender`);
  return lines.join("\n");
}

async function buildJacuzziWarmReply() {
  const status = await getJacuzziStatusDoc();
  const booking = await getActiveWellnessBooking("jacuzzi");
  const temp = status?.tempC != null ? Number(status.tempC) : null;
  const threshold = status?.warmThresholdC != null ? Number(status.warmThresholdC) : JACUZZI_WARM_TEMP_C;
  const lines = [];
  if (temp != null && !Number.isNaN(temp)) {
    if (temp >= threshold) {
      lines.push(`🛁♨️ *Jacuzzi ist warm* (${temp.toFixed(1)} °C) – rein damit! 🌊`);
    } else {
      lines.push(`🛁 *Jacuzzi wird noch warm* (${temp.toFixed(1)} °C, Ziel ca. ${status?.targetTempC || 38} °C)`);
    }
    if (status?.updatedAt) {
      lines.push(`Stand: ${fmtTimeZurich(new Date(status.updatedAt))} Uhr`);
    }
  } else {
    lines.push(
      blueriiot.blueriiotEnabled()
        ? "🛁 Noch keine Temperatur in der Cloud – Sync läuft alle 5 Min."
        : "🛁 Keine Temperatur – Blue-Riiot-Sync in functions/.env aktivieren."
    );
  }
  if (booking) {
    const when = fmtWellnessDateLabel(booking.startAt);
    const range = fmtWellnessTimeRange(booking.startAt, booking.endAt);
    lines.push(`📅 Belegt ${when} (*${range}*) – ${booking.who || "?"}`);
  } else {
    lines.push("📅 Gerade niemand eingetragen – *frei*!");
  }
  return lines.join("\n");
}

async function buildWellnessFreiReply(resource) {
  const meta = WELLNESS_RESOURCES[resource] || { emoji: "📍", label: resource };
  const booking = await getActiveWellnessBooking(resource);
  if (!booking) {
    return `${meta.emoji} *${meta.label} ist frei!* 🎉`;
  }
  const when = fmtWellnessDateLabel(booking.startAt);
  const range = fmtWellnessTimeRange(booking.startAt, booking.endAt);
  const who = booking.who || "jemand";
  if (resource === "kino" && booking.title) {
    return `${meta.emoji} Im *Kino* ${when} wird *${booking.title}* von *${range}* geschaut – ${who}`;
  }
  return `${meta.emoji} *${meta.label}* ist belegt ${when} (*${range}*) – ${who}`;
}

function zurichDateParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const p = (t) => +parts.find((x) => x.type === t).value;
  return { y: p("year"), m: p("month"), d: p("day") };
}

function parseWellnessTimeOnDate(token, baseDate = new Date()) {
  const t = String(token || "").trim().toLowerCase();
  if (!t || t === "jetzt" || t === "now") return new Date();
  let base = baseDate;
  const { date } = extractDate(t);
  if (date) base = date;
  const { hh, mi, cleaned } = extractTime(t);
  let hour = hh;
  let minute = mi;
  if (hour === null) {
    const bare = (cleaned || t).match(/^(\d{1,2})(?:[:.:h](\d{2}))?$/);
    if (!bare) return null;
    hour = +bare[1];
    minute = bare[2] ? +bare[2] : 0;
  }
  const { y, m, d } = zurichDateParts(base);
  return zurichWallToUtcDate(y, m, d, hour, minute);
}

function normalizeWellnessResource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (/jacuzzi|whirlpool|hot\s*tub/.test(s)) return "jacuzzi";
  if (/sauna/.test(s)) return "sauna";
  if (/kino|cinema/.test(s)) return "kino";
  return null;
}

function isWellnessBookingIntent(raw) {
  const s = String(raw || "").trim();
  if (/^Wellness\s+belegen:/i.test(s)) return true;
  if (!/\b(jacuzzi|whirlpool|sauna|kino)\b/i.test(s)) return false;
  if (/\b(frei\??|available|libre)\b/i.test(s) && !/\b(bis|von|ab)\s*\d/i.test(s)) return false;
  return (
    /\b(besetzt|belegt|reservier\w*|buche\w*|blockier\w*)\b/i.test(s) ||
    /\b(von\s+mir|für\s+mich)\b/i.test(s) ||
    /\b(?:von|ab)\s+\d{1,2}\b.*\bbis\b/i.test(s) ||
    /\bbis\s+\d{1,2}\b/i.test(s)
  );
}

/** @returns {{ resource: string, who: string, startAt: Date, endAt: Date, title?: string } | null} */
function parseWellnessBookingCommand(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const llm = s.match(/^Wellness\s+belegen:\s*(.+)$/i);
  if (llm) {
    const parts = llm[1].split("|").map((p) => p.trim());
    if (parts.length >= 4) {
      const resource = normalizeWellnessResource(parts[0]);
      const who = parts[1];
      const startAt = parseWellnessTimeOnDate(parts[2]);
      const endAt = parseWellnessTimeOnDate(parts[3]);
      const title = parts[4] || "";
      if (resource && who && startAt && endAt) {
        return { resource, who, startAt, endAt, title };
      }
    }
    return null;
  }

  if (!isWellnessBookingIntent(s)) return null;

  const resource = normalizeWellnessResource(s);
  if (!resource) return null;

  let who = "WHO_SELF";
  if (/\b(von\s+mir|für\s+mich)\b/i.test(s)) {
    who = "WHO_SELF";
  } else {
    const vonFuer = s.match(/\b(?:von|für|for)\s+([A-Za-zÄÖÜäöüß][\wäöüÄÖÜß.-]*)/i);
    if (vonFuer) {
      const w = vonFuer[1].toLowerCase();
      who = w === "mir" || w === "mich" ? "WHO_SELF" : vonFuer[1];
    }
  }

  let startAt = new Date();
  let endAt = null;
  const vonBis = s.match(
    /\b(?:von|ab|from)\s+(\d{1,2})(?:[:.:h](\d{2}))?\s*(?:uhr|h)?\s*(?:bis|-|–|to)\s+(\d{1,2})(?:[:.:h](\d{2}))?\s*(?:uhr|h)?/i
  );
  const nurBis = s.match(/\b(?:bis|until)\s+(\d{1,2})(?:[:.:h](\d{2}))?\s*(?:uhr|h)?/i);
  const { y, m, d } = zurichDateParts();

  if (vonBis) {
    startAt = zurichWallToUtcDate(y, m, d, +vonBis[1], vonBis[2] ? +vonBis[2] : 0);
    endAt = zurichWallToUtcDate(y, m, d, +vonBis[3], vonBis[4] ? +vonBis[4] : 0);
  } else if (nurBis) {
    endAt = zurichWallToUtcDate(y, m, d, +nurBis[1], nurBis[2] ? +nurBis[2] : 0);
  } else {
    return null;
  }

  let title = "";
  if (resource === "kino") {
    const tm = s.match(/\bkino\s+(.+?)\s+(?:besetzt|belegt|reservier|von|für|bis)/i);
    if (tm) title = cleanTail(tm[1]);
  }

  return { resource, who, startAt, endAt, title };
}

function resolveWellnessBookingWho(whoToken, resident, senderName) {
  const w = String(whoToken || "").trim();
  if (!w || w === "WHO_SELF" || /^(ich|mir|mich|me)$/i.test(w)) {
    return resident || resolveResident(senderName, true) || senderName || "WG";
  }
  return resolveResident(w, true) || w;
}

async function findWellnessBookingConflict(resource, startMs, endMs) {
  const snap = await db.collection("wellnessBookings").where("resource", "==", resource).get();
  for (const doc of snap.docs) {
    const d = doc.data();
    const s = wellnessTsMs(d.startAt);
    const e = wellnessTsMs(d.endAt);
    if (s != null && e != null && s < endMs && e > startMs) {
      return { id: doc.id, ...d };
    }
  }
  return null;
}

async function createWellnessBooking({ resource, who, startAt, endAt, title, createdBy }) {
  const entry = {
    resource,
    who,
    title: title || "",
    startAt: startAt instanceof Date ? startAt.toISOString() : startAt,
    endAt: endAt instanceof Date ? endAt.toISOString() : endAt,
    createdBy: createdBy || who,
    createdAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection("wellnessBookings").add(entry);
  return { id: ref.id, ...entry };
}

/** WhatsApp bei neuer Sauna-Buchung (komma-separiert, ohne +). Default: Manu. */
function saunaBookingNotifyTargets() {
  const raw =
    process.env.SAUNA_BOOKING_NOTIFY ||
    process.env.WELLNESS_BOOKING_NOTIFY ||
    "41798385590";
  return [...new Set(raw.split(",").map((s) => s.trim().replace(/\D/g, "")).filter(Boolean))];
}

async function sendSaunaBookingAlert(data) {
  if (!data || data.resource !== "sauna") return;
  const targets = saunaBookingNotifyTargets();
  if (!targets.length) return;
  const when = fmtWellnessDateLabel(data.startAt);
  const range = fmtWellnessTimeRange(data.startAt, data.endAt);
  const who = data.who || data.createdBy || "?";
  const via = data.createdBy && data.createdBy !== who ? `\n📝 Eingetragen von: *${data.createdBy}*` : "";
  const text =
    `🧖 *Neue Sauna-Buchung*\n\n` +
    `👤 *${who}*\n` +
    `📅 ${when}, *${range}*${via}\n\n` +
    `🌐 ${WEBSITE_URL}/#kalender`;
  for (const to of targets) {
    try {
      const ok = await sendWhatsApp(to, text);
      if (!ok) logger.warn("sendSaunaBookingAlert failed", { to });
    } catch (e) {
      logger.error("sendSaunaBookingAlert", { to, error: e?.message });
    }
  }
}

function parseWellnessQuery(raw, history) {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  if (isWellnessBookingIntent(s)) return null;
  if (
    /\b(jacuzzi|whirlpool|hot\s*tub)\b.*\b(warm|temperatur|temp|heiss|heiß)\b/i.test(s) ||
    /\b(warm|temperatur)\b.*\b(jacuzzi|whirlpool)\b/i.test(s) ||
    /^jacuzzi\s*warm\??$/i.test(low)
  ) {
    return { type: "jacuzzi_warm" };
  }
  if (
    /^jacuzzi\s*\??$/i.test(low) ||
    /^whirlpool\s*\??$/i.test(low) ||
    /^hot\s*tub\s*\??$/i.test(low) ||
    /^jacuzzi\s*(?:status|info|übersicht|uebersicht)\s*\??$/i.test(low) ||
    /\b(wasserqualit[aä]t|wasser\s*qualit[aä]t)\b/i.test(s) ||
    /\bwie\s+ist\s+(die\s+)?wasser/i.test(low) ||
    /\b(wasserqualit|ph|chlorgehalt|chlor\s*gehalt|orp|blue\s*connect)\b.*\b(jacuzzi|whirlpool|pool)\b/i.test(s) ||
    /\b(jacuzzi|whirlpool|pool)\b.*\b(wasserqualit|ph|chlorgehalt|chlor|orp)\b/i.test(s) ||
    /\b(water\s*quality|chlorine\s*level|how\s+is\s+the\s+water)\b/i.test(low) ||
    /\b(qualit[eé]\s+(de\s+l[''])?eau|chlore|ph)\b.*\b(jacuzzi|spa)\b/i.test(low)
  ) {
    return { type: "jacuzzi_status" };
  }
  const recent = (history || [])
    .slice(-4)
    .map((m) => String(m?.content || ""))
    .join(" ")
    .toLowerCase();
  const jacuzziCtx = /\b(jacuzzi|whirlpool|hot\s*tub|wasserqualit|🛁)\b/i.test(recent);
  if (jacuzziCtx) {
    if (/\b(wasserqualit|wasser\s*qualit|ph|chlor|chlorgehalt|orp|blue\s*connect)\b/i.test(low)) {
      return { type: "jacuzzi_status" };
    }
    if (/\b(wie\s+ist|wie\s+sieht|und\s+die|what\s+about|how\s+about)\b/i.test(low) &&
        /\b(wasser|qualit|temp|temperatur|warm)\b/i.test(low)) {
      if (/\b(warm|temperatur|temp|heiss|heiß)\b/i.test(low) && !/\b(wasserqualit|ph|chlor)\b/i.test(low)) {
        return { type: "jacuzzi_warm" };
      }
      return { type: "jacuzzi_status" };
    }
  }
  for (const key of ["kino", "sauna", "jacuzzi"]) {
    if (
      new RegExp(`\\b${key}\\b.*\\b(frei|frei\\?|available|libre|status)\\b`, "i").test(s) ||
      new RegExp(`\\b(frei|frei\\?|status)\\b.*\\b${key}\\b`, "i").test(s) ||
      new RegExp(`^${key}\\s+frei\\??$`, "i").test(low)
    ) {
      return { type: "frei", resource: key };
    }
  }
  return null;
}

/* ==========================================================================
   Umfragen (Variante B: WhatsApp-Buttons, A: Text-RSVP, C: Website-Link)
   ========================================================================== */

function isPollQuestionIntent(raw) {
  const s = String(raw || "").trim();
  if (!s || !/\?\s*$/.test(s)) return false;
  if (isWellnessBookingIntent(s) || parseWellnessQuery(s)) return false;
  if (/^(wer|was|wie|wo|wann|warum|who|what|how|where|when|qui|quoi|comment)\b/i.test(s)) return false;
  if (/^(umfrage|poll|sondage)\b/i.test(s)) return true;
  return /\b(spieleabend|grillabend|apéro|apero|zämme|zäme|treff|meetup|party|abend|zämespiel|zäme\s*spiel|goht\s*das|chömmed|chömed|wotsch|wot\s*mer)\b/i.test(s);
}

function parsePollQuestion(raw) {
  const s = String(raw || "").trim();
  if (!isPollQuestionIntent(s)) return null;
  const cleaned = s.replace(/\?+\s*$/, "").trim();
  const whenRe = /\s+(morgen|heute|übermorgen|uebermorgen|am\s+(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)|on\s+\w+|demain|today|tomorrow)\s*$/i;
  const wm = cleaned.match(whenRe);
  if (wm) {
    const title = cleaned.slice(0, wm.index).trim();
    return { title: title || cleaned, whenLabel: wm[1].trim(), mode: "buttons", question: s };
  }
  return { title: cleaned, whenLabel: "", mode: "buttons", question: s };
}

function parsePollStartCommand(raw) {
  const s = String(raw || "").trim();
  let mode = "buttons";
  let m = s.match(/^umfrage\s+text\s*[:\-–]?\s*(.+)$/i);
  if (m) mode = "text";
  else m = s.match(/^umfrage\s*(?:neu\s*)?[:\-–]\s*(.+)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  const parts = rest.split("|").map((x) => x.trim());
  const title = parts[0];
  if (!title) return null;
  const whenLabel = parts[1] || "";
  let deadlineLabel = "";
  for (let i = 2; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const pl = p.toLowerCase();
    if (pl === "text" || pl === "buttons" || pl === "button") continue;
    if (/\bbis\b/i.test(p)) deadlineLabel = p.trim();
  }
  const modePart = (parts[2] || "").toLowerCase();
  if (modePart === "text") mode = "text";
  if (modePart === "buttons" || modePart === "button") mode = "buttons";
  const question = whenLabel ? `${title} ${whenLabel}?` : `${title}?`;
  return { title, whenLabel, mode, question, deadlineLabel };
}

function parsePollStatusCommand(raw) {
  const s = String(raw || "").trim();
  let m = s.match(/^umfrage\s+status\s*[:\-–]?\s*(.+)$/i);
  if (m) return { title: m[1].trim() };
  m = s.match(/^(?:wie\s+si[eht]'?s?\s+aus|stand|ergebnis|zämmefassung|zusammenfassung)\s*(?:bei|zum|zur|zu|für)?\s*(.+?)\s*[?.!]*$/i);
  if (m) return { title: m[1].trim() };
  m = s.match(/^umfrage\s+(?!text\b|status\b|neu\b)(.+)$/i);
  if (m && !m[1].includes("|")) return { title: m[1].trim() };
  m = s.match(/^(?:wer\s+sagt\s+ja|wer\s+kommt)\s+(?:zu[rm]?\s+)?(.+?)\s*[?.!]*$/i);
  if (m) return { title: m[1].trim() };
  return null;
}

function inferPollEventDate(whenLabel) {
  const s = String(whenLabel || "").toLowerCase().trim();
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  if (/morgen|tomorrow|demain|morn\b/i.test(s)) {
    d.setDate(d.getDate() + 1);
  } else if (/übermorgen|uebermorgen/i.test(s)) {
    d.setDate(d.getDate() + 2);
  }
  const { date } = extractDate(whenLabel || "");
  if (date) {
    const dd = new Date(date);
    const { hh, mi } = extractTime(whenLabel);
    dd.setHours(hh === null ? 19 : hh, mi, 0, 0);
    return dd.toISOString();
  }
  return d.toISOString();
}

async function findPollByTitle(title, { openOnly = false } = {}) {
  const snap = await db.collection("polls").get();
  const needle = String(title || "").toLowerCase().trim();
  let best = null;
  let bestScore = -1;
  snap.forEach((doc) => {
    const data = doc.data();
    if (openOnly && data?.status === "closed") return;
    const t = String(data?.title || "").toLowerCase();
    if (!t) return;
    let score = 0;
    if (t === needle) score = 100;
    else if (t.startsWith(needle) || needle.startsWith(t)) score = 70;
    else if (t.includes(needle) || needle.includes(t)) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = { id: doc.id, ...data };
    }
  });
  return bestScore > 0 ? best : null;
}

function buildPollSummary(poll) {
  const responses = Object.values(poll.responses || {});
  const ja = [];
  const nein = [];
  const vielleicht = [];
  const respondedNames = new Set();
  for (const r of responses) {
    const n = r.name || "?";
    respondedNames.add(n.toLowerCase());
    if (r.choice === "ja") ja.push(n);
    else if (r.choice === "nein") nein.push(n);
    else vielleicht.push(n);
  }
  const nochNicht = ADULTS.filter(
    (a) => ![...respondedNames].some((n) => n === a.toLowerCase() || n.startsWith(a.toLowerCase()))
  );
  const whenLine = poll.whenLabel ? `\n📅 ${poll.whenLabel}` : "";
  const modeHint =
    poll.mode === "text"
      ? "\n💬 _Text-Umfrage (Ja/Nein/Vielleicht + Eventname)_"
      : "\n🔘 _Button-Umfrage_";
  const lines = [
    `📊 *Umfrage: ${poll.title}*${whenLine}`,
    poll.question ? `❓ ${poll.question}` : "",
    "",
    `✅ *Ja* (${ja.length})${ja.length ? `: ${ja.join(", ")}` : ""}`,
    `❌ *Nein* (${nein.length})${nein.length ? `: ${nein.join(", ")}` : ""}`,
    `🤔 *Vielleicht* (${vielleicht.length})${vielleicht.length ? `: ${vielleicht.join(", ")}` : ""}`,
    nochNicht.length ? `\n⏳ *Noch keine Antwort* (${nochNicht.length}): ${nochNicht.join(", ")}` : "",
    modeHint,
    `\n🌐 ${WEBSITE_URL}/#events`,
  ];
  if (poll.closesAt) {
    lines.splice(3, 0, `⏰ Antworten bis ${fmtDateTime(poll.closesAt)}`);
  }
  return lines.filter((x) => x !== "").join("\n");
}

async function recordPollResponse(pollId, from, senderName, choice) {
  const ref = db.collection("polls").doc(pollId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const poll = snap.data();
  const name = (await resolveResidentFromWhatsApp(from, senderName)) || senderName || "Gast";
  const key = String(from || "").replace(/\D/g, "") || name.toLowerCase();
  await ref.update({
    [`responses.${key}`]: { name, choice, at: new Date().toISOString() },
  });
  if (poll.eventId) {
    if (choice === "ja") await addRSVP(poll.eventId, name);
    else if (choice === "nein") await removeRSVP(poll.eventId, name);
  }
  return { poll, name, choice };
}

function parsePollClosesAt(deadlineLabel) {
  const s = String(deadlineLabel || "").trim();
  if (!s) return null;
  const { date, cleaned } = extractDate(s);
  if (!date) return null;
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth() + 1;
  const da = date.getUTCDate();
  const { hh, mi } = extractTime(cleaned);
  const h = hh === null ? 23 : hh;
  const min = mi === null && hh === null ? 59 : mi;
  const dUtc = zurichWallToUtcDate(y, mo, da, h, min);
  return dUtc.toISOString();
}

async function startPoll(opts) {
  const { title, whenLabel, question, mode, from, organizerName, phoneId, deadlineLabel } = opts;
  const ref = db.collection("polls").doc();
  const eventDate = inferPollEventDate(whenLabel);
  const closesAt = parsePollClosesAt(deadlineLabel);
  const eventId = await createEvent(
    {
      title,
      date: eventDate,
      description: "Umfrage via Gustav",
      emoji: mode === "buttons" ? "📊" : "🎉",
    },
    from
  );
  const poll = {
    title,
    whenLabel: whenLabel || "",
    question: question || `${title}${whenLabel ? ` ${whenLabel}` : ""}?`,
    mode,
    eventId,
    status: "open",
    createdByPhone: String(from || "").replace(/\D/g, ""),
    organizerName: organizerName || "",
    createdAt: FieldValue.serverTimestamp(),
    responses: {},
    ...(closesAt ? { closesAt } : {}),
  };
  await ref.set(poll);
  const pollId = ref.id;
  const { recipients } = cfg();
  const targets = recipients.length ? [...new Set(recipients)] : [from];
  const orgLabel = organizerName ? ` von *${organizerName}*` : "";
  const whenLine = whenLabel ? `\n📅 ${whenLabel}` : "";
  const deadlineLine = closesAt ? `\n⏰ Antworten bis ${fmtDateTime(closesAt)}` : "";
  const linkLine = `\n\n🌐 ${WEBSITE_URL}/#events`;

  if (mode === "buttons") {
    const body = `📊 *Umfrage${orgLabel}*\n\n${poll.question}${whenLine}${deadlineLine}\n\nTippt einen Button 👇`;
    for (const to of targets) {
      await sendWhatsAppInteractiveButtons(
        to,
        {
          body,
          footer: "Gustav · Haus am See",
          buttons: [
            { id: `poll_${pollId}_ja`, title: "✅ Ja" },
            { id: `poll_${pollId}_nein`, title: "❌ Nein" },
            { id: `poll_${pollId}_vielleicht`, title: "🤔 Vielleicht" },
          ],
        },
        phoneId
      );
    }
    return { pollId, sent: targets.length, mode, eventId };
  }

  const text =
    `📊 *Umfrage${orgLabel}*\n\n*${poll.question}*${whenLine}${deadlineLine}\n\n` +
    `Antwortet mit:\n✅ *Ja ${title}*\n❌ *Nein ${title}*\n🤔 *Vielleicht ${title}*` +
    linkLine;
  for (const to of targets) {
    await sendWhatsApp(to, text, phoneId);
  }
  return { pollId, sent: targets.length, mode, eventId };
}

async function handlePollButtonReply(ctx) {
  const { from, buttonId, senderName, reply } = ctx;
  const m = String(buttonId || "").match(/^poll_([^_]+)_(ja|nein|vielleicht)$/i);
  if (!m) return false;
  const pollId = m[1];
  const choice = m[2].toLowerCase();
  const ref = db.collection("polls").doc(pollId);
  const snap = await ref.get();
  if (!snap.exists) {
    await reply("🤷 Diese Umfrage kenne ich nicht mehr.");
    return true;
  }
  const poll = snap.data();
  if (poll.status === "closed") {
    await reply("⏹️ Diese Umfrage ist schon geschlossen.");
    return true;
  }
  const result = await recordPollResponse(pollId, from, senderName, choice);
  const emoji = { ja: "✅", nein: "❌", vielleicht: "🤔" }[choice] || "📊";
  const label = choice.charAt(0).toUpperCase() + choice.slice(1);
  await reply(`${emoji} Notiert: *${label}* für *${result.poll.title}*`);
  return true;
}

async function handleRemindButtonReply(ctx) {
  const { from, buttonId, reply } = ctx;
  const m = String(buttonId || "").match(/^remind_([a-f0-9]+)$/i);
  if (!m) return false;
  const pending = await gustavExtras.consumeRemindButtonToken(db, m[1]);
  if (!pending) {
    await reply("🤷 Diese Erinnerung ist abgelaufen – schreib *Meine Aufgaben?* neu.");
    return true;
  }
  const owner = String(from || "").replace(/\D/g, "");
  if (pending.from && owner && pending.from !== owner) {
    await reply("🔒 Diese Erinnerung gehört einem anderen Chat.");
    return true;
  }
  await addErinnerung({ date: pending.date, text: pending.text }, from);
  await reply(`🔔 Erinnerung gesetzt für ${fmtDateTime(pending.date)}:\n*${pending.text}*`);
  return true;
}

async function buildDeinTagPreview(resident, from) {
  let weatherLine = null;
  try {
    const w = await fetchCurrentWeather();
    weatherLine = formatWeatherText(w, "de").split("\n").slice(0, 2).join("\n");
  } catch {
    /* optional */
  }
  let tasksSnippet = "_nichts Fälliges_";
  try {
    const tr = await tasksOverview.buildTasksOverviewReply({ db, resident, from, scope: "mine" });
    const lines = tr.text.split("\n").filter((l) => /^[•🔥📅⏭️]/.test(l) || l.startsWith("   _"));
    if (lines.length) tasksSnippet = lines.slice(0, 8).join("\n");
  } catch {
    /* optional */
  }
  const events = await listUpcomingEvents(3);
  let wellnessLine = null;
  try {
    const kino = await buildWellnessFreiReply("kino");
    wellnessLine = String(kino || "").split("\n")[0];
  } catch {
    /* optional */
  }
  const { data } = await getAnwesenheit();
  const da = ADULTS.filter((n) => data[n] === "da");
  const anwLine = da.length ? `🏠 Wochenende: ${da.join(", ")} da` : null;
  return deinTag.buildDeinTagMessage({
    resident,
    weatherLine,
    tasksText: tasksSnippet,
    events,
    wellnessLine,
    anwesenheitLine: anwLine,
  });
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

async function markSchadenErledigt(id, by = "WhatsApp") {
  const ref = db.collection("schaeden").doc(id);
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return;
    const data = snap.data();
    const history = Array.isArray(data.history) ? [...data.history] : [];
    history.unshift({
      at: new Date().toISOString(),
      by,
      action: "status",
      prev: data.status || "offen",
      next: "erledigt",
    });
    if (history.length > 50) history.length = 50;
    t.update(ref, {
      status: "erledigt",
      erledigtAt: FieldValue.serverTimestamp(),
      history,
    });
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
  `*Aufgaben (Putz & Haus)*\n` +
  `➕ "Putz: Manu 20.4. Küche"\n` +
  `📋 "Wer putzt?" · "Meine Aufgaben?" (deine To-dos) · "Aufgaben?" (WG-Übersicht)\n` +
  `☀️ "Dein Tag an" / "Dein Tag werktags" / "Dein Tag aus" (Morgen-Zusammenfassung)\n` +
  `🛒 "Pfeffer auf die Liste" · "Was fehlt?" · "Pfeffer erledigt"\n` +
  `🥗 "Mitbringen Spieleabend: Salat" · "Wer bringt was Spieleabend?"\n` +
  `🎬 "Kino heute Avatar"\n` +
  `🚪 "Bewerber Lisa" · "Bewerber Status Lisa: eingeladen"\n` +
  `📊 "Umfrage: Titel | morgen | bis Donnerstag"\n` +
  `📖 "WLAN?" · "Müll?" (Haus-Wiki)\n` +
  `📶 "WLAN QR" / "QR Code WLAN" — QR zum Scannen (Gäste verbinden sich automatisch)\n\n` +
  `*Garten To-Do / Giessplan (Website WG-Kalender)*\n` +
  `🌿 "garten erledigt" / "garten erledigt Rasen hinten"\n` +
  `💧 "gegossen" / "gegossen Wohnzimmer"\n\n` +
  `*Wellness (Website WG-Kalender)*\n` +
  `🛁 "Jacuzzi?" – Übersicht mit Wasserqualität (Temp, pH, Chlorgehalt)\n` +
  `🛁 "Jacuzzi warm?" / "Ist der Jacuzzi warm?"\n` +
  `🎬 "Kino frei?" · 🧖 "Sauna frei?" · 🛁 "Jacuzzi frei?"\n` +
  `📅 Sauna buchen: *"Sauna besetzt von mir bis 20 Uhr"* · *"Sauna für Corina von 18 bis 21"*\n` +
  `📅 Auch Jacuzzi/Kino: *"Jacuzzi besetzt von mir bis 15 Uhr"*\n\n` +
  `*Anwesenheit*\n` +
  `✅ "Bin da" / "Bin weg 1.5."\n` +
  `📋 "Wer ist da?"\n\n` +
  `*Schäden*\n` +
  `🔧 "Schaden: Waschmaschine tropft | Keller | hoch"\n` +
  `    (Foto mitschicken = wird angehängt)\n` +
  `✅ "Schaden erledigt: Rasenmäher" — als repariert markieren\n` +
  `📋 "Schäden"\n` +
  `📱 Zuständige können auf der Website den WhatsApp-Erinnerungsrhythmus wählen (täglich bis alle 2 Wochen)\n\n` +
  `*Event-Anmeldung & Umfragen*\n` +
  `📊 *Variante B (Standard):* "Spieleabend morgen?" oder "Umfrage: Spieleabend | morgen" → Gustav schickt der WG *WhatsApp-Buttons* (Ja/Nein/Vielleicht)\n` +
  `📋 *Zusammenfassung:* "Umfrage Status Spieleabend" / "Wie sieht's aus Spieleabend?"\n` +
  `💬 *Variante A (Text):* "Umfrage Text: Spieleabend | morgen" → Antwort mit *Ja/Nein/Vielleicht Spieleabend*\n` +
  `🌐 *Variante C:* Event erscheint auf der Website → ${WEBSITE_URL}/#events\n` +
  `✅ Klassisch: "Ja Sommerfest" / "Nein Bierkastenlauf"\n` +
  `📋 "Wer kommt zum Sommerfest?"\n\n` +
  `*Sprachen*\n` +
  `🇩🇪 Hochdeutsch · 🇨🇭 Züritüütsch & St. Gallerdeutsch (verstehen & antworten) · 🇬🇧 English · 🇫🇷 Français\n\n` +
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
  `*Polls & Event RSVP*\n` +
  `📊 *Option B (default):* "Game night tomorrow?" or "Poll: Game night | tomorrow" → Gustav sends *WhatsApp buttons* (Yes/No/Maybe) to the WG\n` +
  `📋 *Summary:* "Poll status Game night" / "How's it looking Game night?"\n` +
  `💬 *Option A (text):* "Poll text: Game night | tomorrow" → reply with *Yes/No/Maybe Game night*\n` +
  `🌐 *Option C:* Event on the website → ${WEBSITE_URL}/#events\n` +
  `✅ Classic: "Yes Summer party" / "No Beer run"\n` +
  `📋 "Who's coming to Summer party?"\n\n` +
  `*Languages*\n` +
  `🇩🇪 German · 🇨🇭 Swiss German (Zurich & St. Gallen dialects) · 🇬🇧 English · 🇫🇷 French\n\n` +
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
  `*Sondages & RSVP événements*\n` +
  `📊 *Option B (défaut):* "Soirée jeux demain?" ou "Sondage: Soirée jeux | demain" → Gustav envoie des *boutons WhatsApp* (Oui/Non/Peut-être) au groupe\n` +
  `📋 *Résumé:* "Sondage statut Soirée jeux" / "Comment ça se présente Soirée jeux?"\n` +
  `💬 *Option A (texte):* "Sondage texte: Soirée jeux | demain"\n` +
  `🌐 *Option C:* Événement sur le site → ${WEBSITE_URL}/#events\n` +
  `✅ Classique: "Oui Fête d'été" / "Non Course de bière"\n` +
  `📋 "Qui vient à la Fête d'été?"\n\n` +
  `*Langues*\n` +
  `🇩🇪 Allemand · 🇨🇭 Suisse allemand (Zurich & St-Gall) · 🇬🇧 Anglais · 🇫🇷 Français\n\n` +
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
  const deMarkers = (s.match(/\b(ist|bitte|hilfe|ja|nein|wer|was|wie|wo|schaden|pumpe|licht|garten|wasser|bin|da|weg|putzt|bewerber|zimmer|hallo|danke|grüezi|gruezi|säg|sägmal|chönd|chömmed|chömed|gsi|gärn|wotsch|wot|mer|dä|dänn|morn|goht|chasch|umfrage)\b/g) || []).length;
  
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

  // 0.4) Miete / Zimmerpreis (Website-Inserat)
  if (isMieteQuery(rawInput)) {
    const mieteText = await buildMieteReply();
    if (mieteText) {
      await reply(mieteText);
      return true;
    }
  }

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

  // 0.54) WLAN-QR-Code für Gäste
  if (wifiQr.parseWifiQrQuery(rawInput)) {
    return wifiQr.handleWifiQrRequest({
      db,
      to: from,
      phoneId: replyPhoneId,
      reply,
      sendImage: sendWhatsAppImage,
    });
  }

  // 0.55) Haus-Wiki (WLAN, Müll, Notfall, …)
  const wikiQ = hausWiki.parseWikiQuery(rawInput);
  if (wikiQ) {
    const wikiText = await hausWiki.buildWikiReply(db, wikiQ);
    if (wikiText) {
      await reply(wikiText);
      return true;
    }
  }

  // 0.56) Dein Tag – Einstellungen / Vorschau
  const deinTagCmd = deinTag.parseDeinTagSettingsCommand(rawInput);
  if (deinTagCmd) {
    const resident = await resolveResidentFromWhatsApp(from, senderName);
    if (!resident) {
      await reply("🤷 Dich konnte ich nicht zuordnen – Nummer im WG-Profil hinterlegen.");
      return true;
    }
    if (deinTagCmd.action === "off") {
      await updateMemberPrefField(resident, { deinTag: { enabled: false, cadence: "daily" } });
      await reply("☀️ *Dein Tag* ist aus. Schreib *Dein Tag an* zum Aktivieren.");
      return true;
    }
    if (deinTagCmd.action === "on") {
      const cadence = deinTag.normalizeCadence(deinTagCmd.cadence);
      await updateMemberPrefField(resident, { deinTag: { enabled: true, cadence } });
      await reply(`☀️ *Dein Tag* ist an – ${deinTag.cadenceLabel(cadence)}.`);
      return true;
    }
    if (deinTagCmd.action === "status") {
      const prefs = await getMemberPrefs(resident);
      const dt = prefs.deinTag || {};
      const on = dt.enabled ? `an (${deinTag.cadenceLabel(deinTag.normalizeCadence(dt.cadence))})` : "aus";
      await reply(`☀️ *Dein Tag:* ${on}\n\n*Dein Tag an* · *täglich* · *werktags* · *wöchentlich* · *alle 2 Tage* · *aus*`);
      return true;
    }
    if (deinTagCmd.action === "preview") {
      const text = await buildDeinTagPreview(resident, from);
      await reply(text);
      return true;
    }
  }

  // 0.57) Einkaufsliste
  const einkauf = einkaufsliste.parseEinkaufCommand(rawInput);
  if (einkauf) {
    const who = (await resolveResidentFromWhatsApp(from, senderName)) || senderName || "";
    if (einkauf.action === "list") {
      const items = await einkaufsliste.listOpenItems(db);
      await reply(einkaufsliste.formatListReply(items));
      return true;
    }
    if (einkauf.action === "add") {
      const r = await einkaufsliste.addItem(db, einkauf.item, who);
      if (r?.duplicate) await reply(`🛒 *${r.item.item}* steht schon auf der Liste.`);
      else await reply(`🛒 *${einkauf.item}* auf die Einkaufsliste – danke ${who}!`);
      return true;
    }
    if (einkauf.action === "done") {
      const r = await einkaufsliste.markItemDone(db, einkauf.item, who);
      if (!r.found) await reply(`🤷 «${einkauf.item}» nicht auf der offenen Liste.`);
      else await reply(`✅ *${r.item}* – erledigt!`);
      return true;
    }
    if (einkauf.action === "remove") {
      const r = await einkaufsliste.removeItem(db, einkauf.item);
      if (!r.found) await reply(`🤷 «${einkauf.item}» nicht gefunden.`);
      else await reply(`🗑️ *${r.item}* von der Liste entfernt.`);
      return true;
    }
  }

  // 0.58) Kino heute FILM
  const kinoHeute = gustavExtras.parseKinoHeuteCommand(rawInput);
  if (kinoHeute) {
    const resident = await resolveResidentFromWhatsApp(from, senderName);
    const who = resident || senderName || "Gast";
    const conflict = await findWellnessBookingConflict("kino", kinoHeute.startAt.getTime(), kinoHeute.endAt.getTime());
    if (conflict) {
      await reply(`🎬 Kino ist belegt (${conflict.who}${conflict.title ? ` · ${conflict.title}` : ""}).`);
      return true;
    }
    await createWellnessBooking({
      resource: "kino",
      who,
      title: kinoHeute.title,
      startAt: kinoHeute.startAt.toISOString(),
      endAt: kinoHeute.endAt.toISOString(),
      createdBy: from,
    });
    await reply(
      `🎬 *Kino heute:* ${kinoHeute.title}\n👤 ${who}\n🕗 ${fmtTimeZurich(kinoHeute.startAt)} – ${fmtTimeZurich(kinoHeute.endAt)}\n\n${WEBSITE_URL}/#kalender`
    );
    return true;
  }

  // 0.59) Geburtstag eintragen
  const residentForBday = await resolveResidentFromWhatsApp(from, senderName);
  const bdaySet = birthdays.parseBirthdaySetCommand(rawInput, residentForBday);
  if (bdaySet) {
    await updateMemberPrefField(bdaySet.resident, { birthDate: bdaySet.birthDate });
    await reply(`🎂 Geburtstag gespeichert: *${bdaySet.birthDate}* – die WG bekommt eine Erinnerung!`);
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

  // 11) RSVP (Ja/Nein/Vielleicht)
  const rsvp = parseRSVPMessage(rawInput);
  if (rsvp) {
    const ev = await findEventByTitle(rsvp.title);
    const poll = await findPollByTitle(rsvp.title, { openOnly: true });
    if (!ev && !poll) {
      await reply(`🤷 Kein Event/Umfrage mit "${rsvp.title}" gefunden.\nSchick "Events" für die Liste.`);
      return true;
    }
    const name = senderName || "Gast";
    if (rsvp.maybe) {
      if (poll) await recordPollResponse(poll.id, from, senderName, "vielleicht");
      await reply(`🤔 ${name}: *Vielleicht* für *${rsvp.title}* notiert.`);
      return true;
    }
    if (rsvp.wantsIn) {
      if (ev) await addRSVP(ev.id, name);
      if (poll) await recordPollResponse(poll.id, from, senderName, "ja");
      const title = ev?.title || poll?.title || rsvp.title;
      const when = ev?.date ? ` (${fmtDateTime(ev.date)})` : "";
      await reply(`✅ ${name} angemeldet für *${title}*${when}.`);
    } else {
      if (ev) await removeRSVP(ev.id, name);
      if (poll) await recordPollResponse(poll.id, from, senderName, "nein");
      const title = ev?.title || poll?.title || rsvp.title;
      await reply(`❌ ${name} abgemeldet von *${title}*.`);
    }
    return true;
  }

  // 11b) Umfrage Status / Zusammenfassung
  const pollStatus = parsePollStatusCommand(rawInput);
  if (pollStatus) {
    const poll = await findPollByTitle(pollStatus.title);
    if (!poll) {
      await reply(`🤷 Keine Umfrage zu "${pollStatus.title}" gefunden.`);
    } else {
      await reply(buildPollSummary(poll));
    }
    return true;
  }

  // 11c) Umfrage starten (explizit)
  const pollStart = parsePollStartCommand(rawInput);
  if (pollStart) {
    const organizer = (await resolveResidentFromWhatsApp(from, senderName)) || senderName || "";
    const result = await startPoll({
      ...pollStart,
      from,
      organizerName: organizer,
      phoneId: replyPhoneId,
    });
    const modeLabel = result.mode === "buttons" ? "Buttons an die WG" : "Text-Umfrage an die WG";
    await reply(
      `📊 Umfrage *${pollStart.title}* gestartet – ${modeLabel} (*${result.sent}* Empfänger).\n\n` +
        `📋 Zusammenfassung: *Umfrage Status ${pollStart.title}*\n\n${WEBSITE_URL}/#events`
    );
    return true;
  }

  // 11d) Natürliche Umfrage-Frage ("Spieleabend morgen?")
  const pollQ = parsePollQuestion(rawInput);
  if (pollQ) {
    const organizer = (await resolveResidentFromWhatsApp(from, senderName)) || senderName || "";
    const result = await startPoll({
      ...pollQ,
      from,
      organizerName: organizer,
      phoneId: replyPhoneId,
    });
    await reply(
      `📊 Umfrage läuft! Ich hab der WG Buttons geschickt.\n\n` +
        `📋 Status: *Umfrage Status ${pollQ.title}* oder *Wie sieht's aus ${pollQ.title}?*`
    );
    return true;
  }

  // 11e) Wer bringt was / Mitbringen
  const bring = gustavExtras.parseBringCommand(rawInput);
  if (bring) {
    const ev = await findEventByTitle(bring.eventHint);
    if (!ev) {
      await reply(`🤷 Kein Event zu «${bring.eventHint}» – erst Event anlegen oder Titel prüfen.`);
      return true;
    }
    const who = (await resolveResidentFromWhatsApp(from, senderName)) || senderName || "Gast";
    if (bring.action === "add") {
      await gustavExtras.addBringItem(db, {
        eventId: ev.id,
        eventTitle: ev.title,
        who,
        item: bring.item,
      });
      await reply(`🥗 Notiert: *${who}* bringt *${bring.item}* zu *${ev.title}*.`);
      return true;
    }
    const items = await gustavExtras.listBringItems(db, ev.id);
    await reply(gustavExtras.formatBringList(ev.title, items));
    return true;
  }

  // 12a) Bewerber Status / Einzelperson
  const bewStatus = gustavExtras.parseBewerberStatusCommand(rawInput);
  if (bewStatus) {
    const k = await findKandidatByName(bewStatus.name);
    if (!k) {
      await reply(`🤷 Keine:r Bewerber:in «${bewStatus.name}» gefunden.`);
      return true;
    }
    if (bewStatus.action === "set") {
      await db.collection("kandidaten").doc(k.id).update({ status: bewStatus.status });
      await reply(`🚪 *${k.name}* → ${gustavExtras.STATUS_LABEL[bewStatus.status] || bewStatus.status}`);
      return true;
    }
    await reply(gustavExtras.formatBewerberDetail(k));
    return true;
  }

  // 12b) Bewerber auflisten
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

  // 13c) Garten To-Do: als erledigt markieren
  let gartenParseText = rawInput.trim();
  let gartenTodoResidentOverride = null;
  const gartenNameLead = /^([A-Za-zäöüÄÖÜ]+)\s+(?:garten\s+)?erledigt\b/i.exec(gartenParseText);
  if (gartenNameLead) {
    const rLead = resolveResident(gartenNameLead[1], true);
    if (rLead) {
      gartenTodoResidentOverride = rLead;
      gartenParseText = gartenParseText.slice(gartenNameLead[1].length).trim();
    }
  }
  const gartenMark = parseGartenTodoDoneMessage(gartenParseText);
  if (gartenMark) {
    let resident = gartenTodoResidentOverride || (await resolveResidentFromWhatsApp(from, senderName));
    if (!resident) {
      await reply(
        "❓ Ich weiss nicht, wer du bist. Schreib z.B. *garten erledigt Rasen* von deiner Nummer, oder *Manu garten erledigt*."
      );
      return true;
    }
    let snap;
    try {
      snap = await db.collection("gartentodos").get();
    } catch (e) {
      logger.error("gartentodos load", e);
      await reply("😕 Garten To-Do konnte nicht geladen werden.");
      return true;
    }
    const items = [];
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
    const whoEq = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
    let candidates = items.filter((it) => whoEq(it.who, resident));
    if (gartenMark.taskHint) {
      candidates = candidates.filter((it) => gartenTodoTaskMatchesHint(it.task, gartenMark.taskHint));
    }
    if (candidates.length === 0) {
      await reply(
        gartenMark.taskHint
          ? `🤷 Keine Aufgabe «${gartenMark.taskHint}» für *${resident}* im Garten To-Do.`
          : `🤷 Kein Garten To-Do für *${resident}*.`
      );
      return true;
    }
    const markOne = async (one) => {
      const interval = one.intervalDays || 14;
      const nextWho = gartenTodoPickNextAssignee(one.who);
      await db.collection("gartentodos").doc(one.id).update({
        lastDone: new Date().toISOString(),
        who: nextWho,
        nextDue: gartenTodoIsoDateAfterInterval(interval),
        whoManual: false,
        nextDueManual: false,
      });
      return nextWho;
    };
    if (candidates.length === 1) {
      const one = candidates[0];
      if (gartenTodoDoneToday(one)) {
        await reply(`✅ *${one.task}* ist heute schon erledigt.`);
        return true;
      }
      if (!gartenTodoIsDueOrOverdueData(one)) {
        const nd = gartenTodoNextDueDatePlain(one);
        const fmt = nd.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "short" });
        await reply(
          `✅ Letzte Runde ist erledigt.\nNächste Person: *${one.who || "—"}* ab ${fmt} – dann kann sie «garten erledigt» senden.`
        );
        return true;
      }
      try {
        const nextWho = await markOne(one);
        await reply(
          `✅ *${one.task}* erledigt – danke *${resident}*! 🌿\nNächste Runde: *${nextWho || "—"}*\n\n${WEBSITE_URL}/#kalender`
        );
      } catch (e) {
        logger.error("gartentodos update", e);
        await reply(`😕 Konnte nicht speichern: ${e.message || e}`);
      }
      return true;
    }
    if (gartenMark.taskHint) {
      const lines = candidates.map((c) => `• *${c.task}*`).join("\n");
      await reply(`🌿 Welche Aufgabe?\n\n${lines}\n\n*z.B. garten erledigt Rasen hinten*`);
      return true;
    }
    const due = candidates.filter((it) => gartenTodoIsDueOrOverdueData(it) && !gartenTodoDoneToday(it));
    if (due.length === 1) {
      const one = due[0];
      try {
        const nextWho = await markOne(one);
        await reply(
          `✅ *${one.task}* erledigt – danke *${resident}*! 🌿\nNächste Runde: *${nextWho || "—"}*\n\n${WEBSITE_URL}/#kalender`
        );
      } catch (e) {
        logger.error("gartentodos update", e);
        await reply(`😕 Konnte nicht speichern: ${e.message || e}`);
      }
      return true;
    }
    if (due.length === 0) {
      const lines = candidates.map((c) => `• *${c.task}*`).join("\n");
      await reply(
        `💡 Laut Plan noch nichts fällig. Welche hast du trotzdem erledigt?\n\n${lines}\n\n*z.B. garten erledigt Rasen hinten*`
      );
      return true;
    }
    const lines = due.map((c) => `• *${c.task}*`).join("\n");
    await reply(`🌿 Mehrere Aufgaben fällig – welche?\n\n${lines}\n\n*z.B. garten erledigt …*`);
    return true;
  }

  // 13b) Wellness belegen (Jacuzzi / Sauna / Kino)
  const wellnessBook = parseWellnessBookingCommand(rawInput);
  if (wellnessBook) {
    const resident = await resolveResidentFromWhatsApp(from, senderName);
    const who = resolveWellnessBookingWho(wellnessBook.who, resident, senderName);
    const startMs = wellnessBook.startAt.getTime();
    const endMs = wellnessBook.endAt.getTime();
    if (endMs <= startMs) {
      await reply("⏰ *Ende muss nach Start liegen.*\n\n*z.B. Jacuzzi besetzt von mir bis 15 Uhr*");
      return true;
    }
    if (endMs <= Date.now()) {
      await reply("⏰ Die Endzeit liegt in der Vergangenheit. Bitte Uhrzeit prüfen.");
      return true;
    }
    const conflict = await findWellnessBookingConflict(wellnessBook.resource, startMs, endMs);
    if (conflict) {
      const meta = WELLNESS_RESOURCES[wellnessBook.resource] || { emoji: "📅", label: wellnessBook.resource };
      const range = fmtWellnessTimeRange(conflict.startAt, conflict.endAt);
      await reply(
        `${meta.emoji} *${meta.label}* ist in der Zeit schon belegt (*${range}* – ${conflict.who || "?"}).\n\nAuf der Website unter Kalender → Belegung anpassen.`
      );
      return true;
    }
    await createWellnessBooking({
      ...wellnessBook,
      who,
      createdBy: resident || who,
    });
    const meta = WELLNESS_RESOURCES[wellnessBook.resource] || { emoji: "📅", label: wellnessBook.resource };
    const when = fmtWellnessDateLabel(wellnessBook.startAt);
    const range = fmtWellnessTimeRange(wellnessBook.startAt, wellnessBook.endAt);
    const titleLine =
      wellnessBook.resource === "kino" && wellnessBook.title ? `\n🎬 *${wellnessBook.title}*` : "";
    await reply(
      `${meta.emoji} *${meta.label}* eingetragen – *${who}*\n📅 ${when}, *${range}*${titleLine}\n\n${WEBSITE_URL}/#kalender`
    );
    return true;
  }

  // 13b2) Meine Aufgaben / WG-Aufgaben (Giessplan, Garten, Putz, Schäden, Erinnerungen)
  const tasksQ = tasksOverview.parseMyTasksQuery(rawInput);
  if (tasksQ) {
    const scope = tasksQ.scope;
    const resident =
      scope === "mine" ? await resolveResidentFromWhatsApp(from, senderName) : null;
    const result = await tasksOverview.buildTasksOverviewReply({ db, resident, from, scope });
    await reply(result.text);
    if (result.calendar?.googleUrl) {
      const cta = await sendWhatsAppCtaUrl(
        from,
        {
          body: `📅 *Samstag ${result.calendar.label}*, 10:00 Uhr – deine Aufgaben als Kalender-Termin:`,
          displayText: "📅 Samstag eintragen",
          url: result.calendar.googleUrl,
          footer: "Haus am See",
        },
        replyPhoneId
      );
      if (!cta.ok && result.calendar.icsUrl) {
        await reply(`📅 Kalender (iPhone/Mac): ${result.calendar.icsUrl}`);
      }
    }
    if (result.remind?.taskTitle && result.remind.saturday) {
      const dateIso = saturday10Iso(new Date(result.remind.saturday));
      const token = await gustavExtras.createRemindButtonToken(db, {
        from,
        text: result.remind.taskTitle,
        dateIso,
        resident: resident || "",
      });
      await sendWhatsAppInteractiveButtons(
        from,
        {
          body: `🔔 Soll ich dich auf WhatsApp erinnern?\n*${result.remind.taskTitle}* – Samstag 10:00`,
          footer: "Gustav",
          buttons: [{ id: `remind_${token}`, title: "🔔 Ja, erinnern" }],
        },
        replyPhoneId
      );
    }
    return true;
  }

  // 13c) Wellness: Jacuzzi warm / Sauna·Kino·Jacuzzi frei?
  const wellnessQ = parseWellnessQuery(rawInput, ctx.history);
  if (wellnessQ) {
    if (wellnessQ.type === "jacuzzi_status") {
      await reply(await buildJacuzziFullReply());
      return true;
    }
    if (wellnessQ.type === "jacuzzi_warm") {
      await reply(await buildJacuzziWarmReply());
      return true;
    }
    if (wellnessQ.type === "frei" && wellnessQ.resource) {
      await reply(await buildWellnessFreiReply(wellnessQ.resource));
      return true;
    }
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
  
  // 14a2) DEBUG: Detaillierte Geräte-Info
  if (/^(tuya\s*debug|geräte\s*debug|device\s*debug|steckdosen\s*detail)/i.test(rawInput.trim())) {
    if (!plugs.isConfigured()) {
      await reply(`⚠️ Smart Plugs nicht konfiguriert.`);
      return true;
    }
    try {
      const items = await plugs.getAllStatusDebug();
      if (!items.length) {
        await reply(`🔌 Keine Geräte gefunden.`);
      } else {
        const lines = items.map((d) => {
          const status = d.online ? "online" : "OFFLINE";
          const codes = d.statusCodes?.length ? d.statusCodes.join(", ") : "keine";
          return `*${d.name}* (${status})\nKategorie: ${d.category || "?"}\nCodes: ${codes}`;
        });
        await reply(`🔧 *Geräte-Debug:*\n\n${lines.join("\n\n")}`);
      }
    } catch (e) {
      await reply(`😕 Fehler: ${e.message || e}`);
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
        if (replyPhoneId) rememberWhatsAppPhoneId(replyPhoneId).catch(() => {});
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
          else if (type === "interactive") {
            const buttonReplyId = msg.interactive?.button_reply?.id || "";
            if (buttonReplyId && String(buttonReplyId).startsWith("poll_")) {
              const handledPoll = await handlePollButtonReply({
                from,
                buttonId: buttonReplyId,
                senderName,
                reply: answer,
              });
              if (handledPoll) continue;
            }
            if (buttonReplyId && String(buttonReplyId).startsWith("remind_")) {
              const handledRemind = await handleRemindButtonReply({
                from,
                buttonId: buttonReplyId,
                reply: answer,
              });
              if (handledRemind) continue;
            }
            text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
          }
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
          
          // WhatsApp-Nummer speichern (Profilname oder Abgleich über memberPrefs/Phonebook)
          if (from) {
            const resolvedResident =
              resolveResident(senderName, true) ||
              (await resolveResidentFromWhatsApp(from, senderName));
            if (resolvedResident) {
              saveWhatsAppNumber(resolvedResident, from).catch(() => {});
            }
          }

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
          
          // Test-Befehle VOR LLM abfangen (damit LLM sie nicht uminterpretiert)
          const testMatch = (effectiveText || "").toLowerCase().match(/^(testmsg|test-msg|testnachricht)\s*(giessen|gartentodo|garten|bewerbung|nachricht|polster)?$/i);
          if (testMatch) {
            const testType = (testMatch[2] || "giessen").toLowerCase();
            if (testType === "garten" || testType === "gartentodo") {
              await answer(
                `🌿 *Garten To-Do für ${senderName}*\n\nHeute bitte erledigen:\n🌿 Rasen mähen hinten (Test)\n\nAntwort z.B. *garten erledigt*\n\n🦆 _(Testnachricht im Chat)_`
              );
            } else if (testType === "polster") {
              const slot = { whenLabel: fmtTimeZurich(new Date(Date.now() + 30 * 60000)), slotUnix: Math.floor(Date.now() / 1000) + 1800 };
              const text = buildPolsterRainAlertText(slot.whenLabel, 30) + "\n\n_(Dies ist eine Testnachricht)_";
              await answer(text);
            } else if (testType === "giessen") {
              await answer(`🌱 *Giess-Erinnerung für ${senderName}*\n\nHeute bitte giessen:\n💧 Monstera im Wohnzimmer\n⚠️ Ficus (überfällig!)\n\n🦆 Deine Pflanzen danken dir!\n\n_(Dies ist eine Testnachricht)_`);
            } else if (testType === "bewerbung") {
              await answer(`🚪 *Neue Bewerbung!*\n\n*Von:* Lisa Müller\n*Mail:* lisa@example.com\n*Alter:* 26\n*Einzug ab:* per sofort\n\nHallo! Ich bin sehr interessiert an eurem WG-Zimmer am See. Ich arbeite als Grafikerin und liebe Pflanzen! 🌿\n\n→ ${WEBSITE_URL}/#kandidaten\n\n_(Dies ist eine Testnachricht)_`);
            } else {
              await answer(`✉️ *Nachricht über Kontaktformular:*\n\n*Von:* Max Muster\n*Mail:* max@example.com\n\nHey! Coole WG, wollte fragen ob ihr noch Plätze für den nächsten Grillabend habt?\n\n→ ${WEBSITE_URL}/#wg-intern\n\n_(Dies ist eine Testnachricht)_`);
            }
            continue;
          }
          
          // Chat-Verlauf zurücksetzen (vor LLM)
          if (!mediaId && /^(chat neu|neuer chat|forget|vergiss|reset chat|neustart)\b/i.test(String(effectiveText || "").trim())) {
            await chatHistory.clearChatHistory(from);
            await answer("🦆 Chat-Verlauf gelöscht – frisch gestartet! Frag mich einfach alles. 🧠✨");
            continue;
          }

          // LLM: nur Text; in Gruppen nur @gustav / @bot o. Standard: LLM **zuerst** (Kontext), dann regelbasiert.
          // Optional: GUSTAV_LLM_RULES_FIRST=1 → alte Reihenfolge.
          const allowLlm = !mediaId && (isPrivate || mention.addressed);
          const useLlm = allowLlm && llmRouter.isLlmEnabled();
          const rulesFirst = llmRouter.isLlmRulesFirst();
          const history = useLlm ? await chatHistory.loadChatHistory(from) : [];

          let plan = { command: null, antwort: null };
          let handled = false;
          let chatReplyText = null;

          if (mediaId) {
            handled = await dispatch({
              from,
              senderName,
              text: "",
              caption: effectiveCaption,
              mediaId,
              phoneId: replyPhoneId,
              history,
            });
          } else if (useLlm && !rulesFirst) {
            try {
              plan = await llmRouter.naturalLanguageToCommand(effectiveText, { senderName, history });
              await debugLog("llm_interpret", {
                from,
                order: "llm_first",
                hasCommand: !!plan.command,
                hasAntwort: !!plan.antwort,
                historyLen: history.length,
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
                  history,
                });
              }
            } catch (llmErr) {
              logger.error("llm_interpret", llmErr);
              await debugLog("llm_error", { error: String(llmErr?.message || llmErr), code: llmErr?.code || null });
            }
            if (!handled) {
              handled = await dispatch({
                from,
                senderName,
                text: effectiveText,
                caption: "",
                mediaId: null,
                phoneId: replyPhoneId,
                history,
              });
            }
            if (!handled && plan.antwort) {
              chatReplyText = plan.antwort;
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
              history,
            });
            if (!handled) {
              try {
                plan = await llmRouter.naturalLanguageToCommand(effectiveText, { senderName, history });
                await debugLog("llm_interpret", {
                  from,
                  order: "rules_first",
                  hasCommand: !!plan.command,
                  hasAntwort: !!plan.antwort,
                  historyLen: history.length,
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
                    history,
                  });
                }
                if (!handled && plan.antwort) {
                  chatReplyText = plan.antwort;
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
              history,
            });
          }

          let llmQuotaExhausted = false;

          if (!handled && useLlm) {
            try {
              const chatReply = await llmRouter.generalChatReply(effectiveText, { senderName, history });
              if (chatReply) {
                chatReplyText = chatReply;
                await answer(chatReply);
                handled = true;
                await debugLog("llm_chat_fallback", { from, preview: chatReply.slice(0, 200) });
              }
            } catch (chatErr) {
              logger.error("llm_chat_fallback", chatErr);
              await debugLog("llm_chat_error", { error: String(chatErr?.message || chatErr), code: chatErr?.code || null });
              if (llmRouter.isOpenAiQuotaError(chatErr)) llmQuotaExhausted = true;
            }
          }

          if (chatReplyText) {
            await chatHistory.appendChatHistory(from, effectiveText, chatReplyText);
          }

          if (!handled) {
            await debugLog("no_match", { from, text: effectiveText, useLlm, llmQuotaExhausted });
            if (llmQuotaExhausted) {
              await answer(
                "🦆 Mein *ChatGPT-Modus* ist offline – das OpenAI-Guthaben ist aufgebraucht.\n\n" +
                  "Haus-Befehle gehen weiter: *Wetter*, *Meine Aufgaben?*, *Jacuzzi?*, *Wer putzt?* …\n\n" +
                  "Oder *Hilfe* für die Liste."
              );
            } else {
              await answer(
                useLlm
                  ? "🦆 Hmm, da bin ich gerade überfragt – versuch's nochmal oder schreib *Hilfe* für Haus-Befehle."
                  : HELP_TEXT
              );
            }
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
   Siri / Shortcuts Webhook – Sprachsteuerung mit natürlicher Sprache
   ========================================================================== */

const SIRI_SECRET = process.env.SIRI_SECRET || "hausamsee2026";

// Interpretiert natürliche Sprache für Siri-Befehle
function parseSiriCommand(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return null;
  
  // Minuten extrahieren
  const minMatch = s.match(/(\d+)\s*min/i);
  const minutes = minMatch ? parseInt(minMatch[1], 10) : 20;
  
  // STOP zuerst prüfen (wichtig: vor START!)
  // Bewässerung / Garten STOP
  if (/(bewässer|garten|blumen|giess|gieß|wasser|pflanz|pumpe).*(stopp?|aus|end|beend|aufhör)/i.test(s) ||
      /(stopp?|beend|schalt.*aus|mach.*aus|hör.*auf).*(bewässer|garten|blumen|giess|gieß|pumpe)?/i.test(s) ||
      /^(stopp?e?n?|aus|ende|stop)$/i.test(s) ||
      /(stopp?e?n?|beenden|ausschalten)$/i.test(s)) {
    return { action: "garten", cmd: "stop" };
  }
  
  // Bewässerung / Garten START
  if (/(bewässer|garten|blumen|giess|gieß|wasser|pflanz).*(start|an|ein|los|beginn)/i.test(s) ||
      /(start|beginn|mach|schalt).*(bewässer|garten|blumen|giess|gieß)/i.test(s) ||
      /^(bewässer|garten bewässer|giess|gieß)/i.test(s) ||
      /(starten|einschalten|anmachen)$/i.test(s)) {
    return { action: "garten", cmd: "start", minutes };
  }
  
  // Status abfragen
  if (/(status|läuft|an\?|aktiv|check).*(bewässer|garten|pump)/i.test(s) ||
      /(bewässer|garten|pump).*(status|läuft|an\?|aktiv)/i.test(s) ||
      /^status$/i.test(s)) {
    return { action: "garten", cmd: "status" };
  }
  
  // Toggle (umschalten)
  if (/^(toggle|umschalt|wechsel)$/i.test(s) ||
      /(bewässer|garten).*(toggle|umschalt|wechsel)/i.test(s) ||
      /^(garten|bewässer)$/i.test(s)) {
    return { action: "garten", cmd: "toggle", minutes };
  }
  
  // Licht AN
  if (/(licht|lichter|lampe|beleuchtung|kette).*(an|ein|start)/i.test(s) ||
      /(mach|schalt).*(licht|lichter|lampe|kette).*(an|ein)/i.test(s)) {
    return { action: "licht", cmd: "an" };
  }
  
  // Licht AUS
  if (/(licht|lichter|lampe|beleuchtung|kette).*(aus|off|stop)/i.test(s) ||
      /(mach|schalt).*(licht|lichter|lampe|kette).*(aus)/i.test(s)) {
    return { action: "licht", cmd: "aus" };
  }
  
  // Licht Toggle
  if (/^(licht|lichter|lampe|lichterkette|kette)$/i.test(s) ||
      /(licht|lichter|lampe|kette).*(toggle|umschalt|wechsel)/i.test(s)) {
    return { action: "licht", cmd: "toggle" };
  }
  
  return null;
}

exports.siriWebhook = onRequest(async (req, res) => {
  // CORS für Shortcuts
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }
  
  const params = { ...req.query, ...req.body };
  let { action, cmd, secret, minutes: minParam, text } = params;
  
  // Secret prüfen
  if (secret !== SIRI_SECRET) {
    return res.status(401).json({ success: false, speech: "Zugriff verweigert. Falsches Secret." });
  }
  
  // Natürliche Sprache interpretieren wenn "text" übergeben wird
  if (text && !action) {
    const parsed = parseSiriCommand(text);
    if (parsed) {
      action = parsed.action;
      cmd = parsed.cmd;
      if (parsed.minutes) minParam = parsed.minutes;
    } else {
      return res.json({ 
        success: false, 
        speech: "Das habe ich nicht verstanden. Sag zum Beispiel: Bewässerung starten oder Garten aus.",
        understood: false
      });
    }
  }
  
  // Aktion: garten
  if (action === "garten" || action === "garden") {
    if (!plugs.isConfigured()) {
      return res.json({ success: false, speech: "Smart Home nicht konfiguriert." });
    }
    
    if (cmd === "start" || cmd === "an" || cmd === "on") {
      const minutes = parseInt(minParam, 10) || 20;
      try {
        const result = await startGartenSequenz(minutes, null);
        if (result.success) {
          return res.json({ 
            success: true, 
            speech: `Alles klar! Bewässerung läuft für ${minutes} Minuten.`,
            sequenzId: result.sequenzId 
          });
        } else {
          return res.json({ success: false, speech: "Bewässerung konnte nicht gestartet werden." });
        }
      } catch (e) {
        return res.json({ success: false, speech: `Fehler: ${e.message}` });
      }
    }
    
    if (cmd === "stop" || cmd === "aus" || cmd === "off") {
      try {
        const result = await stopGartenSequenz("siri");
        return res.json({ 
          success: result.success, 
          speech: result.success ? "Bewässerung wurde gestoppt." : "Fehler beim Stoppen." 
        });
      } catch (e) {
        return res.json({ success: false, speech: `Fehler: ${e.message}` });
      }
    }
    
    if (cmd === "status") {
      try {
        const status = await plugs.isDeviceOn(GARTEN_DEVICE_COMPUTER);
        const statusText = status.online 
          ? (status.on ? "Die Bewässerung läuft gerade." : "Die Bewässerung ist aus.") 
          : "Der Bewässerungscomputer ist offline.";
        return res.json({ success: true, speech: statusText, status });
      } catch (e) {
        return res.json({ success: false, speech: "Status konnte nicht abgefragt werden." });
      }
    }
    
    // Toggle: Prüft Status und schaltet um
    if (cmd === "toggle") {
      try {
        const status = await plugs.isDeviceOn(GARTEN_DEVICE_COMPUTER);
        if (status.on) {
          // Ist an → ausschalten
          const result = await stopGartenSequenz("siri");
          return res.json({ 
            success: result.success, 
            speech: "Bewässerung wurde gestoppt.",
            action: "stopped"
          });
        } else {
          // Ist aus → einschalten
          const minutes = parseInt(minParam, 10) || 20;
          const result = await startGartenSequenz(minutes, null);
          return res.json({ 
            success: result.success, 
            speech: `Bewässerung gestartet für ${minutes} Minuten.`,
            action: "started",
            sequenzId: result.sequenzId
          });
        }
      } catch (e) {
        return res.json({ success: false, speech: `Fehler: ${e.message}` });
      }
    }
    
    return res.json({ success: false, speech: "Unbekannter Befehl für Garten." });
  }
  
  // Aktion: licht
  if (action === "licht" || action === "light") {
    if (!plugs.isConfigured()) {
      return res.json({ success: false, speech: "Smart Home nicht konfiguriert." });
    }
    
    const device = "Lichterkette";
    const turnOn = cmd === "an" || cmd === "on" || cmd === "start";
    const turnOff = cmd === "aus" || cmd === "off" || cmd === "stop";
    
    if (turnOn || turnOff) {
      try {
        await plugs.setPower(device, turnOn);
        return res.json({ 
          success: true, 
          speech: turnOn ? "Lichterkette ist jetzt an." : "Lichterkette ist jetzt aus."
        });
      } catch (e) {
        return res.json({ success: false, speech: `Fehler: ${e.message}` });
      }
    }
    
    // Toggle: Status prüfen und umschalten
    if (cmd === "toggle") {
      try {
        const status = await plugs.isDeviceOn(device);
        const newState = !status.on;
        await plugs.setPower(device, newState);
        return res.json({ 
          success: true, 
          speech: newState ? "Lichterkette ist jetzt an." : "Lichterkette ist jetzt aus.",
          action: newState ? "on" : "off"
        });
      } catch (e) {
        return res.json({ success: false, speech: `Fehler: ${e.message}` });
      }
    }
    
    return res.json({ success: false, speech: "Unbekannter Befehl für Licht." });
  }
  
  return res.json({ 
    success: false, 
    speech: "Sag zum Beispiel: Bewässerung starten, Bewässerung stoppen, oder Licht an.",
    help: {
      examples: ["Bewässerung starten", "Garten aus", "Bewässerung stoppen", "Licht an", "Status"],
      url: "?text=Bewässerung starten&secret=xxx"
    }
  });
});

/* ==========================================================================
   Website: «Jetzt bewässern» / Stopp (Firestore garten_commands)
   ========================================================================== */

exports.onGartenCommand = onDocumentCreated("garten_commands/{id}", async (event) => {
  const ref = event.data?.ref;
  const data = event.data?.data();
  if (!ref || !data) return;
  if (data.status && data.status !== "pending") return;

  const action = String(data.action || "").toLowerCase();
  const member = String(data.member || "Website").trim();

  try {
    await ref.update({ status: "running", startedAt: FieldValue.serverTimestamp() });

    if (action === "stop") {
      const result = await stopGartenSequenz(null);
      await ref.update({
        status: result.success ? "done" : "failed",
        message: result.message || (result.success ? "Bewässerung gestoppt." : "Stoppen fehlgeschlagen."),
        finishedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (action !== "start") {
      await ref.update({
        status: "failed",
        message: "Unbekannte Aktion.",
        finishedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const minutes = Math.max(1, Math.min(120, parseInt(data.minutes, 10) || GARTEN_MANUAL_MINUTES));
    const forceRain = !!data.forceRain;

    if (!forceRain) {
      const rain = await gartenRainAroundNow();
      if (rain.rainy) {
        await ref.update({
          status: "failed",
          message: "Regen im ±6h-Fenster – bitte in der Warnung «Trotzdem bewässern» wählen.",
          skippedRain: true,
          finishedAt: FieldValue.serverTimestamp(),
        });
        return;
      }
    }

    const devicePumpe = String(data.devicePumpe || GARTEN_DEVICE_PUMPE).trim();
    const nachlaufSec = typeof data.nachlaufSec === "number"
      ? Math.max(0, Math.min(300, data.nachlaufSec))
      : GARTEN_SEQUENZ_NACHLAUF_SEC;

    let planData = {};
    try {
      const snap = await db.doc("config/gartenPlan").get();
      if (snap.exists) planData = snap.data();
    } catch (e) {
      logger.warn("onGartenCommand: gartenPlan read", e?.message || e);
    }
    const zone = resolveGartenZoneFromPlan(planData, data.zoneId);

    const result = await startGartenSequenz(minutes, null, {
      devicePumpe,
      nachlaufSec,
      skipRainCheck: forceRain,
      waterLogSource: "website",
      member,
      zoneId: zone.id,
      zoneLabel: zone.label,
      device: zone.device,
      valveType: zone.valveType,
      channel: zone.channel,
    });

    await ref.update({
      status: result.success ? "done" : "failed",
      message: result.message || (result.success ? `Bewässerung gestartet (${minutes} Min).` : "Start fehlgeschlagen."),
      sequenzId: result.sequenzId || null,
      skippedRain: !!result.skippedRain,
      finishedAt: FieldValue.serverTimestamp(),
    });

    if (result.success) {
      logger.info(`Garten manuell gestartet von ${member}, ${minutes} Min`);
    } else {
      logger.warn(`Garten manuell fehlgeschlagen (${member}):`, result.message);
    }
  } catch (e) {
    logger.error("onGartenCommand", e);
    try {
      await ref.update({
        status: "failed",
        message: String(e?.message || e),
        finishedAt: FieldValue.serverTimestamp(),
      });
    } catch (_) { /* */ }
  }
});

/* ==========================================================================
   Kontaktformular → WhatsApp
   ========================================================================== */

exports.onWellnessBookingCreated = onDocumentCreated("wellnessBookings/{id}", async (event) => {
  const data = event.data?.data();
  if (!data || data.resource !== "sauna") return;
  try {
    await sendSaunaBookingAlert(data);
    logger.info("Sauna-Buchungsbenachrichtigung gesendet", { who: data.who });
  } catch (e) {
    logger.error("onWellnessBookingCreated", e);
  }
});

exports.onNewNachricht = onDocumentCreated("nachrichten/{id}", async (event) => {
  const data = event.data?.data();
  if (!data) return;
  
  const isBewerbung = data.type === "bewerbung";
  logger.info(`Neue ${isBewerbung ? "Bewerbung" : "Nachricht"} von ${data.name || "Anonym"}`);
  
  // Bei Bewerbungen: automatisch zu Kandidaten hinzufügen
  if (isBewerbung && data.name) {
    try {
      const kandidatData = {
        name: data.name,
        alter: data.alter || null,
        info: data.message || data.nachricht || "",
        kontakt: data.email || "",
        einzug: data.einzug || null,
        status: "offen",
        source: "kontaktformular",
        createdAt: FieldValue.serverTimestamp(),
      };
      const ref = await db.collection("kandidaten").add(kandidatData);
      logger.info(`Bewerbung als Kandidat:in gespeichert: ${ref.id}`);
    } catch (e) {
      logger.error("Fehler beim Speichern der Bewerbung als Kandidat:in", e);
    }
  }
  
  // WhatsApp-Broadcast an WG
  const header = isBewerbung
    ? "🚪 *Neue Bewerbung!*"
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
    isBewerbung ? `→ ${WEBSITE_URL}/#kandidaten` : `→ ${WEBSITE_URL}/#wg-intern`,
  ].filter(Boolean);
  
  try {
    await broadcast(lines.join("\n"));
    logger.info("WhatsApp-Broadcast gesendet");
  } catch (e) {
    logger.error("Fehler beim WhatsApp-Broadcast", e);
  }
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
        const ok = await sendWhatsApp(target, `🔔 *Erinnerung:*\n${d.text}`);
        if (!ok) {
          logger.warn(`Erinnerung nicht zugestellt an ${target}`, { id: doc.id });
          return;
        }
        await db.collection("erinnerungen").doc(doc.id).update({
          sent: true, sentAt: FieldValue.serverTimestamp(),
        });
      })());
    });
    await Promise.all(promises);
    if (promises.length) logger.info(`Erinnerungen verarbeitet: ${promises.length}`);
  }
);

/* ==========================================================================
   Scheduler: Giessplan-Erinnerungen – täglich 8:00 Uhr
   ========================================================================== */

// Mapping von Bewohner-Namen zu WhatsApp-Nummern (aus gespeicherten WhatsApp-Nummern, memberPrefs oder hardcoded)
async function getBewohnerPhone(name) {
  // 1. Priorität: Gespeicherte WhatsApp-Nummer (von eingehenden Nachrichten)
  try {
    const waSnap = await db.collection("config").doc("whatsappNumbers").get();
    if (waSnap.exists && waSnap.data()[name]) {
      return String(waSnap.data()[name]).replace(/\D/g, "");
    }
  } catch (e) {
    logger.warn("getBewohnerPhone: whatsappNumbers", e);
  }
  
  // 2. Priorität: memberPrefs.phone
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
      if (!whatsappReminderDue(d, 1)) return;

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
    const nowIso = new Date().toISOString();
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
      
      promises.push(
        (async () => {
          const ok = await sendWhatsApp(phone, msg);
          if (!ok) return { ok: false, name };
          await Promise.all(
            plants.map((p) =>
              db.collection("giessplan").doc(p.id).update({ lastReminderAt: nowIso })
            )
          );
          return { ok: true, name };
        })()
      );
    }
    
    const results = await Promise.all(promises);
    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      logger.warn(`Giessplan: ${failed.length} Versand(e) fehlgeschlagen`, {
        names: failed.map((f) => f.name),
      });
    }
    logger.info(
      `Giessplan: ${sent}/${results.length} Erinnerungen zugestellt an ${Object.keys(byPerson).length} Personen`
    );
  }
);

/* ==========================================================================
   Scheduler: Garten To-Do – täglich 8:00 Uhr (wie Giessplan)
   ========================================================================== */

exports.checkGartenTodoReminders = onSchedule(
  { schedule: "every day 08:00", timeZone: "Europe/Zurich" },
  async () => {
    const snap = await db.collection("gartentodos").get();
    if (snap.empty) return;

    const today = startOfDay(new Date());
    const dueTasks = [];

    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (!d.reminder) return;
      if (!whatsappReminderDue(d, 1)) return;
      if (gartenTodoDoneToday(d)) return;

      const nextDate = gartenTodoNextDueDatePlain(d);
      if (nextDate.getTime() <= today.getTime()) {
        dueTasks.push({
          id: doc.id,
          task: d.task,
          who: d.who,
          intervalDays: d.intervalDays || 14,
          overdue: nextDate.getTime() < today.getTime(),
        });
      }
    });

    if (dueTasks.length === 0) {
      logger.info("Garten To-Do: Heute keine Aufgaben fällig");
      return;
    }

    const byPerson = {};
    dueTasks.forEach((t) => {
      if (!t.who) return;
      if (!byPerson[t.who]) byPerson[t.who] = [];
      byPerson[t.who].push(t);
    });

    const nowIso = new Date().toISOString();
    const promises = [];
    for (const [name, tasks] of Object.entries(byPerson)) {
      const phone = await getBewohnerPhone(name);
      if (!phone) {
        logger.warn(`Garten To-Do: Keine Telefonnummer für ${name}`);
        continue;
      }

      const taskList = tasks
        .map((t) => {
          const icon = t.overdue ? "⚠️" : "🌿";
          return `${icon} ${t.task}${t.overdue ? " (überfällig!)" : ""}`;
        })
        .join("\n");

      const msg =
        `🌿 *Garten To-Do für ${name}*\n\nHeute bitte erledigen:\n${taskList}\n\n` +
        `Antwort z.B. *garten erledigt* oder *garten erledigt Rasen hinten*\n\n🦆 Danke!`;

      promises.push(
        (async () => {
          const ok = await sendWhatsApp(phone, msg);
          if (!ok) return { ok: false, name };
          await Promise.all(
            tasks.map((t) =>
              db.collection("gartentodos").doc(t.id).update({ lastReminderAt: nowIso })
            )
          );
          return { ok: true, name };
        })()
      );
    }

    const results = await Promise.all(promises);
    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      logger.warn(`Garten To-Do: ${failed.length} Versand(e) fehlgeschlagen`, {
        names: failed.map((f) => f.name),
      });
    }
    logger.info(
      `Garten To-Do: ${sent}/${results.length} Erinnerungen an ${Object.keys(byPerson).length} Personen`
    );
  }
);

/* ==========================================================================
   Scheduler: Schäden – täglich 9:00, Rhythmus pro Eintrag (Zuständige, offene)
   ========================================================================== */

exports.checkSchadenReminders = onSchedule(
  { schedule: "every day 09:00", timeZone: "Europe/Zurich" },
  async () => {
    const snap = await db.collection("schaeden").get();
    if (snap.empty) return;

    const dueByPerson = {};

    snap.docs.forEach((doc) => {
      const d = doc.data();
      if (!schadenReminderDue(d)) return;
      const name = String(d.zustaendig || "").trim();
      if (!name) return;
      if (!dueByPerson[name]) dueByPerson[name] = [];
      dueByPerson[name].push({
        id: doc.id,
        titel: d.titel || "Schaden",
        ort: d.ort || "",
        prio: d.prio || "medium",
        status: d.status || "offen",
        kuemmerer: d.kuemmerer === "vermieter" ? "vermieter" : "wg",
      });
    });

    if (!Object.keys(dueByPerson).length) {
      logger.info("Schäden: Keine wöchentlichen Erinnerungen fällig");
      return;
    }

    const nowIso = new Date().toISOString();
    const promises = [];

    for (const [name, items] of Object.entries(dueByPerson)) {
      const phone = await getBewohnerPhone(name);
      if (!phone) {
        logger.warn(`Schäden: Keine Telefonnummer für ${name}`);
        continue;
      }

      const lines = items.map((s) => {
        const icon = schadenPrioIcon(s.prio);
        const ort = s.ort ? ` (${s.ort})` : "";
        const st =
          s.status === "in_bearbeitung" ? " · in Arbeit" : "";
        return `${icon} ${s.titel}${ort}${st}${schadenKuemmererTag(s.kuemmerer)}`;
      });

      const msg =
        `🔧 *Schäden-Erinnerung für ${name}*\n\n` +
        `Offene Punkte, für die du zuständig bist:\n${lines.join("\n")}\n\n` +
        `Antwort z.B. *Schaden erledigt: Titel*\n\n` +
        `${WEBSITE_URL}/#wg-intern\n\n🦆 Danke fürs Dranbleiben!`;

      promises.push(
        (async () => {
          const ok = await sendWhatsApp(phone, msg);
          if (!ok) return { ok: false, name };
          await Promise.all(
            items.map((it) =>
              db.collection("schaeden").doc(it.id).update({ lastReminderAt: nowIso })
            )
          );
          return { ok: true, name, count: items.length };
        })()
      );
    }

    const results = await Promise.all(promises);
    const sent = results.filter((r) => r.ok);
    const failed = results.filter((r) => r && !r.ok);
    if (failed.length) {
      logger.warn(`Schäden: ${failed.length} Versand(e) fehlgeschlagen`, {
        names: failed.map((f) => f.name),
      });
    }
    logger.info(
      `Schäden: ${sent.length}/${results.length} wöchentliche Erinnerungen, ` +
        `${sent.reduce((n, r) => n + (r.count || 0), 0)} Einträge`
    );
  }
);

// Test-Endpoint für Nachrichten/Bewerbungen
exports.testNachrichtAlert = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }
  
  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const to = req.query.to || req.body?.to;
  const type = req.query.type || req.body?.type || "bewerbung";
  const isBewerbung = type === "bewerbung";
  
  const testData = isBewerbung ? {
    name: "Test Bewerber:in",
    email: "test@example.com",
    alter: "28",
    einzug: "per sofort",
    message: "Hallo! Ich bin sehr interessiert an eurem WG-Zimmer. Ich bin 28, arbeite als Designer und liebe Pflanzen. 🌿"
  } : {
    name: "Test Person",
    email: "kontakt@example.com",
    message: "Hey! Ist eure Website echt toll, wollte nur fragen ob ihr noch Plätze für den Grillabend habt?"
  };
  
  const header = isBewerbung ? "🚪 *Neue Bewerbung!*" : "✉️ *Nachricht über Kontaktformular:*";
  const lines = [
    header, "",
    `*Von:* ${testData.name}`,
    testData.email ? `*Mail:* ${testData.email}` : "",
    isBewerbung && testData.alter ? `*Alter:* ${testData.alter}` : "",
    isBewerbung && testData.einzug ? `*Einzug ab:* ${testData.einzug}` : "",
    "",
    testData.message,
    "",
    isBewerbung ? `→ ${WEBSITE_URL}/#kandidaten` : `→ ${WEBSITE_URL}/#wg-intern`,
    "",
    "_(Dies ist eine Testnachricht)_"
  ].filter(Boolean);
  
  try {
    if (to) {
      const phone = await getBewohnerPhone(to);
      if (!phone) {
        return res.status(404).json({ error: `Keine Telefonnummer für ${to} gefunden` });
      }
      await sendWhatsApp(phone, lines.join("\n"));
      logger.info(`Test-Nachricht (${type}) an ${to} gesendet`);
      return res.json({ ok: true, message: `${isBewerbung ? "Bewerbung" : "Nachricht"}-Alert an ${to} gesendet` });
    } else {
      await broadcast(lines.join("\n"));
      logger.info(`Test-Nachricht (${type}) an WG gebroadcastet`);
      return res.json({ ok: true, message: `${isBewerbung ? "Bewerbung" : "Nachricht"}-Alert an WG gesendet` });
    }
  } catch (err) {
    logger.error("Test-Nachricht Fehler:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Test-Endpoint für Giessplan-Erinnerung
exports.testGiessReminder = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }
  
  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  const name = req.query.name || req.body?.name || "Manu";
  const plant = req.query.plant || req.body?.plant || "Testpflanze";
  
  const phone = await getBewohnerPhone(name);
  if (!phone) {
    return res.status(404).json({ error: `Keine Telefonnummer für ${name} gefunden` });
  }
  
  const msg = `🌱 *Giess-Erinnerung für ${name}*\n\nHeute bitte giessen:\n💧 ${plant}\n\n🦆 Deine Pflanzen danken dir!\n\n_(Dies ist eine Testnachricht)_`;
  
  const sent = await sendWhatsAppDetailed(phone, msg);
  if (!sent.ok) {
    return res.status(502).json({ ok: false, error: whatsAppProactiveErrorHint(sent), metaCode: sent.metaCode });
  }
  logger.info(`Test-Giessreminder an ${name} (${phone}) gesendet`);
  return res.json({ ok: true, message: `Erinnerung an ${name} gesendet` });
});

exports.testGartenTodoReminder = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }

  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const name = req.query.name || req.body?.name || "Manu";
  const task = req.query.task || req.body?.task || "Rasen mähen hinten (Test)";

  const phone = await getBewohnerPhone(name);
  if (!phone) {
    return res.status(404).json({ error: `Keine Telefonnummer für ${name} gefunden` });
  }

  const msg =
    `🌿 *Garten To-Do für ${name}*\n\nHeute bitte erledigen:\n🌿 ${task}\n\n` +
    `Antwort z.B. *garten erledigt*\n\n🦆 _(Testnachricht)_`;

  const sent = await sendWhatsAppDetailed(phone, msg);
  if (!sent.ok) {
    logger.warn(`Test-Garten-Todo an ${name} fehlgeschlagen`, { metaCode: sent.metaCode });
    return res.status(502).json({
      ok: false,
      error: whatsAppProactiveErrorHint(sent),
      metaCode: sent.metaCode,
    });
  }
  logger.info(`Test-Garten-Todo-Reminder an ${name} (${phone}) gesendet`);
  return res.json({ ok: true, message: `Garten-Erinnerung an ${name} gesendet` });
});

exports.testSchadenReminder = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }

  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const name = req.query.name || req.body?.name || "Manu";
  const titel = req.query.titel || req.body?.titel || "Wasserhahn Küche tropft (Test)";
  const ort = req.query.ort || req.body?.ort || "Küche";

  const phone = await getBewohnerPhone(name);
  if (!phone) {
    return res.status(404).json({ error: `Keine Telefonnummer für ${name} gefunden` });
  }

  const msg =
    `🔧 *Schäden-Erinnerung für ${name}*\n\n` +
    `Offene Punkte, für die du zuständig bist:\n` +
    `${schadenPrioIcon("medium")} ${titel}${ort ? ` (${ort})` : ""}\n\n` +
    `Antwort z.B. *Schaden erledigt: Titel*\n\n` +
    `${WEBSITE_URL}/#wg-intern\n\n🦆 _(Testnachricht)_`;

  const sent = await sendWhatsAppDetailed(phone, msg);
  if (!sent.ok) {
    return res.status(502).json({
      ok: false,
      error: whatsAppProactiveErrorHint(sent),
      metaCode: sent.metaCode,
    });
  }
  logger.info(`Test-Schaden-Reminder an ${name} (${phone}) gesendet`);
  return res.json({ ok: true, message: `Schäden-Erinnerung an ${name} gesendet` });
});

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

function gartenYmdDaysAgo(ymd, days) {
  const [Y, M, D] = String(ymd || gartenYmdZurichNow()).split("-").map(Number);
  if ([Y, M, D].some((n) => Number.isNaN(n))) return ymd;
  const t = Date.UTC(Y, M - 1, D) - days * 86400000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

function pruneGartenWaterLog(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const cutoff = gartenYmdDaysAgo(gartenYmdZurichNow(), 21);
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k >= cutoff && v && typeof v === "object") o[k] = v;
  }
  return o;
}

function normalizeGartenWaterLogDay(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  if (typeof entry.status === "string") {
    return { "wh2-wintergarten": { ...entry } };
  }
  return entry;
}

/** Tages-Log auf config/gartenPlan (pro Zone). */
async function setGartenWaterLog(ymd, zoneId, patch, opts = {}) {
  const ref = db.doc("config/gartenPlan");
  const zid = zoneId || "wh2-wintergarten";
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const data = snap.exists ? snap.data() : {};
      const waterLog = pruneGartenWaterLog(data.waterLog || {});
      const dayLog = normalizeGartenWaterLogDay(waterLog[ymd]);
      const prev = dayLog[zid];
      if (opts.noOverwriteDone && (prev?.status === "done" || prev?.status === "started")) return;
      dayLog[zid] = {
        ...(prev || {}),
        ...patch,
        ymd,
        zoneId: zid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      waterLog[ymd] = dayLog;
      t.set(ref, { waterLog }, { merge: true });
    });
  } catch (e) {
    logger.warn("setGartenWaterLog failed", e?.message || e);
  }
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
  
  const useSequenz = data.useSequenz !== false;
  const devicePumpe = String(data.deviceName || GARTEN_DEVICE_PUMPE).trim();
  const zones = normalizeGartenPlanZones(data).filter((z) => z.enabled);
  const { dayKey, hm } = zurichWeekdayKeyAndHM();
  const ymd = gartenYmdZurichNow();
  const sk = data.slotSkips && typeof data.slotSkips === "object" ? data.slotSkips : {};

  for (const zone of zones) {
    const slots = Array.isArray(zone.days?.[dayKey]) ? zone.days[dayKey] : [];
    if (!slots.length) continue;

    if (await gartenDayShouldSkipDueToRain(slots, ymd)) {
      const rainKey = `${ymd}|${zone.id}`;
      if (gartenRainSkipLoggedYmd !== rainKey) {
        gartenRainSkipLoggedYmd = rainKey;
        await debugLog("garten_plan_skip_rain", { ymd, dayKey, zoneId: zone.id });
        await setGartenWaterLog(ymd, zone.id, { status: "skipped_rain", source: "plan", dayKey }, { noOverwriteDone: true });
        await notifyGartenRainSkipped(zone.label);
        logger.info(`Garten: ${zone.label} heute (${dayKey}) wegen Niederschlag übersprungen.`);
      }
      continue;
    }

    let idx = 0;
    for (const slot of slots) {
      const onT = normHM(slot.on);
      const offT = normHM(slot.off);
      if (!onT || !offT) {
        idx += 1;
        continue;
      }
      if (isGartenSlotSkipped(sk, ymd, dayKey, idx, zone.id)) {
        idx += 1;
        continue;
      }

      if (onT === hm) {
        if (useSequenz) {
          const [onH, onM] = onT.split(":").map(Number);
          const [offH, offM] = offT.split(":").map(Number);
          const minutes = Math.max(1, (offH * 60 + offM) - (onH * 60 + onM));

          try {
            const result = await startGartenSequenz(minutes, null, {
              devicePumpe,
              nachlaufSec: data.nachlaufSec ?? GARTEN_SEQUENZ_NACHLAUF_SEC,
              zoneId: zone.id,
              zoneLabel: zone.label,
              device: zone.device,
              valveType: zone.valveType,
              channel: zone.channel,
              waterLogSource: "plan",
              dayKey,
              slotIndex: idx,
              ymd,
              slotOn: onT,
              slotOff: offT,
              allowQueue: true,
            });
            await debugLog("garten_plan_seq_start", { hm, dayKey, zoneId: zone.id, slotIndex: idx, minutes, result: result.success, queued: !!result.queued });
            if (result.success && !result.queued) {
              await setGartenWaterLog(ymd, zone.id, {
                status: "started",
                source: "plan",
                dayKey,
                slotIndex: idx,
                slotOn: onT,
                slotOff: offT,
                minutes,
                zoneLabel: zone.label,
              });
              await notifyGartenPlanStarted(zone.label, minutes, onT, offT);
            } else if (result.queued) {
              logger.info(`Garten: ${zone.label} in Warteschlange (${onT})`);
            } else {
              logger.warn("garten_plan_seq_start failed:", result.message);
            }
          } catch (e) {
            logger.error("garten_plan_seq_start", e?.message || e);
          }
        } else {
          try {
            await plugs.setPower(devicePumpe, true);
            await debugLog("garten_plan_on", { device: devicePumpe, hm, dayKey, zoneId: zone.id, slotIndex: idx });
          } catch (e) {
            logger.error("garten_plan_on", e?.message || e);
          }
        }
      }

      if (!useSequenz && offT === hm) {
        try {
          await plugs.setPower(devicePumpe, false);
          await debugLog("garten_plan_off", { device: devicePumpe, hm, dayKey, zoneId: zone.id, slotIndex: idx });
        } catch (e) {
          logger.error("garten_plan_off", e?.message || e);
        }
      }
      idx += 1;
    }
  }

  try {
    await processGartenStartQueue(data);
  } catch (e) {
    logger.warn("processGartenStartQueue", e?.message || e);
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
      const activePumpTasks = snap.docs.filter((d) => {
        const data = d.data();
        if (data.sequenzId && data.step === 3 && data.deviceKind === "pump") return true;
        const device = (data.device || "").toLowerCase();
        return device.includes("pump") || device.includes("beet") || device.includes("garten") || device.includes("rasen");
      });
      
      for (const doc of activePumpTasks) {
        const d = doc.data();
        try {
          if (d.sequenzId) {
            let planData = {};
            try {
              const ps = await db.doc("config/gartenPlan").get();
              if (ps.exists) planData = ps.data();
            } catch (_) { /* */ }
            await plugs.setPower(d.device, false);
            if (d.valveDevice) {
              await stopGartenValve({
                device: d.valveDevice,
                valveType: d.valveType || "irrigation",
                channel: d.channel ?? null,
              });
            } else {
              await stopAllGartenValves(planData);
            }
            const seqSnap = await db.collection("bewaesserung_tasks").where("done", "==", false).get();
            await Promise.all(seqSnap.docs.filter((x) => x.data().sequenzId === d.sequenzId).map((x) =>
              x.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp(), reason: "rain" })
            ));
            const zoneName = d.zoneLabel || d.valveDevice || "Garten";
            await broadcastToWG(`🌧️ *Bewässerung wegen Regen gestoppt*\n\n📍 ${zoneName}\nPumpe und Ventil sind aus.`);
          } else {
            await plugs.setPower(d.device, false);
            await doc.ref.update({ done: true, cancelledAt: FieldValue.serverTimestamp(), reason: "rain" });
          }
          if (d.requestedBy) {
            await sendWhatsApp(d.requestedBy, `🌧️ *${d.device}* automatisch gestoppt – es regnet! 🦆💧\n\nKein Grund zu giessen wenn der Himmel das übernimmt!`);
          }
          await debugLog("plug_rain_stop", { device: d.device, sequenzId: d.sequenzId || null, zone: d.zoneLabel });
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
        for (const doc of activePumpeSequenzen) {
          const d = doc.data();
          const zone = {
            device: d.valveDevice || d.device,
            valveType: d.valveType || "irrigation",
            channel: d.channel ?? null,
            label: d.zoneLabel || d.valveDevice || "Ventil",
          };
          try {
            const valveStatus = await isGartenValveOn(zone);
            if (!valveStatus.on || !valveStatus.online) {
              logger.error(`🚨 TROCKENLAUF-SCHUTZ: ${zone.label} ist ${!valveStatus.online ? "offline" : "AUS"} während Pumpe läuft!`);
              try {
                await plugs.setPower(GARTEN_DEVICE_PUMPE, false);
                logger.info("Pumpe wegen Trockenlauf-Schutz ausgeschaltet");
              } catch (e) {
                logger.error("Konnte Pumpe nicht ausschalten:", e?.message);
              }
              await abortGartenSequenz(d.sequenzId, d.requestedBy, "valve_turned_off",
                `🚨 *NOTFALL-STOPP!*\n\n*${zone.label}* ist ${!valveStatus.online ? "offline" : "ausgegangen"} – Pumpe wurde SOFORT gestoppt!\n\n⚠️ Bitte prüfe die Anlage!`);
              await debugLog("garten_dry_run_prevention", {
                zone: zone.label,
                valveOnline: valveStatus.online,
                valveOn: valveStatus.on,
                sequenzId: d.sequenzId,
              });
            }
          } catch (e) {
            logger.warn("Trockenlauf-Check fehlgeschlagen (ignoriert):", e?.message);
          }
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
        
        try {
          if (d.deviceKind === "valve" || (d.valveType && d.step === 4)) {
            await stopGartenValve({
              device: d.device,
              valveType: d.valveType || "irrigation",
              channel: d.channel ?? null,
            });
          } else {
            await plugs.setPower(d.device, d.action === "on");
          }
          await doc.ref.update({ done: true, executedAt: FieldValue.serverTimestamp() });
          await debugLog("garten_seq_step", { sequenzId: d.sequenzId, step: d.step, device: d.device, action: d.action, deviceKind: d.deviceKind });
          logger.info(`Sequenz ${d.sequenzId} Step ${d.step}: ${d.device} ${d.action}`);
          
          if (d.sendSuccessMessage && d.requestedBy) {
            const mins = d.bewässerungsMinuten || "?";
            const zoneName = d.zoneLabel || d.device || "Ventil";
            await sendWhatsApp(d.requestedBy, 
              `✅ *Garten-Bewässerung abgeschlossen!*\n\n` +
              `📍 ${zoneName}\n` +
              `🌿 Dauer: ${mins} Minuten\n` +
              `🔌 Pumpe: AUS\n` +
              `🔌 Ventil: AUS\n\n` +
              `Alles hat geklappt – der Garten ist gegossen! 🌻💧`
            );
            await debugLog("garten_seq_success_msg", { sequenzId: d.sequenzId, minutes: mins });
            await setGartenWaterLog(gartenYmdZurichNow(), d.zoneId || "wh2-wintergarten", {
              status: "done",
              source: d.waterLogSource || (d.requestedBy ? "whatsapp" : "plan"),
              minutes: mins,
              sequenzId: d.sequenzId,
              zoneLabel: zoneName,
            });
          }

          if (d.step === 4) {
            try {
              const planSnap = await db.doc("config/gartenPlan").get();
              if (planSnap.exists) await processGartenStartQueue(planSnap.data());
            } catch (qe) {
              logger.warn("processGartenStartQueue after step 4", qe?.message || qe);
            }
          }
        } catch (e) {
          logger.error(`Sequenz-Step failed for ${d.device}:`, e.message || e);
          await debugLog("garten_seq_step_error", { sequenzId: d.sequenzId, step: d.step, device: d.device, error: String(e.message || e) });
          // Bei kritischen Steps trotzdem als done markieren nach 10 Min
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

/* ==========================================================================
   Scheduler: Dein Tag – persönliche Zusammenfassung (Opt-in)
   ========================================================================== */

exports.checkDeinTag = onSchedule(
  { schedule: "every day 07:30", timeZone: "Europe/Zurich" },
  async () => {
    const prefsSnap = await db.collection("config").doc("memberPrefs").get();
    const allPrefs = prefsSnap.exists ? prefsSnap.data() : {};
    const now = new Date();
    let sent = 0;
    for (const name of ADULTS) {
      const dt = allPrefs[name]?.deinTag;
      if (!dt?.enabled) continue;
      const cadence = deinTag.normalizeCadence(dt.cadence);
      if (!deinTag.shouldSendDeinTagToday(cadence, now)) continue;
      if (!deinTag.shouldSendDeinTagInterval(dt.lastSentAt, cadence, now)) continue;
      const phone = await getBewohnerPhone(name);
      if (!phone) continue;
      const text = await buildDeinTagPreview(name, phone);
      const ok = await sendWhatsApp(phone, text);
      if (ok) {
        sent++;
        await updateMemberPrefField(name, {
          deinTag: { ...dt, enabled: true, cadence, lastSentAt: now.toISOString() },
        });
      }
    }
    if (sent) logger.info(`Dein Tag: ${sent} Zusammenfassungen gesendet`);
  }
);

/* ==========================================================================
   Scheduler: Umfragen mit Deadline schliessen
   ========================================================================== */

exports.checkPollDeadlines = onSchedule(
  { schedule: "every 30 minutes", timeZone: "Europe/Zurich" },
  async () => {
    const nowISO = new Date().toISOString();
    const snap = await db.collection("polls").where("status", "==", "open").get();
    for (const doc of snap.docs) {
      const p = doc.data();
      if (!p.closesAt || String(p.closesAt) > nowISO) continue;
      await doc.ref.update({ status: "closed", closedAt: FieldValue.serverTimestamp() });
      const summary = buildPollSummary({ ...p, status: "closed" });
      const orgPhone = p.createdByPhone;
      if (orgPhone) await sendWhatsApp(orgPhone, `⏰ *Umfrage geschlossen:* ${p.title}\n\n${summary}`);
      logger.info(`Poll deadline closed: ${doc.id} ${p.title}`);
    }
  }
);

/* ==========================================================================
   Scheduler: Geburtstage (morgen + heute)
   ========================================================================== */

exports.checkBirthdays = onSchedule(
  { schedule: "every day 08:00", timeZone: "Europe/Zurich" },
  async () => {
    const prefsSnap = await db.collection("config").doc("memberPrefs").get();
    const allPrefs = prefsSnap.exists ? prefsSnap.data() : {};
    const now = new Date();
    const year = +now.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich", year: "numeric" });
    for (const name of BEWOHNER) {
      const bd = birthdays.parseBirthDate(allPrefs[name]?.birthDate);
      if (!bd) continue;
      const tomorrow = birthdays.isBirthdayOn(now, bd, 1);
      const today = birthdays.isBirthdayOn(now, bd, 0);
      if (!tomorrow && !today) continue;
      const age = birthdays.ageTurning(bd, year + (tomorrow ? 1 : 0));
      const msg = birthdays.buildBirthdayMessage(name, { tomorrow, age });
      await broadcast(msg);
      logger.info(`Birthday alert: ${name} ${tomorrow ? "tomorrow" : "today"}`);
    }
  }
);

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

    lines.push("*📋 Aufgaben diese Woche:*");
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
      schaeden.forEach((s) =>
        lines.push(`• ${s.titel}${s.ort ? ` (${s.ort})` : ""}${schadenKuemmererTag(s.kuemmerer)}`)
      );
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
  { schedule: "every 5 minutes", timeZone: "Europe/Zurich" },
  async () => {
    if (!gartenRegenPolsterEnabled()) return;

    const targets = await rainAlertRecipientsResolved();
    if (!targets.length) {
      logger.warn("Garten-Regen-Alert: keine Empfänger (WHATSAPP_* oder Bot-Nummern in memberPrefs)");
      return;
    }

    let data;
    try {
      data = await fetchOpenMeteoPfaeffikon();
    } catch (e) {
      logger.error("checkGartenRegenPolster: open-meteo", e?.message || e);
      return;
    }

    const slot = findRainAlertSlot(data?.hourly);
    if (!slot) return;

    const minutesUntil = (slot.slotUnix * 1000 - Date.now()) / 60000;
    if (minutesUntil < RAIN_ALERT_MIN_MINUTES || minutesUntil > RAIN_ALERT_MAX_MINUTES) {
      return;
    }

    const ref = db.doc(GARTEN_POLSTER_ALERT_DOC);
    const prev = await ref.get();
    const prevData = prev.exists ? prev.data() : {};
    const last = prevData.lastRainSlotUnix;
    if (last != null && Number(last) === slot.slotUnix) {
      return;
    }
    const lastSentMs = prevData.lastAlertSentAt
      ? new Date(prevData.lastAlertSentAt).getTime()
      : prevData.sentAt?.toDate?.()?.getTime?.() ?? 0;
    if (lastSentMs && Date.now() - lastSentMs < RAIN_ALERT_COOLDOWN_MS) {
      return;
    }

    const { okList, failList, anyOk } = await sendPolsterRainAlertToTargets(targets, slot, minutesUntil);

    if (anyOk) {
      await ref.set(
        {
          lastRainSlotUnix: slot.slotUnix,
          whenLabel: slot.whenLabel,
          minutesUntilApprox: Math.round(minutesUntil * 10) / 10,
          lastAlertSentAt: new Date().toISOString(),
          sentAt: FieldValue.serverTimestamp(),
          sentTo: okList,
          failedTo: failList,
        },
        { merge: true }
      );
      await debugLog("garten_regen_polster_sent", {
        slotUnix: slot.slotUnix,
        whenLabel: slot.whenLabel,
        minutesUntil: Math.round(minutesUntil * 10) / 10,
        ok: okList.length,
        fail: failList.length,
      });
      logger.info(`Garten-Regen-Polster: ${okList.length}/${targets.length} WhatsApp (${slot.whenLabel})`);
    } else {
      logger.warn("checkGartenRegenPolster: alle WhatsApp-Sends fehlgeschlagen", {
        targets: targets.length,
        failList,
      });
      await debugLog("garten_regen_polster_failed", {
        slotUnix: slot.slotUnix,
        whenLabel: slot.whenLabel,
        targets,
      });
    }
  }
);

function jacuzziMetricExtras(reading = {}) {
  const extras = {};
  for (const key of ["ph", "orp"]) {
    const m = reading[key];
    if (!m || m.value == null || Number.isNaN(Number(m.value))) continue;
    extras[key] = Number(m.value);
    if (m.okMin != null) extras[`${key}OkMin`] = Number(m.okMin);
    if (m.okMax != null) extras[`${key}OkMax`] = Number(m.okMax);
    if (m.warnLow != null) extras[`${key}WarnLow`] = Number(m.warnLow);
    if (m.warnHigh != null) extras[`${key}WarnHigh`] = Number(m.warnHigh);
  }
  return extras;
}

async function persistJacuzziReading({ tempC, at, source, extras = {} }) {
  const measuredAt = at || new Date().toISOString();
  const status = {
    tempC,
    warmThresholdC: JACUZZI_WARM_TEMP_C,
    targetTempC: 38,
    updatedAt: measuredAt,
    source: String(source || "blueriiot").slice(0, 32),
    ...extras,
  };
  const readingDoc = {
    tempC,
    at: measuredAt,
    source: status.source,
  };
  for (const key of ["ph", "orp"]) {
    if (status[key] != null) readingDoc[key] = status[key];
    for (const suffix of ["OkMin", "OkMax", "WarnLow", "WarnHigh"]) {
      const field = `${key}${suffix}`;
      if (status[field] != null) readingDoc[field] = status[field];
    }
  }
  await db.doc("config/jacuzzi").set(status, { merge: true });
  await db.collection("jacuzziReadings").add(readingDoc);
  return status;
}

const JACUZZI_WATER_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function jacuzziWaterAmpelLevel(value, okMin, okMax, warnLow, warnHigh) {
  if (value == null || Number.isNaN(Number(value))) return "unknown";
  const v = Number(value);
  if (okMin != null && okMax != null && v >= okMin && v <= okMax) return "ok";
  if (warnLow != null && warnHigh != null && v >= warnLow && v <= warnHigh) return "warn";
  return "bad";
}

function jacuzziAmpelRank(level) {
  if (level === "bad") return 3;
  if (level === "warn") return 2;
  if (level === "ok") return 1;
  return 0;
}

function jacuzziWaterAmpelWorsened(prevLevel, nextLevel) {
  if (!nextLevel || nextLevel === "unknown" || nextLevel === "ok") return false;
  if (!prevLevel || prevLevel === "unknown") return nextLevel === "warn" || nextLevel === "bad";
  return jacuzziAmpelRank(nextLevel) > jacuzziAmpelRank(prevLevel);
}

function jacuzziWaterAmpelLabel(level) {
  if (level === "ok") return "im Soll";
  if (level === "warn") return "Grenzbereich";
  if (level === "bad") return "kritisch";
  return "unbekannt";
}

function buildJacuzziWaterMetricLine(key, status) {
  if (key === "tempC") {
    if (status.tempC == null || Number.isNaN(Number(status.tempC))) return null;
    const level =
      status.tempAmpel ||
      jacuzziWaterAmpelLevel(
        status.tempC,
        status.tempOkMin ?? 30,
        status.tempOkMax ?? 40,
        status.tempWarnLow ?? 5,
        status.tempWarnHigh ?? 50
      );
    const icon = level === "ok" ? "🟢" : level === "warn" ? "🟡" : level === "bad" ? "🔴" : "⚪";
    const warm = Number(status.tempC) >= (status.warmThresholdC ?? JACUZZI_WARM_TEMP_C);
    const range =
      (status.tempOkMin != null && status.tempOkMax != null)
        ? ` (Soll ${status.tempOkMin}–${status.tempOkMax} °C)`
        : " (Soll 30–40 °C)";
    return `${icon} *Temperatur:* ${Number(status.tempC).toFixed(1)} °C${warm ? " ♨️" : ""} – ${jacuzziWaterAmpelLabel(level)}${range}`;
  }
  const field = key === "orp" ? "orp" : key;
  if (status[field] == null) return null;
  const level = status[`${field}Ampel`] || "unknown";
  const icon = level === "ok" ? "🟢" : level === "warn" ? "🟡" : level === "bad" ? "🔴" : "⚪";
  const label = field === "ph" ? "pH" : "Chlorgehalt";
  const value =
    field === "ph"
      ? Number(status.ph).toFixed(1)
      : `${Math.round(Number(status.orp))} mV`;
  const range =
    status[`${field}OkMin`] != null && status[`${field}OkMax`] != null
      ? ` (Soll ${status[`${field}OkMin`]}–${status[`${field}OkMax`]}${field === "orp" ? " mV" : ""})`
      : "";
  return `${icon} *${label}:* ${value} – ${jacuzziWaterAmpelLabel(level)}${range}`;
}

function buildJacuzziWaterAlertText(status) {
  const enriched = jacuzziEnrichedStatus(status);
  const lines = ["🛁 *Jacuzzi · Wasserqualität*", ""];
  for (const key of ["tempC", "ph", "orp"]) {
    const line = buildJacuzziWaterMetricLine(key, enriched);
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

async function getJacuzziWhatsappRecipients() {
  const [prefsSnap, pwSnap] = await Promise.all([
    db.doc("config/memberPrefs").get(),
    db.doc("config/memberPasswords").get(),
  ]);
  const prefs = prefsSnap.exists ? prefsSnap.data() || {} : {};
  const passwords = pwSnap.exists ? pwSnap.data() || {} : {};
  const recipients = [];
  for (const name of ADULTS) {
    if (!passwords[name]) continue;
    if (prefs[name]?.jacuzziWhatsapp !== true) continue;
    const phone = await getBewohnerPhone(name);
    if (phone) recipients.push({ name, phone });
  }
  return recipients;
}

async function maybeSendJacuzziWaterAlerts(status, prev = {}) {
  const phAmpel = jacuzziWaterAmpelLevel(
    status.ph,
    status.phOkMin,
    status.phOkMax,
    status.phWarnLow,
    status.phWarnHigh
  );
  const orpAmpel = jacuzziWaterAmpelLevel(
    status.orp,
    status.orpOkMin,
    status.orpOkMax,
    status.orpWarnLow,
    status.orpWarnHigh
  );
  const enriched = { ...status, phAmpel, orpAmpel };

  const alerts = [];
  const now = Date.now();
  if (
    status.ph != null &&
    jacuzziWaterAmpelWorsened(prev.phAmpel, phAmpel) &&
    now - (prev.jacuzziAlertPhAt || 0) >= JACUZZI_WATER_ALERT_COOLDOWN_MS
  ) {
    alerts.push("ph");
  }
  if (
    status.orp != null &&
    jacuzziWaterAmpelWorsened(prev.orpAmpel, orpAmpel) &&
    now - (prev.jacuzziAlertOrpAt || 0) >= JACUZZI_WATER_ALERT_COOLDOWN_MS
  ) {
    alerts.push("orp");
  }

  const alertMeta = {
    phAmpel,
    orpAmpel,
    jacuzziAlertPhAt: prev.jacuzziAlertPhAt || null,
    jacuzziAlertOrpAt: prev.jacuzziAlertOrpAt || null,
  };

  if (!alerts.length) {
    await db.doc("config/jacuzzi").set(alertMeta, { merge: true });
    return;
  }

  const recipients = await getJacuzziWhatsappRecipients();
  if (!recipients.length) {
    logger.info("Jacuzzi-Wasser-Alert: keine Empfänger (Opt-in + persönliches Passwort)");
    await db.doc("config/jacuzzi").set(alertMeta, { merge: true });
    return;
  }

  const text = buildJacuzziWaterAlertText(enriched);

  for (const { name, phone } of recipients) {
    try {
      await sendWhatsApp(phone, text);
      logger.info(`Jacuzzi-Wasser-Alert an ${name}`);
    } catch (e) {
      logger.warn(`Jacuzzi-Wasser-Alert an ${name} fehlgeschlagen`, e?.message || e);
    }
  }

  if (alerts.includes("ph")) alertMeta.jacuzziAlertPhAt = now;
  if (alerts.includes("orp")) alertMeta.jacuzziAlertOrpAt = now;
  await db.doc("config/jacuzzi").set(alertMeta, { merge: true });
}

/** Blue Riiot Cloud: letzte Messung holen und in Firestore schreiben. */
async function runBlueriiotSyncOnce({ force = false } = {}) {
  if (!blueriiot.blueriiotEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  let cached = {};
  try {
    const cfgSnap = await db.doc("config/blueriiot").get();
    if (cfgSnap.exists) cached = cfgSnap.data() || {};
  } catch (e) {
    logger.warn("runBlueriiotSyncOnce: config/blueriiot", e?.message);
  }

  let reading;
  try {
    reading = await blueriiot.fetchLatestTemperature(cached);
  } catch (e) {
    logger.error("runBlueriiotSyncOnce: API", e?.message || e);
    await db.doc("config/blueriiot").set(
      { lastError: String(e.message || e), lastSyncAt: new Date().toISOString() },
      { merge: true }
    );
    return { ok: false, reason: "api_error", error: String(e.message || e) };
  }

  if (!reading || Number.isNaN(reading.tempC)) {
    logger.info("runBlueriiotSyncOnce: keine Temperatur");
    return { ok: false, reason: "no_reading", releaseMeta: reading?.releaseMeta };
  }

  const prevSnap = await db.doc("config/jacuzzi").get();
  const prev = prevSnap.exists ? prevSnap.data() : {};
  const waterExtras = jacuzziMetricExtras(reading);
  const sameTimestamp = prev.blueriiotMeasuredAt === reading.measuredAt;
  const needsWaterUpdate = waterExtras.orp != null && prev.orp == null;
  if (sameTimestamp && !needsWaterUpdate && !force) {
    return { ok: true, unchanged: true, reading, prev };
  }

  const status = await persistJacuzziReading({
    tempC: reading.tempC,
    at: reading.measuredAt,
    source: "blueriiot",
    extras: {
      blueriiotMeasuredAt: reading.measuredAt,
      poolId: reading.poolId,
      deviceSerial: reading.deviceSerial,
      ...waterExtras,
    },
  });

  await maybeSendJacuzziWaterAlerts(status, prev);

  const blueriiotPatch = {
    poolId: reading.poolId,
    deviceSerial: reading.deviceSerial,
    lastSyncAt: new Date().toISOString(),
    lastMeasuredAt: reading.measuredAt,
    lastTempC: reading.tempC,
    lastError: null,
  };
  if (reading.releaseMeta) {
    blueriiotPatch.lastReleaseEvent = {
      ...reading.releaseMeta,
      at: new Date().toISOString(),
    };
  }
  await db.doc("config/blueriiot").set(blueriiotPatch, { merge: true });

  logger.info(`Blue Riiot: ${reading.tempC}°C @ ${reading.measuredAt}`, reading.releaseMeta || {});
  return { ok: true, unchanged: false, reading, status, prev };
}

/** Blue Riiot Cloud: alle 5 Min. letzte Messung → Website & Gustav */
exports.syncBlueriiotJacuzzi = onSchedule(
  { schedule: "every 5 minutes", timeZone: "Europe/Zurich" },
  async () => {
    await runBlueriiotSyncOnce();
  }
);

/** Manueller Push / Legacy-Bridge: Temperatur in Firestore schreiben */
/** ICS-Download für Gustav-Aufgaben-Kalender (Token aus «Meine Aufgaben?»). */
exports.tasksCalendarIcs = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET");
    return res.status(204).send("");
  }
  const token = String(req.query.token || "").trim();
  if (!token || token.length > 64) {
    return res.status(400).send("token required");
  }
  try {
    const snap = await db.collection("gustavCalendarLinks").doc(token).get();
    if (!snap.exists) return res.status(404).send("not found or expired");
    const ics = snap.data()?.ics;
    if (!ics) return res.status(404).send("empty");
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="haus-am-see-aufgaben.ics"');
    return res.status(200).send(ics);
  } catch (e) {
    logger.error("tasksCalendarIcs", e);
    return res.status(500).send("error");
  }
});

exports.jacuzziReading = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }
  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const tempC = parseFloat(req.query.tempC ?? req.body?.tempC);
  if (Number.isNaN(tempC) || tempC < 0 || tempC > 60) {
    return res.status(400).json({ error: "tempC (0–60) required" });
  }
  const source = String(req.body?.source || req.query?.source || "manual").slice(0, 32);
  await persistJacuzziReading({ tempC, at: new Date().toISOString(), source });
  return res.json({ ok: true, tempC, warm: tempC >= JACUZZI_WARM_TEMP_C });
});

exports.testPolsterAlert = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).send("");
  }
  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SIRI_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const to = req.query.to || req.body?.to;
  const targets = to
    ? [String(to).replace(/\D/g, "")]
    : await rainAlertRecipientsResolved();
  if (!targets.length) {
    return res.status(404).json({ error: "Keine Empfänger" });
  }
  const slot = { whenLabel: "14:00", slotUnix: Math.floor(Date.now() / 1000) + 1800 };
  const { okList, failList, anyOk } = await sendPolsterRainAlertToTargets(targets, slot, 30);
  return res.json({
    ok: anyOk,
    message: anyOk ? `Polster-Alert an ${okList.length} Nummer(n)` : "Alle Sends fehlgeschlagen",
    okList,
    failList,
  });
});

