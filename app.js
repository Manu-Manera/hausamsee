import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  where,
  serverTimestamp,
  setDoc,
  deleteField,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ==========================================================================
   Konfiguration – Bewohner & WG-Passwort
   (Anpassbar, bleibt im Repo)
   ========================================================================== */

const BEWOHNER = [
  {
    name: "Corina",
    role: "Seele des Hauses",
    emoji: "🌻",
    bio: "Sorgt dafür, dass es überall Pflanzen, gute Laune und frischen Kaffee gibt."
  },
  {
    name: "Jasmin",
    role: "Brunch-Queen",
    emoji: "🥐",
    bio: "Steht gerne früh auf, macht die besten Sonntags-Gipfeli und kennt jedes nette Café am See."
  },
  {
    name: "Dino",
    role: "Grill- & Feuerchef",
    emoji: "🔥",
    bio: "Wenn es Rauch gibt, steht Dino am Grill. Zuständig für Feuerstelle, Playlist und spontane Abende."
  },
  {
    name: "Andi",
    role: "Handwerker & Tüftler",
    emoji: "🛠️",
    bio: "Repariert alles, baut Möbel aus Palettenholz und hat immer das richtige Werkzeug zur Hand."
  },
  {
    name: "Manu",
    role: "Events & Ausflüge",
    emoji: "🏕️",
    bio: "Organisiert die besten Touren rund um den Pfäffikersee und hat immer einen Plan für das Wochenende."
  },
  {
    name: "Hugues",
    role: "SUP-Liebhaber",
    emoji: "🛶",
    bio: "Paddelt bei jedem Wetter über den See und bringt einen französischen Akzent ins Haus."
  },
  {
    name: "Fannie",
    role: "Kreativ-Kopf",
    emoji: "🎨",
    bio: "Bringt Farbe ins Haus, liebt lange Gespräche am Feuer und kocht leidenschaftlich gerne."
  },
  {
    name: "Eliot",
    role: "Junior-Abenteurer",
    emoji: "🦊",
    bio: "Jüngster im Haus. Entdeckt den Garten, den Steg und alle Schwäne auf dem See.",
    kid: true
  },
  {
    name: "Oscar",
    role: "Junior-Abenteurer",
    emoji: "🐻",
    bio: "Bringt das grösste Lachen ins Haus und ist Co-Pilot bei jedem Ausflug zum See.",
    kid: true
  }
];

// SHA-256 Hash des WG-Passworts. Standard: "hausamsee"
// Passwort ändern? -> hier den SHA-256-Hash des neuen Passworts eintragen.
//   Neuen Hash erzeugen: im Browser-Konsole:
//     crypto.subtle.digest("SHA-256", new TextEncoder().encode("neuesPasswort")).then(b=>console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")))
// Default "hausamsee":
const WG_PASSWORD_HASH = "a89881e9359c985da03b139154082072ba21de07e264891470ac67b2be1bd28f";
/** Klartext-Standard (für Initiale, Einladungstext, niemals im öffentlich sichtbaren Login-Platzhalter) */
const DEFAULT_WG_PASSWORD_PLAINTEXT = "hausamsee";

// Kürzere Anzeigenamen + Icon (Wahl in WG-Intern → Einstellungen, gespeichert in config/memberPrefs)
const EMOJI_CHOICES = [
  ...new Set([
    ...BEWOHNER.map((b) => b.emoji),
    "🌿", "🌳", "🌲", "🌸", "🌷", "🌺", "🦋", "🐾", "🌙", "☀️", "⭐", "🌊", "⛰️", "🏔️", "🍀", "🌈", "🎸", "🎧", "🎬", "🍕", "☕", "🥂", "🍰", "🚴", "⛵", "🦆", "🦢", "🪷", "🦔", "🦫", "🦦"
  ])
];
const EMOJI_CHOICES_SET = new Set(EMOJI_CHOICES);
/** Legacy-Schreibweisen → offizieller Vorname (Login & Firestore) */
const BEWOHNER_NAME_ALIASES = { Andy: "Andi", Fanny: "Fannie", Elliot: "Eliot" };
function canonicalBewohnerName(name) {
  return BEWOHNER_NAME_ALIASES[name] || name;
}
const BEWOHNER_NAME_SET = new Set(BEWOHNER.map((b) => b.name));

// Gallery-Konstanten
const MAX_GALLERY_IMAGES = 20;
const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.82;
const MAX_IMAGE_BYTES = 900_000; // ~900 KB per Bild (Firestore Document Limit = 1MB)

// Audio-Konstanten
const MAX_AUDIO_BYTES = 900_000; // ~900 KB pro Audio-Datei (Firestore Document Limit)

// Wetter: Open-Meteo (nur Anzeige, kostenlos, kein API-Key) — Koordinaten Pfäffikon ZH
const WEATHER_SPOT = { label: "Pfäffikon", lat: 47.3656, lon: 8.7808 };

function wmoWeatherGerman(code) {
  const c = Number(code);
  if (c === 0) return { text: "Klar", emoji: "☀️" };
  if (c === 1) return { text: "Grösstenteils klar", emoji: "🌤️" };
  if (c === 2) return { text: "Teilweise bewölkt", emoji: "⛅" };
  if (c === 3) return { text: "Bewölkt", emoji: "☁️" };
  if (c === 45 || c === 48) return { text: "Nebel", emoji: "🌫️" };
  if (c >= 51 && c <= 55) return { text: "Nieselregen", emoji: "🌦️" };
  if (c === 56 || c === 57) return { text: "Gefrierender Niesel", emoji: "🌨️" };
  if (c >= 61 && c <= 65) return { text: "Regen", emoji: "🌧️" };
  if (c === 66 || c === 67) return { text: "Gefrierender Regen", emoji: "🌧️" };
  if (c >= 71 && c <= 75) return { text: "Schneefall", emoji: "❄️" };
  if (c === 77) return { text: "Schneegriesel", emoji: "❄️" };
  if (c === 80 || c === 81 || c === 82) return { text: "Regenschauer", emoji: "🌦️" };
  if (c === 85 || c === 86) return { text: "Schneeschauer", emoji: "🌨️" };
  if (c === 95) return { text: "Gewitter", emoji: "⛈️" };
  if (c === 96 || c === 99) return { text: "Gewitter mit Hagel", emoji: "⛈️" };
  if (c === 97) return { text: "Gewitter", emoji: "⛈️" };
  return { text: "Aktuelles Wetter", emoji: "🌡️" };
}

function ymdAddOne(ymd) {
  const [Y, M, D] = ymd.split("-").map(Number);
  const d = new Date(Y, M - 1, D + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Wetter-Slot ab voller Stunde (Vergleich mit Open-Meteo `time`-Strings) */
function toHourlyKey(iso) {
  if (!iso || iso.length < 16) return iso;
  return `${iso.slice(0, 13)}:00`;
}

/**
 * Stündliche Aussichten: Rest von heute + kompletter morgen (heute 00h–23h).
 * escapeHtml: aus Modul, zur Laufzeit verfügbar
 */
function buildHourlyOutlookHTML(hourly, curTimeIso, esc) {
  const tArr = hourly?.time;
  const temps = hourly?.temperature_2m;
  const codes = hourly?.weather_code;
  if (!tArr || !temps || !codes || !tArr.length) return "";
  const curSlot = toHourlyKey(curTimeIso || tArr[0]);
  const todayYmd = (curTimeIso || tArr[0]).slice(0, 10);
  const tomorrowYmd = ymdAddOne(todayYmd);

  const todaySlots = [];
  const tomSlots = [];
  for (let i = 0; i < tArr.length; i++) {
    const t = tArr[i];
    const d = t.slice(0, 10);
    if (d === todayYmd && t >= curSlot) {
      todaySlots.push({ t, i });
    } else if (d === tomorrowYmd) {
      tomSlots.push({ t, i });
    }
  }

  const row = (slots) => {
    if (!slots.length) return "";
    const parts = slots.map(({ t, i: ti }) => {
      const label = `${t.slice(11, 13)}h`;
      const te = Math.round(Number(temps[ti]));
      const em = wmoWeatherGerman(codes[ti]).emoji;
      return `<div class="wh-slot" title="${esc(t)}"><span class="wh-time">${esc(label)}</span><span class="wh-ico" aria-hidden="true">${em}</span><span class="wh-tmp">${te}°</span></div>`;
    });
    return `<div class="wh-row">${parts.join("")}</div>`;
  };

  if (!todaySlots.length && !tomSlots.length) return "";
  return (
    (todaySlots.length ? `<p class="wh-day">Heute</p>${row(todaySlots)}` : "") +
    (tomSlots.length ? `<p class="wh-day">Morgen</p>${row(tomSlots)}` : "")
  );
}

/* Event-Vorhersage (Open-Meteo, bis 16 Tage) */
const EVENT_FORECAST_TTL_MS = 30 * 60 * 1000;
let eventForecastCache = { t: 0, byDay: null, byHour: null };

function zurichParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const ymd = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = get("hour").padStart(2, "0");
  return { ymd, hour, hourKey: `${ymd}T${hour}:00` };
}

function daysUntilZurich(date) {
  const now = zurichParts(new Date()).ymd;
  const target = zurichParts(date).ymd;
  const a = new Date(`${now}T12:00:00`);
  const b = new Date(`${target}T12:00:00`);
  return Math.round((b - a) / 86400000);
}

async function loadEventForecast() {
  if (eventForecastCache.byDay && Date.now() - eventForecastCache.t < EVENT_FORECAST_TTL_MS) {
    return eventForecastCache;
  }
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(WEATHER_SPOT.lat));
  u.searchParams.set("longitude", String(WEATHER_SPOT.lon));
  u.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum"
  );
  u.searchParams.set("hourly", "temperature_2m,weather_code,precipitation_probability");
  u.searchParams.set("timezone", "Europe/Zurich");
  u.searchParams.set("forecast_days", "16");
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error("Event-Wetter HTTP " + res.status);
  const j = await res.json();
  const byDay = Object.create(null);
  const days = j.daily?.time || [];
  for (let i = 0; i < days.length; i++) {
    byDay[days[i]] = {
      code: j.daily.weather_code?.[i],
      tmax: j.daily.temperature_2m_max?.[i],
      tmin: j.daily.temperature_2m_min?.[i],
      precipProb: j.daily.precipitation_probability_max?.[i],
      precipSum: j.daily.precipitation_sum?.[i],
    };
  }
  const byHour = Object.create(null);
  const hours = j.hourly?.time || [];
  for (let i = 0; i < hours.length; i++) {
    const key = String(hours[i]).slice(0, 16); // YYYY-MM-DDTHH:MM
    byHour[key] = {
      temp: j.hourly.temperature_2m?.[i],
      code: j.hourly.weather_code?.[i],
      precipProb: j.hourly.precipitation_probability?.[i],
    };
  }
  eventForecastCache = { t: Date.now(), byDay, byHour };
  return eventForecastCache;
}

function getEventWeather(ev) {
  if (!ev?.date || !eventForecastCache.byDay) return null;
  const d = new Date(ev.date);
  if (Number.isNaN(d.getTime())) return null;
  const delta = daysUntilZurich(d);
  if (delta < 0) return { kind: "past" };
  if (delta > 15) {
    return { kind: "far", label: "Vorhersage später", emoji: "📅" };
  }
  const { ymd, hourKey } = zurichParts(d);
  const hour =
    eventForecastCache.byHour?.[hourKey] ||
    eventForecastCache.byHour?.[`${hourKey.slice(0, 13)}:00`];
  const day = eventForecastCache.byDay[ymd];
  if (!day && !hour) return { kind: "far", label: "Keine Daten", emoji: "🌡️" };
  const code = hour?.code ?? day?.code;
  const { text, emoji } = wmoWeatherGerman(code);
  const temp =
    hour?.temp != null
      ? Math.round(Number(hour.temp))
      : day?.tmax != null
        ? Math.round(Number(day.tmax))
        : null;
  const tmin = day?.tmin != null ? Math.round(Number(day.tmin)) : null;
  const tmax = day?.tmax != null ? Math.round(Number(day.tmax)) : null;
  const precip =
    hour?.precipProb != null
      ? Math.round(Number(hour.precipProb))
      : day?.precipProb != null
        ? Math.round(Number(day.precipProb))
        : null;
  return {
    kind: "ok",
    emoji,
    text,
    temp,
    tmin,
    tmax,
    precip,
    atEvent: hour?.temp != null,
  };
}

function renderEventWeatherBlock(ev, isPast) {
  if (isPast) return "";
  const w = getEventWeather(ev);
  if (!w || w.kind === "past") {
    return `<div class="event-weather event-weather--pending" data-weather-for="${escapeHtml(ev.id)}" aria-label="Wetter wird geladen">
      <span class="event-weather-emoji" aria-hidden="true">⏳</span>
      <span class="event-weather-temp">…</span>
      <span class="event-weather-label">Wetter</span>
    </div>`;
  }
  if (w.kind === "far") {
    return `<div class="event-weather event-weather--far" data-weather-for="${escapeHtml(ev.id)}" title="Open-Meteo liefert Vorhersagen ca. 16 Tage im Voraus">
      <span class="event-weather-emoji" aria-hidden="true">${w.emoji}</span>
      <span class="event-weather-temp">—</span>
      <span class="event-weather-label">${escapeHtml(w.label)}</span>
    </div>`;
  }
  const tempTxt = w.temp != null ? `${w.temp}°` : "—";
  const range =
    w.tmin != null && w.tmax != null ? `${w.tmin}–${w.tmax}°` : "";
  const rain = w.precip != null ? `${w.precip}% Regen` : "";
  const sub = [w.text, range || rain].filter(Boolean).join(" · ");
  const title = [
    w.atEvent ? `Um Event-Zeit ca. ${tempTxt}` : `Tageswert ${tempTxt}`,
    w.text,
    range && `Tag ${range}`,
    rain,
    "Open-Meteo · Pfäffikon",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="event-weather" data-weather-for="${escapeHtml(ev.id)}" title="${escapeHtml(title)}">
    <span class="event-weather-emoji" aria-hidden="true">${w.emoji}</span>
    <span class="event-weather-temp">${escapeHtml(tempTxt)}</span>
    <span class="event-weather-label">${escapeHtml(sub)}</span>
  </div>`;
}

async function hydrateEventWeather() {
  const nodes = document.querySelectorAll("[data-weather-for]");
  if (!nodes.length) return;
  try {
    await loadEventForecast();
  } catch (e) {
    console.warn("[Event-Wetter]", e);
    nodes.forEach((el) => {
      el.classList.add("event-weather--far");
      el.innerHTML = `<span class="event-weather-emoji" aria-hidden="true">🌡️</span><span class="event-weather-temp">—</span><span class="event-weather-label">Wetter offline</span>`;
    });
    return;
  }
  // Re-render upcoming cards’ weather slots without full list rebuild
  nodes.forEach((el) => {
    const id = el.getAttribute("data-weather-for");
    const ev = eventsCache.find((x) => x.id === id);
    if (!ev) return;
    const html = renderEventWeatherBlock(ev, false);
    if (!html) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = html.trim();
    const next = tmp.firstElementChild;
    if (next) el.replaceWith(next);
  });
}

async function initWeather() {
  const w = document.getElementById("weatherWidget");
  if (!w) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => {
    if (!s) return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  };
  try {
    const u = new URL("https://api.open-meteo.com/v1/forecast");
    u.searchParams.set("latitude", String(WEATHER_SPOT.lat));
    u.searchParams.set("longitude", String(WEATHER_SPOT.lon));
    u.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
    u.searchParams.set("hourly", "temperature_2m,weather_code");
    u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
    u.searchParams.set("timezone", "Europe/Zurich");
    u.searchParams.set("forecast_days", "2");
    const res = await fetch(u.toString());
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    const cur = j.current;
    const daily = j.daily;
    const hourly = j.hourly;
    if (!cur) throw new Error("kein current");
    const { text, emoji } = wmoWeatherGerman(cur.weather_code);
    if ($("weatherIcon")) $("weatherIcon").textContent = emoji;
    if ($("weatherDesc")) $("weatherDesc").textContent = text;
    if ($("weatherLocation")) $("weatherLocation").textContent = WEATHER_SPOT.label;
    if ($("weatherTemp") && cur.temperature_2m != null) {
      $("weatherTemp").textContent = `${Math.round(Number(cur.temperature_2m))}°`;
    }
    if ($("weatherRange") && daily?.temperature_2m_min?.[0] != null && daily?.temperature_2m_max?.[0] != null) {
      const lo = Math.round(Number(daily.temperature_2m_min[0]));
      const hi = Math.round(Number(daily.temperature_2m_max[0]));
      $("weatherRange").textContent = `Heute: ${lo}° – ${hi}°`;
    } else if ($("weatherRange")) {
      $("weatherRange").textContent = "";
    }
    const parts = [];
    if (cur.relative_humidity_2m != null) {
      parts.push(`Luftfeuchte ${Math.round(Number(cur.relative_humidity_2m))} %`);
    }
    if (cur.wind_speed_10m != null) {
      const kmh = (Number(cur.wind_speed_10m) * 3.6).toFixed(0);
      parts.push(`Wind ${kmh} km/h`);
    }
    if ($("weatherDetail")) $("weatherDetail").textContent = parts.join(" · ");
    if ($("weatherUpdated") && cur.time) {
      const t = new Date(String(cur.time));
      $("weatherUpdated").textContent = t.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
    }

    const hEl = $("weatherHourly");
    if (hEl) {
      const hHtml = buildHourlyOutlookHTML(hourly, cur.time, esc);
      if (hHtml) {
        hEl.innerHTML = hHtml;
        hEl.classList.remove("hidden");
        w.classList.add("weather-hero--has-hourly");
      } else {
        hEl.innerHTML = "";
        hEl.classList.add("hidden");
        w.classList.remove("weather-hero--has-hourly");
      }
    }

    w.classList.remove("weather-hero--error");
  } catch (e) {
    console.warn("[Wetter]", e);
    w.classList.add("weather-hero--error");
    w.classList.remove("weather-hero--has-hourly");
    if ($("weatherHourly")) {
      $("weatherHourly").innerHTML = "";
      $("weatherHourly").classList.add("hidden");
    }
    if ($("weatherIcon")) $("weatherIcon").textContent = "🌡️";
    if ($("weatherTemp")) $("weatherTemp").textContent = "–";
    if ($("weatherRange")) $("weatherRange").textContent = "";
    if ($("weatherDesc")) $("weatherDesc").textContent = "Wetterdaten momentan nicht verfügbar.";
    if ($("weatherDetail")) $("weatherDetail").textContent = "";
    if ($("weatherUpdated")) $("weatherUpdated").textContent = "";
  }
}

/* ==========================================================================
   Firebase Setup
   ========================================================================== */

let db = null;
let firebaseReady = false;
try {
  if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "PLACEHOLDER") {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    firebaseReady = true;
  } else {
    console.info("[Haus am See] Firebase noch nicht konfiguriert – Daten nur lokal.");
  }
} catch (e) {
  console.error("Firebase-Init fehlgeschlagen", e);
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(`has_${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Kleine Text-/Listen-Daten – beim Start sofort parsen */
const localStore = {
  events: readLocalJson("events", []),
  putzplan: readLocalJson("putzplan", []),
  giessplan: readLocalJson("giessplan", []),
  gartentodos: readLocalJson("gartentodos", []),
  termine: readLocalJson("termine", []),
  anwesenheit: readLocalJson("anwesenheit", {}),
  kandidaten: readLocalJson("kandidaten", []),
  config: readLocalJson("config", {}),
  guests: readLocalJson("guests", []),
  anmeldungen: readLocalJson("anmeldungen", []),
  nachrichten: readLocalJson("nachrichten", []),
  bewohnertexte: readLocalJson("bewohnertexte", {}),
  memberPasswords: readLocalJson("memberPasswords", {}),
  memberPrefs: readLocalJson("memberPrefs", {}),
  movedOut: readLocalJson("movedOut", []),
  wellnessBookings: readLocalJson("wellnessBookings", []),
  jacuzziReadings: readLocalJson("jacuzziReadings", []),
  einkaufsliste: readLocalJson("einkaufsliste", []),
  eventBring: readLocalJson("eventBring", []),
  hausfeatures: readLocalJson("hausfeatures", {}),
};
function saveLocal(key, value) { localStorage.setItem(`has_${key}`, JSON.stringify(value)); }

/** Base64-Bilder/Audio – lazy laden (können zusammen >10 MB sein) */
const heavyLocalCache = {};

function getHeavyLocal(key, fallback) {
  if (!(key in heavyLocalCache)) {
    heavyLocalCache[key] = readLocalJson(key, fallback);
    localStore[key] = heavyLocalCache[key];
  }
  return heavyLocalCache[key];
}

/** Firestore-Timestamps für localStorage in Zahlen umwandeln */
function serializeForLocal(data) {
  return JSON.parse(JSON.stringify(data, (_k, v) => {
    if (v && typeof v.toDate === "function") return v.toDate().getTime();
    if (v && typeof v.toMillis === "function") return v.toMillis();
    return v;
  }));
}

/** Nur leichte Collections beim Live-Sync cachen – Medien nie (Megabyte-Writes blockieren UI) */
const PERSIST_ON_SNAPSHOT_KEYS = new Set([
  "events", "putzplan", "giessplan", "gartentodos", "termine", "anwesenheit",
  "anmeldungen", "einkaufsliste", "eventBring", "hausWiki", "kandidaten",
  "guests", "nachrichten", "hausfeatures", "bewohnertexte",
  "wellnessBookings", "jacuzziReadings", "jacuzziStatus",
]);
let persistPending = null;
let persistTimer = null;

function flushPersistPending() {
  persistTimer = null;
  if (!persistPending) return;
  const batch = persistPending;
  persistPending = null;
  for (const [key, value] of Object.entries(batch)) {
    const serialized = serializeForLocal(value);
    localStore[key] = serialized;
    saveLocal(key, serialized);
  }
}

function persistFirestoreCache(key, value) {
  if (!PERSIST_ON_SNAPSHOT_KEYS.has(key)) return;
  if (!persistPending) persistPending = {};
  persistPending[key] = value;
  if (persistTimer) return;
  persistTimer = setTimeout(flushPersistPending, 600);
}

/* ==========================================================================
   Helpers
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const monthShort = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtDateTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Nur sichere URL-Schemata für href/src zulassen (blockt javascript:, data:text/html …). */
function safeUrl(url) {
  const s = String(url || "").trim();
  if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
  // Bilder/Audio als Data-URL sind ok; ausführbares HTML nicht.
  if (/^data:(image\/|audio\/|video\/)/i.test(s)) return s;
  return "";
}

function showToast(msg, type = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => { t.classList.remove("show"); }, 3200);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, "0")).join("");
}

/** Eingabe vor SHA-256 (iOS, Autofill, Unicode) – muss identisch für Speichern und Login sein */
function normPasswordInput(s) {
  return String(s ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n]+/g, "")
    .trim();
}

const LOGIN_LAST_MEMBER_KEY = "has_last_login_member";

// Server-Auth: Passwörter werden NICHT mehr im Browser geprüft (Hashes sind
// nicht mehr öffentlich lesbar), sondern von der authApi-Cloud-Function.
const AUTH_API_URL = `https://europe-west1-${firebaseConfig.projectId}.cloudfunctions.net/authApi`;
let authSessionToken = null;

async function authApiCall(action, payload = {}) {
  const res = await fetch(AUTH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* leere/kaputte Antwort */ }
  return { status: res.status, ...data };
}

/* ==========================================================================
   Auth (WG-Login + Gast-Zugänge)
   ========================================================================== */

const SESSION_KEY = "has_wg_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 Tage

// Laufzeit-Cache für Auth-Config (gemeinsamer Hash + persönliche Hashes + Gäste)
// — Persönliches Passwort: doc "config/memberPasswords" { "Manu": "hex64", ... }
// — Fallback für alle ohne eigenes Passwort: doc "config/auth" { passwordHash }
let authConfig = {
  passwordHash: WG_PASSWORD_HASH,
  /** @type {Record<string, string>} Nur Erwachsene; sobald gesetzt, gilt nur noch dieses Passwort für Login */
  memberHashes: {},
  /** @type {Record<string, { displayName?: string, emoji?: string }>} */
  memberPrefs: {},
  ready: false,
};
let guestsCache = [];
/** @type {Set<string>} Namen, die in der App als ausgezogen gelten (Firestore config/movedOut) */
let movedOutNames = new Set();

const auth = {
  member: null,
  isGuest: false,
  /** @type {"personal"|"group"|null} Nur bei WG-Login: persönliches vs. Gruppenpasswort */
  loginKind: null,
  get isAuthed() { return !!this.member; },
  get isMember() { return !!this.member && !this.isGuest; },
  /** Persönliches Passwort gesetzt und damit eingeloggt (für Jacuzzi-WhatsApp-Opt-in). */
  get isPersonalLogin() {
    return this.isMember && this.loginKind === "personal" && !!authConfig.memberHashes[this.member];
  },
  init() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session.until <= Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      if (session.isGuest) {
        this.member = session.member;
        this.isGuest = true;
        this.loginKind = null;
        authSessionToken = session.token || null;
        this.apply();
      } else {
        const member = canonicalBewohnerName(session.member);
        if (BEWOHNER.find(b => b.name === member) && !movedOutNames.has(member)) {
        this.member = member;
        this.isGuest = false;
        this.loginKind = session.loginKind === "personal" ? "personal" : "group";
        authSessionToken = session.token || null;
        this.apply();
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      }
    } catch { localStorage.removeItem(SESSION_KEY); }
  },
  login(member, { isGuest = false, loginKind = null, token = null } = {}) {
    this.member = member;
    this.isGuest = isGuest;
    this.loginKind = isGuest ? null : loginKind;
    authSessionToken = token || null;
    if (!isGuest && member) {
      try { sessionStorage.setItem(LOGIN_LAST_MEMBER_KEY, member); } catch (_) { /* */ }
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      member,
      isGuest,
      loginKind: this.loginKind,
      token: authSessionToken,
      until: Date.now() + SESSION_DURATION
    }));
    this.apply();
    const greeting = isGuest ? `Willkommen als Gast, ${member} 🎟️` : `Willkommen zurück, ${mLabel(member)} 🌿`;
    showToast(greeting, "success");
  },
  /** Session-Token still aktualisieren (nach Passwortwechsel) – ohne Begrüßung. */
  refreshToken(token) {
    if (!token) return;
    authSessionToken = token;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const s = raw ? JSON.parse(raw) : {};
      s.token = token;
      s.until = Date.now() + SESSION_DURATION;
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (_) { /* */ }
  },
  logout() {
    if (authSessionToken) authApiCall("logout", { token: authSessionToken }).catch(() => {});
    this.member = null;
    this.isGuest = false;
    this.loginKind = null;
    authSessionToken = null;
    localStorage.removeItem(SESSION_KEY);
    this.apply();
    showToast("Abgemeldet.");
  },
  apply() {
    document.body.classList.toggle("wg-authed", this.isAuthed);
    document.body.classList.toggle("wg-member", this.isMember);
    document.body.classList.toggle("wg-guest", this.isGuest);
    updateLoginChip();
    // Re-render dynamic sections so buttons/states reflect auth
    renderTermine();
    renderAnwesend();
    renderGallery();
    renderEvents();
    renderAufgaben();
    renderGiessplan();
    renderGartenTodos();
    populateGiessWhoSelect();
    populateGartenTodoWhoSelect();
    renderPlaylist();
    renderKandidaten();
    renderSchaeden();
    renderBewohner();
    renderHausFeatures();
    renderGuestsList();
    renderNachrichten();
    renderRoomOffer();
    populateSchadenZustaendigSelect();
    syncKalenderTabs();
    fillMemberProfileForm();
    renderSettingsBewohnerRoster();
    syncKeychainUserFields();
    renderEinkaufsliste();
    renderGustavHub();
    renderHausWiki();
    renderWellnessBelegung();
    renderJacuzziPanel();
    renderWhatsappSettings();
  }
};

const ADULT_NAMES = new Set(BEWOHNER.filter((b) => !b.kid).map((b) => b.name));

function applyMovedOutDoc(data) {
  const arr = (data && Array.isArray(data.names)) ? data.names : [];
  movedOutNames = new Set(arr.filter((n) => BEWOHNER_NAME_SET.has(n)));
}

function isMovedOut(name) {
  return movedOutNames.has(name);
}

function getActiveBewohner() {
  return BEWOHNER.filter((b) => !movedOutNames.has(b.name));
}

function getActiveAdults() {
  return getActiveBewohner().filter((b) => !b.kid);
}

/** Erwachsene für Termin-Badges: aktiv, oder ausgezogen aber mit gespeichertem RSVP */
function bewohnerFuerTerminBadges(responses) {
  return BEWOHNER.filter(
    (b) => !b.kid
      && (!movedOutNames.has(b.name) || (responses && Object.prototype.hasOwnProperty.call(responses, b.name)))
  );
}

/** Gemeinsames Login ohne persönliches Passwort: Hash aus Firestore ODER eingebautes Standard-«hausamsee» */
function hashMatchesWgLoginFallback(hash) {
  return hash === authConfig.passwordHash || hash === WG_PASSWORD_HASH;
}

function parseMemberPasswordHashes(data) {
  const out = {};
  if (!data || typeof data !== "object") return out;
  const skipKeys = new Set(["updatedAt", "updatedBy", "createdAt"]);
  for (const [k, v] of Object.entries(data)) {
    if (skipKeys.has(k)) continue;
    if (v == null) continue;
    if (typeof v !== "string") continue;
    const raw = v.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(raw)) continue;
    const kTrim = canonicalBewohnerName(k.trim());
    let canonical = [...ADULT_NAMES].find((n) => n === kTrim);
    if (!canonical) canonical = [...ADULT_NAMES].find((n) => n.toLowerCase() === kTrim.toLowerCase());
    if (!canonical) continue;
    out[canonical] = raw;
  }
  return out;
}

function applyMemberPasswordsDoc(data) {
  authConfig.memberHashes = parseMemberPasswordHashes(data);
}

/**
 * Server-Auth: statt echter Hashes speichern wir nur noch, WER ein persönliches
 * Passwort hat (Namen aus dem öffentlichen config/authMeta). Die UI-Checks
 * (`!!authConfig.memberHashes[name]`) funktionieren damit unverändert weiter.
 */
function applyAuthMetaDoc(data) {
  const names = data && Array.isArray(data.withPersonal) ? data.withPersonal : [];
  const out = {};
  for (const n of names) {
    const canonical = canonicalBewohnerName(String(n));
    if (ADULT_NAMES.has(canonical)) out[canonical] = true;
  }
  authConfig.memberHashes = out;
}

const LOGIN_REST_MS = 3000;
const LOGIN_WAIT_MS = 2000;
const AUTH_HASHES_SESSION_KEY = "has_auth_hashes_v1";
const AUTH_HASHES_SESSION_TTL_MS = 30 * 60 * 1000;

let loginHashesLoadPromise = null;
let loginHashesReady = false;

function promiseWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function firestoreRestFieldsToPlain(fields) {
  const out = {};
  if (!fields || typeof fields !== "object") return out;
  for (const [k, v] of Object.entries(fields)) {
    if (!v || typeof v !== "object") continue;
    if (v.stringValue != null) out[k] = v.stringValue;
  }
  return out;
}

function persistAuthHashesSessionCache() {
  try {
    sessionStorage.setItem(AUTH_HASHES_SESSION_KEY, JSON.stringify({
      passwordHash: authConfig.passwordHash,
      memberHashes: authConfig.memberHashes,
      t: Date.now(),
      fromNetwork: true,
    }));
  } catch (_) { /* Privatmodus / Speicher voll */ }
}

function hydrateAuthHashesSessionCache() {
  try {
    const raw = sessionStorage.getItem(AUTH_HASHES_SESSION_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d?.t || Date.now() - d.t > AUTH_HASHES_SESSION_TTL_MS) return false;
    if (d.passwordHash) authConfig.passwordHash = d.passwordHash;
    if (d.memberHashes && typeof d.memberHashes === "object") {
      authConfig.memberHashes = { ...authConfig.memberHashes, ...d.memberHashes };
    }
    return !!d.fromNetwork;
  } catch (_) { /* */ }
  return false;
}

function markLoginHashesReady() {
  loginHashesReady = true;
}

/**
 * Prefetch: lädt nur noch die öffentliche Namensliste (config/authMeta), wer ein
 * persönliches Passwort hat. Passwort-Hashes werden NICHT mehr geladen (die prüft
 * serverseitig die authApi). Reine UI-Beschleunigung, unkritisch bei Fehlern.
 */
async function refreshLoginHashesViaRest() {
  if (!firebaseReady || !firebaseConfig.projectId || !firebaseConfig.apiKey) return false;
  const pid = firebaseConfig.projectId;
  const key = encodeURIComponent(firebaseConfig.apiKey);
  const url = `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/config/authMeta?key=${key}`;
  try {
    const res = await promiseWithTimeout(fetch(url, { cache: "no-store" }), LOGIN_REST_MS);
    if (!res.ok) return false;
    const j = await res.json();
    const plain = firestoreRestFieldsToPlain(j?.fields || {});
    // withPersonal ist ein Array → in firestoreRestFieldsToPlain nicht enthalten;
    // separat auslesen:
    const arr = j?.fields?.withPersonal?.arrayValue?.values || [];
    applyAuthMetaDoc({ withPersonal: arr.map((v) => v.stringValue).filter(Boolean) });
    markLoginHashesReady();
    return true;
  } catch (e) {
    console.warn("refreshLoginHashesViaRest", e?.message || e);
    return false;
  }
}

/** Einmaliger Load – Prefetch und Login teilen dasselbe Promise. */
function startLoginHashesLoad() {
  if (!firebaseReady) return Promise.resolve(false);
  if (loginHashesReady) return Promise.resolve(true);
  if (loginHashesLoadPromise) return loginHashesLoadPromise;
  loginHashesLoadPromise = refreshLoginHashesViaRest()
    .finally(() => {
      if (!loginHashesReady) loginHashesLoadPromise = null;
    });
  return loginHashesLoadPromise;
}

function prefetchLoginHashesInBackground() {
  startLoginHashesLoad().catch(() => {});
}

/** Vor Login: Session-Cache sofort, sonst max. 2s auf laufendes Prefetch warten. */
async function ensureAuthConfigForLogin() {
  if (hydrateAuthHashesSessionCache()) {
    markLoginHashesReady();
    prefetchLoginHashesInBackground();
    return;
  }
  if (loginHashesReady) return;
  try {
    await promiseWithTimeout(startLoginHashesLoad(), LOGIN_WAIT_MS);
  } catch (_) {
    /* Prefetch noch nicht fertig – Passwort trotzdem prüfen */
  }
  if (!authConfig.ready) loadAuthConfig().catch(() => {});
}

function applyMemberPrefsDoc(data) {
  const next = {};
  const raw = data && typeof data === "object" ? { ...data } : {};
  if (raw.Andy && !raw.Andi) {
    raw.Andi = raw.Andy;
    delete raw.Andy;
  }
  if (raw.Fanny && !raw.Fannie) {
    raw.Fannie = raw.Fanny;
    delete raw.Fanny;
  }
  if (raw.Elliot && !raw.Eliot) {
    raw.Eliot = raw.Elliot;
    delete raw.Elliot;
  }
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(raw)) {
      const key = canonicalBewohnerName(k);
      if (!BEWOHNER_NAME_SET.has(key) || !v || typeof v !== "object") continue;
      const rawName = v.displayName != null ? String(v.displayName) : "";
      const displayName = rawName.replace(/\s+/g, " ").trim().slice(0, 32);
      const rawEmoji = v.emoji != null ? String(v.emoji).trim() : "";
      if (rawEmoji && !EMOJI_CHOICES_SET.has(rawEmoji)) continue;
      const rawPhone = v.phone != null ? String(v.phone).replace(/[^\d+]/g, "").trim() : "";
      const o = {};
      if (displayName) o.displayName = displayName;
      if (rawEmoji) o.emoji = rawEmoji;
      if (rawPhone) o.phone = rawPhone;
      if (typeof v.jacuzziWhatsapp === "boolean") o.jacuzziWhatsapp = v.jacuzziWhatsapp;
      if (typeof v.whatsappGiessplan === "boolean") o.whatsappGiessplan = v.whatsappGiessplan;
      if (typeof v.whatsappGarten === "boolean") o.whatsappGarten = v.whatsappGarten;
      if (typeof v.whatsappSchaden === "boolean") o.whatsappSchaden = v.whatsappSchaden;
      if (v.birthDate != null && String(v.birthDate).trim()) o.birthDate = String(v.birthDate).trim().slice(0, 12);
      if (v.deinTag && typeof v.deinTag === "object") {
        o.deinTag = {
          enabled: !!v.deinTag.enabled,
          cadence: ["daily", "weekdays", "weekly", "every2days"].includes(v.deinTag.cadence) ? v.deinTag.cadence : "daily",
        };
      }
      if (Object.keys(o).length) next[key] = { ...(next[key] || {}), ...o };
    }
  }
  authConfig.memberPrefs = next;
}

function mLabel(name) {
  if (!name) return "";
  const p = authConfig.memberPrefs[name];
  return (p?.displayName && String(p.displayName).trim()) || name;
}

function mEmoji(name) {
  if (!name) return "🌿";
  const p = authConfig.memberPrefs[name];
  if (p?.emoji && EMOJI_CHOICES_SET.has(p.emoji)) return p.emoji;
  return BEWOHNER.find((b) => b.name === name)?.emoji || "🌿";
}

function onMemberPrefsChanged() {
  updateLoginChip();
  fillMemberProfileForm();
  renderBewohner();
  renderAnwesend();
  renderTermine();
  renderSchaeden();
  renderEinkaufsliste();
  renderGustavHub();
  renderHausWiki();
  populateLoginMemberSelect();
  populateAufgabenWhoSelect();
  populateSchadenZustaendigSelect();
  renderSettingsBewohnerRoster();
  renderWhatsappSettings();
}

function onMovedOutChanged() {
  renderBewohner();
  renderAnwesend();
  renderTermine();
  renderSchaeden();
  populateLoginMemberSelect();
  populateAufgabenWhoSelect();
  populateSchadenZustaendigSelect();
  updateLoginChip();
  renderSettingsBewohnerRoster();
  $("statBewohner") && ($("statBewohner").textContent = String(getActiveBewohner().length));
  populateAdminPasswordSelect();
}

async function clearMemberAppPrefsInCloud(name) {
  if (!ADULT_NAMES.has(name)) return;
  if (!firebaseReady) {
    if (localStore.memberPasswords[name]) {
      const { [name]: _r, ...rest } = localStore.memberPasswords;
      localStore.memberPasswords = rest;
      saveLocal("memberPasswords", localStore.memberPasswords);
    }
    if (localStore.memberPrefs[name]) {
      const { [name]: _p, ...r2 } = localStore.memberPrefs;
      localStore.memberPrefs = r2;
      saveLocal("memberPrefs", localStore.memberPrefs);
    }
    applyMemberPasswordsDoc(localStore.memberPasswords);
    applyMemberPrefsDoc(localStore.memberPrefs);
    return;
  }
  // Passwort-Hash + Prefs serverseitig entfernen (config/memberPasswords ist gesperrt).
  await authApiCall("clearPersonal", { token: authSessionToken, target: name });
  delete authConfig.memberHashes[name];
  if (authConfig.memberPrefs[name]) delete authConfig.memberPrefs[name];
}

async function saveMovedOutNamesArray(names) {
  const uniq = [...new Set(names.filter((n) => BEWOHNER_NAME_SET.has(n)))].sort();
  applyMovedOutDoc({ names: uniq });
  if (firebaseReady) {
    await setDoc(doc(db, "config", "movedOut"), {
      names: uniq,
      updatedBy: auth.member,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } else {
    localStore.movedOut = uniq;
    saveLocal("movedOut", uniq);
  }
  onMovedOutChanged();
}

function populateAdminPasswordSelect() {
  const sel = $("adminClearPersonalSelect");
  if (!sel) return;
  const prev = sel.value;
  const adults = getActiveAdults();
  sel.innerHTML = `<option value="">Person wählen…</option>` +
    adults.map((b) => `<option value="${escapeAttr(b.name)}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`).join("");
  if (prev && Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
}

function buildWgInviteText() {
  const u = new URL(window.location.href);
  u.searchParams.set("openLogin", "1");
  const url = u.toString();
  const text = `Hi! Unsere Wohn-Website (Infos, Kalender, …):
${url}

Zum Anmelden: in der Leiste deinen vollen Namen wählen (wie in der WG-Liste) und Passwort eingeben.
Initiales Gruppenpasswort (nur solange es die WG nicht geändert hat): ${DEFAULT_WG_PASSWORD_PLAINTEXT}
Danach: unter «WG-Intern → Einstellungen» dein persönliches Passwort, Anzeigename und Icon setzen.`;
  return { url, text, shareTitle: "Haus am See – WG-Zugang" };
}

async function shareWgInviteFromSheet() {
  if (!requireMember("Einladung teilen")) return;
  const { text, shareTitle, url } = buildWgInviteText();
  await shareOrCopy({ title: shareTitle, text, url });
}

function openWgInviteWhatsApp() {
  if (!requireMember("Einladung teilen")) return;
  const { text } = buildWgInviteText();
  const win = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  if (!win) showToast("Popup blockiert – bitte Teilen oder Kopieren nutzen.", "error");
}

function copyWgInviteToClipboard() {
  if (!requireMember("Einladung teilen")) return;
  const { text } = buildWgInviteText();
  navigator.clipboard.writeText(text).then(
    () => showToast("Einladungstext in die Zwischenablage.", "success"),
    () => showToast("Kopieren nicht möglich.", "error")
  );
}

function renderSettingsBewohnerRoster() {
  const host = $("settingsBewohnerRoster");
  if (!host) return;
  if (!auth.isMember) {
    host.innerHTML = "<p class=\"form-note\" style=\"margin:0;\">Nur sichtbar, wenn du als Bewohner:in angemeldet bist.</p>";
    return;
  }
  const active = getActiveBewohner();
  const moved = BEWOHNER.filter((b) => movedOutNames.has(b.name));
  const activeRows = active.map((b) => `
    <div class="settings-roster-row">
      <span class="settings-roster-name">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}${b.kid ? ' <span class="kid-badge">Kid</span>' : ""}</span>
      <button type="button" class="event-share-btn" data-moved="out" data-name="${escapeAttr(b.name)}">Auszug</button>
    </div>
  `).join("");
  const movedRows = moved.map((b) => `
    <div class="settings-roster-row is-movedout">
      <span class="settings-roster-name muted">${b.emoji} ${escapeHtml(b.name)}</span>
      <button type="button" class="event-share-btn" data-moved="in" data-name="${escapeAttr(b.name)}">Wieder da</button>
    </div>
  `).join("");

  host.innerHTML = `
    <div class="settings-roster-block">
      <div class="settings-roster-h">Aktuell in der Liste</div>
      ${activeRows || "<p class='form-note' style='margin:0;'>—</p>"}
    </div>
    ${moved.length ? `<div class="settings-roster-block" style="margin-top:10px">
      <div class="settings-roster-h">Ausgezogen (kein Login)</div>
      ${movedRows}
    </div>` : ""}
    <p class="form-note" style="margin-top:10px;">Nach «Auszug» verschwindet der Name in Login, Kacheln und Wochenend-Status. Gäste und alte Event-Daten bleiben.</p>
  `;
  host.querySelectorAll("button[data-moved]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-name");
      if (btn.getAttribute("data-moved") === "out") markBewohnerMovedOut(name);
      else markBewohnerZurueck(name);
    });
  });
  populateAdminPasswordSelect();
}

async function markBewohnerMovedOut(name) {
  if (!requireMember("Besetzung ändern")) return;
  if (!BEWOHNER_NAME_SET.has(name) || isMovedOut(name)) return;
  if (getActiveBewohner().length <= 1) {
    showToast("Wenigstens eine Person muss in der Liste bleiben.", "error");
    return;
  }
  if (!confirm(`${name} als ausgezogen markieren? (Login und Listen weg; persönliches Passwort wird entfernt.)`)) return;
  try {
    await clearMemberAppPrefsInCloud(name);
    const wasMe = auth.member === name;
    await saveMovedOutNamesArray([...movedOutNames, name]);
    if (wasMe) {
      showToast("Auszug für dich gespeichert. Du wirst abgemeldet. «Wieder da» holt dich in die Liste zurück.", "success");
      auth.logout();
    } else {
      showToast(`${name} ist als ausgezogen gespeichert.`, "success");
    }
  } catch (e) {
    console.error(e);
    showToast("Speichern fehlgeschlagen.", "error");
  }
}

async function markBewohnerZurueck(name) {
  if (!requireMember("Besetzung ändern")) return;
  if (!isMovedOut(name)) return;
  if (!confirm(`${name} wieder zur aktiven Besetzung hinzufügen?`)) return;
  try {
    await saveMovedOutNamesArray([...movedOutNames].filter((n) => n !== name));
    showToast(`${name} erscheint wieder in der WG-Liste.`, "success");
  } catch (e) {
    console.error(e);
    showToast("Speichern fehlgeschlagen.", "error");
  }
}

function fillMemberProfileForm() {
  const elName = $("profileDisplayName");
  const elEmoji = $("profileEmoji");
  const elPhone = $("profilePhone");
  const elBirth = $("profileBirthDate");
  if (!elName || !elEmoji) return;
  if (!auth.isMember) {
    elName.value = "";
    if (elPhone) elPhone.value = "";
    if (elBirth) elBirth.value = "";
    if (elEmoji.options.length) elEmoji.selectedIndex = 0;
    return;
  }
  const p = authConfig.memberPrefs[auth.member];
  const base = BEWOHNER.find((b) => b.name === auth.member);
  elName.value = p?.displayName || auth.member;
  if (elPhone) elPhone.value = p?.phone || "";
  if (elBirth) elBirth.value = p?.birthDate || "";
  const want = p?.emoji && EMOJI_CHOICES_SET.has(p.emoji) ? p.emoji : (base?.emoji || EMOJI_CHOICES[0]);
  if (Array.from(elEmoji.options).some((o) => o.value === want)) elEmoji.value = want;
  else {
    const opt = document.createElement("option");
    opt.value = want;
    opt.textContent = `${want} (sonstig)`;
    elEmoji.appendChild(opt);
    elEmoji.value = want;
  }
}

function populateProfileEmojiSelect() {
  const sel = $("profileEmoji");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = EMOJI_CHOICES.map((e) => `<option value="${e}">${e}</option>`).join("");
  if (keep && Array.from(sel.options).some((o) => o.value === keep)) sel.value = keep;
}

/** Login für eine konkrete Bewohner:in: eigenes Passwort, sonst gemeinsames WG-Passwort. */
async function verifyMemberPassword(memberName, pw) {
  const canonical = canonicalBewohnerName(memberName);
  const hash = await sha256(normPasswordInput(pw));
  const personal = authConfig.memberHashes[canonical];
  if (personal) {
    if (hash === personal) return { ok: true, kind: "personal" };
    return { ok: false, reason: "wrong", hasPersonal: true };
  }
  if (hashMatchesWgLoginFallback(hash)) return { ok: true, kind: "group" };
  return { ok: false, reason: "wrong", hasPersonal: false };
}

// Hash für ein Passwort: nur Gäste + gemeinsames WG-Passwort (für generische Gast-Option)
async function verifyPassword(pw) {
  const hash = await sha256(normPasswordInput(pw));
  if (hashMatchesWgLoginFallback(hash)) return { ok: true, kind: "member" };
  const now = Date.now();
  for (const g of guestsCache) {
    if (g.hash !== hash) continue;
    if (g.expiresAt && g.expiresAt < now) return { ok: false, reason: "expired", guestName: g.name };
    return { ok: true, kind: "guest", guestName: g.name };
  }
  return { ok: false, reason: "wrong" };
}

/** iOS/Safari: Konto-Name muss in einem echten <input> mit autocomplete="username" stehen, nicht im <select>. */
function syncKeychainUserFields() {
  const lku = $("loginKeychainUser");
  const sel = $("loginMember");
  if (lku && sel) {
    const v = sel.value;
    if (v.startsWith("__guest__:")) {
      const key = v.slice("__guest__:".length);
      const g = (guestsCache || []).find((x) => x.id === key || x.name === key);
      lku.value = g ? g.name : "";
    } else if (v === "__guest__") {
      lku.value = "Gast (Haus am See)";
    } else if (v) {
      lku.value = v;
    }
  }
  const cpu = $("changePwKeychainUser");
  if (cpu) {
    if (auth.isMember && !auth.isGuest) cpu.value = auth.member;
    else cpu.value = "";
  }
}

/** Keychain füllt oft zuerst Konto-Name – Dropdown muss dann nachziehen. */
function syncSelectFromKeychainUser() {
  const lku = $("loginKeychainUser");
  const sel = $("loginMember");
  if (!lku || !sel) return;
  const name = lku.value.trim();
  if (!name) return;
  if (name === "Gast (Haus am See)" && [...sel.options].some((o) => o.value === "__guest__")) {
    sel.value = "__guest__";
    return;
  }
  if ([...sel.options].some((o) => o.value === name)) sel.value = name;
}

function resolveLoginMemberSelection() {
  syncSelectFromKeychainUser();
  const sel = $("loginMember");
  let selected = sel?.value || "";
  const keychainName = ($("loginKeychainUser")?.value || "").trim();
  if (!selected && keychainName) {
    syncSelectFromKeychainUser();
    selected = sel?.value || "";
  }
  if (selected && keychainName && !selected.startsWith("__guest__") && keychainName !== selected) {
    if ([...ADULT_NAMES, ...getActiveBewohner().filter((b) => b.kid).map((b) => b.name)].includes(keychainName)) {
      sel.value = keychainName;
      selected = keychainName;
      syncKeychainUserFields();
    }
  }
  return selected;
}

/** Passwort aus Formular (Autofill liefert manchmal nur zuverlässig über FormData). */
function readLoginPassword(form) {
  if (form && typeof FormData !== "undefined") {
    const fd = new FormData(form);
    const fromForm = fd.get("password");
    if (fromForm != null && String(fromForm).length > 0) return String(fromForm);
  }
  return $("loginPassword")?.value || "";
}

function scheduleLoginAutofillSync() {
  // Nur Dropdown nachziehen – Keychain-Konto-Name NICHT überschreiben (sonst Autofill kaputt)
  syncSelectFromKeychainUser();
  setTimeout(syncSelectFromKeychainUser, 200);
}

function wireLoginAutofillSync() {
  const lku = $("loginKeychainUser");
  const pw = $("loginPassword");
  const sel = $("loginMember");
  lku?.addEventListener("input", () => { syncSelectFromKeychainUser(); });
  lku?.addEventListener("change", () => { syncSelectFromKeychainUser(); });
  pw?.addEventListener("change", () => { syncSelectFromKeychainUser(); });
  sel?.addEventListener("change", () => { syncKeychainUserFields(); });
}

function updateLoginChip() {
  const btn = $("loginBtn");
  if (auth.isAuthed) {
    btn.classList.add("logged-in");
    const label = auth.isGuest ? auth.member : mLabel(auth.member);
    const icon = auth.isGuest ? "🎟️" : mEmoji(auth.member);
    btn.innerHTML = `<span class="login-icon">${icon}</span><span class="login-label">${escapeHtml(label)} · Abmelden</span>`;
  } else {
    btn.classList.remove("logged-in");
    btn.innerHTML = `<span class="login-icon">🔑</span><span class="login-label">Anmelden</span>`;
  }
}

function populateLoginMemberSelect() {
  const select = $("loginMember");
  if (!select) return;
  const previous = select.value;
  const adults = getActiveAdults();
  const kids = getActiveBewohner().filter(b => b.kid);
  const now = Date.now();
  const activeGuests = (guestsCache || []).filter(g => !g.expiresAt || g.expiresAt > now);

  const memberOpts = adults
    .map(b => `<option value="${escapeHtml(b.name)}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`)
    .join("");

  const kidsOpts = kids
    .map(b => `<option value="${escapeHtml(b.name)}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`)
    .join("");

  // Jeder Gast bekommt einen eigenen Eintrag mit Namen
  const guestOpts = activeGuests
    .map(g => `<option value="__guest__:${escapeHtml(g.id || g.name)}">🎟️ ${escapeHtml(g.name)} (Gast)</option>`)
    .join("");

  // Fallback: kein Gast angelegt → generische Option beibehalten, damit Bekannte noch reinkommen
  const guestGroup = activeGuests.length
    ? `<optgroup label="Gast-Zugänge">${guestOpts}</optgroup>`
    : `<option value="__guest__">🎟️ Gast-Zugang (Passwort eingeben)</option>`;

  const kidsGroup = kids.length
    ? `<optgroup label="Kids">${kidsOpts}</optgroup>`
    : "";

  select.innerHTML =
    `<option value="" disabled ${previous ? "" : "selected"}>Wähle dich aus…</option>` +
    `<optgroup label="Bewohner:innen">${memberOpts}</optgroup>` +
    kidsGroup +
    guestGroup;

  if (previous) select.value = previous;
  syncKeychainUserFields();
}

$("loginMember")?.addEventListener("change", () => { syncKeychainUserFields(); });

function openLoginDialog() {
  $("loginError")?.classList.add("hidden");
  const pw = $("loginPassword");
  if (pw) pw.value = "";
  prefetchLoginHashesInBackground();
  populateLoginMemberSelect();
  const last = sessionStorage.getItem(LOGIN_LAST_MEMBER_KEY);
  const sel = $("loginMember");
  if (last && sel && [...sel.options].some((o) => o.value === last)) {
    sel.value = last;
  }
  syncKeychainUserFields();
  try {
    $("loginDialog")?.showModal();
    scheduleLoginAutofillSync();
  } catch (_) { /* */ }
}

function populateAufgabenWhoSelect() {
  const select = $("aufgabenWho");
  if (!select) return;
  const current = select.value;
  select.innerHTML = gartenTodoWhoOptionsHtml("", true);
  if (current) select.value = current;
}

function setAufgabenFormDefaults() {
  const when = $("aufgabenWhen");
  if (when && !when.value) when.value = zurichTodayYmd();
}

$("loginBtn")?.addEventListener("click", () => {
  if (auth.isAuthed) {
    if (confirm(`${auth.member}, wirklich abmelden?`)) auth.logout();
  } else {
    openLoginDialog();
  }
});

document.querySelector("#loginDialog .dialog-close")?.addEventListener("click", () => {
  $("loginDialog").close();
});

$("loginDialog")?.addEventListener("click", (e) => {
  if (e.target === $("loginDialog")) $("loginDialog").close();
});

$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  syncSelectFromKeychainUser();
  const selected = canonicalBewohnerName(resolveLoginMemberSelection());
  const password = readLoginPassword(e.target);
  if (!selected) {
    const errorEl = $("loginError");
    errorEl.textContent = "Bitte zuerst «Ich bin» wählen (oder Konto-Name aus der Passwort-App).";
    errorEl.classList.remove("hidden");
    return;
  }

  const submitBtn = $("loginForm")?.querySelector('button[type="submit"]');
  const prevBtnText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Prüfe…";
  }

  const errorEl = $("loginError");
  const resetSubmitBtn = () => {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = prevBtnText || "Anmelden";
    }
  };
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    $("loginPassword").value = "";
    $("loginPassword").focus();
    resetSubmitBtn();
  };

  // Ohne Firebase (lokaler Demo-Modus): alte clientseitige Prüfung als Fallback.
  if (!firebaseReady) {
    await ensureAuthConfigForLogin();
    if (selected.startsWith("__guest__:") || selected === "__guest__") {
      const res = await verifyPassword(password);
      if (!res.ok || res.kind !== "guest") { showError("Falsches Passwort · versuch's nochmal."); return; }
      resetSubmitBtn(); auth.login(res.guestName, { isGuest: true }); $("loginDialog").close(); return;
    }
    const mres = await verifyMemberPassword(selected, password);
    if (!mres.ok) { showError("Falsches Passwort · versuch's nochmal."); return; }
    resetSubmitBtn(); auth.login(selected, { isGuest: false, loginKind: mres.kind }); $("loginDialog").close(); return;
  }

  try {
    // Gast-Login (konkreter Eintrag oder generisch)
    if (selected.startsWith("__guest__:") || selected === "__guest__") {
      const guestKey = selected.startsWith("__guest__:") ? selected.slice("__guest__:".length) : "";
      const r = await authApiCall("guestLogin", { password, guestKey });
      if (!r.ok) {
        showError(r.reason === "expired" ? "Dieser Gast-Zugang ist abgelaufen."
          : r.reason === "throttled" ? "Zu viele Versuche – bitte kurz warten."
          : "Falsches Passwort · versuch's nochmal.");
        return;
      }
      resetSubmitBtn();
      auth.login(r.guestName || r.member, { isGuest: true, token: r.token });
      $("loginDialog").close();
      return;
    }

    // WG-Mitglied
    const r = await authApiCall("login", { member: selected, password });
    if (!r.ok) {
      if (r.reason === "throttled") {
        showError("Zu viele Fehlversuche – bitte ein paar Minuten warten.");
      } else if (r.hasPersonal) {
        showError(
          "Falsches Passwort. Du hast ein persönliches Passwort – das WG-Passwort gilt nicht mehr für dich. " +
          "Passwort-App-Eintrag prüfen oder unter WG-Intern → Einstellungen neu setzen."
        );
      } else {
        showError("Falsches Passwort · versuch's nochmal.");
      }
      return;
    }
    resetSubmitBtn();
    auth.login(selected, { isGuest: false, loginKind: r.kind, token: r.token });
    $("loginDialog").close();
  } catch (err) {
    console.error("Login fehlgeschlagen", err);
    showError("Anmeldung nicht möglich – Verbindung prüfen und nochmal versuchen.");
  }
});

/* Guard helper: prüft Auth, zeigt sonst Hinweis */
function requireAuth(actionName = "Diese Aktion") {
  if (auth.isAuthed) return true;
  showToast(`${actionName} ist nur für angemeldete Personen.`, "error");
  openLoginDialog();
  return false;
}

/* Nur WG-Mitglieder (Gäste ausgeschlossen) */
function requireMember(actionName = "Diese Aktion") {
  if (auth.isMember) return true;
  if (auth.isGuest) {
    showToast(`${actionName} ist nur für WG-Mitglieder, nicht für Gäste.`, "error");
    return false;
  }
  showToast(`${actionName} ist nur für angemeldete WG-Mitglieder.`, "error");
  openLoginDialog();
  return false;
}

/* ==========================================================================
   Navigation
   ========================================================================== */

const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
navToggle?.addEventListener("click", () => {
  navToggle.classList.toggle("open");
  navLinks.classList.toggle("open");
});
navLinks?.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    navToggle.classList.remove("open");
    navLinks.classList.remove("open");
  }
});

/* ==========================================================================
   Lightbox
   ========================================================================== */

const lightbox = $("lightbox");
const lightboxImg = $("lightboxImg");
const lightboxCaption = $("lightboxCaption");
const lightboxDelete = $("lightboxDelete");
let lightboxCurrentId = null;

document.querySelector(".lightbox-close")?.addEventListener("click", () => lightbox.close());
lightbox?.addEventListener("click", (e) => {
  if (e.target === lightbox) lightbox.close();
});
lightbox?.addEventListener("close", () => {
  lightboxCurrentId = null;
});

let lightboxCurrentKind = null; // "gallery" | "eventfoto"

function openLightbox({ src, caption = "", id = null, kind = "gallery" }) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightboxCurrentId = id;
  lightboxCurrentKind = kind;
  if (id && auth.isAuthed) {
    lightboxDelete.classList.remove("hidden");
  } else {
    lightboxDelete.classList.add("hidden");
  }
  lightbox.showModal();
}

lightboxDelete?.addEventListener("click", async () => {
  if (!lightboxCurrentId) return;
  if (!requireAuth("Bilder löschen")) return;
  if (!confirm("Bild wirklich löschen?")) return;
  if (lightboxCurrentKind === "eventfoto") {
    await deleteEventFoto(lightboxCurrentId);
  } else {
    await deleteGalleryItem(lightboxCurrentId);
  }
  lightbox.close();
});

/* ==========================================================================
   Bewohner rendern
   ========================================================================== */

/* ==========================================================================
   Haus-Features (Cards)
   ========================================================================== */

const HAUS_FEATURES_DEFAULT = [
  { id: "garten",    emoji: "🌿", title: "Garten mit Trampolin",      text: "Liegewiese, Feuerstelle und ein Trampolin, auf dem wir uns bei jedem Wetter austoben." },
  { id: "wohnzimmer",emoji: "🔥", title: "Wohnzimmer mit Kamin",      text: "Das Herzstück: knisterndes Feuer, grosse Sofas und lange Abende mit Gesprächen bis in die Nacht." },
  { id: "kino",      emoji: "🎬", title: "Kinobereich mit Gästebett", text: "Beamer, Leinwand, viele Kissen – und ein ausziehbares Bett für Gäste, die über Nacht bleiben." },
  { id: "sauna",     emoji: "🧖", title: "Sauna",                      text: "Unsere Wohlfühl-Ecke für kalte Tage und lange Wochenenden. Aufguss inklusive." },
  { id: "jacuzzi",   emoji: "🛁", title: "Jacuzzi",                    text: "Warmes Wasser, perlende Blasen, Sternenhimmel oben drüber – mehr braucht's nicht." },
  { id: "sup",       emoji: "🏄", title: "SUPs",                       text: "Unsere Stand-Up-Paddles warten darauf, aufs Wasser gebracht zu werden – der See ist fast vor der Tür." }
];

let hausbilderCache = {};
let hausfeaturesCache = {};

function getHausFeature(id) {
  const def = HAUS_FEATURES_DEFAULT.find(f => f.id === id) || {};
  const custom = hausfeaturesCache[id] || {};
  return {
    id,
    emoji: custom.emoji || def.emoji || "🏠",
    title: custom.title || def.title || id,
    text: custom.text || def.text || ""
  };
}

function getHausFeatures() {
  return HAUS_FEATURES_DEFAULT.map(f => getHausFeature(f.id));
}

function renderHausFeatures() {
  const grid = $("hausGrid");
  if (!grid) return;
  grid.innerHTML = getHausFeatures().map(f => {
    const photo = hausbilderCache[f.id]?.src;
    const hero = photo
      ? `<img class="haus-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(f.title)}" loading="lazy" />`
      : `<div class="card-icon">${f.emoji}</div>`;
    return `
      <div class="haus-card warm ${photo ? 'has-photo' : ''}" data-feature="${f.id}">
        ${hero}
        <h3>${escapeHtml(f.title)}</h3>
        <p>${escapeHtml(f.text)}</p>
        ${auth.isMember ? `
          <div class="haus-card-actions">
            <button class="mini-btn" data-feature="${f.id}" data-action="edit">✏️ Text</button>
            <button class="mini-btn" data-feature="${f.id}" data-action="upload">${photo ? "📷 Ändern" : "📷 Foto"}</button>
            ${photo ? `<button class="mini-btn danger" data-feature="${f.id}" data-action="delete">🗑️</button>` : ""}
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  grid.querySelectorAll("[data-action='upload']").forEach(btn => {
    btn.addEventListener("click", () => uploadHausBild(btn.dataset.feature));
  });
  grid.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Foto wirklich entfernen?")) deleteHausBild(btn.dataset.feature);
    });
  });
  grid.querySelectorAll("[data-action='edit']").forEach(btn => {
    btn.addEventListener("click", () => openHausFeatureEditor(btn.dataset.feature));
  });
}

async function uploadHausBild(featureId) {
  if (!requireMember("Haus-Bilder ändern")) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 1200);
      const sizeBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (sizeBytes > MAX_IMAGE_BYTES) {
        showToast(`Bild zu gross (${Math.round(sizeBytes/1024)} KB). Bitte verkleinern.`, "error");
        return;
      }
      const payload = { src: dataUrl, updatedBy: auth.member, updatedAt: Date.now() };
      if (firebaseReady) {
        await setDoc(doc(db, "hausbilder", featureId), { ...payload, updatedAt: serverTimestamp() });
      }
      localStore.hausbilder = localStore.hausbilder || {};
      localStore.hausbilder[featureId] = payload;
      hausbilderCache[featureId] = payload;
      saveLocal("hausbilder", localStore.hausbilder);
      renderHausFeatures();
      showToast("Foto gespeichert.", "success");
    } catch (err) {
      console.error(err);
      showToast("Foto-Upload fehlgeschlagen.", "error");
    }
  });
  input.click();
}

async function deleteHausBild(featureId) {
  if (!requireMember("Foto entfernen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "hausbilder", featureId)); }
    catch (e) { showToast("Entfernen fehlgeschlagen.", "error"); return; }
  }
  if (localStore.hausbilder) delete localStore.hausbilder[featureId];
  delete hausbilderCache[featureId];
  saveLocal("hausbilder", localStore.hausbilder || {});
  renderHausFeatures();
  showToast("Foto entfernt.", "success");
}

function openHausFeatureEditor(featureId) {
  if (!requireMember("Feature bearbeiten")) return;
  const f = getHausFeature(featureId);
  
  const dialog = document.createElement("dialog");
  dialog.className = "auth-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="auth-form" style="max-width:500px;">
      <h2 class="auth-title">✏️ ${escapeHtml(f.emoji)} ${escapeHtml(f.title)} bearbeiten</h2>
      <div class="form-row">
        <label for="featureEmoji">Emoji</label>
        <input id="featureEmoji" type="text" value="${escapeAttr(f.emoji)}" maxlength="4" style="width:60px;font-size:1.5rem;text-align:center;" />
      </div>
      <div class="form-row">
        <label for="featureTitle">Titel</label>
        <input id="featureTitle" type="text" value="${escapeAttr(f.title)}" maxlength="50" required />
      </div>
      <div class="form-row">
        <label for="featureText">Beschreibung</label>
        <textarea id="featureText" rows="4" maxlength="500" style="resize:vertical;">${escapeHtml(f.text)}</textarea>
      </div>
      <div class="auth-btns">
        <button type="button" class="btn-secondary" id="featureCancelBtn">Abbrechen</button>
        <button type="submit" class="btn-primary">💾 Speichern</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  
  dialog.querySelector("#featureCancelBtn").addEventListener("click", () => {
    dialog.close();
    dialog.remove();
  });
  
  dialog.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const emoji = dialog.querySelector("#featureEmoji").value.trim() || f.emoji;
    const title = dialog.querySelector("#featureTitle").value.trim();
    const text = dialog.querySelector("#featureText").value.trim();
    
    if (!title) {
      showToast("Titel darf nicht leer sein.", "error");
      return;
    }
    
    try {
      const payload = { emoji, title, text, updatedBy: auth.member, updatedAt: Date.now() };
      if (firebaseReady) {
        await setDoc(doc(db, "hausfeatures", featureId), { ...payload, updatedAt: serverTimestamp() }, { merge: true });
      }
      localStore.hausfeatures = localStore.hausfeatures || {};
      localStore.hausfeatures[featureId] = payload;
      hausfeaturesCache[featureId] = payload;
      saveLocal("hausfeatures", localStore.hausfeatures);
      renderHausFeatures();
      showToast("Gespeichert!", "success");
      dialog.close();
      dialog.remove();
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  });
  
  dialog.showModal();
}

/* ==========================================================================
   Bewohner-Fotos Cache
   ========================================================================== */

let bewohnerfotosCache = {};
let bewohnertexteCache = {};

function getBewohnerText(name) {
  const override = bewohnertexteCache[name] || {};
  const base = BEWOHNER.find(b => b.name === name) || {};
  return {
    role: override.role ?? base.role ?? "",
    bio: override.bio ?? base.bio ?? "",
    longBio: override.longBio ?? "",
    hobby: override.hobby ?? "",
    food: override.food ?? "",
    motto: override.motto ?? "",
    link: override.link ?? "",
  };
}

function escapeAttr(s) { return escapeHtml(String(s || "")); }
function normalizeUrl(u) {
  if (!u) return "";
  try {
    const s = String(u).trim();
    if (!s) return "";
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    return "https://" + s;
  } catch { return ""; }
}

function renderBewohner() {
  const grid = $("bewohnerGrid");
  if (!grid) return;
  const people = getActiveBewohner();
  const cardsHtml = people.map(b => {
    const photo = bewohnerfotosCache[b.name]?.src;
    const text = getBewohnerText(b.name);
    const hasMore = !!(text.longBio || text.hobby || text.food || text.motto || text.link);
    const dlabel = mLabel(b.name);
    const avatarInner = photo
      ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" />`
      : `<span class="avatar-emoji">${mEmoji(b.name)}</span>`;
    return `
      <article class="bewohner-card ${b.kid ? 'is-kid' : ''}" data-name="${escapeHtml(b.name)}" tabindex="0" role="button" aria-label="Profil von ${escapeHtml(dlabel)} öffnen">
        <div class="bewohner-avatar">
          ${avatarInner}
          ${auth.isMember ? `
            <button class="avatar-edit" data-name="${escapeHtml(b.name)}" title="Foto ändern" aria-label="Foto ändern">📷</button>
          ` : ""}
          ${hasMore ? `<span class="profile-indicator" title="Ausführliches Profil">👤</span>` : ""}
        </div>
        <div class="bewohner-info">
          <h3>
            ${escapeHtml(dlabel)}
            ${b.kid ? '<span class="kid-badge" title="Jüngstes Mitglied">Kid</span>' : ''}
          </h3>
          <span class="bewohner-role">${escapeHtml(text.role)}</span>
          <p class="bewohner-bio">${escapeHtml(text.bio)}</p>
          <span class="bewohner-open-hint">Tippen für Profil →</span>
        </div>
      </article>
    `;
  }).join("");

  // Handy: kompakte Liste zum Antippen (Profil öffnet sich erst dann)
  const mobileListHtml = people.map(b => {
    const photo = bewohnerfotosCache[b.name]?.src;
    const text = getBewohnerText(b.name);
    const dlabel = mLabel(b.name);
    const thumb = photo
      ? `<img src="${escapeHtml(photo)}" alt="" loading="lazy" />`
      : `<span class="avatar-emoji">${mEmoji(b.name)}</span>`;
    return `
      <button type="button" class="bewohner-row" data-name="${escapeHtml(b.name)}" aria-label="Profil von ${escapeHtml(dlabel)} öffnen">
        <span class="bewohner-row-avatar">${thumb}</span>
        <span class="bewohner-row-text">
          <span class="bewohner-row-name">${escapeHtml(dlabel)}${b.kid ? ' <span class="kid-badge">Kid</span>' : ''}</span>
          <span class="bewohner-row-role">${escapeHtml(text.role)}</span>
        </span>
        <span class="bewohner-row-chevron" aria-hidden="true">›</span>
      </button>
    `;
  }).join("");

  grid.innerHTML = `
    <div class="bewohner-mobile-list" role="list">${mobileListHtml}</div>
    <div class="bewohner-desktop-grid">${cardsHtml}</div>
  `;
  $("statBewohner").textContent = String(people.length);

  grid.querySelectorAll(".avatar-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      uploadBewohnerFoto(btn.dataset.name);
    });
  });
  const openFrom = (el) => {
    const name = el?.dataset?.name;
    if (name) openBewohnerProfile(name);
  };
  grid.querySelectorAll(".bewohner-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openFrom(card);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFrom(card); }
    });
  });
  grid.querySelectorAll(".bewohner-row").forEach(row => {
    row.addEventListener("click", () => openFrom(row));
  });
}

function openBewohnerProfile(name) {
  const dlg = $("bewohnerProfileDialog");
  if (!dlg) return;
  renderBewohnerProfileView(name);
  setBewohnerProfileMode("view");
  try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
}

function setBewohnerProfileMode(mode) {
  const view = $("profileView");
  const edit = $("bewohnerTextForm");
  if (!view || !edit) return;
  if (mode === "edit") { view.hidden = true; edit.hidden = false; }
  else { view.hidden = false; edit.hidden = true; }
}

function renderBewohnerProfileView(name) {
  const base = BEWOHNER.find(b => b.name === name);
  if (!base) return;
  const text = getBewohnerText(name);
  const photo = bewohnerfotosCache[name]?.src;
  const avatar = photo
    ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(mLabel(name))}" />`
    : `<span class="avatar-emoji">${mEmoji(name)}</span>`;
  $("profileAvatar").innerHTML = avatar;
  $("profileName").textContent = mLabel(name) + (base.kid ? " 👶" : "");
  $("profileRole").textContent = text.role;
  $("profileBio").textContent = text.bio;

  const sections = [];
  if (text.longBio) sections.push(`<div class="profile-section profile-long"><h4>Über mich</h4><p>${escapeHtml(text.longBio).replace(/\n/g, "<br>")}</p></div>`);
  if (text.hobby) sections.push(`<div class="profile-section"><h4>🎨 Hobby</h4><p>${escapeHtml(text.hobby)}</p></div>`);
  if (text.food) sections.push(`<div class="profile-section"><h4>🍴 Lieblingsessen</h4><p>${escapeHtml(text.food)}</p></div>`);
  if (text.motto) sections.push(`<div class="profile-section profile-motto"><h4>💬 Motto</h4><p>„${escapeHtml(text.motto)}"</p></div>`);
  if (text.link) {
    const url = normalizeUrl(text.link);
    sections.push(`<div class="profile-section"><h4>🔗 Link</h4><p><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.link)}</a></p></div>`);
  }
  if (!sections.length) {
    sections.push(`<div class="profile-empty">${auth.isMember ? "Noch kein ausführliches Profil. Klick auf „Profil bearbeiten“ um was zu erzählen." : `${escapeHtml(mLabel(name))} hat hier noch kein ausführliches Profil hinterlegt.`}</div>`);
  }
  $("profileSections").innerHTML = sections.join("");

  const editBtn = $("profileEditBtn");
  if (editBtn) {
    editBtn.hidden = !auth.isMember;
    editBtn.onclick = () => openBewohnerEditMode(name);
  }
}

function openBewohnerEditMode(name) {
  if (!requireMember("Profil bearbeiten")) return;
  const text = getBewohnerText(name);
  $("bewohnerTextTarget").value = name;
  $("bewohnerTextName").textContent = name;
  $("bewohnerTextRole").value = text.role || "";
  $("bewohnerTextBio").value = text.bio || "";
  $("bewohnerTextLong").value = text.longBio || "";
  $("bewohnerTextHobby").value = text.hobby || "";
  $("bewohnerTextFood").value = text.food || "";
  $("bewohnerTextMotto").value = text.motto || "";
  $("bewohnerTextLink").value = text.link || "";
  setBewohnerProfileMode("edit");
}

async function saveBewohnerText(name, payload) {
  // Optimistisches Update – sofort im UI zeigen
  bewohnertexteCache = { ...(bewohnertexteCache || {}), [name]: { ...payload, updatedAt: Date.now() } };
  renderBewohner();

  if (firebaseReady) {
    try {
      await setDoc(doc(db, "bewohnertexte", name), { ...payload, updatedBy: auth.member || null, updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error("saveBewohnerText:", e);
      const msg = (e?.code === "permission-denied")
        ? "Keine Berechtigung. Bitte firestore.rules in Firebase deployen (Collection: bewohnertexte)."
        : `Speichern fehlgeschlagen: ${e?.message || e?.code || "Unbekannt"}`;
      showToast(msg, "error");
      return false;
    }
  } else {
    localStore.bewohnertexte[name] = { ...payload, updatedAt: Date.now() };
    saveLocal("bewohnertexte", localStore.bewohnertexte);
  }
  return true;
}

async function resetBewohnerText(name) {
  if (bewohnertexteCache && bewohnertexteCache[name]) {
    const copy = { ...bewohnertexteCache };
    delete copy[name];
    bewohnertexteCache = copy;
    renderBewohner();
  }
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "bewohnertexte", name)); }
    catch (e) {
      console.error("resetBewohnerText:", e);
      const msg = (e?.code === "permission-denied")
        ? "Keine Berechtigung. Bitte firestore.rules deployen."
        : `Zurücksetzen fehlgeschlagen: ${e?.message || e?.code || "Unbekannt"}`;
      showToast(msg, "error");
      return false;
    }
  } else {
    delete localStore.bewohnertexte[name];
    saveLocal("bewohnertexte", localStore.bewohnertexte);
  }
  return true;
}

$("bewohnerTextForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Profil speichern")) return;
  const name = $("bewohnerTextTarget").value;
  if (!name) return;
  const payload = {
    role: $("bewohnerTextRole").value.trim(),
    bio: $("bewohnerTextBio").value.trim(),
    longBio: $("bewohnerTextLong").value.trim(),
    hobby: $("bewohnerTextHobby").value.trim(),
    food: $("bewohnerTextFood").value.trim(),
    motto: $("bewohnerTextMotto").value.trim(),
    link: $("bewohnerTextLink").value.trim(),
  };
  const allEmpty = Object.values(payload).every(v => !v);
  if (allEmpty) {
    if (await resetBewohnerText(name)) {
      renderBewohnerProfileView(name);
      setBewohnerProfileMode("view");
      showToast("Profil zurückgesetzt.", "success");
    }
    return;
  }
  if (await saveBewohnerText(name, payload)) {
    renderBewohnerProfileView(name);
    setBewohnerProfileMode("view");
    showToast("Profil gespeichert. ✨", "success");
  }
});

$("profileEditCancel")?.addEventListener("click", () => {
  const name = $("bewohnerTextTarget").value;
  if (name) renderBewohnerProfileView(name);
  setBewohnerProfileMode("view");
});

$("profileClose")?.addEventListener("click", () => $("bewohnerProfileDialog").close());
$("profileCloseBtn")?.addEventListener("click", () => $("bewohnerProfileDialog").close());
$("bewohnerProfileDialog")?.addEventListener("click", (e) => {
  if (e.target === $("bewohnerProfileDialog")) $("bewohnerProfileDialog").close();
});

$("bewohnerTextReset")?.addEventListener("click", async () => {
  if (!requireMember("Zurücksetzen")) return;
  const name = $("bewohnerTextTarget").value;
  if (!name) return;
  if (!confirm(`Profil für ${name} auf Original zurücksetzen?`)) return;
  if (await resetBewohnerText(name)) {
    renderBewohnerProfileView(name);
    setBewohnerProfileMode("view");
    showToast("Zurückgesetzt.", "success");
  }
});

async function uploadBewohnerFoto(name) {
  if (!requireMember("Bewohner-Fotos ändern")) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 600); // kleiner für Avatar
      const sizeBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (sizeBytes > MAX_IMAGE_BYTES) {
        showToast(`Bild zu gross (${Math.round(sizeBytes/1024)} KB).`, "error");
        return;
      }
      const payload = { src: dataUrl, updatedBy: auth.member, updatedAt: Date.now() };
      if (firebaseReady) {
        await setDoc(doc(db, "bewohnerfotos", name), { ...payload, updatedAt: serverTimestamp() });
      } else {
        localStore.bewohnerfotos[name] = payload;
        bewohnerfotosCache = localStore.bewohnerfotos;
        saveLocal("bewohnerfotos", localStore.bewohnerfotos);
        renderBewohner();
      }
      showToast(`Foto für ${name} aktualisiert.`, "success");
    } catch (err) {
      console.error(err);
      const msg = err?.code === "invalid-argument" || String(err?.message || "").toLowerCase().includes("exceeds")
        ? "Bild ist nach dem Schneiden noch zu gross fürs Speichern (max. 1 MB pro Dokument). Wähle ein kleineres Original."
        : "Foto-Upload fehlgeschlagen.";
      showToast(msg, "error");
    }
  });
  input.click();
}

async function deleteBewohnerFoto(name) {
  if (!requireMember("Foto entfernen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "bewohnerfotos", name)); }
    catch (e) { showToast("Entfernen fehlgeschlagen.", "error"); return; }
  } else {
    delete localStore.bewohnerfotos[name];
    bewohnerfotosCache = localStore.bewohnerfotos;
    saveLocal("bewohnerfotos", localStore.bewohnerfotos);
    renderBewohner();
  }
  showToast("Foto entfernt.", "success");
}

/* ==========================================================================
   Galerie (Editor + Lightbox)
   ========================================================================== */

const DEFAULT_GALLERY = [
  { id: "default_1", src: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80", caption: "Sonnenuntergang" },
  { id: "default_2", src: "https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=800&q=80", caption: "Holzhütte" },
  { id: "default_3", src: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80", caption: "Boot auf dem See" },
  { id: "default_4", src: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80", caption: "Morgennebel" },
  { id: "default_5", src: "https://images.unsplash.com/photo-1530982011887-3cc11cc85693?w=800&q=80", caption: "Lagerfeuer im Garten" },
  { id: "default_6", src: "https://images.unsplash.com/photo-1502781252888-9143ba7f074e?w=1200&q=80", caption: "Abendstimmung" }
];

let galerieCache = [];
let galerieFirestoreSynced = false;

function renderGallery() {
  const grid = $("gallery");
  if (!grid) return;
  const userImages = [...galerieCache].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // Beim Firebase-Laden: kein Unsplash-Flash – erst echte Daten oder Ladehinweis
  if (firebaseReady && !userImages.length && !galerieFirestoreSynced) {
    grid.innerHTML = `<div class="empty-state gallery-loading"><span class="spinner"></span> Galerie wird geladen…</div>`;
    return;
  }
  const images = userImages.length > 0 ? userImages : (!firebaseReady ? DEFAULT_GALLERY : []);
  if (!images.length) {
    grid.innerHTML = `<div class="empty-state">Noch keine Bilder in der Galerie.</div>`;
    return;
  }

  grid.innerHTML = images.map(img => `
    <div class="gallery-item" data-src="${escapeHtml(img.src)}" data-id="${escapeHtml(img.id)}" data-caption="${escapeHtml(img.caption || "")}">
      <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.caption || "Haus am See")}" loading="lazy" />
      ${img.caption ? `<div class="gallery-caption">${escapeHtml(img.caption)}</div>` : ""}
    </div>
  `).join("");

  grid.querySelectorAll(".gallery-item").forEach(item => {
    item.addEventListener("click", () => {
      const id = item.dataset.id;
      const isUserImage = !id.startsWith("default_");
      openLightbox({
        src: item.dataset.src,
        caption: item.dataset.caption,
        id: isUserImage ? id : null
      });
    });
  });
}

/* Galerie-Upload */
$("galleryAddBtn")?.addEventListener("click", () => {
  if (!requireAuth("Bilder hinzufügen")) return;
  $("galleryFileInput").click();
});

$("galleryFileInput")?.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;
  if (!requireAuth("Bilder hinzufügen")) return;

  // Progress UI
  const progress = document.createElement("div");
  progress.className = "upload-progress";
  progress.innerHTML = `<span class="spinner"></span><span>Lade 0 / ${files.length} …</span>`;
  document.body.appendChild(progress);

  let success = 0;
  for (let i = 0; i < files.length; i++) {
    progress.querySelector("span:last-child").textContent = `Lade ${i + 1} / ${files.length} …`;
    try {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await resizeImage(file);
      const sizeBytes = Math.ceil((dataUrl.length * 3) / 4);
      if (sizeBytes > MAX_IMAGE_BYTES) {
        showToast(`Bild "${file.name}" zu gross (${Math.round(sizeBytes/1024)} KB).`, "error");
        continue;
      }
      const caption = prompt(`Kurze Beschriftung für "${file.name}" (optional):`, "") || "";
      const entry = {
        src: dataUrl,
        caption: caption.trim(),
        addedBy: auth.member,
        createdAt: Date.now()
      };
      if (firebaseReady) {
        await addDoc(collection(db, "galerie"), { ...entry, createdAt: serverTimestamp() });
      } else {
        entry.id = "local_" + Date.now() + "_" + i;
        localStore.galerie.unshift(entry);
        galerieCache = localStore.galerie;
        saveLocal("galerie", localStore.galerie);
        renderGallery();
      }
      success++;
    } catch (err) {
      console.error(err);
      showToast(`Fehler bei "${files[i].name}".`, "error");
    }
  }

  progress.remove();
  if (success > 0) showToast(`${success} Bild${success > 1 ? "er" : ""} hinzugefügt.`, "success");
});

async function deleteGalleryItem(id) {
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "galerie", id)); showToast("Bild gelöscht.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.galerie = localStore.galerie.filter(g => g.id !== id);
    galerieCache = localStore.galerie;
    saveLocal("galerie", localStore.galerie);
    renderGallery();
    showToast("Bild gelöscht.", "success");
  }
}

function resizeImage(file, maxDim = MAX_IMAGE_DIM, quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   Events
   ========================================================================== */

let eventsCache = [];
let anmeldungenCache = [];

function renderEvents() {
  const list = $("eventsList");
  if (!list) return;
  const today = new Date(new Date().setHours(0,0,0,0));
  const upcoming = eventsCache
    .filter(e => new Date(e.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const past = eventsCache
    .filter(e => new Date(e.date) < today)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const upcomingHtml = upcoming.length
    ? upcoming.map(ev => renderEventCard(ev, false)).join("")
    : `<div class="empty-state">Gerade kein Event geplant – aber das ändert sich schnell 🫖</div>`;

  // Vergangene Events nur anzeigen wenn eingeloggt (Partybilder sind privat)
  const pastHtml = (auth.isAuthed && past.length)
    ? `
      <h3 class="events-divider">📸 Erinnerungen & Partybilder</h3>
      ${past.map(ev => renderEventCard(ev, true)).join("")}
    ` : "";

  list.innerHTML = upcomingHtml + pastHtml;

  list.querySelectorAll(".event-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireAuth("Events löschen")) return;
      if (confirm("Event wirklich löschen?")) deleteEvent(btn.dataset.id);
    });
  });
  list.querySelectorAll(".event-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireAuth("Events bearbeiten")) return;
      startEditEvent(btn.dataset.id);
    });
  });
  list.querySelectorAll(".event-fotos-add").forEach(btn => {
    btn.addEventListener("click", () => uploadEventFotos(btn.dataset.id));
  });
  list.querySelectorAll(".event-foto").forEach(el => {
    el.addEventListener("click", () => {
      openLightbox({
        src: el.dataset.src,
        caption: el.dataset.caption || "",
        id: el.dataset.id,
        kind: "eventfoto"
      });
    });
  });

  // Anmelde-Formulare
  list.querySelectorAll(".signup-form").forEach(form => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSignupSubmit(form.dataset.eventid, form);
    });
  });
  list.querySelectorAll(".signup-remove").forEach(btn => {
    btn.addEventListener("click", () => removeOwnSignup(btn.dataset.id, btn.dataset.eventid));
  });
  list.querySelectorAll(".signup-match").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireAuth("Paare zuweisen")) return;
      matchSignups(btn.dataset.eventid);
    });
  });
  list.querySelectorAll("[data-flyer]").forEach(el => {
    const open = () => {
      const ev = eventsCache.find(x => x.id === el.dataset.flyer);
      if (ev?.flyerSrc) openLightbox({ src: ev.flyerSrc, caption: `📄 ${ev.title}` });
    };
    el.addEventListener("click", open);
    if (el.tagName === "DIV") {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
    }
  });
  list.querySelectorAll(".event-share-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ev = eventsCache.find(x => x.id === btn.dataset.id);
      if (!ev) return;
      if (btn.dataset.action === "ical") downloadEventIcs(ev);
      else if (btn.dataset.action === "share") shareEvent(ev);
    });
  });
  list.querySelectorAll(".event-bring-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void submitEventBring(form.dataset.eventid, form);
    });
  });
  list.querySelectorAll(".bring-change-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest("li");
      const panel = li?.querySelector(".bring-change-panel");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('input[name="item"]')?.focus();
    });
  });
  list.querySelectorAll(".bring-change-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void changeEventBring(form.dataset.id, form);
    });
  });
  list.querySelectorAll(".bring-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      void deleteEventBring(btn.dataset.id);
    });
  });
  bindIconPickers(list);

  $("statEvents").textContent = upcoming.length;
  void hydrateEventWeather();
}

let eventBringCache = [];

/** Lustige Icons für Anmeldung & Mitbringen – bewusst viele */
const PARTY_ICONS = [
  "🥳","😎","🤩","🤪","😜","🥸","🤓","😇","😈","👻","💀","👽","🤖","💩","🤡","🥶","🥵","🥴","😵‍💫","🫠",
  "🙈","🙉","🙊","🐵","🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐔","🐧",
  "🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲","🪳",
  "🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋",
  "🦈","🐊","🐅","🐆","🦓","🦍","🦧","🦣","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎",
  "🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐈","🪶","🐉","🐲","🌵","🎄","🌲","🌳","🌴","🌱","🌿",
  "☘️","🍀","🎍","🪴","🎋","🍃","🍂","🍁","🍄","🐚","🪸","🪨","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼",
  "🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","⭐","🌟","✨","⚡","🔥","💥",
  "☄️","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","☃️","⛄","🌬️","💨","🌪️","🌫️","🌊",
  "💧","💦","☂️","🍔","🍟","🍕","🌭","🥪","🌮","🌯","🥙","🧆","🥚","🍳","🥞","🧇","🥓","🥩","🍗","🍖",
  "🦴","🌭","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧",
  "🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕","🫖",
  "🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊","🥄","🍴","🍽️","🥣","🥡",
  "🥢","🧂","⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃",
  "🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤼",
  "🤸","⛹️","🤺","🤾","🏌️","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️",
  "🏵️","🎗️","🎫","🎟️","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸",
  "🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩","🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻",
  "🚚","🚛","🚜","🛵","🏍️","🛺","🚔","🚍","🚘","🚖","🛞","✈️","🛩️","🛫","🛬","🪂","💺","🚁","🚟","🚠",
  "🚡","🛰️","🚀","🛸","🛎️","🧳","⏰","🧨","💣","🔮","🪄","🧿","🪬","🪩","🎈","🎉","🎊","🎎","🎏","🎐",
  "🧧","🎀","🎁","🫙","🪄","👑","👒","🎩","🎓","🧢","🪖","⛑️","💄","💍","💎","🔇","🔔","📣","📯","📻",
  "🧀","🥑","🌶️","🧄","🧅","🥕","🌽","🥦","🥒","🥬","🍆","🥔","🍠","🥐","🥖","🫓","🥨","🥯","🥞","🫕",
  "🦦","🦥","🦨","🦡","🦫","🦭","🦩","🦚","🦜","🦢","🦤","🪶","🦔","🐿️","🐀","🐁","🌋","🏝️","🏖️","⛺",
  "🏕️","🏡","🏠","🛖","🏰","🗼","🗽","🗿","⛲","⛺","🌃","🌆","🌇","🌉","♨️","💈","🎪","🎢","🎡","🎠",
];

function getPreferredPartyIcon() {
  try {
    const saved = localStorage.getItem("partyIcon");
    if (saved && PARTY_ICONS.includes(saved)) return saved;
  } catch { /* ignore */ }
  return PARTY_ICONS[Math.floor(Math.random() * PARTY_ICONS.length)] || "🥳";
}

function rememberPartyIcon(icon) {
  if (!icon) return;
  try { localStorage.setItem("partyIcon", icon); } catch { /* ignore */ }
}

function normalizePartyIcon(icon) {
  const s = String(icon || "").trim();
  if (s && (PARTY_ICONS.includes(s) || [...s].length <= 4)) return s.slice(0, 8);
  return getPreferredPartyIcon();
}

function readFormIcon(form) {
  return normalizePartyIcon(form?.querySelector('input[name="icon"]')?.value);
}

function renderIconPicker(selected) {
  const cur = normalizePartyIcon(selected || getPreferredPartyIcon());
  const opts = PARTY_ICONS.map(
    (e) =>
      `<button type="button" class="icon-opt${e === cur ? " is-selected" : ""}" data-icon="${e}" aria-label="Icon ${e}">${e}</button>`
  ).join("");
  return `
    <div class="icon-picker" data-icon-picker>
      <input type="hidden" name="icon" value="${escapeHtml(cur)}" />
      <button type="button" class="icon-picker-toggle" aria-expanded="false">
        <span class="icon-picker-current" aria-hidden="true">${cur}</span>
        <span class="icon-picker-label">Icon wählen</span>
      </button>
      <div class="icon-picker-grid" hidden role="listbox" aria-label="Lustige Icons">
        ${opts}
      </div>
    </div>`;
}

function bindIconPickers(root) {
  if (!root) return;
  root.querySelectorAll("[data-icon-picker]").forEach((picker) => {
    if (picker.dataset.bound === "1") return;
    picker.dataset.bound = "1";
    const hidden = picker.querySelector('input[name="icon"]');
    const toggle = picker.querySelector(".icon-picker-toggle");
    const grid = picker.querySelector(".icon-picker-grid");
    const current = picker.querySelector(".icon-picker-current");
    if (!hidden || !toggle || !grid) return;
    toggle.addEventListener("click", () => {
      const willOpen = grid.hidden;
      // andere Pickers schliessen
      root.querySelectorAll(".icon-picker-grid").forEach((g) => {
        if (g !== grid) g.hidden = true;
      });
      root.querySelectorAll(".icon-picker-toggle").forEach((t) => {
        if (t !== toggle) t.setAttribute("aria-expanded", "false");
      });
      grid.hidden = !willOpen;
      toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".icon-opt");
      if (!btn) return;
      const icon = btn.dataset.icon;
      hidden.value = icon;
      if (current) current.textContent = icon;
      grid.querySelectorAll(".icon-opt").forEach((b) => b.classList.toggle("is-selected", b === btn));
      rememberPartyIcon(icon);
      grid.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function eventBringForEvent(eventId) {
  return eventBringCache.filter((x) => x.eventId === eventId);
}

function normalizeBringWho(who) {
  return String(who || "").trim().toLowerCase();
}

function formatBringItemHtml(entry) {
  const struck = Array.isArray(entry.struckItems) ? entry.struckItems : [];
  const struckHtml = struck
    .map(
      (s) =>
        `<span class="bring-struck"><span class="bring-struck-text">${escapeHtml(s)}</span></span>`
    )
    .join("");
  return `${struckHtml}<span class="bring-current">${escapeHtml(entry.item || "")}</span>`;
}

function bringInitials(who) {
  const parts = String(who || "?").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function bringAvatarTone(who) {
  const s = normalizeBringWho(who);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * (i + 1)) % 4;
  return ["tone-lake", "tone-moss", "tone-sun", "tone-coral"][h];
}

function renderPersonAvatar(who, icon) {
  if (icon) {
    return `<span class="bring-avatar bring-avatar--emoji" aria-hidden="true">${escapeHtml(icon)}</span>`;
  }
  return `<span class="bring-avatar ${bringAvatarTone(who)}" aria-hidden="true">${escapeHtml(bringInitials(who))}</span>`;
}

function renderEventBringBlock(ev) {
  const items = eventBringForEvent(ev.id);
  const listHtml = items.length
    ? `<ul class="event-bring-ul">${items.map((x) =>
        `<li class="bring-item" data-id="${escapeHtml(x.id)}">
          <div class="bring-item-main">
            ${renderPersonAvatar(x.who, x.icon)}
            <span class="bring-line">
              <span class="bring-who">${escapeHtml(x.who || "?")}</span>
              <span class="bring-stuff">${formatBringItemHtml(x)}</span>
            </span>
            <span class="bring-actions">
              <button type="button" class="bring-change-btn" title="Eintrag bearbeiten">Ändern</button>
              <button type="button" class="bring-delete-btn" data-id="${escapeHtml(x.id)}" title="Eintrag löschen">×</button>
            </span>
          </div>
          <div class="bring-change-panel" hidden>
            <form class="bring-change-form" data-id="${escapeHtml(x.id)}">
              ${renderIconPicker(x.icon || getPreferredPartyIcon())}
              <input type="text" name="who" value="${escapeHtml(x.who || "")}" placeholder="Name" maxlength="60" required />
              <input type="text" name="item" value="${escapeHtml(x.item || "")}" placeholder="Mitbringsel…" maxlength="120" required />
              <label class="bring-strike-opt">
                <input type="checkbox" name="strike" />
                <span>Altes durchstreichen</span>
              </label>
              <button type="submit" class="btn btn-primary small">Ändern</button>
            </form>
          </div>
        </li>`
      ).join("")}</ul>`
    : `<p class="form-note small">Noch niemand eingetragen – trag dich ein und mach den Sommer bunt.</p>`;
  const whoField = auth.isAuthed
    ? `<input type="hidden" name="who" value="${escapeHtml(auth.member || "")}" />`
    : `<input type="text" name="who" placeholder="Dein Name" maxlength="60" autocomplete="name" required />`;
  return `
    <details class="event-bring">
      <summary>🥗 Wer bringt was · ${items.length}</summary>
      ${listHtml}
      <form class="event-bring-form inline" data-eventid="${escapeHtml(ev.id)}">
        ${renderIconPicker(getPreferredPartyIcon())}
        ${whoField}
        <input type="text" name="item" placeholder="z. B. Salat oder Vodka Melone" maxlength="120" required />
        <button type="submit" class="btn btn-primary small">Eintragen</button>
      </form>
      <p class="form-note small">Planänderung: Häkchen bei „Altes durchstreichen“ oder nochmal mit gleichem Namen. WhatsApp: <em>Mitbringen ${escapeHtml(ev.title)}: Salat</em></p>
    </details>`;
}

async function applyBringPlanChange(entryId, newItem) {
  const entry = eventBringCache.find((x) => x.id === entryId);
  if (!entry) throw new Error("Eintrag nicht gefunden");
  const next = String(newItem || "").trim().slice(0, 120);
  if (!next) throw new Error("Bitte neues Mitbringsel angeben");
  if (normalizeBringWho(next) === normalizeBringWho(entry.item)) {
    throw new Error("Das steht schon so da.");
  }
  const struck = Array.isArray(entry.struckItems) ? [...entry.struckItems] : [];
  if (entry.item) struck.push(String(entry.item).slice(0, 120));
  const struckItems = struck.slice(-6);
  await updateDoc(doc(db, "eventBring", entryId), {
    item: next,
    struckItems,
    updatedAt: serverTimestamp(),
  });
}

async function submitEventBring(eventId, form) {
  const itemInput = form.querySelector('input[name="item"]');
  const whoInput = form.querySelector('input[name="who"]');
  const item = String(itemInput?.value || "").trim().slice(0, 120);
  const who = String(whoInput?.value || auth.member || "").trim().slice(0, 60);
  if (!item) return;
  if (!who) {
    showToast("Bitte Namen eintragen.", "error");
    return;
  }
  const ev = eventsCache.find((x) => x.id === eventId);
  if (!ev) return;
  if (!firebaseReady) {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
    return;
  }
  try {
    const existing = eventBringForEvent(eventId).find(
      (x) => normalizeBringWho(x.who) === normalizeBringWho(who)
    );
    const icon = readFormIcon(form);
    if (existing) {
      await applyBringPlanChange(existing.id, item);
      await updateDoc(doc(db, "eventBring", existing.id), { icon, who });
      rememberPartyIcon(icon);
      if (itemInput) itemInput.value = "";
      showToast("Planänderung notiert ✏️", "success");
      return;
    }
    await addDoc(collection(db, "eventBring"), {
      eventId,
      eventTitle: ev.title || "",
      who,
      item,
      icon,
      struckItems: [],
      createdAt: serverTimestamp(),
    });
    rememberPartyIcon(icon);
    if (itemInput) itemInput.value = "";
    if (whoInput && whoInput.type !== "hidden") whoInput.value = "";
    showToast("Eingetragen.", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Speichern fehlgeschlagen.", "error");
  }
}

async function changeEventBring(entryId, form) {
  const who = String(form.querySelector('input[name="who"]')?.value || "").trim().slice(0, 60);
  const item = String(form.querySelector('input[name="item"]')?.value || "").trim().slice(0, 120);
  const icon = readFormIcon(form);
  const strike = !!form.querySelector('input[name="strike"]')?.checked;
  if (!who) {
    showToast("Bitte Namen eintragen.", "error");
    return;
  }
  if (!item) {
    showToast("Bitte Mitbringsel angeben.", "error");
    return;
  }
  if (!firebaseReady) {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
    return;
  }
  try {
    const entry = eventBringCache.find((x) => x.id === entryId);
    if (!entry) throw new Error("Eintrag nicht gefunden");
    const itemChanged = normalizeBringWho(item) !== normalizeBringWho(entry.item);
    if (strike && itemChanged) {
      await applyBringPlanChange(entryId, item);
      await updateDoc(doc(db, "eventBring", entryId), { who, icon });
      rememberPartyIcon(icon);
      showToast("Planänderung notiert ✏️", "success");
      return;
    }
    await updateDoc(doc(db, "eventBring", entryId), {
      who,
      item,
      icon,
      updatedAt: serverTimestamp(),
    });
    rememberPartyIcon(icon);
    showToast("Eintrag geändert.", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Ändern fehlgeschlagen.", "error");
  }
}

async function deleteEventBring(entryId) {
  if (!entryId) return;
  if (!confirm("Diesen Mitbringen-Eintrag wirklich löschen?")) return;
  if (!firebaseReady) {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
    return;
  }
  try {
    await deleteDoc(doc(db, "eventBring", entryId));
    showToast("Eintrag gelöscht.", "success");
  } catch (err) {
    console.error(err);
    showToast("Löschen fehlgeschlagen.", "error");
  }
}

function renderEventCard(ev, isPast) {
  const d = new Date(ev.date);
  const fotos = eventfotosCache.filter(f => f.eventId === ev.id);

  const fotosBlock = auth.isAuthed ? `
    <details class="event-fotos" ${fotos.length ? "open" : ""}>
      <summary>📸 Partybilder · ${fotos.length}</summary>
      <div class="event-fotos-grid">
        ${fotos.map(f => `
          <div class="event-foto" data-src="${escapeHtml(f.src)}" data-id="${escapeHtml(f.id)}" data-caption="${escapeHtml(f.caption || '')}">
            <img src="${escapeHtml(f.src)}" alt="${escapeHtml(f.caption || ev.title)}" loading="lazy" />
            ${f.caption ? `<div class="foto-caption">${escapeHtml(f.caption)}</div>` : ""}
          </div>
        `).join("") || `<div class="empty-state small">Noch keine Partybilder für dieses Event.</div>`}
      </div>
      <div class="event-fotos-actions">
        <button class="btn btn-ghost small event-fotos-add" data-id="${ev.id}">⬆️ Bilder hochladen</button>
        <p class="wg-hint">Nur für angemeldete Personen sichtbar · max. 900 KB pro Bild</p>
      </div>
    </details>
  ` : "";

  const signupBlock = !isPast ? renderSignupBlock(ev) : "";
  const bringBlock = !isPast ? renderEventBringBlock(ev) : "";

  const hasFlyer = !!ev.flyerSrc;
  const dateClickable = hasFlyer ? `data-flyer="${ev.id}" role="button" tabindex="0" title="Flyer ansehen"` : "";
  const flyerBadge = hasFlyer ? `<span class="event-flyer-chip">📄</span>` : "";
  const flyerButton = hasFlyer
    ? `<button class="event-flyer-btn" data-flyer="${ev.id}" title="Flyer ansehen">📄 Flyer</button>`
    : "";

  return `
    <article class="event-card ${isPast ? 'is-past' : ''} ${hasFlyer ? 'has-flyer' : ''}">
      <div class="event-date ${hasFlyer ? 'clickable' : ''}" ${dateClickable}>
        <span class="day">${String(d.getDate()).padStart(2,"0")}</span>
        <span class="month">${monthShort[d.getMonth()]}</span>
        <span class="time">${d.toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"})}${(() => {
          const ed = ev.endDate ? new Date(ev.endDate) : null;
          if (!ed || isNaN(ed.getTime()) || ed <= d) return "";
          const sameDay = ed.toDateString() === d.toDateString();
          if (sameDay) return " – " + ed.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
          return "";
        })()}</span>
        ${flyerBadge}
        ${renderEventWeatherBlock(ev, isPast)}
      </div>
      <div class="event-info">
        <h3>${escapeHtml(ev.emoji || "🎉")} ${escapeHtml(ev.title)} ${flyerButton}</h3>
        <div class="event-meta">📍 ${escapeHtml(ev.location || "Haus am See")}</div>
        ${ev.description ? `<p>${escapeHtml(ev.description)}</p>` : ""}
        ${signupBlock}
        ${bringBlock}
        ${fotosBlock}
      </div>
      <div class="event-actions">
        ${!isPast ? `
          <div class="event-share">
            <button class="event-share-btn" data-action="ical" data-id="${ev.id}" title="In Kalender speichern">📅 Kalender</button>
            <button class="event-share-btn" data-action="share" data-id="${ev.id}" title="Event teilen">📤 Teilen</button>
          </div>
        ` : ""}
        ${auth.isMember ? `
          <div class="event-admin">
            <button class="event-edit" data-id="${ev.id}" title="Event bearbeiten">✏️ Bearbeiten</button>
            <button class="event-delete" data-id="${ev.id}">Löschen</button>
          </div>
        ` : ""}
      </div>
    </article>
  `;
}

/* -------- iCal-Export + Teilen -------- */

function pad2(n) { return String(n).padStart(2, "0"); }

function toIcsDate(date) {
  // UTC-Format: YYYYMMDDTHHMMSSZ
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) + "T" +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) + "Z"
  );
}

function icsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  // iCal: Zeilen > 75 Oktetten müssen umgebrochen werden
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function eventPermalink(ev, hash = "events") {
  const base = location.href.split("#")[0];
  return `${base}#${hash}`;
}

/** iCal-Alarme (werden von iPhone-Kalender, Google Calendar etc. als Erinnerung übernommen). */
function appendIcsAlarms(lines, alarms) {
  for (const a of alarms) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:${a.trigger}`,
      foldIcsLine(`DESCRIPTION:${icsEscape(a.description || "Erinnerung Haus am See")}`),
      "END:VALARM"
    );
  }
}

function buildIcs(ev, hash = "events") {
  const start = new Date(ev.date);
  if (isNaN(start.getTime())) return null;
  let end = ev.endDate ? new Date(ev.endDate) : null;
  if (!end || isNaN(end.getTime()) || end <= start) {
    end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  }
  const now = new Date();
  const uid = `${ev.id || "local-" + start.getTime()}@hausamsee`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Haus am See//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    foldIcsLine(`SUMMARY:${icsEscape((ev.emoji ? ev.emoji + " " : "") + ev.title)}`),
    foldIcsLine(`LOCATION:${icsEscape(ev.location || "Haus am See, Pilatusstrasse 40, Pfäffikon ZH")}`),
  ];
  const description = [ev.description || "", eventPermalink(ev, hash)].filter(Boolean).join("\n\n");
  if (description) lines.push(foldIcsLine(`DESCRIPTION:${icsEscape(description)}`));
  lines.push(foldIcsLine(`URL:${eventPermalink(ev, hash)}`));
  const title = (ev.emoji ? ev.emoji + " " : "") + (ev.title || "Termin");
  appendIcsAlarms(lines, [
    { trigger: "-P1D", description: `Morgen: ${title}` },
    { trigger: "-PT2H", description: `In 2 Stunden: ${title}` },
  ]);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadEventIcs(ev, hash = "events") {
  const ics = buildIcs(ev, hash);
  if (!ics) { showToast("Datum ungültig.", "error"); return; }
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `haus-am-see-${(ev.title || "event").replace(/[^a-z0-9äöüß -]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Kalender-Datei mit Erinnerungen heruntergeladen.", "success");
}

function toIcsDateOnly(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
}

function gartenTodoPermalink() {
  return `${location.href.split("#")[0]}#kalender`;
}

function buildGartenTodoIcs(item, slot = {}) {
  let due = gartenTodoNextDueDate(item);
  if (slot.date) {
    const parsed = slot.date instanceof Date ? startOfDayLocal(slot.date) : parseGartenTodoDueISO(slot.date);
    if (parsed) due = parsed;
  }
  if (isNaN(due.getTime())) return null;
  const who = slot.who || item.who || "";
  const y = due.getFullYear();
  const mo = due.getMonth() + 1;
  const da = due.getDate();
  const dtStart = zurichWallToUtcDate(y, mo, da, GARTEN_TODO_WORK_HOUR, GARTEN_TODO_WORK_MINUTE);
  const dtEnd = zurichWallToUtcDate(y, mo, da, GARTEN_TODO_WORK_HOUR, GARTEN_TODO_WORK_MINUTE + 30);
  const now = new Date();
  const roundSuffix = slot.roundIndex != null ? `-r${slot.roundIndex}` : "";
  const uid = `gartentodo-${item.id || due.getTime()}${roundSuffix}@hausamsee`;
  const interval = item.intervalDays || 14;
  const summary = `🌿 ${item.task} – ${mLabel(who)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Haus am See//Garten To-Do//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(dtStart)}`,
    `DTEND:${toIcsDate(dtEnd)}`,
    foldIcsLine(`SUMMARY:${icsEscape(summary)}`),
    foldIcsLine(`LOCATION:${icsEscape("Haus am See, Pilatusstrasse 40, Pfäffikon ZH")}`),
  ];
  const descParts = [
    `Garten To-Do · Zuständig: ${who || "—"}`,
    `Intervall: alle ${interval} Tage`,
  ];
  if (slot.roundIndex != null) descParts.push("Voraussichtliche Rotation (Plan)");
  descParts.push(
    item.reminder
      ? `WhatsApp-Erinnerung: ${reminderEveryDaysLabel(normalizeReminderEveryDays(item.reminderEveryDays, 1))}`
      : "WhatsApp-Erinnerung: aus"
  );
  descParts.push(gartenTodoPermalink());
  lines.push(foldIcsLine(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`));
  lines.push(foldIcsLine(`URL:${gartenTodoPermalink()}`));
  appendIcsAlarms(lines, [
    { trigger: "-P1D", description: `Morgen: ${item.task}` },
    { trigger: "-PT0M", description: `Heute: ${item.task}` },
  ]);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function triggerGartenTodoIcsDownload(ics, item, extraSlug = "") {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = (item.task || "garten")
    .replace(/[^a-z0-9äöüß -]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "garten";
  a.download = `haus-am-see-garten-${base}${extraSlug}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Kalender mit Erinnerungen (morgen + am Tag) – auf dem Handy öffnen.", "success");
}

function downloadGartenTodoIcs(item) {
  const ics = buildGartenTodoIcs(item);
  if (!ics) {
    showToast("Fälligkeitsdatum ungültig.", "error");
    return;
  }
  triggerGartenTodoIcsDownload(ics, item);
}

function downloadGartenTodoRotationIcs(item, dueIso, who, roundIndex) {
  const ics = buildGartenTodoIcs(item, { date: dueIso, who, roundIndex });
  if (!ics) {
    showToast("Termin ungültig.", "error");
    return;
  }
  const dateSlug = (dueIso || "").replace(/-/g, "") || "termin";
  triggerGartenTodoIcsDownload(ics, item, `-${dateSlug}`);
}

function dataUrlToFile(dataUrl, filename) {
  try {
    const [header, base64] = dataUrl.split(",");
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = mime.split("/")[1] || "bin";
    const cleanName = (filename || "flyer").replace(/[^a-z0-9äöüß -]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "flyer";
    return new File([bytes], `${cleanName}.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

function buildShareText(ev, hash = "events") {
  const d = new Date(ev.date);
  const when = d.toLocaleString("de-CH", {
    weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
  });
  const endDate = ev.endDate ? new Date(ev.endDate) : null;
  let whenLine = `🗓️ ${when}`;
  if (endDate && !isNaN(endDate.getTime()) && endDate > d) {
    const sameDay = endDate.toDateString() === d.toDateString();
    const endFmt = sameDay
      ? endDate.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })
      : endDate.toLocaleString("de-CH", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
    whenLine += ` – ${endFmt}`;
  }
  const titleLine = `${ev.emoji || "🎉"} ${ev.title} · Haus am See`;
  const parts = [
    titleLine,
    whenLine,
    `📍 ${ev.location || "Pilatusstrasse 40, Pfäffikon ZH"}`,
  ];
  if (ev.description) parts.push("", ev.description);
  parts.push("", eventPermalink(ev, hash));
  return parts.join("\n");
}

/** Native Share nur auf echtem Mobile – Desktop-Safari hat oft share() ohne brauchbares UI. */
function prefersNativeShare() {
  if (typeof navigator.share !== "function") return false;
  try {
    if (navigator.userAgentData?.mobile === true) return true;
  } catch { /* ignore */ }
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod/i.test(ua)) return true;
  // iPadOS meldet sich oft als Macintosh + Touch
  if (navigator.maxTouchPoints > 1 && /Mac|iPad/i.test(navigator.platform || ua)) return true;
  return false;
}

async function copyTextReliable(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

/**
 * Teilen: Mobile → Share-Sheet; Desktop → Zwischenablage (+ klarer Toast).
 * @returns {"shared"|"copied"|"aborted"|"failed"}
 */
async function shareOrCopy({ title, text, url, files } = {}) {
  const body = String(text || "").trim();
  const link = String(url || "").trim();
  const full = link && !body.includes(link) ? `${body}\n\n${link}` : body || link;
  const textForNative = link
    ? body.replace(new RegExp(`\\n*\\s*${link.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "").trimEnd()
    : body;

  if (prefersNativeShare()) {
    const shareData = { title: title || "Haus am See", text: textForNative || body };
    if (link) shareData.url = link;
    if (files?.length && typeof navigator.canShare === "function") {
      try {
        if (navigator.canShare({ files })) shareData.files = files;
      } catch { /* ignore */ }
    }
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "aborted";
      if (shareData.files) {
        try {
          delete shareData.files;
          await navigator.share(shareData);
          return "shared";
        } catch (err2) {
          if (err2?.name === "AbortError") return "aborted";
        }
      }
    }
  }

  if (await copyTextReliable(full)) {
    showToast("In Zwischenablage kopiert – zum Teilen einfügen.", "success");
    return "copied";
  }
  showToast("Teilen nicht möglich.", "error");
  return "failed";
}

async function shareEvent(ev, hash = "events") {
  const fullText = buildShareText(ev, hash);
  const url = eventPermalink(ev, hash);
  const textWithoutLink = fullText.replace(/\n*\s*https?:\/\/\S+$/, "").trimEnd();
  const files = [];
  if (ev.flyerSrc && typeof ev.flyerSrc === "string" && ev.flyerSrc.startsWith("data:")) {
    const file = dataUrlToFile(ev.flyerSrc, ev.title);
    if (file) files.push(file);
  }
  await shareOrCopy({
    title: `${ev.title} · Haus am See`,
    text: textWithoutLink,
    url,
    files,
  });
}

/* -------- Öffentliche Anmeldeliste -------- */

function getOwnSignupIds(eventId) {
  try {
    return JSON.parse(localStorage.getItem(`anm_${eventId}`) || "[]");
  } catch { return []; }
}
function addOwnSignupId(eventId, id) {
  const ids = getOwnSignupIds(eventId);
  if (!ids.includes(id)) ids.push(id);
  localStorage.setItem(`anm_${eventId}`, JSON.stringify(ids));
}
function removeOwnSignupId(eventId, id) {
  const ids = getOwnSignupIds(eventId).filter(x => x !== id);
  localStorage.setItem(`anm_${eventId}`, JSON.stringify(ids));
}

function renderSignupBlock(ev) {
  const mode = ev.registrationMode || "single";
  if (mode === "none") return "";

  const entries = anmeldungenCache
    .filter(a => a.eventId === ev.id)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const ownIds = new Set(getOwnSignupIds(ev.id));

  if (mode === "pair") {
    const pairs = entries.filter(a => !a.needsPartner && a.partnerName);
    const solos = entries.filter(a => a.needsPartner || !a.partnerName);
    const listHtml = `
      ${pairs.length ? `
        <div class="signup-subhead">👫 Angemeldete Paare · ${pairs.length}</div>
        <ul class="signup-list">
          ${pairs.map(a => `
            <li class="signup-item signup-pair">
              <span class="signup-icon" aria-hidden="true">${escapeHtml(a.icon || "🥳")}</span>
              <span class="signup-names">${escapeHtml(a.name)} <span class="signup-link">🤝</span> ${escapeHtml(a.partnerName)}</span>
              ${ownIds.has(a.id) || auth.isMember
                ? `<button type="button" class="signup-remove" data-id="${a.id}" data-eventid="${ev.id}" title="Anmeldung entfernen">×</button>`
                : ""}
            </li>
          `).join("")}
        </ul>
      ` : ""}
      ${solos.length ? `
        <div class="signup-subhead">🙋 Sucht noch Partner:in · ${solos.length}</div>
        <ul class="signup-list">
          ${solos.map(a => `
            <li class="signup-item signup-solo">
              <span class="signup-icon" aria-hidden="true">${escapeHtml(a.icon || "🥳")}</span>
              <span class="signup-names">${escapeHtml(a.name)}</span>
              ${ownIds.has(a.id) || auth.isMember
                ? `<button type="button" class="signup-remove" data-id="${a.id}" data-eventid="${ev.id}" title="Anmeldung entfernen">×</button>`
                : ""}
            </li>
          `).join("")}
        </ul>
      ` : ""}
      ${!entries.length ? `<div class="empty-state small">Noch niemand angemeldet. Mach den Anfang!</div>` : ""}
    `;
    const matchBtn = (auth.isMember && solos.length >= 2) ? `
      <button type="button" class="btn btn-ghost small signup-match" data-eventid="${ev.id}">🎲 ${solos.length >= 2 ? `${Math.floor(solos.length/2)} Paar${Math.floor(solos.length/2) > 1 ? 'e' : ''} zufällig bilden` : 'Paare zufällig bilden'}</button>
    ` : "";
    return `
      <details class="event-signup">
        <summary>🏁 Anmeldung zum Paar-Lauf · ${entries.length}</summary>
        ${listHtml}
        <form class="signup-form signup-form-pair" data-eventid="${ev.id}">
          ${renderIconPicker(getPreferredPartyIcon())}
          <div class="signup-row">
            <input type="text" name="name" placeholder="Dein Name" autocomplete="off" required />
            <input type="text" name="partnerName" placeholder="Partner:in (oder leer)" autocomplete="off" />
          </div>
          <label class="signup-need-partner">
            <input type="checkbox" name="needsPartner" />
            <span>Partner:in gesucht – bitte später zufällig zuweisen</span>
          </label>
          <div class="signup-actions">
            <button type="submit" class="btn btn-primary small">Anmelden</button>
            ${matchBtn}
          </div>
          <p class="form-note">Zwei Namen = komplettes Paar. Nur dein Name + Häkchen = Partner:in wird später ausgelost.</p>
        </form>
      </details>
    `;
  }

  // single
  return `
    <details class="event-signup">
      <summary>📝 Anmeldeliste · ${entries.length}</summary>
      ${entries.length ? `
        <ul class="signup-list">
          ${entries.map(a => `
            <li class="signup-item">
              <span class="signup-icon" aria-hidden="true">${escapeHtml(a.icon || "🥳")}</span>
              <span class="signup-names">${escapeHtml(a.name)}</span>
              ${ownIds.has(a.id) || auth.isMember
                ? `<button type="button" class="signup-remove" data-id="${a.id}" data-eventid="${ev.id}" title="Anmeldung entfernen">×</button>`
                : ""}
            </li>
          `).join("")}
        </ul>
      ` : `<div class="empty-state small">Noch niemand angemeldet. Mach den Anfang!</div>`}
      <form class="signup-form" data-eventid="${ev.id}">
        ${renderIconPicker(getPreferredPartyIcon())}
        <div class="signup-row">
          <input type="text" name="name" placeholder="Dein Name" autocomplete="off" required />
          <button type="submit" class="btn btn-primary small">Anmelden</button>
        </div>
      </form>
    </details>
  `;
}

async function handleSignupSubmit(eventId, form) {
  const ev = eventsCache.find(e => e.id === eventId);
  if (!ev) return;
  const mode = ev.registrationMode || "single";
  const name = (form.elements["name"].value || "").trim();
  if (!name) { showToast("Bitte Namen eintragen.", "error"); return; }
  const icon = readFormIcon(form);

  const entry = { eventId, name, icon, createdAt: Date.now() };
  if (mode === "pair") {
    const partnerName = (form.elements["partnerName"].value || "").trim();
    const needsPartnerChecked = !!form.elements["needsPartner"]?.checked;
    if (partnerName && !needsPartnerChecked) {
      entry.partnerName = partnerName;
      entry.needsPartner = false;
    } else {
      entry.partnerName = "";
      entry.needsPartner = true;
    }
  }

  try {
    let newId;
    if (firebaseReady) {
      const ref = await addDoc(collection(db, "anmeldungen"), { ...entry, createdAt: serverTimestamp() });
      newId = ref.id;
    } else {
      newId = "local_" + Date.now();
      entry.id = newId;
      localStore.anmeldungen.push(entry);
      anmeldungenCache = localStore.anmeldungen;
      saveLocal("anmeldungen", localStore.anmeldungen);
      renderEvents();
    }
    addOwnSignupId(eventId, newId);
    rememberPartyIcon(icon);
    form.reset();
    const iconInput = form.querySelector('input[name="icon"]');
    if (iconInput) iconInput.value = icon;
    const current = form.querySelector(".icon-picker-current");
    if (current) current.textContent = icon;
    showToast("Anmeldung gespeichert 🎉", "success");
  } catch (err) {
    console.error(err);
    showToast("Anmeldung fehlgeschlagen.", "error");
  }
}

async function removeOwnSignup(id, eventId) {
  const ownIds = getOwnSignupIds(eventId);
  if (!ownIds.includes(id) && !auth.isMember) {
    showToast("Nur WG-Mitglieder können andere Anmeldungen entfernen.", "error");
    return;
  }
  if (!confirm("Anmeldung wirklich entfernen?")) return;
  try {
    if (firebaseReady) {
      await deleteDoc(doc(db, "anmeldungen", id));
    } else {
      localStore.anmeldungen = localStore.anmeldungen.filter(a => a.id !== id);
      anmeldungenCache = localStore.anmeldungen;
      saveLocal("anmeldungen", localStore.anmeldungen);
      renderEvents();
    }
    removeOwnSignupId(eventId, id);
    showToast("Anmeldung entfernt.", "success");
  } catch (err) {
    console.error(err);
    showToast("Entfernen fehlgeschlagen.", "error");
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function matchSignups(eventId) {
  const solos = anmeldungenCache.filter(a => a.eventId === eventId && (a.needsPartner || !a.partnerName));
  if (solos.length < 2) { showToast("Mindestens zwei Solo-Anmeldungen nötig.", "error"); return; }
  if (!confirm(`${solos.length} Solo-Anmeldungen werden zufällig gepaart. Fortfahren?`)) return;

  const shuffled = shuffle(solos);
  const updates = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    updates.push([a.id, { partnerName: b.name, needsPartner: false, matchedWithId: b.id }]);
    // Der zweite Eintrag wird entfernt, damit das Paar nur einmal in der Liste steht
    updates.push([b.id, "__delete__"]);
  }

  try {
    if (firebaseReady) {
      for (const [id, payload] of updates) {
        if (payload === "__delete__") {
          await deleteDoc(doc(db, "anmeldungen", id));
        } else {
          await updateDoc(doc(db, "anmeldungen", id), payload);
        }
      }
    } else {
      for (const [id, payload] of updates) {
        if (payload === "__delete__") {
          localStore.anmeldungen = localStore.anmeldungen.filter(a => a.id !== id);
        } else {
          const idx = localStore.anmeldungen.findIndex(a => a.id === id);
          if (idx >= 0) Object.assign(localStore.anmeldungen[idx], payload);
        }
      }
      anmeldungenCache = localStore.anmeldungen;
      saveLocal("anmeldungen", localStore.anmeldungen);
      renderEvents();
    }
    const pairs = Math.floor(shuffled.length / 2);
    const leftover = shuffled.length % 2;
    showToast(`🎲 ${pairs} Paar${pairs > 1 ? 'e' : ''} gebildet${leftover ? " · 1 Person noch ohne Partner:in" : ""}.`, "success");
  } catch (err) {
    console.error(err);
    showToast("Zuweisung fehlgeschlagen.", "error");
  }
}

async function uploadEventFotos(eventId) {
  if (!requireAuth("Partybilder hochladen")) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const progress = document.createElement("div");
    progress.className = "upload-progress";
    progress.innerHTML = `<span class="spinner"></span><span>Lade 0 / ${files.length} …</span>`;
    document.body.appendChild(progress);

    let success = 0;
    for (let i = 0; i < files.length; i++) {
      progress.querySelector("span:last-child").textContent = `Lade ${i + 1} / ${files.length} …`;
      try {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await resizeImage(file);
        const sizeBytes = Math.ceil((dataUrl.length * 3) / 4);
        if (sizeBytes > MAX_IMAGE_BYTES) {
          showToast(`"${file.name}" zu gross.`, "error");
          continue;
        }
        const entry = {
          eventId,
          src: dataUrl,
          caption: "",
          addedBy: auth.member,
          createdAt: Date.now()
        };
        if (firebaseReady) {
          await addDoc(collection(db, "eventfotos"), { ...entry, createdAt: serverTimestamp() });
        } else {
          entry.id = "local_" + Date.now() + "_" + i;
          localStore.eventfotos.push(entry);
          eventfotosCache = localStore.eventfotos;
          saveLocal("eventfotos", localStore.eventfotos);
          renderEvents();
        }
        success++;
      } catch (err) { console.error(err); }
    }

    progress.remove();
    if (success > 0) showToast(`${success} Bild${success > 1 ? "er" : ""} hinzugefügt.`, "success");
  });
  input.click();
}

async function deleteEventFoto(id) {
  if (!requireAuth("Partybild löschen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "eventfotos", id)); showToast("Bild gelöscht.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.eventfotos = localStore.eventfotos.filter(f => f.id !== id);
    eventfotosCache = localStore.eventfotos;
    saveLocal("eventfotos", localStore.eventfotos);
    renderEvents();
    showToast("Bild gelöscht.", "success");
  }
}

let eventfotosCache = [];

async function deleteEvent(eventId) {
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "events", eventId)); showToast("Event gelöscht."); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.events = localStore.events.filter(e => e.id !== eventId);
    eventsCache = localStore.events;
    saveLocal("events", localStore.events);
    renderEvents();
  }
}

// Flyer-State für das Event-Formular
let evFlyerData = null;       // base64 eines neu hochgeladenen Flyers
let evFlyerRemove = false;    // true, wenn beim Bearbeiten ein bestehender Flyer entfernt werden soll

function setEvFlyerPreview(src) {
  const wrap = $("evFlyerPreview");
  const img = $("evFlyerImg");
  if (!wrap || !img) return;
  if (src) {
    img.src = src;
    wrap.classList.remove("hidden");
  } else {
    img.removeAttribute("src");
    wrap.classList.add("hidden");
  }
}

$("evFlyer")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImage(file, 1400);
    evFlyerData = dataUrl;
    evFlyerRemove = false;
    setEvFlyerPreview(dataUrl);
  } catch (err) {
    console.error(err);
    showToast("Flyer konnte nicht verarbeitet werden.", "error");
  }
});

$("evFlyerRemove")?.addEventListener("click", () => {
  evFlyerData = null;
  evFlyerRemove = true;
  const input = $("evFlyer");
  if (input) input.value = "";
  setEvFlyerPreview(null);
});

function resetEvFlyerState() {
  evFlyerData = null;
  evFlyerRemove = false;
  const input = $("evFlyer");
  if (input) input.value = "";
  setEvFlyerPreview(null);
}

function startEditEvent(id) {
  const ev = eventsCache.find(e => e.id === id);
  if (!ev) return;
  $("evId").value = ev.id;
  $("evTitle").value = ev.title || "";
  // datetime-local erwartet YYYY-MM-DDTHH:mm
  $("evDate").value = ev.date ? String(ev.date).slice(0, 16) : "";
  $("evEndDate").value = ev.endDate ? String(ev.endDate).slice(0, 16) : "";
  $("evDesc").value = ev.description || "";
  $("evLocation").value = ev.location || "";
  $("evEmoji").value = ev.emoji || "";
  $("evMode").value = ev.registrationMode || "single";
  resetEvFlyerState();
  if (ev.flyerSrc) setEvFlyerPreview(ev.flyerSrc);
  $("evSubmit").textContent = "Änderungen speichern";
  $("evCancel").classList.remove("hidden");
  $("eventFormSummary").textContent = `✏️ Event bearbeiten: ${ev.title}`;
  const toggle = $("eventFormToggle");
  if (toggle) { toggle.open = true; toggle.scrollIntoView({ behavior: "smooth", block: "start" }); }
}

function cancelEditEvent() {
  $("eventForm").reset();
  $("evId").value = "";
  resetEvFlyerState();
  $("evSubmit").textContent = "Event speichern";
  $("evCancel").classList.add("hidden");
  $("eventFormSummary").textContent = "➕ Event hinzufügen (nur für WG)";
}
$("evCancel")?.addEventListener("click", cancelEditEvent);

$("eventForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Events bearbeiten")) return;
  const editingId = $("evId").value.trim();
  const endDateRaw = $("evEndDate")?.value || "";
  const data = {
    title: $("evTitle").value.trim(),
    date: $("evDate").value,
    endDate: endDateRaw || null,
    description: $("evDesc").value.trim(),
    location: $("evLocation").value.trim() || "Haus am See, Pilatusstrasse 40, Pfäffikon ZH",
    emoji: $("evEmoji").value.trim() || "🎉",
    registrationMode: $("evMode").value || "single",
  };

  if (editingId) {
    // Update
    const update = { ...data };
    if (evFlyerData) update.flyerSrc = evFlyerData;
    else if (evFlyerRemove) update.flyerSrc = null;
    if (firebaseReady) {
      try { await updateDoc(doc(db, "events", editingId), update); }
      catch (err) { console.error(err); showToast("Speichern fehlgeschlagen.", "error"); return; }
    } else {
      const idx = localStore.events.findIndex(ev => ev.id === editingId);
      if (idx >= 0) {
        Object.assign(localStore.events[idx], update);
        if (update.flyerSrc === null) delete localStore.events[idx].flyerSrc;
      }
      eventsCache = localStore.events;
      saveLocal("events", localStore.events);
      renderEvents();
    }
    cancelEditEvent();
    showToast("Event aktualisiert.", "success");
    return;
  }

  // Create
  const entry = {
    ...data,
    rsvp: { yes: 0, no: 0 },
    createdBy: auth.member,
    createdAt: Date.now(),
  };
  if (evFlyerData) entry.flyerSrc = evFlyerData;
  if (firebaseReady) {
    try { await addDoc(collection(db, "events"), { ...entry, createdAt: serverTimestamp() }); }
    catch (err) { showToast("Speichern fehlgeschlagen.", "error"); return; }
  } else {
    entry.id = "local_" + Date.now();
    localStore.events.push(entry);
    eventsCache = localStore.events;
    saveLocal("events", localStore.events);
    renderEvents();
  }
  e.target.reset();
  resetEvFlyerState();
  $("eventFormToggle").open = false;
  showToast("Event gespeichert.", "success");
});

/* ==========================================================================
   Kalender Tabs
   ========================================================================== */

document.querySelectorAll("#kalender .kalender-tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    activateKalenderTab(tab.dataset.tab);
  });
});

function activateKalenderTab(key) {
  if (!key) return;
  const name = key.charAt(0).toUpperCase() + key.slice(1);
  const panel = $(`tab${name}`);
  if (!panel) return;
  document.querySelectorAll("#kalender .kalender-tabs .tab").forEach(t => t.classList.remove("active"));
  document.querySelector(`#kalender .kalender-tabs .tab[data-tab="${key}"]`)?.classList.add("active");
  document.querySelectorAll("#kalender .kalender-panel").forEach(p => p.classList.add("hidden"));
  panel.classList.remove("hidden");
}

function syncKalenderTabs() {
  // Falls der aktive Tab nur für eingeloggte User sichtbar ist, aber niemand angemeldet ist,
  // auf Termine umschalten, damit die Sektion nicht leer wirkt.
  const activeTab = document.querySelector("#kalender .kalender-tabs .tab.active");
  if (!activeTab) {
    activateKalenderTab("termine");
    return;
  }
  if (activeTab.hasAttribute("data-wg-only") && !auth.isAuthed) {
    activateKalenderTab("termine");
  }
}

/* ==========================================================================
   Aufgaben (Firestore-Collection: putzplan)
   ========================================================================== */

let putzCache = [];

/* ==========================================================================
   Giessplan (Zimmerpflanzen)
   ========================================================================== */

/** WhatsApp-Erinnerungsrhythmus (Tage zwischen zwei Nachrichten, solange fällig/offen) */
const REMINDER_EVERY_DAYS_OPTIONS = [
  { v: 1, l: "Täglich" },
  { v: 2, l: "Alle 2 Tage" },
  { v: 3, l: "Alle 3 Tage" },
  { v: 7, l: "Wöchentlich" },
  { v: 14, l: "Alle 2 Wochen" },
];

function normalizeReminderEveryDays(raw, fallback = 1) {
  const n = parseInt(raw, 10);
  return REMINDER_EVERY_DAYS_OPTIONS.some((o) => o.v === n) ? n : fallback;
}

function reminderEveryDaysLabel(n) {
  const hit = REMINDER_EVERY_DAYS_OPTIONS.find((o) => o.v === normalizeReminderEveryDays(n, 0));
  return hit ? hit.l : `alle ${n} Tage`;
}

function reminderCadenceSelectHtml(value, fallback, id, type, disabled = false) {
  const v = normalizeReminderEveryDays(value, fallback);
  const dis = disabled ? " disabled" : "";
  const opts = REMINDER_EVERY_DAYS_OPTIONS.map(
    (o) => `<option value="${o.v}" ${o.v === v ? "selected" : ""}>${o.l}</option>`
  ).join("");
  return `<select class="reminder-cadence-select" data-id="${escapeAttr(id)}" data-reminder-type="${escapeAttr(type)}"${dis} aria-label="Erinnerungsrhythmus">${opts}</select>`;
}

function reminderCadenceRowHtml({ id, type, checked, everyDays, fallback, cbDisabled = false, selectDisabled = false }) {
  const on = !!checked;
  const cbDis = cbDisabled ? " disabled" : "";
  const selDis = selectDisabled || !on;
  return `
    <div class="reminder-cadence-row">
      <label class="gartentodo-reminder-toggle">
        <input type="checkbox" class="reminder-cadence-cb" data-id="${escapeAttr(id)}" data-reminder-type="${escapeAttr(type)}" ${on ? "checked" : ""}${cbDis} />
        <span>📱 WhatsApp</span>
      </label>
      ${reminderCadenceSelectHtml(everyDays, fallback, id, type, selDis)}
    </div>`;
}

function bindReminderCadenceControls(root) {
  if (!root) return;
  root.querySelectorAll(".reminder-cadence-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      const sel = root.querySelector(
        `.reminder-cadence-select[data-id="${cb.dataset.id}"][data-reminder-type="${cb.dataset.reminderType}"]`
      );
      if (sel) sel.disabled = !cb.checked;
      void setReminderCadence(cb.dataset.reminderType, cb.dataset.id, {
        reminder: cb.checked,
        everyDays: sel ? parseInt(sel.value, 10) : undefined,
      });
    });
  });
  root.querySelectorAll(".reminder-cadence-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      void setReminderCadence(sel.dataset.reminderType, sel.dataset.id, {
        everyDays: parseInt(sel.value, 10),
      });
    });
  });
}

/** Gemeinsame Begriffe für Giessplan- und Garten-To-Do-Kacheln */
const TODO_CARD_LABELS = {
  task: "Aufgabe",
  plant: "Pflanze",
  assignee: "Zuständig",
  doneToday: "Heute erledigt – gespeichert",
  overdueDays: (n) => `${n} Tag${n > 1 ? "e" : ""} überfällig`,
  chipDone: "Erledigt",
  chipActive: "Dran",
  saveDoneGarten: "Erledigt speichern",
  saveDoneGiess: "Gegossen speichern",
  whatsapp: "WhatsApp",
  whatsappReminderTitle: (days) =>
    `WhatsApp-Erinnerung ${reminderEveryDaysLabel(days)} (wenn fällig), bis erledigt`,
  schadenReminderTitle: (days) =>
    `WhatsApp-Erinnerung ${reminderEveryDaysLabel(days)}, solange offen`,
  history: "Verlauf",
  historyCount: (n) => `Verlauf (${n})`,
  historyEmpty: "Noch keine Einträge.",
  historySwapped: (by, when) => `Verlauf · getauscht von ${by} · ${when}`,
};

let giessplanCache = [];

function getNextGiessDate(lastWatered, intervalDays) {
  const last = lastWatered ? new Date(lastWatered) : new Date();
  const next = new Date(last);
  next.setDate(next.getDate() + intervalDays);
  return next;
}

function getGiessStatus(item) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const lastWatered = item.lastWatered ? new Date(item.lastWatered) : null;
  const lastWateredToday = lastWatered && lastWatered.toDateString() === today.toDateString();
  
  if (lastWateredToday) return "done-today";
  
  const nextDate = getNextGiessDate(item.lastWatered, item.intervalDays || 3);
  nextDate.setHours(0, 0, 0, 0);
  
  if (nextDate < today) return "overdue";
  if (nextDate.getTime() === today.getTime()) return "due-today";
  return "upcoming";
}

function formatGiessCardSummary(item) {
  const status = getGiessStatus(item);
  const nextDate = getNextGiessDate(item.lastWatered, item.intervalDays || 3);
  const nextDay = startOfDayLocal(nextDate);
  const dateStr = nextDate.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });

  if (status === "done-today") {
    return { chip: TODO_CARD_LABELS.chipDone, chipCls: "done", when: TODO_CARD_LABELS.doneToday };
  }
  if (status === "overdue") {
    const days = Math.ceil((today0() - nextDay) / 86400000);
    return {
      chip: TODO_CARD_LABELS.chipActive,
      chipCls: "overdue",
      when: `${dateStr} · ${TODO_CARD_LABELS.overdueDays(days)}`,
    };
  }
  if (status === "due-today") {
    return { chip: TODO_CARD_LABELS.chipActive, chipCls: "due-today", when: dateStr };
  }
  const days = Math.ceil((nextDay - today0()) / 86400000);
  return {
    chip: TODO_CARD_LABELS.chipActive,
    chipCls: "upcoming",
    when: `${dateStr} (in ${days} Tag${days > 1 ? "en" : ""})`,
  };
}

function renderGiessplan() {
  const grid = $("giessplanGrid");
  if (!grid) return;
  
  const sorted = [...giessplanCache].sort((a, b) => {
    const statusOrder = { "overdue": 0, "due-today": 1, "upcoming": 2, "done-today": 3 };
    return (statusOrder[getGiessStatus(a)] || 2) - (statusOrder[getGiessStatus(b)] || 2);
  });
  
  if (sorted.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">Noch keine Pflanzen eingetragen 🌿</div>`;
    renderGustavHub();
    return;
  }
  
  grid.innerHTML = sorted.map((item) => {
    const status = getGiessStatus(item);
    const summary = formatGiessCardSummary(item);
    const whoName = item.who ? mLabel(item.who) : "Noch offen";
    const whoEmoji = item.who ? mEmoji(item.who) : "👤";

    return `
      <div class="giess-card gartentodo-card ${status}">
        <header class="gartentodo-card-head">
          <div class="gartentodo-hero">
            <p class="gartentodo-hero-label">${TODO_CARD_LABELS.plant}</p>
            <h3 class="gartentodo-task-title giess-plant-title">${escapeHtml(item.plant)}</h3>
            <div class="gartentodo-assignee${item.who ? "" : " is-empty"}">
              <span class="gartentodo-assignee-label">${TODO_CARD_LABELS.assignee}</span>
              <span class="gartentodo-assignee-value"><span class="gartentodo-assignee-emoji" aria-hidden="true">${whoEmoji}</span> ${escapeHtml(whoName)}</span>
            </div>
          </div>
          <div class="gartentodo-head-end">
            ${item.reminder ? `<span class="gartentodo-reminder-badge" title="${escapeAttr(TODO_CARD_LABELS.whatsappReminderTitle(normalizeReminderEveryDays(item.reminderEveryDays, 1)))}">📱</span>` : ""}
            <span class="gartentodo-status-chip ${summary.chipCls}">${escapeHtml(summary.chip)}</span>
          </div>
        </header>
        <p class="gartentodo-when-line">${escapeHtml(summary.when)}</p>
        ${auth.isAuthed ? `
          ${status !== "done-today"
            ? `<div class="gartentodo-done-actions">
            <button type="button" class="mini-btn gartentodo-done-btn" data-id="${item.id}" data-action="water">✅ ${TODO_CARD_LABELS.saveDoneGiess}</button>
          </div>`
            : ""}
          <div class="gartentodo-tools">
            ${reminderCadenceRowHtml({
              id: item.id,
              type: "giess",
              checked: item.reminder,
              everyDays: item.reminderEveryDays,
              fallback: 1,
            })}
          </div>
          <div class="gartentodo-actions">
            <button type="button" class="mini-btn danger" data-id="${item.id}" data-action="delete">Löschen</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
  
  grid.querySelectorAll(".mini-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "water") markAsWatered(btn.dataset.id);
      else if (btn.dataset.action === "delete") deleteGiessItem(btn.dataset.id);
    });
  });
  bindReminderCadenceControls(grid);
  renderGustavHub();
}

async function markAsWatered(id) {
  if (!requireAuth("Giessplan ändern")) return;
  const now = new Date().toISOString();
  
  if (firebaseReady) {
    await updateDoc(doc(db, "giessplan", id), { lastWatered: now });
  } else {
    const item = giessplanCache.find(g => g.id === id);
    if (item) {
      item.lastWatered = now;
      localStore.giessplan = giessplanCache;
      saveLocal("giessplan", localStore.giessplan);
      renderGiessplan();
    }
  }
  showToast(`✅ ${TODO_CARD_LABELS.saveDoneGiess.replace(" speichern", "")} gespeichert!`, "success");
}

async function deleteGiessItem(id) {
  if (!requireAuth("Giessplan ändern")) return;
  if (!confirm("Diese Pflanze aus dem Giessplan entfernen?")) return;
  
  if (firebaseReady) {
    await deleteDoc(doc(db, "giessplan", id));
  } else {
    localStore.giessplan = localStore.giessplan.filter(g => g.id !== id);
    giessplanCache = localStore.giessplan;
    saveLocal("giessplan", localStore.giessplan);
    renderGiessplan();
  }
  showToast("Entfernt.", "success");
}

$("giessForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Giessplan ändern")) return;
  
  const entry = {
    plant: $("giessPlant").value.trim(),
    who: $("giessWho").value,
    intervalDays: parseInt($("giessInterval").value, 10),
    reminder: $("giessReminder").checked,
    reminderEveryDays: normalizeReminderEveryDays($("giessReminderEvery")?.value, 1),
    lastWatered: null,
    createdAt: Date.now()
  };
  
  if (firebaseReady) {
    await addDoc(collection(db, "giessplan"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    if (!localStore.giessplan) localStore.giessplan = [];
    localStore.giessplan.push(entry);
    giessplanCache = localStore.giessplan;
    saveLocal("giessplan", localStore.giessplan);
    renderGiessplan();
  }
  
  e.target.reset();
  $("giessReminder").checked = true; // Reset to default checked
  showToast("🌱 Pflanze hinzugefügt!", "success");
});

// Populate giessWho select
function populateGiessWhoSelect() {
  const sel = $("giessWho");
  if (!sel) return;
  const active = getActiveBewohner().filter(b => !b.kid);
  sel.innerHTML = `<option value="">Wer giesst?</option>` + 
    active.map(b => `<option value="${b.name}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`).join("");
}

/* ==========================================================================
   Garten To-Do (fair verteilt, KW-Anzeige, WhatsApp-Erinnerung)
   ========================================================================== */

let gartenTodoCache = [];

const GARTEN_TODO_INTERVAL_LABELS = {
  7: "Wöchentlich",
  10: "Alle 10 Tage",
  14: "Alle 2 Wochen",
  21: "Alle 3 Wochen",
  28: "Alle 4 Wochen",
  30: "Monatlich",
};

/** Standard-Gartenarbeit: Samstag 10:00 (Europe/Zurich) */
const GARTEN_TODO_WORK_HOUR = 10;
const GARTEN_TODO_WORK_MINUTE = 0;

function zurichYmd(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

function ymdToLocalDate(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Montag (ISO) als KW-Beginn, Europe/Zurich */
function getKwWeekStartDate(date) {
  const base = ymdToLocalDate(zurichYmd(date));
  const isoDow = base.getDay() === 0 ? 7 : base.getDay();
  const monday = new Date(base);
  monday.setDate(monday.getDate() - (isoDow - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Sonntag = letzter Tag der ISO-Kalenderwoche */
function getKwWeekEndDate(date) {
  const end = getKwWeekStartDate(date);
  end.setDate(end.getDate() + 6);
  end.setHours(0, 0, 0, 0);
  return end;
}

function getNextGartenWorkSaturday(from = new Date()) {
  const base = ymdToLocalDate(zurichYmd(from));
  let daysUntilSat = (6 - base.getDay() + 7) % 7;
  if (daysUntilSat === 0) {
    const hour = parseInt(
      new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", hour: "numeric", hour12: false })
        .formatToParts(from)
        .find((p) => p.type === "hour")?.value || "0",
      10
    );
    if (hour >= GARTEN_TODO_WORK_HOUR) daysUntilSat = 7;
  }
  const sat = new Date(base);
  sat.setDate(sat.getDate() + daysUntilSat);
  sat.setHours(0, 0, 0, 0);
  return sat;
}

function snapToGartenSaturday(date) {
  const d = startOfDayLocal(date);
  const daysUntil = (6 - d.getDay() + 7) % 7;
  const sat = new Date(d);
  if (daysUntil > 0) sat.setDate(sat.getDate() + daysUntil);
  return sat;
}

function nextGartenDueAfterDone(fromDate, intervalDays) {
  return snapToGartenSaturday(addDaysLocal(startOfDayLocal(fromDate), intervalDays));
}

function defaultGartenTodoDueISO() {
  return toISODateLocal(getNextGartenWorkSaturday());
}

function formatGartenWorkSlot(date) {
  const dateStr = date.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "Europe/Zurich",
  });
  return `${dateStr}, ${pad2(GARTEN_TODO_WORK_HOUR)}:${pad2(GARTEN_TODO_WORK_MINUTE)}`;
}

function setGartenTodoFormDefaults() {
  const due = $("gartenTodoDue");
  if (due) due.value = defaultGartenTodoDueISO();
}

function getActiveAdultNames() {
  return getActiveBewohner().filter((b) => !b.kid).map((b) => b.name);
}

/** ISO-Kalenderwoche (Europe/Zurich) */
function getKwInfo(date) {
  const d = date instanceof Date ? date : new Date(date);
  const zurich = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
  zurich.setHours(12, 0, 0, 0);
  const th = new Date(zurich);
  th.setDate(th.getDate() + 4 - (th.getDay() || 7));
  const yearStart = new Date(th.getFullYear(), 0, 1);
  const kw = Math.ceil((((th - yearStart) / 86400000) + 1) / 7);
  return { kw, year: th.getFullYear() };
}

function formatKwLabel(date) {
  const { kw, year } = getKwInfo(date);
  const weekEnd = getKwWeekEndDate(date);
  const endStr = weekEnd.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
  return `KW ${kw} · ${year} (bis spätestens ${endStr})`;
}

function updateGartenTodoKwHead() {
  const el = $("gartenTodoKwHead");
  if (!el) return;
  const now = new Date();
  el.textContent = `Aktuelle ${formatKwLabel(now)} – heute ${now.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", timeZone: "Europe/Zurich" })} · Standard Gartenarbeit: Samstag ${pad2(GARTEN_TODO_WORK_HOUR)}:${pad2(GARTEN_TODO_WORK_MINUTE)}`;
}

function gartenTodoCountMap() {
  const counts = {};
  getActiveAdultNames().forEach((n) => { counts[n] = 0; });
  return counts;
}

function mergeGartenTodoCountMaps(...maps) {
  const out = gartenTodoCountMap();
  maps.forEach((m) => {
    Object.keys(m).forEach((k) => { out[k] = (out[k] || 0) + (m[k] || 0); });
  });
  return out;
}

/** Erledigte Garten-Runden (Wer war für die Runde eingeteilt). */
function gartenTodoCompletedCounts() {
  const counts = gartenTodoCountMap();
  gartenTodoCache.forEach((t) => {
    (t.history || []).forEach((h) => {
      if (h.action !== "done") return;
      const name = h.completedBy || h.by;
      if (name && counts[name] !== undefined) counts[name]++;
    });
  });
  return counts;
}

/** Aktuell dran: fällig/überfällig, nicht «erledigt bis nächster Termin». */
function gartenTodoActiveAssignmentCounts(excludeId = null) {
  const counts = gartenTodoCountMap();
  gartenTodoCache.forEach((t) => {
    if (excludeId && t.id === excludeId) return;
    if (gartenTodoRoundComplete(t)) return;
    if (t.who && counts[t.who] !== undefined) counts[t.who]++;
  });
  return counts;
}

/** Einsätze = erledigt + aktuell dran (Basis für Fairness). */
function gartenTodoDutyCounts(excludeId = null) {
  return mergeGartenTodoCountMaps(
    gartenTodoCompletedCounts(),
    gartenTodoActiveAssignmentCounts(excludeId)
  );
}

function pickFairAssignee(excludeId = null) {
  const adults = [...getActiveAdultNames()];
  if (!adults.length) return "";
  const counts = gartenTodoDutyCounts(excludeId);
  adults.sort((a, b) => (counts[a] - counts[b]) || a.localeCompare(b, "de"));
  return adults[0];
}

/** Kurze Fairness-Rechnung: +1 Einsatz für «who» auf dieser Karte (ohne diese Karte in der Basis). */
function gartenTodoFairnessAfter(who, excludeId) {
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  if (!who || !adults.length) return { ok: false, text: "Keine Bewohner für die Berechnung." };
  const before = gartenTodoDutyCounts(excludeId);
  const after = { ...before };
  after[who] = (after[who] || 0) + 1;
  const nums = adults.map((n) => after[n] || 0);
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const diff = max - min;
  const fair = pickFairAssignee(excludeId);
  const tally = adults.map((n) => `${mLabel(n)} ${after[n] || 0}`).join(", ");
  if (who === fair && diff <= 1) {
    return { ok: true, text: `Fair: ${mLabel(who)} hat die wenigsten Einsätze. Danach ${tally} (Differenz ${diff}).` };
  }
  if (diff <= 1) {
    return { ok: true, text: `Danach ausgeglichen: ${tally} (Differenz ${diff}).` };
  }
  return {
    ok: false,
    text: `Danach ${tally} (Differenz ${diff}). Fairer wäre ${mLabel(fair)} (${before[fair] || 0} Einsätze, statt ${who} mit ${after[who]}).`,
  };
}

function gartenTodoHistoryEntry(action, fields = {}) {
  return {
    at: new Date().toISOString(),
    by: auth.member || "WG",
    action,
    ...fields,
  };
}

function appendGartenTodoHistory(item, entry) {
  const hist = Array.isArray(item.history) ? [...item.history] : [];
  hist.unshift(entry);
  if (hist.length > 25) hist.length = 25;
  return hist;
}

function formatGartenTodoHistoryLine(h) {
  const when = new Date(h.at).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
  let detail = "";
  if (h.action === "created") {
    detail = `Angelegt → ${escapeHtml(h.who || "—")}${h.nextDue ? `, fällig ${escapeHtml(h.nextDue)}` : ", nächster Samstag"}`;
  } else if (h.action === "plan") {
    const prev = h.prevWho && h.prevWho !== h.who ? ` (vorher ${escapeHtml(h.prevWho)})` : "";
    detail = `Planung → ${escapeHtml(h.who || "—")}, fällig ${escapeHtml(h.nextDue || "—")}${prev}`;
  } else if (h.action === "done") {
    detail = `Erledigt → nächste Runde ${escapeHtml(h.who || "—")}, fällig ${escapeHtml(h.nextDue || "—")}`;
  } else if (h.action === "rotation") {
    const prev = h.prevWho && h.prevWho !== h.who ? ` (vorher ${escapeHtml(h.prevWho)})` : "";
    detail = `Reihenfolge → ${escapeHtml(h.who || "—")}, ${escapeHtml(h.nextDue || "—")}${prev}`;
  } else if (h.action === "reminder") {
    detail = h.fairNote || "WhatsApp-Erinnerung geändert";
  }
  const fair = h.fairNote ? `<br><span class="gartentodo-fair-inline">${escapeHtml(h.fairNote)}</span>` : "";
  return `<li><time>${when}</time> · ${escapeHtml(h.by || "—")} · ${detail}${fair}</li>`;
}

function normalizeGartenTodoRotationOverrides(item) {
  if (!Array.isArray(item.rotationOverrides)) return [];
  return item.rotationOverrides.filter((o) => o && o.due && o.who);
}

function gartenTodoRotationOverridesByDue(item) {
  const map = {};
  normalizeGartenTodoRotationOverrides(item).forEach((o) => { map[o.due] = o; });
  return map;
}

function gartenTodoNewSwapMeta() {
  return {
    swappedBy: auth.member || "WG",
    swappedAt: new Date().toISOString(),
  };
}

function upsertGartenTodoRotationOverride(list, due, who, swapMeta = null) {
  const next = [...list];
  const idx = next.findIndex((o) => o.due === due);
  const meta = swapMeta || gartenTodoNewSwapMeta();
  const entry = { due, who, swappedBy: meta.swappedBy, swappedAt: meta.swappedAt };
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return next;
}

const GARTEN_TODO_ICON_SVG = {
  /** Sync-Pfeile im Kreis (Referenz: zwei dicke Halbkreis-Pfeile) */
  swap: `<svg class="gartentodo-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6.6 10.2a6.4 6.4 0 0 1 10.6-2.4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M16.8 6.2l3.4 1.2-2.2 2.8" fill="currentColor" stroke="none"/>
    <path d="M17.4 13.8a6.4 6.4 0 0 1-10.6 2.4" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M7.2 17.8l-3.4-1.2 2.2-2.8" fill="currentColor" stroke="none"/>
  </svg>`,
  /** Analoge Uhr (Ziffernblatt) */
  clock: `<svg class="gartentodo-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="9.25" fill="currentColor" opacity="0.1"/>
    <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" stroke-width="1.55"/>
    <path d="M12 5v1.5M12 17.5V19M5 12h1.5M17.5 12H19M7.05 7.05l1.06 1.06M15.89 15.89l1.06 1.06M16.95 7.05l-1.06 1.06M8.11 15.89l-1.06 1.06" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" opacity="0.45"/>
    <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
    <path d="M12 12V8.2" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"/>
    <path d="M12 12h3.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
  </svg>`,
  /** Kalender mit Ringen und Raster */
  calendar: `<svg class="gartentodo-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" fill="currentColor" opacity="0.1"/>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M3 9.5h18" stroke="currentColor" stroke-width="1.5"/>
    <path d="M8 3v3.5M16 3v3.5" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"/>
    <rect x="7" y="2" width="2" height="3" rx="0.6" fill="currentColor" opacity="0.85"/>
    <rect x="15" y="2" width="2" height="3" rx="0.6" fill="currentColor" opacity="0.85"/>
    <circle cx="8" cy="13" r="1" fill="currentColor" opacity="0.55"/>
    <circle cx="12" cy="13" r="1" fill="currentColor" opacity="0.55"/>
    <circle cx="16" cy="13" r="1" fill="currentColor" opacity="0.55"/>
    <circle cx="8" cy="17" r="1" fill="currentColor" opacity="0.85"/>
    <circle cx="12" cy="17" r="1" fill="currentColor"/>
    <circle cx="16" cy="17" r="1" fill="currentColor" opacity="0.55"/>
  </svg>`,
};

function gartenTodoIconBtn(className, title, innerSvg, extraAttrs = "") {
  const t = escapeAttr(title);
  return `<button type="button" class="gartentodo-icon-btn ${className}" title="${t}" aria-label="${t}" ${extraAttrs}>${innerSvg}</button>`;
}

/** Sentinel für Verlauf-Dropdown auf der Kachel (gesamte history[], nicht nur ein Termin). */
const GARTEN_TODO_CARD_HISTORY_DUE = "__card__";

function gartenTodoHistoryId(itemId, dueIso) {
  return `gartentodo-history-${itemId}-${dueIso}`;
}

function gartenTodoHistoryPanelId(itemId, dueIso) {
  return `${gartenTodoHistoryId(itemId, dueIso)}-panel`;
}

function gartenTodoHistoryEntriesForDue(item, dueIso, swapInfo = null, rowWho = "") {
  const hist = Array.isArray(item.history) ? item.history : [];
  const matched = hist.filter((h) => {
    if (h.action === "plan" || h.action === "rotation") return h.nextDue === dueIso;
    if (h.action === "created" && h.nextDue) return h.nextDue === dueIso;
    return false;
  });
  if (matched.length) return matched;
  if (swapInfo?.at) {
    return [
      {
        at: swapInfo.at,
        by: swapInfo.by || "WG",
        action: "rotation",
        who: rowWho || normalizeGartenTodoRotationOverrides(item).find((o) => o.due === dueIso)?.who || "",
        nextDue: dueIso,
        fairNote: null,
      },
    ];
  }
  return [];
}

function gartenTodoRowHistoryHtml(item, dueIso, swapInfo, rowWho = "") {
  const entries = gartenTodoHistoryEntriesForDue(item, dueIso, swapInfo, rowWho);
  if (!entries.length) return `<p class="form-note">${TODO_CARD_LABELS.historyEmpty}</p>`;
  return `<ul class="gartentodo-history-list">${entries.map(formatGartenTodoHistoryLine).join("")}</ul>`;
}

function gartenTodoSwapTooltip(swapInfo) {
  if (!swapInfo?.at) return TODO_CARD_LABELS.history;
  const when = new Date(swapInfo.at).toLocaleDateString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
  const by = swapInfo.by ? mLabel(swapInfo.by) : "WG";
  return TODO_CARD_LABELS.historySwapped(by, when);
}

function gartenTodoHistoryDropdownHtml(item, r) {
  const panelId = gartenTodoHistoryPanelId(item.id, r.dueIso);
  const title = gartenTodoSwapTooltip(r.swapInfo);
  return `<div class="gartentodo-history-drop">
    ${gartenTodoIconBtn(
      "gartentodo-verlauf-icon-btn",
      title,
      GARTEN_TODO_ICON_SVG.clock,
      `data-history-for="${escapeHtml(item.id)}" data-history-due="${escapeHtml(r.dueIso)}" aria-expanded="false" aria-controls="${escapeHtml(panelId)}"`
    )}
    <div class="gartentodo-history-panel" id="${escapeHtml(panelId)}" role="region" aria-label="${escapeAttr(TODO_CARD_LABELS.history)}">
      ${gartenTodoRowHistoryHtml(item, r.dueIso, r.swapInfo, r.who)}
    </div>
  </div>`;
}

function gartenTodoCardHistoryDropdownHtml(item) {
  const panelId = gartenTodoHistoryPanelId(item.id, GARTEN_TODO_CARD_HISTORY_DUE);
  const count = Array.isArray(item.history) ? item.history.length : 0;
  const title = count ? TODO_CARD_LABELS.historyCount(count) : TODO_CARD_LABELS.history;
  return `<div class="gartentodo-history-drop gartentodo-card-history-drop">
    ${gartenTodoIconBtn(
      "gartentodo-verlauf-icon-btn",
      title,
      GARTEN_TODO_ICON_SVG.clock,
      `data-history-for="${escapeHtml(item.id)}" data-history-due="${escapeHtml(GARTEN_TODO_CARD_HISTORY_DUE)}" aria-expanded="false" aria-controls="${escapeHtml(panelId)}"`
    )}
    <div class="gartentodo-history-panel gartentodo-card-history-panel" id="${escapeHtml(panelId)}" role="region" aria-label="${escapeAttr(TODO_CARD_LABELS.history)}">
      ${gartenTodoHistoryHtml(item)}
    </div>
  </div>`;
}

function findGartenTodoHistoryPanel(itemId, dueIso) {
  return document.getElementById(gartenTodoHistoryPanelId(itemId, dueIso));
}

function findGartenTodoHistoryBtn(root, itemId, dueIso) {
  return root.querySelector(
    `.gartentodo-verlauf-icon-btn[data-history-for="${CSS.escape(itemId)}"][data-history-due="${CSS.escape(dueIso)}"]`
  );
}

function clearGartenTodoHistoryPanelPosition(panel) {
  if (!panel) return;
  panel.classList.remove("is-fixed");
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  panel.style.maxHeight = "";
  panel.style.overflowY = "";
  panel.style.visibility = "";
  panel.style.width = "";
  panel.style.minWidth = "";
  panel.style.maxWidth = "";
}

function gartenTodoHistoryPanelMount(panel, open) {
  if (!panel._gartentodoPortalHome) {
    panel._gartentodoPortalHome = { parent: panel.parentElement, next: panel.nextSibling };
  }
  const home = panel._gartentodoPortalHome;
  if (!home?.parent) return;
  if (open) {
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
  } else if (panel.parentElement === document.body) {
    if (home.next && home.next.parentNode === home.parent) home.parent.insertBefore(panel, home.next);
    else home.parent.appendChild(panel);
  }
}

/** Dropdown direkt am Uhr-Button (fixed), nur bei Bedarf im Viewport korrigieren. */
function positionGartenTodoHistoryPanel(panel, btn) {
  if (!panel || !btn) return;
  const margin = 12;
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btnRect = btn.getBoundingClientRect();
  const alignRight = !panel.classList.contains("gartentodo-card-history-panel");

  panel.classList.add("is-fixed");
  panel.style.position = "fixed";
  panel.style.display = "block";
  panel.style.visibility = "hidden";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  panel.style.left = "-10000px";
  panel.style.top = "0";
  panel.style.maxHeight = `${Math.floor(vh * 0.65)}px`;
  panel.style.overflowY = "auto";

  const pr = panel.getBoundingClientRect();
  const w = pr.width;
  const naturalH = pr.height;

  let left = alignRight ? btnRect.right - w : btnRect.left;
  let top = btnRect.bottom + gap;

  if (left < margin) left = margin;
  if (left + w > vw - margin) left = vw - margin - w;

  let maxH = Math.min(naturalH, Math.floor(vh * 0.65));
  const spaceBelow = vh - margin - top;
  if (naturalH > spaceBelow) {
    const spaceAbove = btnRect.top - gap - margin;
    if (spaceAbove >= spaceBelow) {
      maxH = Math.min(naturalH, spaceAbove, Math.floor(vh * 0.65));
      top = btnRect.top - gap - maxH;
    } else {
      maxH = Math.max(120, spaceBelow);
    }
  }
  if (top < margin) {
    top = margin;
    maxH = Math.min(maxH, vh - margin - top);
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.maxHeight = `${Math.round(maxH)}px`;
  panel.style.visibility = "visible";
}

function refreshOpenGartenTodoHistoryPanels() {
  document.querySelectorAll(".gartentodo-history-panel.is-open").forEach((panel) => {
    const btn =
      panel._gartentodoAnchorBtn
      || panel.closest(".gartentodo-history-drop")?.querySelector(".gartentodo-verlauf-icon-btn");
    if (btn) positionGartenTodoHistoryPanel(panel, btn);
  });
}

function bindGartenTodoHistoryReposition() {
  if (window._gartenTodoHistoryRepositionBound) return;
  window._gartenTodoHistoryRepositionBound = true;
  const run = () => refreshOpenGartenTodoHistoryPanels();
  window.addEventListener("resize", run);
  window.addEventListener("scroll", run, true);
}

function setGartenTodoHistoryPanelOpen(panel, btn, open) {
  if (!panel) return;
  panel.classList.toggle("is-open", open);
  panel.setAttribute("aria-hidden", open ? "false" : "true");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    panel._gartentodoAnchorBtn = btn;
    bindGartenTodoHistoryReposition();
    gartenTodoHistoryPanelMount(panel, true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => positionGartenTodoHistoryPanel(panel, btn));
    });
  } else {
    panel._gartentodoAnchorBtn = null;
    clearGartenTodoHistoryPanelPosition(panel);
    gartenTodoHistoryPanelMount(panel, false);
    panel.classList.remove("gartentodo-history-flash");
  }
}

function closeGartenTodoHistoryPanels(root, exceptPanel = null) {
  root.querySelectorAll(".gartentodo-history-panel").forEach((panel) => {
    if (panel === exceptPanel) return;
    const btn = panel.closest(".gartentodo-history-drop")?.querySelector(".gartentodo-verlauf-icon-btn");
    setGartenTodoHistoryPanelOpen(panel, btn, false);
  });
}

function toggleGartenTodoRowHistory(itemId, dueIso, root = document) {
  const panel = findGartenTodoHistoryPanel(itemId, dueIso);
  const btn = findGartenTodoHistoryBtn(root, itemId, dueIso);
  if (!panel || !btn) return;
  if (dueIso !== GARTEN_TODO_CARD_HISTORY_DUE) {
    const parentRotation = panel.closest(".gartentodo-subdetails");
    if (parentRotation && !parentRotation.open) parentRotation.open = true;
  }
  const willOpen = !panel.classList.contains("is-open");
  closeGartenTodoHistoryPanels(root, willOpen ? panel : null);
  setGartenTodoHistoryPanelOpen(panel, btn, willOpen);
  if (willOpen) {
    panel.classList.add("gartentodo-history-flash");
    window.setTimeout(() => panel.classList.remove("gartentodo-history-flash"), 2200);
  }
}

function removeGartenTodoRotationOverride(list, due) {
  return list.filter((o) => o.due !== due);
}

function buildGartenTodoRotation(item, rounds = 12) {
  const interval = item.intervalDays || 14;
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  if (!adults.length) return [];
  const overridesByDue = gartenTodoRotationOverridesByDue(item);
  let who = item.who && adults.includes(item.who) ? item.who : adults[0];
  let date = gartenTodoNextDueDate(item);
  const rows = [];
  for (let i = 0; i < rounds; i++) {
    const dueIso = toISODateLocal(date);
    let swapInfo = null;
    const ov = overridesByDue[dueIso];
    if (ov?.who && adults.includes(ov.who)) {
      who = ov.who;
      if (ov.swappedAt) swapInfo = { by: ov.swappedBy, at: ov.swappedAt };
    } else if (i === 0 && item.whoSwappedAt) {
      swapInfo = { by: item.whoSwappedBy, at: item.whoSwappedAt };
    }
    rows.push({
      who,
      date: new Date(date),
      dueIso,
      kw: formatKwLabel(date),
      slot: formatGartenWorkSlot(date),
      current: i === 0,
      swapInfo,
      roundIndex: i,
    });
    const idx = adults.indexOf(who);
    who = adults[(idx + 1) % adults.length];
    date = addDaysLocal(date, interval);
  }
  return rows;
}

function gartenTodoRotationHtml(item, canEdit = false) {
  const rows = buildGartenTodoRotation(item);
  if (!rows.length) return "<p class=\"form-note\">Keine aktiven Erwachsenen.</p>";
  const lis = rows
    .map((r) => {
      const n = r.roundIndex + 1;
      const itemCls = [
        "gartentodo-rotation-item",
        r.current ? "is-next" : "",
        r.roundIndex > 0 ? "is-later" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const saveBtn = canEdit
        ? gartenTodoIconBtn(
            "gartentodo-rotation-save",
            "Person tauschen (z.B. Urlaub)",
            GARTEN_TODO_ICON_SVG.swap,
            `data-id="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-round="${r.roundIndex}"`
          )
        : "";
      const calBtn = gartenTodoIconBtn(
        "gartentodo-rotation-ical",
        "In Kalender speichern",
        GARTEN_TODO_ICON_SVG.calendar,
        `data-id="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-who="${escapeHtml(r.who)}" data-round="${r.roundIndex}"`
      );
      const historyDrop = r.swapInfo ? gartenTodoHistoryDropdownHtml(item, r) : "";
      const whoControls = canEdit
        ? `<select class="gartentodo-rotation-who" data-rotation-who="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-round="${r.roundIndex}" aria-label="Person für ${escapeHtml(r.slot)}">${gartenTodoWhoOptionsHtml(r.who, false, true)}</select>`
        : `<span class="gartentodo-rotation-person-name">${escapeHtml(mLabel(r.who))}</span>`;
      return `<li class="${itemCls}">
        <div class="gartentodo-rotation-rank" aria-label="Termin ${n}">
          <span class="gartentodo-rotation-rank-n">${n}</span>
        </div>
        <div class="gartentodo-rotation-body">
          <p class="gartentodo-rotation-heading">
            <span class="gartentodo-rotation-when">${escapeHtml(r.slot)}</span>
          </p>
          <p class="gartentodo-rotation-kw">${r.kw}</p>
          <div class="gartentodo-rotation-toolbar">
            ${whoControls}
            <div class="gartentodo-icon-group" role="group" aria-label="Aktionen">
              ${saveBtn}
              ${calBtn}
              ${historyDrop}
            </div>
          </div>
        </div>
      </li>`;
    })
    .join("");
  const hint = canEdit
    ? `Icons: tauschen · Kalender · Uhr (Verlauf). Zeile 1 = nächste Runde.`
    : `Samstag ${pad2(GARTEN_TODO_WORK_HOUR)}:${pad2(GARTEN_TODO_WORK_MINUTE)}, alle ${item.intervalDays || 14} Tage.`;
  return `<ol class="gartentodo-rotation-list" start="1">${lis}</ol><p class="form-note">${hint}</p>`;
}

function gartenTodoHistoryHtml(item) {
  const hist = Array.isArray(item.history) ? item.history : [];
  if (!hist.length) return `<p class="form-note">${TODO_CARD_LABELS.historyEmpty}</p>`;
  return `<ul class="gartentodo-history-list">${hist.map(formatGartenTodoHistoryLine).join("")}</ul>`;
}

function pickNextAssignee(currentWho) {
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  if (!adults.length) return "";
  const idx = adults.indexOf(currentWho);
  if (idx < 0) return pickFairAssignee();
  return adults[(idx + 1) % adults.length];
}

function today0() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function toISODateLocal(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysLocal(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseGartenTodoDueISO(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Nächstes Fälligkeitsdatum: nextDue, sonst Samstag nach lastDone+Intervall, sonst nächster Samstag. */
function gartenTodoNextDueDate(item) {
  const manual = parseGartenTodoDueISO(item.nextDue);
  if (manual) return manual;
  const interval = item.intervalDays || 14;
  if (item.lastDone) {
    return nextGartenDueAfterDone(new Date(item.lastDone), interval);
  }
  return getNextGartenWorkSaturday();
}

function startOfDayLocal(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function gartenTodoWhoOptionsHtml(selected = "", includeFair = false, plainNames = false) {
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  let html = "";
  if (includeFair) {
    const fair = pickFairAssignee();
    const fairLabel = fair ? `Fair vorschlagen (${mLabel(fair)})` : "Fair vorschlagen";
    html += `<option value=""${!selected ? " selected" : ""}>${escapeHtml(fairLabel)}</option>`;
  }
  html += adults
    .map((n) => {
      const label = plainNames ? mLabel(n) : `${mEmoji(n)} ${mLabel(n)}`;
      return `<option value="${escapeHtml(n)}"${n === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return html;
}

function populateGartenTodoWhoSelect() {
  const sel = $("gartenTodoWho");
  if (!sel) return;
  sel.innerHTML = gartenTodoWhoOptionsHtml("", true);
  setGartenTodoFormDefaults();
  updateGartenTodoFormFairPreview();
}

function updateGartenTodoFormFairPreview() {
  const el = $("gartenTodoFormFair");
  if (!el) return;
  const pick = $("gartenTodoWho")?.value;
  const who = pick || pickFairAssignee();
  if (!who) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const fair = gartenTodoFairnessAfter(who, null);
  el.className = `gartentodo-fair-preview ${fair.ok ? "ok" : "warn"}`;
  el.textContent = pick ? fair.text : `Vorschlag: ${fair.text}`;
}

$("gartenTodoWho")?.addEventListener("change", updateGartenTodoFormFairPreview);

function formatGartenTodoDutyPart(name, completed, active) {
  const total = (completed || 0) + (active || 0);
  if (!total) return `${mEmoji(name)} 0`;
  if (completed && active) return `${mEmoji(name)} ${total} (${completed}+${active})`;
  if (completed) return `${mEmoji(name)} ${total} (${completed} erledigt)`;
  return `${mEmoji(name)} ${total} (dran)`;
}

function renderGartenTodoBalance() {
  const el = $("gartenTodoBalance");
  if (!el) return;
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  if (!adults.length) {
    el.textContent = "";
    return;
  }
  const completed = gartenTodoCompletedCounts();
  const active = gartenTodoActiveAssignmentCounts();
  const line = adults.map((n) => formatGartenTodoDutyPart(n, completed[n], active[n])).join(" · ");
  el.textContent = `Einsätze (erledigt + aktuell dran): ${line}`;
}

function gartenTodoTodayYmd() {
  return zurichYmd(new Date());
}

function getGartenTodoLastCompleter(item) {
  if (item.lastCompletedBy) return item.lastCompletedBy;
  const entry = (item.history || []).find((h) => h.action === "done");
  return entry?.completedBy || entry?.by || null;
}

function getGartenTodoStatus(item) {
  const todayYmd = gartenTodoTodayYmd();
  const today = today0();
  const next = gartenTodoNextDueDate(item);
  const nextYmd = toISODateLocal(next);

  // Letzte Runde erledigt, nächster Termin in der Zukunft → `who` ist die NÄCHSTE Person (noch offen)
  if (item.lastDone && next > today) return "scheduled";

  if (item.lastDone) {
    const lastYmd = zurichYmd(new Date(item.lastDone));
    if (lastYmd === todayYmd && nextYmd === todayYmd) return "done-today";
  }

  if (next < today) return "overdue";
  if (nextYmd === todayYmd) return "due-today";
  return "upcoming";
}

function gartenTodoRoundComplete(item) {
  return getGartenTodoStatus(item) === "scheduled";
}

/** «Erledigt speichern» anzeigen (auch nächste Runde nach Tausch/Rotation). */
function gartenTodoShowDoneButton(item) {
  const s = getGartenTodoStatus(item);
  return s === "overdue" || s === "due-today" || s === "upcoming" || s === "scheduled";
}

function formatGartenTodoNext(item) {
  const status = getGartenTodoStatus(item);
  const next = gartenTodoNextDueDate(item);
  const kw = formatKwLabel(next);
  const slot = formatGartenWorkSlot(next);
  const planNote = item.nextDueManual ? " · Datum festgelegt" : "";
  if (status === "done-today") return { text: "✅ Heute erledigt – gespeichert", kw, cls: "" };
  if (status === "scheduled") {
    const lastStr = new Date(item.lastDone).toLocaleDateString("de-CH", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Zurich",
    });
    return {
      text: `✅ Erledigt am ${lastStr} – nächste Runde: ${slot}`,
      kw,
      cls: "",
    };
  }
  if (status === "overdue") {
    const days = Math.ceil((today0() - next) / 86400000);
    return { text: `⚠️ ${days} Tag${days > 1 ? "e" : ""} überfällig · ${slot}${planNote}`, kw, cls: "overdue" };
  }
  if (status === "due-today") return { text: `📋 Heute fällig · ${slot}${planNote}`, kw, cls: "due-today" };
  const days = Math.ceil((next - today0()) / 86400000);
  return { text: `Fällig ${slot} (in ${days} Tag${days > 1 ? "en" : ""})${planNote}`, kw, cls: "" };
}

/** Terminzeile auf der Kachel: nur «bis spätestens» (letzter KW-Tag), ohne Kalender-Uhrzeit. */
function formatGartenTodoCardWhenLine(next) {
  return formatKwLabel(next);
}

/** Kompakte Kachel-Anzeige: Status + Termin (KW «bis spätestens» für alle offenen Runden). */
function formatGartenTodoCardSummary(item) {
  const status = getGartenTodoStatus(item);
  const next = gartenTodoNextDueDate(item);
  const whenLine = formatGartenTodoCardWhenLine(next);
  if (status === "done-today") {
    return { chip: TODO_CARD_LABELS.chipDone, chipCls: "done", when: TODO_CARD_LABELS.doneToday };
  }
  if (status === "overdue") {
    const days = Math.ceil((today0() - next) / 86400000);
    return {
      chip: TODO_CARD_LABELS.chipActive,
      chipCls: "overdue",
      when: `${whenLine} · ${TODO_CARD_LABELS.overdueDays(days)}`,
    };
  }
  if (status === "due-today") {
    return { chip: TODO_CARD_LABELS.chipActive, chipCls: "due-today", when: whenLine };
  }
  const chipCls = status === "scheduled" ? "scheduled" : "upcoming";
  return { chip: TODO_CARD_LABELS.chipActive, chipCls, when: whenLine };
}

function renderGartenTodos() {
  const grid = $("gartenTodoGrid");
  if (!grid) return;
  updateGartenTodoKwHead();
  renderGartenTodoBalance();

  const sorted = [...gartenTodoCache].sort((a, b) => {
    const order = { overdue: 0, "due-today": 1, upcoming: 2, scheduled: 3, "done-today": 4 };
    return (order[getGartenTodoStatus(a)] ?? 2) - (order[getGartenTodoStatus(b)] ?? 2);
  });

  if (!sorted.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Noch keine Garten-Aufgaben – Zeit, den Garten zu planen! 🌿</div>`;
    return;
  }

  grid.innerHTML = sorted.map((item) => {
    const status = getGartenTodoStatus(item);
    const summary = formatGartenTodoCardSummary(item);
    const whoName = item.who ? mLabel(item.who) : "Noch offen";
    const whoEmoji = item.who ? mEmoji(item.who) : "👤";
    const canEdit = auth.isMember;
    const showDoneBtn = gartenTodoShowDoneButton(item);
    const cardHistoryDrop = gartenTodoCardHistoryDropdownHtml(item);
    const reminderBadge = item.reminder
      ? `<span class="gartentodo-reminder-badge" title="${escapeAttr(TODO_CARD_LABELS.whatsappReminderTitle(normalizeReminderEveryDays(item.reminderEveryDays, 1)))}">📱</span>`
      : "";

    return `
      <div class="gartentodo-card ${status}">
        <header class="gartentodo-card-head">
          <div class="gartentodo-hero">
            <p class="gartentodo-hero-label">${TODO_CARD_LABELS.task}</p>
            <h3 class="gartentodo-task-title">${escapeHtml(item.task)}</h3>
            <div class="gartentodo-assignee${item.who ? "" : " is-empty"}">
              <span class="gartentodo-assignee-label">${TODO_CARD_LABELS.assignee}</span>
              <span class="gartentodo-assignee-value"><span class="gartentodo-assignee-emoji" aria-hidden="true">${whoEmoji}</span> ${escapeHtml(whoName)}</span>
            </div>
          </div>
          <div class="gartentodo-head-end">
            ${reminderBadge}
            <span class="gartentodo-status-chip ${summary.chipCls}">${escapeHtml(summary.chip)}</span>
          </div>
        </header>
        <p class="gartentodo-when-line">${escapeHtml(summary.when)}</p>
        ${canEdit ? `
          <details class="gartentodo-subdetails">
            <summary>📅 Wochen-Reihenfolge &amp; Tausch</summary>
            ${gartenTodoRotationHtml(item, true)}
          </details>
          ${showDoneBtn
            ? `<div class="gartentodo-done-actions">
            <button type="button" class="mini-btn gartentodo-done-btn" data-id="${item.id}" data-action="done">✅ ${TODO_CARD_LABELS.saveDoneGarten}</button>
            <label class="gartentodo-rotate-row">
              <input type="checkbox" class="gartentodo-rotate-next" data-id="${item.id}" checked />
              <span>Nächste Person nach Fairness-Einsätzen (empfohlen)</span>
            </label>
          </div>`
            : ""}
          <div class="gartentodo-tools">
            <button type="button" class="event-share-btn gartentodo-share-btn" data-id="${item.id}" data-action="ical" title="In Kalender speichern (iPhone/Android)">📅 Kalender</button>
            ${reminderCadenceRowHtml({
              id: item.id,
              type: "garten",
              checked: item.reminder,
              everyDays: item.reminderEveryDays,
              fallback: 1,
            })}
            ${cardHistoryDrop}
          </div>
          <div class="gartentodo-actions">
            <button type="button" class="mini-btn danger" data-id="${item.id}" data-action="delete">Löschen</button>
          </div>
        ` : `
          <div class="gartentodo-tools">
            <button type="button" class="event-share-btn gartentodo-share-btn" data-id="${item.id}" data-action="ical" title="In Kalender speichern">📅 Kalender</button>
            ${cardHistoryDrop}
          </div>
        `}
      </div>
    `;
  }).join("");

  grid.querySelectorAll(".gartentodo-done-btn[data-action='done']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rotate = grid.querySelector(`.gartentodo-rotate-next[data-id="${btn.dataset.id}"]`);
      void markGartenTodoDone(btn.dataset.id, rotate ? rotate.checked : true, btn);
    });
  });
  grid.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => void deleteGartenTodo(btn.dataset.id));
  });
  grid.querySelectorAll(".gartentodo-share-btn[data-action='ical']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = gartenTodoCache.find((t) => t.id === btn.dataset.id);
      if (item) downloadGartenTodoIcs(item);
    });
  });
  grid.querySelectorAll(".gartentodo-rotation-ical").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = gartenTodoCache.find((t) => t.id === btn.dataset.id);
      if (!item) return;
      const sel = grid.querySelector(
        `.gartentodo-rotation-who[data-rotation-who="${btn.dataset.id}"][data-due="${btn.dataset.due}"]`
      );
      const who = sel?.value || btn.dataset.who;
      downloadGartenTodoRotationIcs(item, btn.dataset.due, who, parseInt(btn.dataset.round, 10));
    });
  });
  grid.querySelectorAll(".gartentodo-rotation-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = grid.querySelector(
        `.gartentodo-rotation-who[data-rotation-who="${btn.dataset.id}"][data-due="${btn.dataset.due}"]`
      );
      void saveGartenTodoRotationSlot(
        btn.dataset.id,
        btn.dataset.due,
        parseInt(btn.dataset.round, 10),
        sel?.value,
        btn
      );
    });
  });
  grid.querySelectorAll(".gartentodo-verlauf-icon-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleGartenTodoRowHistory(btn.dataset.historyFor, btn.dataset.historyDue, grid);
    });
  });
  if (!window._gartenTodoHistoryAwayBound) {
    window._gartenTodoHistoryAwayBound = true;
    document.addEventListener("click", (e) => {
      window.setTimeout(() => {
        if (e.target.closest(".gartentodo-history-drop, .gartentodo-history-panel, .gartentodo-verlauf-icon-btn")) return;
        const g = $("gartenTodoGrid");
        if (g) closeGartenTodoHistoryPanels(g);
      }, 0);
    });
  }
  bindReminderCadenceControls(grid);
  renderGustavHub();
}

async function setReminderCadence(type, id, { reminder, everyDays } = {}) {
  if (type === "garten") {
    if (!requireMember("Garten To-Do")) return;
    const item = gartenTodoCache.find((t) => t.id === id);
    if (!item) return;
    const updates = {};
    if (reminder !== undefined) updates.reminder = !!reminder;
    if (everyDays !== undefined) updates.reminderEveryDays = normalizeReminderEveryDays(everyDays, 1);
    if (!Object.keys(updates).length) return;
    const parts = [];
    if (updates.reminder !== undefined) {
      parts.push(updates.reminder ? "WhatsApp-Erinnerung an" : "WhatsApp-Erinnerung aus");
    }
    if (updates.reminderEveryDays !== undefined) {
      parts.push(`Rhythmus: ${reminderEveryDaysLabel(updates.reminderEveryDays)}`);
    }
    updates.history = appendGartenTodoHistory(
      item,
      gartenTodoHistoryEntry("reminder", { fairNote: parts.join(" · ") })
    );
    await persistGartenTodoUpdates(id, updates, "📱 Erinnerung gespeichert.", "success");
    return;
  }
  if (type === "giess") {
    if (!requireAuth("Giessplan ändern")) return;
    const item = giessplanCache.find((g) => g.id === id);
    if (!item) return;
    const updates = {};
    if (reminder !== undefined) updates.reminder = !!reminder;
    if (everyDays !== undefined) updates.reminderEveryDays = normalizeReminderEveryDays(everyDays, 1);
    if (!Object.keys(updates).length) return;
    try {
      if (firebaseReady) {
        await updateDoc(doc(db, "giessplan", id), updates);
      } else {
        Object.assign(item, updates);
        localStore.giessplan = giessplanCache;
        saveLocal("giessplan", localStore.giessplan);
        renderGiessplan();
      }
      showToast("📱 Erinnerung gespeichert.", "success");
    } catch (err) {
      console.error("setReminderCadence giess", err);
      showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
    }
    return;
  }
  if (type === "schaden") {
    if (!requireAuth("Erinnerung speichern")) return;
    const item = schaedenCache.find((s) => s.id === id);
    if (!item || !item.zustaendig || item.status === "erledigt") return;
    const updates = {};
    if (reminder !== undefined) updates.reminder = !!reminder;
    if (everyDays !== undefined) {
      updates.reminderEveryDays = normalizeReminderEveryDays(everyDays, 7);
    }
    if (!Object.keys(updates).length) return;
    const parts = [];
    if (updates.reminder !== undefined) {
      parts.push(updates.reminder ? "WhatsApp-Erinnerung an" : "WhatsApp-Erinnerung aus");
    }
    if (updates.reminderEveryDays !== undefined) {
      parts.push(`Rhythmus: ${reminderEveryDaysLabel(updates.reminderEveryDays)}`);
    }
    updates.history = appendSchadenHistory(item, schadenHistoryEntry("reminder", { fairNote: parts.join(" · ") }));
    if (firebaseReady) {
      try {
        await updateDoc(doc(db, "schaeden", id), updates);
      } catch (e) {
        showToast("Speichern fehlgeschlagen.", "error");
      }
    } else {
      Object.assign(item, updates);
      schaedenCache = localStore.schaeden;
      saveLocal("schaeden", localStore.schaeden);
      renderSchaeden();
    }
    showToast("📱 Erinnerung gespeichert.", "success");
  }
}

async function persistGartenTodoUpdates(id, updates, toastMsg, toastType = "success") {
  const item = gartenTodoCache.find((t) => t.id === id);
  if (!item) return false;
  const snapshot = {};
  Object.keys(updates).forEach((k) => {
    const v = item[k];
    snapshot[k] = Array.isArray(v) ? [...v] : v;
  });
  Object.assign(item, updates);
  try {
    if (firebaseReady) {
      await updateDoc(doc(db, "gartentodos", id), updates);
    } else {
      localStore.gartentodos = gartenTodoCache;
      saveLocal("gartentodos", localStore.gartentodos);
    }
    renderGartenTodos();
    showToast(toastMsg, toastType);
    return true;
  } catch (err) {
    Object.assign(item, snapshot);
    console.error("persistGartenTodoUpdates", err);
    showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
    return false;
  }
}

async function saveGartenTodoRotationSlot(id, dueIso, roundIndex, who, triggerBtn = null) {
  if (!requireMember("Garten To-Do")) return;
  const item = gartenTodoCache.find((t) => t.id === id);
  if (!item || !who || !dueIso) {
    showToast("Bitte Person wählen.", "error");
    return;
  }
  const rows = buildGartenTodoRotation(item);
  const row = rows[roundIndex];
  const prevWho = row?.who || item.who;
  if (prevWho === who) {
    showToast("Keine Änderung – gleiche Person.", "info");
    return;
  }
  const fair = gartenTodoFairnessAfter(who, id);
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "…";
  }
  const history = appendGartenTodoHistory(
    item,
    gartenTodoHistoryEntry(roundIndex === 0 ? "plan" : "rotation", {
      who,
      nextDue: dueIso,
      prevWho,
      prevDue: roundIndex === 0 ? (item.nextDue || dueIso) : dueIso,
      fairNote: fair.text,
    })
  );
  const swapMeta = gartenTodoNewSwapMeta();
  let updates;
  if (roundIndex === 0) {
    updates = {
      who,
      nextDue: dueIso,
      whoManual: true,
      nextDueManual: true,
      whoSwappedBy: swapMeta.swappedBy,
      whoSwappedAt: swapMeta.swappedAt,
      rotationOverrides: removeGartenTodoRotationOverride(normalizeGartenTodoRotationOverrides(item), dueIso),
      history,
    };
  } else {
    updates = {
      rotationOverrides: upsertGartenTodoRotationOverride(
        normalizeGartenTodoRotationOverrides(item),
        dueIso,
        who,
        swapMeta
      ),
      whoManual: true,
      history,
    };
  }
  const ok = await persistGartenTodoUpdates(
    id,
    updates,
    fair.ok ? `Tausch gespeichert. ${fair.text}` : `Tausch gespeichert (Abweichung). ${fair.text}`,
    fair.ok ? "success" : "info"
  );
  if (triggerBtn) {
    triggerBtn.disabled = false;
    triggerBtn.innerHTML = GARTEN_TODO_ICON_SVG.swap;
  }
  if (!ok) renderGartenTodos();
}

async function markGartenTodoDone(id, rotateNext = true, triggerBtn = null) {
  if (!requireMember("Garten To-Do")) return;
  const item = gartenTodoCache.find((t) => t.id === id);
  if (!item) return;
  const now = new Date().toISOString();
  const interval = item.intervalDays || 14;
  const completedBy = auth.member || item.who || "WG";
  const nextWho = rotateNext ? pickFairAssignee(id) : item.who;
  const nextDue = toISODateLocal(nextGartenDueAfterDone(today0(), interval));
  const fair = gartenTodoFairnessAfter(nextWho, id);
  const history = appendGartenTodoHistory(
    item,
    gartenTodoHistoryEntry("done", {
      completedBy,
      who: nextWho,
      nextDue,
      fairNote: rotateNext ? `Fairness: ${fair.text}` : "Gleiche Person bleibt dran.",
    })
  );
  const updates = {
    lastDone: now,
    lastCompletedBy: completedBy,
    who: nextWho,
    nextDue,
    whoManual: false,
    nextDueManual: false,
    history,
  };

  const snapshot = {
    lastDone: item.lastDone,
    who: item.who,
    nextDue: item.nextDue,
    whoManual: item.whoManual,
    nextDueManual: item.nextDueManual,
    history: Array.isArray(item.history) ? [...item.history] : [],
  };

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "Speichern…";
  }

  Object.assign(item, updates);
  renderGartenTodos();

  try {
    if (firebaseReady) {
      await updateDoc(doc(db, "gartentodos", id), updates);
    } else {
      localStore.gartentodos = gartenTodoCache;
      saveLocal("gartentodos", localStore.gartentodos);
    }
    const rotHint = rotateNext ? `Nächste Person: ${nextWho || "—"}` : "Gleiche Person bleibt dran";
    showToast(`✅ ${TODO_CARD_LABELS.saveDoneGarten.replace(" speichern", "")} gespeichert! ${rotHint}`, "success");
  } catch (err) {
    console.error("markGartenTodoDone", err);
    Object.assign(item, snapshot);
    renderGartenTodos();
    showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
  }
}

async function deleteGartenTodo(id) {
  if (!requireAuth("Garten To-Do")) return;
  if (!confirm("Diese Garten-Aufgabe entfernen?")) return;
  if (firebaseReady) {
    await deleteDoc(doc(db, "gartentodos", id));
  } else {
    localStore.gartentodos = (localStore.gartentodos || []).filter((t) => t.id !== id);
    gartenTodoCache = localStore.gartentodos;
    saveLocal("gartentodos", localStore.gartentodos);
    renderGartenTodos();
  }
  showToast("Entfernt.", "success");
}

$("gartenTodoForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Garten To-Do")) return;
  const task = $("gartenTodoTask").value.trim();
  const intervalDays = parseInt($("gartenTodoInterval").value, 10);
  if (!task || !intervalDays) {
    showToast("Bitte Aufgabe und Intervall ausfüllen.", "error");
    return;
  }
  const whoPick = $("gartenTodoWho")?.value || "";
  const duePick = $("gartenTodoDue")?.value || "";
  let who = whoPick;
  let whoManual = false;
  if (!who) {
    who = pickFairAssignee();
    if (!who) {
      showToast("Keine aktiven Erwachsenen für die Verteilung.", "error");
      return;
    }
  } else {
    whoManual = true;
  }
  const fair = gartenTodoFairnessAfter(who, null);
  const entry = {
    task,
    intervalDays,
    reminder: $("gartenTodoReminder").checked,
    reminderEveryDays: normalizeReminderEveryDays($("gartenTodoReminderEvery")?.value, 1),
    who,
    whoManual,
    nextDue: duePick || defaultGartenTodoDueISO(),
    nextDueManual: !!(duePick && duePick !== defaultGartenTodoDueISO()),
    lastDone: null,
    history: [
      gartenTodoHistoryEntry("created", {
        who,
        nextDue: duePick || defaultGartenTodoDueISO(),
        fairNote: fair.text,
      }),
    ],
  };
  if (firebaseReady) {
    await addDoc(collection(db, "gartentodos"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    if (!localStore.gartentodos) localStore.gartentodos = [];
    localStore.gartentodos.push(entry);
    gartenTodoCache = localStore.gartentodos;
    saveLocal("gartentodos", localStore.gartentodos);
    renderGartenTodos();
  }
  e.target.reset();
  $("gartenTodoReminder").checked = true;
  populateGartenTodoWhoSelect();
  const dueHint = `fällig ${formatGartenWorkSlot(parseGartenTodoDueISO(duePick || defaultGartenTodoDueISO()))}`;
  showToast(`🌿 Gespeichert – ${who}, ${dueHint}.`, "success");
});

/* ==========================================================================
   Aufgaben – Render, Reihenfolge, Tausch, Verlauf (wie Garten To-Do)
   ========================================================================== */

function aufgabenIsRecurring(item) {
  return (item.intervalDays || 0) > 0;
}

function aufgabenNextDueDate(item) {
  const manual = parseGartenTodoDueISO(item.nextDue || item.when);
  if (manual) return manual;
  const interval = item.intervalDays || 0;
  if (!interval) return parseGartenTodoDueISO(item.when) || today0();
  if (item.lastDone) {
    return addDaysLocal(startOfDayLocal(new Date(item.lastDone)), interval);
  }
  return parseGartenTodoDueISO(item.when) || today0();
}

function formatAufgabenSlot(date) {
  return date.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Zurich",
  });
}

function getAufgabenStatus(item) {
  if (!aufgabenIsRecurring(item)) {
    return item.done ? "done" : "upcoming";
  }
  if (gartenTodoDoneToday(item)) return "done-today";
  const next = aufgabenNextDueDate(item);
  const today = today0();
  if (next < today) return "overdue";
  if (next.getTime() === today.getTime()) return "due-today";
  return "upcoming";
}

function buildAufgabenRotation(item, rounds = 10) {
  const interval = item.intervalDays || 7;
  const adults = [...getActiveAdultNames()].sort((a, b) => a.localeCompare(b, "de"));
  if (!adults.length) return [];
  const overridesByDue = gartenTodoRotationOverridesByDue(item);
  let who = item.who && adults.includes(item.who) ? item.who : adults[0];
  let date = aufgabenNextDueDate(item);
  const rows = [];
  for (let i = 0; i < rounds; i++) {
    const dueIso = toISODateLocal(date);
    let swapInfo = null;
    const ov = overridesByDue[dueIso];
    if (ov?.who && adults.includes(ov.who)) {
      who = ov.who;
      if (ov.swappedAt) swapInfo = { by: ov.swappedBy, at: ov.swappedAt };
    } else if (i === 0 && item.whoSwappedAt) {
      swapInfo = { by: item.whoSwappedBy, at: item.whoSwappedAt };
    }
    rows.push({
      who,
      date: new Date(date),
      dueIso,
      kw: formatKwLabel(date),
      slot: formatAufgabenSlot(date),
      current: i === 0,
      swapInfo,
      roundIndex: i,
    });
    const idx = adults.indexOf(who);
    who = adults[(idx + 1) % adults.length];
    date = addDaysLocal(date, interval);
  }
  return rows;
}

function aufgabenRotationHtml(item, canEdit = false) {
  const rows = buildAufgabenRotation(item);
  if (!rows.length) return "<p class=\"form-note\">Keine aktiven Erwachsenen.</p>";
  const lis = rows
    .map((r) => {
      const n = r.roundIndex + 1;
      const itemCls = [
        "gartentodo-rotation-item",
        r.current ? "is-next" : "",
        r.roundIndex > 0 ? "is-later" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const saveBtn = canEdit
        ? gartenTodoIconBtn(
            "gartentodo-rotation-save",
            "Person tauschen (z.B. Urlaub)",
            GARTEN_TODO_ICON_SVG.swap,
            `data-id="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-round="${r.roundIndex}"`
          )
        : "";
      const calBtn = gartenTodoIconBtn(
        "gartentodo-rotation-ical",
        "In Kalender speichern",
        GARTEN_TODO_ICON_SVG.calendar,
        `data-id="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-who="${escapeHtml(r.who)}" data-round="${r.roundIndex}"`
      );
      const historyDrop = r.swapInfo ? gartenTodoHistoryDropdownHtml(item, r) : "";
      const whoControls = canEdit
        ? `<select class="gartentodo-rotation-who" data-rotation-who="${escapeHtml(item.id)}" data-due="${escapeHtml(r.dueIso)}" data-round="${r.roundIndex}" aria-label="Person für ${escapeHtml(r.slot)}">${gartenTodoWhoOptionsHtml(r.who, false, true)}</select>`
        : `<span class="gartentodo-rotation-person-name">${escapeHtml(mLabel(r.who))}</span>`;
      return `<li class="${itemCls}">
        <div class="gartentodo-rotation-rank" aria-label="Termin ${n}">
          <span class="gartentodo-rotation-rank-n">${n}</span>
        </div>
        <div class="gartentodo-rotation-body">
          <p class="gartentodo-rotation-heading">
            <span class="gartentodo-rotation-when">${escapeHtml(r.slot)}</span>
          </p>
          <p class="gartentodo-rotation-kw">${r.kw}</p>
          <div class="gartentodo-rotation-toolbar">
            ${whoControls}
            <div class="gartentodo-icon-group" role="group" aria-label="Aktionen">
              ${saveBtn}
              ${calBtn}
              ${historyDrop}
            </div>
          </div>
        </div>
      </li>`;
    })
    .join("");
  const hint = canEdit
    ? `Icons: tauschen · Kalender · Uhr (Verlauf). Zeile 1 = nächste Runde, alle ${item.intervalDays || 7} Tage.`
    : `Wiederholung alle ${item.intervalDays || 7} Tage.`;
  return `<ol class="gartentodo-rotation-list" start="1">${lis}</ol><p class="form-note">${hint}</p>`;
}

function formatAufgabenCardSummary(item) {
  const status = getAufgabenStatus(item);
  const next = aufgabenNextDueDate(item);
  const whenLine = formatAufgabenSlot(next);
  if (status === "done") {
    return { chip: TODO_CARD_LABELS.chipDone, chipCls: "done", when: TODO_CARD_LABELS.doneToday };
  }
  if (status === "done-today") {
    return { chip: TODO_CARD_LABELS.chipDone, chipCls: "done", when: TODO_CARD_LABELS.doneToday };
  }
  if (status === "overdue") {
    const days = Math.ceil((today0() - next) / 86400000);
    return {
      chip: TODO_CARD_LABELS.chipActive,
      chipCls: "overdue",
      when: `${whenLine} · ${TODO_CARD_LABELS.overdueDays(days)}`,
    };
  }
  if (status === "due-today") {
    return { chip: TODO_CARD_LABELS.chipActive, chipCls: "due-today", when: whenLine };
  }
  return { chip: TODO_CARD_LABELS.chipActive, chipCls: "upcoming", when: whenLine };
}

function aufgabenShowDoneButton(item) {
  if (!aufgabenIsRecurring(item)) return !item.done;
  const s = getAufgabenStatus(item);
  return s === "overdue" || s === "due-today" || s === "upcoming";
}

function buildAufgabenIcs(item, dueIso, who, roundIndex = null) {
  const due = parseGartenTodoDueISO(dueIso) || aufgabenNextDueDate(item);
  if (isNaN(due.getTime())) return null;
  const assignee = who || item.who || "";
  const y = due.getFullYear();
  const mo = due.getMonth() + 1;
  const da = due.getDate();
  const dtStart = zurichWallToUtcDate(y, mo, da, 9, 0);
  const dtEnd = zurichWallToUtcDate(y, mo, da, 10, 0);
  const now = new Date();
  const roundSuffix = roundIndex != null ? `-r${roundIndex}` : "";
  const uid = `aufgabe-${item.id || due.getTime()}${roundSuffix}@hausamsee`;
  const summary = `📋 ${item.task} – ${mLabel(assignee)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Haus am See//Aufgaben//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(dtStart)}`,
    `DTEND:${toIcsDate(dtEnd)}`,
    foldIcsLine(`SUMMARY:${icsEscape(summary)}`),
    foldIcsLine(`LOCATION:${icsEscape("Haus am See, Pilatusstrasse 40, Pfäffikon ZH")}`),
  ];
  const descParts = [`Aufgabe · Zuständig: ${assignee || "—"}`];
  if (aufgabenIsRecurring(item)) descParts.push(`Wiederholung: alle ${item.intervalDays} Tage`);
  else descParts.push("Einmalige Aufgabe");
  if (roundIndex != null) descParts.push("Geplanter Termin aus Reihenfolge");
  descParts.push(gartenTodoPermalink());
  lines.push(foldIcsLine(`DESCRIPTION:${icsEscape(descParts.join("\n"))}`));
  lines.push(foldIcsLine(`URL:${gartenTodoPermalink()}`));
  appendIcsAlarms(lines, [
    { trigger: "-P1D", description: `Morgen: ${item.task}` },
    { trigger: "-PT0M", description: `Heute: ${item.task}` },
  ]);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

function downloadAufgabenIcs(item, dueIso, who, roundIndex = null) {
  const ics = buildAufgabenIcs(item, dueIso, who, roundIndex);
  if (!ics) {
    showToast("Termin ungültig.", "error");
    return;
  }
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = (item.task || "aufgabe")
    .replace(/[^a-z0-9äöüß -]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "aufgabe";
  a.download = `haus-am-see-aufgabe-${base}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Kalender-Datei heruntergeladen.", "success");
}

async function persistAufgabenUpdates(id, updates, toastMsg, toastType = "success") {
  const item = putzCache.find((p) => p.id === id);
  if (!item) return false;
  const snapshot = {};
  Object.keys(updates).forEach((k) => {
    const v = item[k];
    snapshot[k] = Array.isArray(v) ? [...v] : v;
  });
  Object.assign(item, updates);
  try {
    if (firebaseReady) {
      await updateDoc(doc(db, "putzplan", id), updates);
    } else {
      localStore.putzplan = putzCache;
      saveLocal("putzplan", localStore.putzplan);
    }
    renderAufgaben();
    showToast(toastMsg, toastType);
    return true;
  } catch (err) {
    Object.assign(item, snapshot);
    console.error("persistAufgabenUpdates", err);
    showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
    return false;
  }
}

async function saveAufgabenRotationSlot(id, dueIso, roundIndex, who, triggerBtn = null) {
  if (!requireMember("Aufgaben")) return;
  const item = putzCache.find((p) => p.id === id);
  if (!item || !who || !dueIso) {
    showToast("Bitte Person wählen.", "error");
    return;
  }
  const rows = buildAufgabenRotation(item);
  const row = rows[roundIndex];
  const prevWho = row?.who || item.who;
  if (prevWho === who) {
    showToast("Keine Änderung – gleiche Person.", "info");
    return;
  }
  if (triggerBtn) {
    triggerBtn.disabled = true;
  }
  const history = appendGartenTodoHistory(
    item,
    gartenTodoHistoryEntry(roundIndex === 0 ? "plan" : "rotation", {
      who,
      nextDue: dueIso,
      prevWho,
      prevDue: roundIndex === 0 ? (item.when || dueIso) : dueIso,
      fairNote: `Tausch: ${mLabel(prevWho)} → ${mLabel(who)}`,
    })
  );
  const swapMeta = gartenTodoNewSwapMeta();
  let updates;
  if (roundIndex === 0) {
    updates = {
      who,
      when: dueIso,
      nextDue: dueIso,
      whoManual: true,
      whoSwappedBy: swapMeta.swappedBy,
      whoSwappedAt: swapMeta.swappedAt,
      rotationOverrides: removeGartenTodoRotationOverride(normalizeGartenTodoRotationOverrides(item), dueIso),
      history,
    };
  } else {
    updates = {
      rotationOverrides: upsertGartenTodoRotationOverride(
        normalizeGartenTodoRotationOverrides(item),
        dueIso,
        who,
        swapMeta
      ),
      whoManual: true,
      history,
    };
  }
  const ok = await persistAufgabenUpdates(id, updates, `Tausch gespeichert (${mLabel(who)}).`);
  if (triggerBtn) {
    triggerBtn.disabled = false;
    triggerBtn.innerHTML = GARTEN_TODO_ICON_SVG.swap;
  }
  if (!ok) renderAufgaben();
}

async function markAufgabenDone(id, rotateNext = true) {
  if (!requireMember("Aufgaben")) return;
  const item = putzCache.find((p) => p.id === id);
  if (!item) return;
  if (!aufgabenIsRecurring(item)) {
    const history = appendGartenTodoHistory(
      item,
      gartenTodoHistoryEntry("done", {
        completedBy: auth.member || item.who || "WG",
        fairNote: "Einmalige Aufgabe erledigt",
      })
    );
    await persistAufgabenUpdates(id, { done: true, history }, "✅ Erledigt gespeichert.");
    return;
  }
  const now = new Date().toISOString();
  const interval = item.intervalDays || 7;
  const completedBy = auth.member || item.who || "WG";
  const nextWho = rotateNext ? pickNextAssignee(item.who) : item.who;
  const nextDue = toISODateLocal(addDaysLocal(today0(), interval));
  const history = appendGartenTodoHistory(
    item,
    gartenTodoHistoryEntry("done", {
      completedBy,
      who: nextWho,
      nextDue,
      fairNote: rotateNext ? `Nächste Person: ${mLabel(nextWho)}` : "Gleiche Person bleibt dran.",
    })
  );
  await persistAufgabenUpdates(
    id,
    {
      lastDone: now,
      lastCompletedBy: completedBy,
      who: nextWho,
      when: nextDue,
      nextDue,
      done: false,
      whoManual: false,
      history,
    },
    `✅ Erledigt – nächste Runde: ${mLabel(nextWho)}, ${formatAufgabenSlot(parseGartenTodoDueISO(nextDue))}.`
  );
}

async function toggleAufgabenOneShot(id) {
  if (!requireAuth("Aufgaben ändern")) return;
  const item = putzCache.find((p) => p.id === id);
  if (!item || aufgabenIsRecurring(item)) return;
  const nextDone = !item.done;
  const history = appendGartenTodoHistory(
    item,
    gartenTodoHistoryEntry("done", {
      fairNote: nextDone ? "Einmalige Aufgabe erledigt" : "Wieder als offen markiert",
    })
  );
  await persistAufgabenUpdates(
    id,
    { done: nextDone, history },
    nextDone ? "Als erledigt markiert." : "Wieder offen."
  );
}

async function deleteAufgabe(id) {
  if (!requireAuth("Aufgaben löschen")) return;
  if (!confirm("Diese Aufgabe wirklich löschen?")) return;
  if (firebaseReady) {
    await deleteDoc(doc(db, "putzplan", id));
  } else {
    localStore.putzplan = localStore.putzplan.filter((p) => p.id !== id);
    putzCache = localStore.putzplan;
    saveLocal("putzplan", localStore.putzplan);
    renderAufgaben();
  }
  showToast("Entfernt.", "success");
}

function renderAufgaben() {
  const grid = $("aufgabenGrid");
  if (!grid) return;

  const order = { overdue: 0, "due-today": 1, upcoming: 2, done: 3, "done-today": 4 };
  const sorted = [...putzCache].sort((a, b) => {
    const sa = getAufgabenStatus(a);
    const sb = getAufgabenStatus(b);
    const diff = (order[sa] ?? 2) - (order[sb] ?? 2);
    if (diff !== 0) return diff;
    return aufgabenNextDueDate(a) - aufgabenNextDueDate(b);
  });

  if (!sorted.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Noch keine Aufgaben – Zeit, die Liste zu starten! 📋</div>`;
    renderGustavHub();
    return;
  }

  grid.innerHTML = sorted
    .map((item) => {
      const status = getAufgabenStatus(item);
      const summary = formatAufgabenCardSummary(item);
      const recurring = aufgabenIsRecurring(item);
      const whoName = item.who ? mLabel(item.who) : "Noch offen";
      const whoEmoji = item.who ? mEmoji(item.who) : "👤";
      const canEdit = auth.isMember;
      const showDoneBtn = aufgabenShowDoneButton(item);
      const cardHistoryDrop = gartenTodoCardHistoryDropdownHtml(item);
      const typeBadge = recurring
        ? `<span class="gartentodo-badge">🔁 alle ${item.intervalDays} Tage</span>`
        : `<span class="gartentodo-badge manual">📌 einmalig</span>`;

      return `
      <div class="gartentodo-card ${status}">
        <header class="gartentodo-card-head">
          <div class="gartentodo-hero">
            <p class="gartentodo-hero-label">${TODO_CARD_LABELS.task}</p>
            <h3 class="gartentodo-task-title">${escapeHtml(item.task)}</h3>
            <div class="gartentodo-assignee${item.who ? "" : " is-empty"}">
              <span class="gartentodo-assignee-label">${TODO_CARD_LABELS.assignee}</span>
              <span class="gartentodo-assignee-value"><span class="gartentodo-assignee-emoji" aria-hidden="true">${whoEmoji}</span> ${escapeHtml(whoName)}</span>
            </div>
          </div>
          <div class="gartentodo-head-end">
            ${typeBadge}
            <span class="gartentodo-status-chip ${summary.chipCls}">${escapeHtml(summary.chip)}</span>
          </div>
        </header>
        <p class="gartentodo-when-line">${escapeHtml(summary.when)}</p>
        ${canEdit && recurring ? `
          <details class="gartentodo-subdetails">
            <summary>📅 Reihenfolge &amp; Tausch</summary>
            ${aufgabenRotationHtml(item, true)}
          </details>
          ${showDoneBtn
            ? `<div class="gartentodo-done-actions">
            <button type="button" class="mini-btn gartentodo-done-btn" data-id="${item.id}" data-action="done">✅ ${TODO_CARD_LABELS.saveDoneGarten}</button>
          </div>`
            : ""}
        ` : ""}
        ${canEdit ? `
          <div class="gartentodo-tools">
            ${recurring
              ? `<button type="button" class="event-share-btn gartentodo-share-btn" data-id="${item.id}" data-action="ical-main" title="Nächste Runde in den Kalender">📅 Kalender</button>`
              : ""}
            ${cardHistoryDrop}
          </div>
          <div class="gartentodo-actions">
            ${!recurring
              ? `<button type="button" class="mini-btn" data-id="${item.id}" data-action="toggle">${item.done ? "↺ Wieder offen" : "✅ Erledigt"}</button>`
              : ""}
            <button type="button" class="mini-btn danger" data-id="${item.id}" data-action="delete">Löschen</button>
          </div>
        ` : `<div class="gartentodo-tools">${cardHistoryDrop}</div>`}
      </div>`;
    })
    .join("");

  grid.querySelectorAll(".gartentodo-done-btn[data-action='done']").forEach((btn) => {
    btn.addEventListener("click", () => void markAufgabenDone(btn.dataset.id, true));
  });
  grid.querySelectorAll("[data-action='toggle']").forEach((btn) => {
    btn.addEventListener("click", () => void toggleAufgabenOneShot(btn.dataset.id));
  });
  grid.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", () => void deleteAufgabe(btn.dataset.id));
  });
  grid.querySelectorAll(".gartentodo-share-btn[data-action='ical-main']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = putzCache.find((p) => p.id === btn.dataset.id);
      if (!item) return;
      downloadAufgabenIcs(item, toISODateLocal(aufgabenNextDueDate(item)), item.who);
    });
  });
  renderGustavHub();
  grid.querySelectorAll(".gartentodo-rotation-ical").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = putzCache.find((p) => p.id === btn.dataset.id);
      if (!item) return;
      const sel = grid.querySelector(
        `.gartentodo-rotation-who[data-rotation-who="${btn.dataset.id}"][data-due="${btn.dataset.due}"]`
      );
      const who = sel?.value || btn.dataset.who;
      downloadAufgabenIcs(item, btn.dataset.due, who, parseInt(btn.dataset.round, 10));
    });
  });
  grid.querySelectorAll(".gartentodo-rotation-save").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = grid.querySelector(
        `.gartentodo-rotation-who[data-rotation-who="${btn.dataset.id}"][data-due="${btn.dataset.due}"]`
      );
      void saveAufgabenRotationSlot(
        btn.dataset.id,
        btn.dataset.due,
        parseInt(btn.dataset.round, 10),
        sel?.value,
        btn
      );
    });
  });
  grid.querySelectorAll(".gartentodo-verlauf-icon-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleGartenTodoRowHistory(btn.dataset.historyFor, btn.dataset.historyDue, grid);
    });
  });
  if (!window._aufgabenHistoryAwayBound) {
    window._aufgabenHistoryAwayBound = true;
    document.addEventListener("click", (e) => {
      window.setTimeout(() => {
        if (e.target.closest(".gartentodo-history-drop, .gartentodo-history-panel, .gartentodo-verlauf-icon-btn")) return;
        const g = $("aufgabenGrid");
        if (g) closeGartenTodoHistoryPanels(g);
      }, 0);
    });
  }
}

$("aufgabenForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Aufgaben")) return;
  const task = $("aufgabenTask").value.trim();
  const who = $("aufgabenWho").value;
  const when = $("aufgabenWhen").value;
  const intervalDays = parseInt($("aufgabenInterval").value, 10) || 0;
  if (!task || !who || !when) {
    showToast("Bitte Aufgabe, Person und Datum ausfüllen.", "error");
    return;
  }
  const entry = {
    task,
    who,
    when,
    nextDue: when,
    intervalDays,
    done: false,
    lastDone: null,
    rotationOverrides: [],
    history: [
      gartenTodoHistoryEntry("created", {
        who,
        nextDue: when,
        fairNote: intervalDays ? `Wiederholung alle ${intervalDays} Tage` : "Einmalige Aufgabe",
      }),
    ],
  };
  if (firebaseReady) {
    await addDoc(collection(db, "putzplan"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    localStore.putzplan.push(entry);
    putzCache = localStore.putzplan;
    saveLocal("putzplan", localStore.putzplan);
    renderAufgaben();
  }
  e.target.reset();
  setAufgabenFormDefaults();
  populateAufgabenWhoSelect();
  showToast("Aufgabe gespeichert.", "success");
});

/* ==========================================================================
   Termine (mit WG-RSVP)
   ========================================================================== */

let termineCache = [];

/** Geburtstag aus Profil (MM-TT, MM-DD oder JJJJ-MM-TT) – gleiche Logik wie functions/birthdays.js */
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

function zurichYmdParts(date = new Date()) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date).split("-");
  return { year: +y, month: +m, day: +d };
}

function birthdayAgeTurning(birth, celebrationYear) {
  if (!birth?.year || !celebrationYear) return null;
  return celebrationYear - birth.year;
}

/** Nächstes Geburtstagsdatum (09:00 Europe/Zurich) für Kalender-Eintrag */
function nextBirthdayDateTime(birth) {
  const zurich = zurichYmdParts();
  let year = zurich.year;
  if (birth.month < zurich.month || (birth.month === zurich.month && birth.day < zurich.day)) {
    year += 1;
  }
  let month = birth.month;
  let day = birth.day;
  if (month === 2 && day === 29) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    if (!leap) day = 28;
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T09:00`;
}

/** Automatische Kalender-Termine aus memberPrefs.birthDate */
function getBirthdayTermine() {
  const out = [];
  for (const b of getActiveBewohner()) {
    const birth = parseBirthDate(authConfig.memberPrefs[b.name]?.birthDate);
    if (!birth) continue;
    const date = nextBirthdayDateTime(birth);
    const celebrationYear = +date.slice(0, 4);
    const label = mLabel(b.name);
    const age = birthdayAgeTurning(birth, celebrationYear);
    out.push({
      id: `birthday:${b.name}:${celebrationYear}`,
      title: `🎂 Geburtstag ${label}`,
      note: age != null
        ? `${label} wird ${age} – Zeit zu feiern! 🎉`
        : `Geburtstag von ${label} 🎉`,
      date,
      isBirthday: true,
      birthdayPerson: b.name,
      createdBy: b.name,
      responses: {},
    });
  }
  return out;
}

function isBirthdayTerminId(id) {
  return String(id || "").startsWith("birthday:");
}

function renderTermine() {
  const list = $("termineList");
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const upcoming = [...termineCache, ...getBirthdayTermine()]
    .filter(t => new Date(t.date) >= todayStart)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) {
    list.innerHTML = `<div class="empty-state">Keine anstehenden Termine.</div>`;
    return;
  }

  list.innerHTML = upcoming.map(t => {
    const d = new Date(t.date);
    const responses = t.responses || {};
    const myResponse = auth.isAuthed ? responses[auth.member] : null;

    // Response-Badges: Erwachsene Bewohner mit Status
    const badges = bewohnerFuerTerminBadges(responses).map((b) => {
      const status = responses[b.name];
      const classes = status ? status : "pending";
      const icon = status === "yes" ? "✓" : status === "no" ? "✗" : status === "maybe" ? "?" : "…";
      return `<span class="response-badge ${classes}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))} ${icon}</span>`;
    }).join("");

    return `
      <div class="termin-card${t.isBirthday ? " termin-birthday" : ""}">
        <div class="termin-date">
          <span class="day">${String(d.getDate()).padStart(2,"0")}</span>
          <span class="month">${monthShort[d.getMonth()]}</span>
          <span class="time">${d.toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"})}</span>
        </div>
        <div class="termin-body">
          <h3>${escapeHtml(t.title)}</h3>
          ${t.note ? `<p class="termin-note">${escapeHtml(t.note)}</p>` : ""}
          ${t.isBirthday
            ? `<p class="termin-creator">Automatisch aus Profil-Einstellungen</p>`
            : (t.createdBy ? `<p class="termin-creator">Erstellt von ${escapeHtml(mLabel(t.createdBy))}</p>` : "")}
          <div class="termin-responses">${badges}</div>
          ${auth.isAuthed ? `
            <div class="termin-my-response">
              <span class="label">Deine Antwort (${escapeHtml(mLabel(auth.member))}):</span>
              <div class="response-buttons">
                <button class="response-btn yes ${myResponse === 'yes' ? 'active' : ''}" data-id="${t.id}" data-response="yes">✓ Zusage</button>
                <button class="response-btn maybe ${myResponse === 'maybe' ? 'active' : ''}" data-id="${t.id}" data-response="maybe">? Vielleicht</button>
                <button class="response-btn no ${myResponse === 'no' ? 'active' : ''}" data-id="${t.id}" data-response="no">✗ Absage</button>
              </div>
            </div>
          ` : `<p class="form-note" style="text-align:left;margin-top:10px;">Zum Zu-/Absagen bitte anmelden.</p>`}
          <div class="event-share termin-share">
            <button class="event-share-btn termin-share-btn" data-action="ical" data-id="${t.id}" title="In Kalender speichern">📅 Kalender</button>
            <button class="event-share-btn termin-share-btn" data-action="share" data-id="${t.id}" title="Termin teilen">📤 Teilen</button>
          </div>
        </div>
        ${auth.isAuthed && !t.isBirthday ? `<button class="mini-btn danger termin-delete" data-id="${t.id}">Löschen</button>` : ""}
      </div>
    `;
  }).join("");

  list.querySelectorAll(".response-btn").forEach(btn => {
    btn.addEventListener("click", () => setTerminResponse(btn.dataset.id, btn.dataset.response));
  });
  list.querySelectorAll(".termin-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireAuth("Termine löschen")) return;
      if (confirm("Termin wirklich löschen?")) deleteTermin(btn.dataset.id);
    });
  });
  list.querySelectorAll(".termin-share-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = termineCache.find(x => x.id === btn.dataset.id);
      if (!t) return;
      const ev = {
        id: t.id,
        title: t.title,
        date: t.date,
        description: t.note || "",
        emoji: "📅",
        location: "Haus am See, Pilatusstrasse 40, Pfäffikon ZH",
      };
      if (btn.dataset.action === "ical") downloadEventIcs(ev, "kalender");
      else if (btn.dataset.action === "share") shareEvent(ev, "kalender");
    });
  });
}

async function setTerminResponse(terminId, response) {
  if (!requireAuth("Zu-/Absagen")) return;
  if (isBirthdayTerminId(terminId)) return;
  if (firebaseReady) {
    const current = termineCache.find(t => t.id === terminId);
    const existing = current?.responses?.[auth.member];
    // Toggle wenn gleich
    const newValue = existing === response ? deleteField() : response;
    try {
      await updateDoc(doc(db, "termine", terminId), {
        [`responses.${auth.member}`]: newValue
      });
    } catch (e) {
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    const item = localStore.termine.find(t => t.id === terminId);
    if (!item) return;
    item.responses = item.responses || {};
    if (item.responses[auth.member] === response) {
      delete item.responses[auth.member];
    } else {
      item.responses[auth.member] = response;
    }
    termineCache = localStore.termine;
    saveLocal("termine", localStore.termine);
    renderTermine();
  }
}

async function deleteTermin(id) {
  if (isBirthdayTerminId(id)) return;
  if (firebaseReady) {
    await deleteDoc(doc(db, "termine", id));
  } else {
    localStore.termine = localStore.termine.filter(t => t.id !== id);
    termineCache = localStore.termine;
    saveLocal("termine", localStore.termine);
    renderTermine();
  }
  showToast("Termin gelöscht.");
}

$("termineForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Termine erstellen")) return;
  const entry = {
    title: $("termTitle").value.trim(),
    date: $("termDate").value,
    note: $("termNote").value.trim(),
    responses: {},
    createdBy: auth.member,
    createdAt: Date.now()
  };
  if (firebaseReady) {
    await addDoc(collection(db, "termine"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    localStore.termine.push(entry);
    termineCache = localStore.termine;
    saveLocal("termine", localStore.termine);
    renderTermine();
  }
  e.target.reset();
  e.target.parentElement.open = false;
  showToast("Termin erstellt.", "success");
});

/* ==========================================================================
   Anwesenheit (Wochenende)
   ========================================================================== */

function getWeekendKey() {
  const now = new Date();
  const day = now.getDay();
  const diffToSat = (6 - day + 7) % 7;
  const sat = new Date(now);
  sat.setDate(now.getDate() + diffToSat);
  return sat.toISOString().slice(0, 10);
}

let anwesendCache = {};

function parseAnwesendStatus(val) {
  if (!val) return { status: "unknown", bis: null };
  if (typeof val === "string") return { status: val, bis: null };
  return { status: val.status || "unknown", bis: val.bis || null };
}

function formatWegBis(bis) {
  if (!bis) return "";
  try {
    const d = new Date(bis);
    return d.toLocaleDateString("de-CH", { day: "numeric", month: "short" });
  } catch { return ""; }
}

function renderAnwesend() {
  const grid = $("anwesendGrid");
  const weekendKey = getWeekendKey();
  const weekendData = anwesendCache[weekendKey] || {};
  grid.innerHTML = getActiveBewohner().map(b => {
    const { status, bis } = parseAnwesendStatus(weekendData[b.name]);
    const canEdit = auth.isAuthed && auth.member === b.name;
    const bisText = status === "weg" && bis ? `<span class="weg-bis">bis ${formatWegBis(bis)}</span>` : "";
    return `
      <div class="anwesend-card">
        <div class="anwesend-emoji">${mEmoji(b.name)}</div>
        <strong>${escapeHtml(mLabel(b.name))}</strong>
        ${bisText}
        <div class="anwesend-btn">
          <button class="da ${status==='da'?'active':''}" data-name="${escapeHtml(b.name)}" data-status="da" ${canEdit?"":"disabled"}>Da</button>
          <button class="weg ${status==='weg'?'active':''}" data-name="${escapeHtml(b.name)}" data-status="weg" ${canEdit?"":"disabled"}>Weg</button>
        </div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll("button[data-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (btn.dataset.status === "weg") {
        openWegDialog(btn.dataset.name);
      } else {
        setAnwesend(btn.dataset.name, "da", null);
      }
    });
  });
}

function openWegDialog(name) {
  const weekendKey = getWeekendKey();
  const weekendData = anwesendCache[weekendKey] || {};
  const { bis } = parseAnwesendStatus(weekendData[name]);
  
  const dialog = document.createElement("dialog");
  dialog.className = "auth-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="auth-form" style="max-width:350px;">
      <h2 class="auth-title">🏖️ Weg bis wann?</h2>
      <div class="form-row">
        <label for="wegBisDate">Zurück am (optional)</label>
        <input id="wegBisDate" type="date" value="${bis || ""}" />
      </div>
      <p class="form-note" style="font-size:0.85rem;color:#666;">Leer lassen wenn du nicht weisst wann du zurück bist.</p>
      <div class="auth-btns">
        <button type="button" class="btn-secondary" id="wegCancelBtn">Abbrechen</button>
        <button type="submit" class="btn-primary">✅ Speichern</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  
  dialog.querySelector("#wegCancelBtn").addEventListener("click", () => {
    dialog.close();
    dialog.remove();
  });
  
  dialog.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bisDate = dialog.querySelector("#wegBisDate").value || null;
    await setAnwesend(name, "weg", bisDate);
    dialog.close();
    dialog.remove();
  });
  
  dialog.showModal();
}

async function setAnwesend(name, status, bis = null) {
  if (!auth.isAuthed || auth.member !== name) {
    showToast("Du kannst nur deinen eigenen Status ändern.", "error");
    return;
  }
  const weekendKey = getWeekendKey();
  const value = status === "weg" && bis ? { status: "weg", bis } : status;
  
  if (firebaseReady) {
    await setDoc(doc(db, "anwesenheit", weekendKey), { [name]: value }, { merge: true });
  } else {
    anwesendCache[weekendKey] = { ...(anwesendCache[weekendKey] || {}), [name]: value };
    localStore.anwesenheit = anwesendCache;
    saveLocal("anwesenheit", localStore.anwesenheit);
    renderAnwesend();
  }
}

/* ==========================================================================
   Wellness · Jacuzzi-Temp & Belegung (Sauna / Jacuzzi / Kino)
   ========================================================================== */

const WELLNESS_RESOURCES = {
  sauna: { emoji: "🧖", label: "Sauna" },
  jacuzzi: { emoji: "🛁", label: "Jacuzzi" },
  kino: { emoji: "🎬", label: "Kino" },
};

const JACUZZI_WARM_TEMP_C = 36;

let wellnessBookingsCache = [];
let jacuzziReadingsCache = [];
let jacuzziStatusCache = null;
const JACUZZI_VERLAUF_LIMIT = 10;
const JACUZZI_HERO_EXPANDED_KEY = "has_jacuzzi_hero_open";
let jacuzziHeroVerlaufOpen = false;
let jacuzziHeroExpanded = localStorage.getItem(JACUZZI_HERO_EXPANDED_KEY) === "1";

function wellnessTimestampMs(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v === "number") return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function getActiveWellnessBooking(resource, nowMs = Date.now()) {
  return wellnessBookingsCache.find((b) => {
    if (b.resource !== resource) return false;
    const start = wellnessTimestampMs(b.startAt);
    const end = wellnessTimestampMs(b.endAt);
    return start != null && end != null && start <= nowMs && end > nowMs;
  }) || null;
}

function fmtWellnessTimeRange(startAt, endAt) {
  const opts = { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" };
  const s = new Date(startAt).toLocaleTimeString("de-CH", opts);
  const e = new Date(endAt).toLocaleTimeString("de-CH", opts);
  return `${s}–${e}`;
}

function fmtWellnessDateLabel(startAt) {
  const start = new Date(startAt);
  const today0 = startOfDayLocal(new Date()).getTime();
  const day0 = startOfDayLocal(start).getTime();
  if (day0 === today0) return "heute";
  const tomorrow0 = today0 + 86400000;
  if (day0 === tomorrow0) return "morgen";
  return start.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Europe/Zurich",
  });
}

function isJacuzziWarm(status) {
  const temp = status?.tempC != null ? Number(status.tempC) : null;
  const threshold = status?.warmThresholdC != null ? Number(status.warmThresholdC) : JACUZZI_WARM_TEMP_C;
  return temp != null && !Number.isNaN(temp) && temp >= threshold;
}

function fmtJacuzziWhen(v) {
  const ms = wellnessTimestampMs(v);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

function jacuzziSourceLabel(source) {
  if (source === "blueriiot") return "Blue Riiot";
  if (source === "manual") return "Manuell";
  return source || "";
}

function jacuzziMetricFromStatus(status, key) {
  const value = status?.[key];
  if (value == null || Number.isNaN(Number(value))) return null;
  return {
    value: Number(value),
    okMin: status?.[`${key}OkMin`],
    okMax: status?.[`${key}OkMax`],
    warnLow: status?.[`${key}WarnLow`],
    warnHigh: status?.[`${key}WarnHigh`],
  };
}

function jacuzziAmpelLevel(metric) {
  if (!metric || metric.value == null || Number.isNaN(metric.value)) return "unknown";
  const v = metric.value;
  const { okMin, okMax, warnLow, warnHigh } = metric;
  if (okMin != null && okMax != null && v >= okMin && v <= okMax) return "ok";
  if (warnLow != null && warnHigh != null && v >= warnLow && v <= warnHigh) return "warn";
  return "bad";
}

function jacuzziAmpelLabel(level) {
  if (level === "ok") return "Gut";
  if (level === "warn") return "Warnung";
  if (level === "bad") return "Schlecht";
  return "Keine Daten";
}

const JACUZZI_GAUGE_META = {
  tempC: {
    label: "Temperatur",
    field: "tempC",
    gaugeMin: 0,
    gaugeMax: 50,
    warnLow: 5,
    okMin: 30,
    okMax: 40,
    warnHigh: 50,
    format: (v) => `${Number(v).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`,
    markerFmt: (v) => String(Math.round(v)),
  },
  ph: {
    label: "pH-Wert",
    field: "ph",
    gaugeMin: 5,
    gaugeMax: 10,
    warnLow: 6.6,
    okMin: 7.2,
    okMax: 7.6,
    warnHigh: 8.4,
    format: (v) => Number(v).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    markerFmt: (v) => Number(v).toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  },
  orp: {
    label: "Chlorgehalt",
    field: "orp",
    gaugeMin: 300,
    gaugeMax: 1000,
    warnLow: 400,
    okMin: 550,
    okMax: 650,
    warnHigh: 900,
    format: (v) => `${Math.round(Number(v)).toLocaleString("de-CH")} mV`,
    markerFmt: (v) => String(Math.round(v)),
  },
};

function jacuzziGaugeMetric(key, status = {}) {
  const meta = JACUZZI_GAUGE_META[key];
  if (!meta) return null;
  const field = meta.field;
  const raw = status?.[field];
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const fromStatus = (suffix) => {
    if (key === "tempC") return null;
    const v = status?.[`${field}${suffix}`];
    return v != null ? Number(v) : null;
  };
  return {
    value: Number(raw),
    label: meta.label,
    gaugeMin: fromStatus("GaugeMin") ?? meta.gaugeMin,
    gaugeMax: fromStatus("GaugeMax") ?? meta.gaugeMax,
    warnLow: fromStatus("WarnLow") ?? meta.warnLow,
    okMin: fromStatus("OkMin") ?? meta.okMin,
    okMax: fromStatus("OkMax") ?? meta.okMax,
    warnHigh: fromStatus("WarnHigh") ?? meta.warnHigh,
    format: meta.format,
    markerFmt: meta.markerFmt,
  };
}

function fmtJacuzziRelative(v) {
  const ms = wellnessTimestampMs(v);
  if (!ms) return "";
  const diffSec = Math.round((ms - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("de-CH", { numeric: "auto" });
  const steps = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, sec] of steps) {
    if (Math.abs(diffSec) >= sec || unit === "minute") {
      return rtf.format(Math.round(diffSec / sec), unit);
    }
  }
  return "";
}

function jacuzziGaugePct(metric, value) {
  const span = metric.gaugeMax - metric.gaugeMin;
  if (!span) return 50;
  return Math.max(0, Math.min(100, ((value - metric.gaugeMin) / span) * 100));
}

function jacuzziGaugeSegments(metric) {
  const min = metric.gaugeMin;
  const max = metric.gaugeMax;
  const pct = (v) => jacuzziGaugePct(metric, v);
  const defs = [
    { cls: "bad", from: min, to: metric.warnLow },
    { cls: "warn", from: metric.warnLow, to: metric.okMin },
    { cls: "ok", from: metric.okMin, to: metric.okMax },
    { cls: "warn", from: metric.okMax, to: metric.warnHigh },
    { cls: "bad", from: metric.warnHigh, to: max },
  ];
  return defs
    .filter((s) => s.from != null && s.to != null && s.to > s.from)
    .map((s) => ({
      cls: s.cls,
      left: pct(s.from),
      width: pct(s.to) - pct(s.from),
    }));
}

function jacuzziGaugeMarkers(metric) {
  const pts = [metric.warnLow, metric.okMin, metric.okMax, metric.warnHigh].filter((v) => v != null);
  const uniq = [...new Set(pts.map((v) => Number(v)))].sort((a, b) => a - b);
  return uniq.map((v) => ({
    value: v,
    left: jacuzziGaugePct(metric, v),
    label: metric.markerFmt(v),
  }));
}

function buildJacuzziGaugeCard(key, status, measuredAt, { compact = false } = {}) {
  const metric = jacuzziGaugeMetric(key, status);
  if (!metric) return "";
  const level = jacuzziAmpelLevel(metric);
  const pos = jacuzziGaugePct(metric, metric.value);
  const rel = fmtJacuzziRelative(measuredAt);
  const segments = jacuzziGaugeSegments(metric)
    .map(
      (s) =>
        `<div class="bc-gauge-seg is-${s.cls}" style="left:${s.left.toFixed(2)}%;width:${s.width.toFixed(2)}%"></div>`
    )
    .join("");
  const markers = jacuzziGaugeMarkers(metric)
    .map((m) => `<span class="bc-gauge-marker" style="left:${m.left.toFixed(2)}%">${escapeHtml(m.label)}</span>`)
    .join("");
  return `
    <article class="bc-gauge-card${compact ? " is-compact" : ""}">
      <div class="bc-gauge-head">
        <span class="bc-gauge-title">${escapeHtml(metric.label)}</span>
        <span class="bc-gauge-meta">${rel ? `<span class="bc-gauge-age">${escapeHtml(rel)}</span>` : ""}<span class="bc-gauge-src" title="Blue Riiot Cloud">☁️</span></span>
      </div>
      <div class="bc-gauge-body">
        <div class="bc-gauge-markers">${markers}</div>
        <div class="bc-gauge-track" role="img" aria-label="${escapeHtml(metric.label)}: ${escapeHtml(metric.format(metric.value))}, ${escapeHtml(jacuzziAmpelLabel(level))}">
          ${segments}
          <div class="bc-gauge-bubble is-${level}" style="left:${pos.toFixed(2)}%">
            <span>${escapeHtml(metric.format(metric.value))}</span>
          </div>
        </div>
      </div>
    </article>`;
}

function buildJacuzziConnectLegend(compact = false) {
  return `
    <div class="bc-legend${compact ? " is-compact" : ""}" aria-hidden="true">
      <span class="bc-legend-item"><span class="bc-legend-dot is-bad"></span>Schlecht</span>
      <span class="bc-legend-item"><span class="bc-legend-dot is-warn"></span>Warnung</span>
      <span class="bc-legend-item"><span class="bc-legend-dot is-ok"></span>Gut</span>
    </div>`;
}

function buildJacuzziConnectDashboard(status, { compact = false } = {}) {
  const at = status?.updatedAt;
  const cards = ["tempC", "ph", "orp"]
    .map((key) => buildJacuzziGaugeCard(key, status, at, { compact }))
    .filter(Boolean);
  if (!cards.length) {
    return `<p class="form-note bc-empty">Noch keine Messungen aus der Blue&nbsp;Riiot-Cloud.</p>`;
  }
  const header = compact
    ? ""
    : `<div class="bc-dashboard-head"><span class="bc-dashboard-brand">Blue Connect</span>${status?.source ? `<span class="bc-dashboard-src">${escapeHtml(jacuzziSourceLabel(status.source))}</span>` : ""}</div>`;
  return `
    <div class="bc-dashboard${compact ? " is-compact" : ""}">
      ${buildJacuzziConnectLegend(compact)}
      ${header}
      <div class="bc-gauge-stack">${cards.join("")}</div>
    </div>`;
}

function getJacuzziReadingsSorted(limit = JACUZZI_VERLAUF_LIMIT) {
  return [...jacuzziReadingsCache]
    .sort((a, b) => (wellnessTimestampMs(b.at) || 0) - (wellnessTimestampMs(a.at) || 0))
    .slice(0, limit);
}

function buildJacuzziReadingsHtml(limit = JACUZZI_VERLAUF_LIMIT) {
  const readings = getJacuzziReadingsSorted(limit);
  if (!readings.length) {
    return `<p class="form-note jacuzzi-verlauf-empty">Noch keine Messungen in der Cloud.</p>`;
  }
  return readings
    .map((r) => {
      const when = fmtJacuzziWhen(r.at);
      const src = jacuzziSourceLabel(r.source);
      const extras = [];
      if (r.ph != null && !Number.isNaN(Number(r.ph))) {
        const lvl = jacuzziAmpelLevel(jacuzziMetricFromStatus(r, "ph"));
        extras.push(`<span class="jacuzzi-reading-extra is-${lvl}">pH ${Number(r.ph).toFixed(1)}</span>`);
      }
      if (r.orp != null && !Number.isNaN(Number(r.orp))) {
        const lvl = jacuzziAmpelLevel(jacuzziMetricFromStatus(r, "orp"));
        extras.push(`<span class="jacuzzi-reading-extra is-${lvl}">Chlorgehalt ${Math.round(Number(r.orp))} mV</span>`);
      }
      const extrasHtml = extras.length ? `<span class="jacuzzi-reading-extras">${extras.join("")}</span>` : "";
      return `<div class="jacuzzi-reading-row"><span class="jacuzzi-reading-when">${escapeHtml(when)}</span><strong>${Number(r.tempC).toFixed(1)} °C</strong>${extrasHtml}<span class="jacuzzi-reading-src">${escapeHtml(src)}</span></div>`;
    })
    .join("");
}

function jacuzziHeroBrief(status) {
  const warm = isJacuzziWarm(status);
  const temp = status?.tempC != null ? Number(status.tempC) : null;
  if (temp != null && !Number.isNaN(temp)) {
    const t = temp.toLocaleString("de-CH", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return warm ? `Warm ♨️ · ${t} °C` : `${t} °C`;
  }
  return warm ? "Warm ♨️" : "Keine Messung";
}

function renderJacuzziPanel() {
  const el = $("jacuzziHeroWidget");
  if (!el) return;

  const status = jacuzziStatusCache;
  const warm = isJacuzziWarm(status);
  const brief = jacuzziHeroBrief(status);
  const booking = getActiveWellnessBooking("jacuzzi");
  const whoSuffix =
    auth.isMember && booking?.who ? ` – ${escapeHtml(booking.who)}` : "";
  const belegHtml = booking
    ? `<p class="wellness-belegung-detail">📅 Belegt ${fmtWellnessDateLabel(booking.startAt)} (${fmtWellnessTimeRange(booking.startAt, booking.endAt)})${whoSuffix}</p>`
    : `<p class="wellness-belegung-detail">📅 Gerade frei – Gustav: <em>Jacuzzi warm?</em></p>`;

  const verlaufCount = Math.min(jacuzziReadingsCache.length, JACUZZI_VERLAUF_LIMIT);
  const verlaufLabel = jacuzziHeroVerlaufOpen ? "Verlauf ausblenden" : `Verlauf (${verlaufCount || "0"})`;
  const verlaufPanel = jacuzziHeroVerlaufOpen
    ? `<div class="jacuzzi-hero-verlauf" id="jacuzziHeroVerlaufPanel">${buildJacuzziReadingsHtml(JACUZZI_VERLAUF_LIMIT)}</div>`
    : "";
  const expandedBody = jacuzziHeroExpanded
    ? `
      <div class="jacuzzi-hero-body-panel" id="jacuzziHeroBodyPanel">
        <div class="jacuzzi-kalender-dashboard bc-dashboard-wrap${warm ? " is-warm" : ""}">
          ${buildJacuzziConnectDashboard(status)}
        </div>
        ${belegHtml}
        <button type="button" class="jacuzzi-verlauf-btn jacuzzi-hero-verlauf-btn" id="jacuzziHeroVerlaufBtn" aria-expanded="${jacuzziHeroVerlaufOpen ? "true" : "false"}" aria-controls="jacuzziHeroVerlaufPanel">
          📊 ${escapeHtml(verlaufLabel)}
        </button>
        ${verlaufPanel}
        <p class="form-note jacuzzi-panel-hint">Blue&nbsp;Riiot-Cloud · Sync alle 5&nbsp;Min. · Gustav: <em>Jacuzzi warm?</em></p>
      </div>`
    : "";

  el.className = `jacuzzi-hero jacuzzi-kalender${warm ? " is-warm" : ""}${jacuzziHeroExpanded ? " is-expanded" : " is-collapsed"}`;
  el.innerHTML = `
    <div class="jacuzzi-hero-card">
      <button type="button" class="jacuzzi-hero-toggle" id="jacuzziHeroToggle" aria-expanded="${jacuzziHeroExpanded ? "true" : "false"}" aria-controls="jacuzziHeroBodyPanel">
        <span class="jacuzzi-hero-toggle-main">
          <span class="jacuzzi-hero-label">🛁 Jacuzzi</span>
          <span class="jacuzzi-hero-brief">${escapeHtml(brief)}</span>
        </span>
        <span class="jacuzzi-hero-chevron" aria-hidden="true">${jacuzziHeroExpanded ? "▾" : "▸"}</span>
      </button>
      ${expandedBody}
    </div>
  `;

}

/* ==========================================================================
   WhatsApp-Benachrichtigungen (zentral in Einstellungen)
   ========================================================================== */

const WHATSAPP_CADENCE_OPTIONS = [
  { value: "daily", label: "Täglich (7:30)" },
  { value: "weekdays", label: "Werktags (Mo–Fr)" },
  { value: "weekly", label: "Wöchentlich (Montag)" },
  { value: "every2days", label: "Alle 2 Tage" },
];

const WHATSAPP_PERSONAL_SETTINGS = [
  {
    id: "deinTag",
    type: "cadence",
    emoji: "☀️",
    title: "Morgen-Zusammenfassung",
    description: "Wetter, deine Aufgaben und anstehende Events – persönlich um 7:30.",
    whatsappHint: "«Dein Tag an», «Dein Tag werktags», «Dein Tag aus»",
  },
  {
    id: "jacuzzi",
    type: "boolean",
    prefKey: "jacuzziWhatsapp",
    emoji: "🛁",
    title: "Jacuzzi Wasserqualität",
    description: "Sofort-Alert, wenn pH oder Chlor (Redox) in Grenz- oder Kritikbereich wechseln.",
    requiresPersonalLogin: true,
    defaultOn: false,
  },
  {
    id: "giessplan",
    type: "boolean",
    prefKey: "whatsappGiessplan",
    emoji: "🌱",
    title: "Gießplan-Erinnerungen",
    description: "Täglich 8:00, wenn deine Zimmerpflanzen fällig sind (pro Pflanze zusätzlich schaltbar).",
    defaultOn: true,
  },
  {
    id: "garten",
    type: "boolean",
    prefKey: "whatsappGarten",
    emoji: "🌿",
    title: "Garten-To-Do-Erinnerungen",
    description: "Täglich 8:00 für offene Garten-Aufgaben, die dir zugewiesen sind.",
    defaultOn: true,
  },
  {
    id: "schaden",
    type: "boolean",
    prefKey: "whatsappSchaden",
    emoji: "🔧",
    title: "Schäden-Erinnerungen",
    description: "Wöchentlich, solange du für offene Schäden zuständig bist.",
    defaultOn: true,
  },
];

const WHATSAPP_WG_BROADCASTS = [
  { emoji: "🎂", title: "Geburtstags-Erinnerung", description: "Heute/morgen hat jemand Geburtstag – an die WG-Gruppe, 8:00." },
  { emoji: "📋", title: "Montags-Update", description: "Events, Putzplan, Anwesenheit und offene Schäden – montags 8:00 an alle." },
  { emoji: "🌧️", title: "Garten & Bewässerung", description: "Regen-Alerts, Bewässerung gestartet/gestoppt – an die WG-Gruppe." },
  { emoji: "⏰", title: "Umfrage geschlossen", description: "Zusammenfassung an die Person, die die Umfrage erstellt hat." },
];

function readWhatsappBoolPref(member, prefKey, defaultOn = true) {
  const v = authConfig.memberPrefs[member]?.[prefKey];
  if (v === false) return false;
  if (v === true) return true;
  return defaultOn;
}

function canEditWhatsappSettings() {
  return auth.isMember && auth.isPersonalLogin && !!authConfig.memberHashes[auth.member];
}

function renderWhatsappSettings() {
  const list = $("whatsappSettingsList");
  const hint = $("whatsappSettingsHint");
  const wgList = $("whatsappWgBroadcastsList");
  if (!list) return;

  if (!auth.isMember) {
    list.innerHTML = `<p class="form-note">Nur für WG-Mitglieder nach Anmeldung.</p>`;
    if (hint) hint.textContent = "";
    return;
  }

  const prefs = authConfig.memberPrefs[auth.member] || {};
  const canEdit = canEditWhatsappSettings();
  const hasPhone = !!(prefs.phone && String(prefs.phone).trim());

  list.innerHTML = WHATSAPP_PERSONAL_SETTINGS.map((s) => {
    if (s.type === "cadence") {
      const dt = prefs.deinTag || {};
      const cadenceOpts = WHATSAPP_CADENCE_OPTIONS.map((o) =>
        `<option value="${o.value}"${(dt.cadence || "daily") === o.value ? " selected" : ""}>${escapeHtml(o.label)}</option>`
      ).join("");
      return `
        <div class="whatsapp-setting-row" data-wa-setting="${s.id}">
          <label class="whatsapp-setting-toggle">
            <input type="checkbox" class="wa-cadence-enabled" ${dt.enabled ? "checked" : ""} ${canEdit ? "" : "disabled"} />
            <span class="whatsapp-setting-emoji">${s.emoji}</span>
          </label>
          <div class="whatsapp-setting-body">
            <strong class="whatsapp-setting-title">${escapeHtml(s.title)}</strong>
            <p class="whatsapp-setting-desc">${escapeHtml(s.description)}</p>
            <div class="whatsapp-setting-extra">
              <label class="whatsapp-setting-cadence-label">Turnus</label>
              <select class="wa-cadence-select" ${canEdit && dt.enabled ? "" : "disabled"}>${cadenceOpts}</select>
            </div>
            ${s.whatsappHint ? `<p class="form-note small">Oder per WhatsApp: ${escapeHtml(s.whatsappHint)}.</p>` : ""}
          </div>
        </div>`;
    }
    const on = readWhatsappBoolPref(auth.member, s.prefKey, s.defaultOn !== false);
    const needsPersonal = s.requiresPersonalLogin;
    const disabled = !canEdit || (needsPersonal && !auth.isPersonalLogin);
    return `
      <div class="whatsapp-setting-row" data-wa-setting="${s.id}" data-pref-key="${s.prefKey}">
        <label class="whatsapp-setting-toggle">
          <input type="checkbox" class="wa-bool-toggle" ${on ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <span class="whatsapp-setting-emoji">${s.emoji}</span>
        </label>
        <div class="whatsapp-setting-body">
          <strong class="whatsapp-setting-title">${escapeHtml(s.title)}</strong>
          <p class="whatsapp-setting-desc">${escapeHtml(s.description)}</p>
        </div>
      </div>`;
  }).join("");

  if (wgList) {
    wgList.innerHTML = WHATSAPP_WG_BROADCASTS.map((b) =>
      `<li><strong>${b.emoji} ${escapeHtml(b.title)}</strong> – ${escapeHtml(b.description)}</li>`
    ).join("");
  }

  if (hint) {
    if (!canEdit) {
      hint.textContent = "Zum Ändern: persönliches Passwort setzen und damit anmelden (nicht Gruppenpasswort).";
    } else if (!hasPhone) {
      hint.textContent = "Handynummer im Profil oben speichern – sonst kommen keine persönlichen Nachrichten an.";
    } else {
      hint.textContent = "Änderungen werden sofort gespeichert.";
    }
  }
}

async function saveWhatsappMemberPrefs(patch, toastMsg) {
  if (!canEditWhatsappSettings()) {
    showToast("Bitte mit persönlichem Passwort anmelden.", "error");
    renderWhatsappSettings();
    return;
  }
  const profileData = {
    ...(authConfig.memberPrefs[auth.member] || {}),
    ...patch,
    updatedBy: auth.member,
  };
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "memberPrefs"), {
        [auth.member]: { ...profileData, updatedAt: serverTimestamp() },
      }, { merge: true });
      authConfig.memberPrefs[auth.member] = { ...profileData };
      if (toastMsg) showToast(toastMsg, "success");
      onMemberPrefsChanged();
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
      renderWhatsappSettings();
    }
  } else {
    const next = { ...localStore.memberPrefs, [auth.member]: profileData };
    localStore.memberPrefs = next;
    saveLocal("memberPrefs", next);
    applyMemberPrefsDoc(next);
    onMemberPrefsChanged();
    if (toastMsg) showToast(toastMsg, "success");
  }
}

function setupJacuzziVerlaufToggles() {
  $("jacuzziHeroWidget")?.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    if (e.target.closest("#jacuzziHeroVerlaufBtn")) {
      jacuzziHeroVerlaufOpen = !jacuzziHeroVerlaufOpen;
      renderJacuzziPanel();
      return;
    }
    if (e.target.closest("#jacuzziHeroToggle")) {
      jacuzziHeroExpanded = !jacuzziHeroExpanded;
      localStorage.setItem(JACUZZI_HERO_EXPANDED_KEY, jacuzziHeroExpanded ? "1" : "0");
      if (!jacuzziHeroExpanded) jacuzziHeroVerlaufOpen = false;
      renderJacuzziPanel();
    }
  });
}

function setupWhatsappSettings() {
  $("whatsappSettingsList")?.addEventListener("change", (e) => {
    const row = e.target.closest("[data-wa-setting]");
    if (!row) return;
    const settingId = row.dataset.waSetting;

    if (e.target.classList.contains("wa-cadence-enabled")) {
      const cadence = row.querySelector(".wa-cadence-select")?.value || "daily";
      void saveWhatsappMemberPrefs(
        { deinTag: { enabled: !!e.target.checked, cadence } },
        e.target.checked ? "Morgen-Zusammenfassung aktiviert." : "Morgen-Zusammenfassung deaktiviert."
      );
      return;
    }
    if (e.target.classList.contains("wa-cadence-select") && settingId === "deinTag") {
      if (!row.querySelector(".wa-cadence-enabled")?.checked) return;
      void saveWhatsappMemberPrefs(
        { deinTag: { enabled: true, cadence: e.target.value } },
        "Turnus gespeichert."
      );
      return;
    }
    if (e.target.classList.contains("wa-bool-toggle")) {
      const prefKey = row.dataset.prefKey;
      if (!prefKey) return;
      void saveWhatsappMemberPrefs(
        { [prefKey]: !!e.target.checked },
        e.target.checked ? "WhatsApp-Benachrichtigung aktiviert." : "WhatsApp-Benachrichtigung deaktiviert."
      );
    }
  });
}

function wellnessWhoLine(booking) {
  if (!auth.isMember) return "";
  const who = booking?.who?.trim();
  return who ? ` · ${escapeHtml(who)}` : "";
}

function renderWellnessBelegung() {
  const grid = $("wellnessBelegungGrid");
  const list = $("wellnessBookingsList");
  if (!grid) return;

  const nowMs = Date.now();
  grid.innerHTML = Object.entries(WELLNESS_RESOURCES)
    .map(([key, meta]) => {
      const active = getActiveWellnessBooking(key, nowMs);
      const cls = active ? "is-busy" : "is-free";
      let detail;
      if (!active) {
        detail = "Frei – per WhatsApp: <em>" + meta.label + " frei?</em>";
      } else if (key === "kino" && active.title) {
        detail = `${fmtWellnessDateLabel(active.startAt)} <strong>${escapeHtml(active.title)}</strong> · ${fmtWellnessTimeRange(active.startAt, active.endAt)}${wellnessWhoLine(active)}`;
      } else {
        detail = `${fmtWellnessDateLabel(active.startAt)} · ${fmtWellnessTimeRange(active.startAt, active.endAt)}${wellnessWhoLine(active)}`;
      }
      return `
        <article class="wellness-belegung-card ${cls}">
          <h4>${meta.emoji} ${meta.label}</h4>
          <p class="wellness-belegung-detail">${active ? "Belegt: " : ""}${detail}</p>
        </article>`;
    })
    .join("");

  if (!list) return;
  const upcoming = [...wellnessBookingsCache]
    .filter((b) => (wellnessTimestampMs(b.endAt) || 0) > nowMs)
    .sort((a, b) => (wellnessTimestampMs(a.startAt) || 0) - (wellnessTimestampMs(b.startAt) || 0));

  if (!upcoming.length) {
    list.innerHTML = `<p class="form-note">Keine Einträge – unten Belegung hinzufügen.</p>`;
    return;
  }

  list.innerHTML = upcoming
    .map((b) => {
      const meta = WELLNESS_RESOURCES[b.resource] || { emoji: "📍", label: b.resource };
      const active = getActiveWellnessBooking(b.resource, nowMs)?.id === b.id;
      const title = b.title ? ` · ${escapeHtml(b.title)}` : "";
      return `
        <div class="wellness-booking-item${active ? " is-active" : ""}">
          <span>${meta.emoji} <strong>${meta.label}</strong>${title} · ${fmtWellnessDateLabel(b.startAt)} ${fmtWellnessTimeRange(b.startAt, b.endAt)}${wellnessWhoLine(b)}</span>
          ${auth.isMember ? `<button type="button" class="mini-btn danger" data-wellness-delete="${b.id}">Entfernen</button>` : ""}
        </div>`;
    })
    .join("");

  list.querySelectorAll("[data-wellness-delete]").forEach((btn) => {
    btn.addEventListener("click", () => void deleteWellnessBooking(btn.dataset.wellnessDelete));
  });
}

function setWellnessFormDefaults() {
  const start = $("wellnessStart");
  const end = $("wellnessEnd");
  if (!start || !end) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const toLocal = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!start.value) {
    const s = new Date(now);
    s.setMinutes(0, 0, 0);
    s.setHours(s.getHours() + 1);
    start.value = toLocal(s);
  }
  if (!end.value) {
    const e = new Date(now);
    e.setMinutes(0, 0, 0);
    e.setHours(e.getHours() + 3);
    end.value = toLocal(e);
  }
}

async function saveJacuzziReading(tempC, source = "manual") {
  const now = new Date().toISOString();
  const status = {
    tempC,
    warmThresholdC: JACUZZI_WARM_TEMP_C,
    targetTempC: 38,
    updatedAt: now,
    source,
  };
  const reading = { tempC, at: now, source };
  if (firebaseReady) {
    await setDoc(doc(db, "config", "jacuzzi"), status, { merge: true });
    await addDoc(collection(db, "jacuzziReadings"), reading);
  } else {
    jacuzziStatusCache = status;
    localStore.jacuzziStatus = status;
    saveLocal("jacuzziStatus", status);
    reading.id = "local_" + Date.now();
    jacuzziReadingsCache.unshift(reading);
    localStore.jacuzziReadings = jacuzziReadingsCache;
    saveLocal("jacuzziReadings", jacuzziReadingsCache);
    renderJacuzziPanel();
  }
  showToast(isJacuzziWarm(status) ? "🛁♨️ Warm gespeichert." : "🛁 Temperatur gespeichert.", "success");
}

async function deleteWellnessBooking(id) {
  if (!requireMember("Belegung löschen")) return;
  if (!confirm("Belegung wirklich entfernen?")) return;
  if (firebaseReady) {
    await deleteDoc(doc(db, "wellnessBookings", id));
  } else {
    wellnessBookingsCache = wellnessBookingsCache.filter((b) => b.id !== id);
    localStore.wellnessBookings = wellnessBookingsCache;
    saveLocal("wellnessBookings", wellnessBookingsCache);
    renderWellnessBelegung();
    renderJacuzziPanel();
  }
  showToast("Entfernt.", "success");
}

$("jacuzziReadingForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Temperatur speichern")) return;
  const tempC = parseFloat($("jacuzziTempInput").value);
  if (Number.isNaN(tempC)) return;
  const warm = tempC >= JACUZZI_WARM_TEMP_C;
  try {
    await saveJacuzziReading(tempC, "manual");
    e.target.reset();
  } catch (err) {
    showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
  }
});

$("wellnessBookingForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Belegung speichern")) return;
  const resource = $("wellnessResource").value;
  const who = $("wellnessWho").value.trim();
  const title = $("wellnessTitle").value.trim();
  const startLocal = $("wellnessStart").value;
  const endLocal = $("wellnessEnd").value;
  if (!resource || !who || !startLocal || !endLocal) return;
  const startAt = new Date(startLocal).toISOString();
  const endAt = new Date(endLocal).toISOString();
  if (new Date(endAt) <= new Date(startAt)) {
    showToast("Ende muss nach Start liegen.", "error");
    return;
  }
  const entry = {
    resource,
    who,
    title: title || "",
    startAt,
    endAt,
    createdBy: auth.member || "WG",
    createdAt: Date.now(),
  };
  try {
    if (firebaseReady) {
      await addDoc(collection(db, "wellnessBookings"), { ...entry, createdAt: serverTimestamp() });
    } else {
      entry.id = "local_" + Date.now();
      wellnessBookingsCache.push(entry);
      localStore.wellnessBookings = wellnessBookingsCache;
      saveLocal("wellnessBookings", wellnessBookingsCache);
      renderWellnessBelegung();
      renderJacuzziPanel();
    }
    e.target.reset();
    setWellnessFormDefaults();
    showToast("Belegung gespeichert.", "success");
  } catch (err) {
    showToast(`Speichern fehlgeschlagen: ${err.message || err}`, "error");
  }
});

$("wellnessResource")?.addEventListener("change", () => {
  const isKino = $("wellnessResource")?.value === "kino";
  $("wellnessTitleField")?.classList.toggle("hidden", !isKino);
});

setWellnessFormDefaults();

/* ==========================================================================
   Gästebuch · kreativ (Text, Draw, Photo, GIF, Voice, Link)
   ========================================================================== */

// Optional: Giphy-API-Key (leer = Suche deaktiviert, GIF per URL geht trotzdem)
// Gratis-Key holen: https://developers.giphy.com/ → "Create an App"
const GIPHY_API_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65"; // Public Giphy Developer Sandbox
const MAX_AUDIO_MESSAGE_BYTES = 900_000;
const MAX_VOICE_SECONDS = 90;

let gbCache = [];
// Additive Module – alles lässt sich frei kombinieren
const GB_OPTIONAL_MODULES = ["draw", "photo", "gif", "voice", "link"];
let gbModules = { draw: false, photo: false, gif: false, voice: false, link: false };
let gbPhotoData = null;       // Base64 JPG (Foto – separat oder als Hintergrund der Zeichnung)
let gbGifData = null;         // { url, title }
let gbVoiceData = null;       // { audioSrc: dataUrl, duration: Sekunden }
let gbPhotoBakedIntoDraw = false; // true → Foto ist in die Zeichnung eingebettet

/* -------- Helpers -------- */

function linkifyText(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, url =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );
}

function guessLinkDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return url; }
}

/* -------- Rendering -------- */

function renderGaestebuch() {
  const list = $("gbList");
  if (!list) return;
  if (gbCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Sei die erste Stimme im Gästebuch 💌</div>`;
    $("statGaeste").textContent = 0;
    return;
  }

  list.innerHTML = gbCache.map(gb => renderGbCard(gb)).join("");
  $("statGaeste").textContent = gbCache.length;

  // Lightbox für eigene Drawings / Photos
  list.querySelectorAll(".gb-media-zoom").forEach(el => {
    el.addEventListener("click", () => {
      openLightbox({ src: el.dataset.src, caption: el.dataset.caption || "", kind: "gaestebuch" });
    });
  });

  // Löschen (nur für Mitglieder)
  list.querySelectorAll(".gb-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireMember("Einträge löschen")) return;
      if (confirm("Eintrag wirklich löschen?")) deleteGaestebuch(btn.dataset.id);
    });
  });
}

function renderGbCard(gb) {
  const color = gb.color || "";
  const headerStyle = color ? `style="--gb-accent:${escapeHtml(color)}"` : "";
  const headBlock = `
    <div class="gb-head">
      <div class="gb-avatar" ${headerStyle}>${escapeHtml(gb.emoji || "🌿")}</div>
      <div class="gb-who">
        <strong>${escapeHtml(gb.name || "Anonym")}</strong>
        <span>${fmtDate(gb.createdAt)}</span>
      </div>
      ${auth.isMember ? `<button class="gb-delete" data-id="${gb.id}" title="Löschen">✕</button>` : ""}
    </div>
  `;

  // Backward-Compat: alte Einträge hatten `kind` + `imageSrc`
  let photoSrc = gb.photoSrc || (gb.kind === "photo" ? gb.imageSrc : null);
  let drawSrc = gb.drawSrc || (gb.kind === "draw" ? gb.imageSrc : null);
  const gifUrl = gb.gifUrl || null;
  const audioSrc = gb.audioSrc || null;
  const linkUrl = gb.linkUrl || null;
  const message = gb.message || "";
  const photoCaption = gb.photoCaption || "";

  const kinds = [];
  if (drawSrc) kinds.push("draw");
  if (photoSrc) kinds.push("photo");
  if (gifUrl) kinds.push("gif");
  if (audioSrc) kinds.push("voice");
  if (linkUrl) kinds.push("link");
  if (message) kinds.push("text");

  let body = "";

  if (photoSrc) {
    body += `
      <div class="gb-media">
        <img class="gb-media-zoom" src="${escapeHtml(photoSrc)}" alt="${escapeHtml(photoCaption || 'Foto')}" data-src="${escapeHtml(photoSrc)}" data-caption="${escapeHtml(photoCaption || '')}" loading="lazy" />
      </div>
      ${photoCaption ? `<p class="gb-msg gb-caption">${linkifyText(photoCaption)}</p>` : ""}
    `;
  }

  if (drawSrc) {
    body += `
      <div class="gb-media">
        <img class="gb-media-zoom gb-draw" src="${escapeHtml(drawSrc)}" alt="Zeichnung von ${escapeHtml(gb.name)}" data-src="${escapeHtml(drawSrc)}" data-caption="Zeichnung von ${escapeHtml(gb.name)}" loading="lazy" />
      </div>
    `;
  }

  if (gifUrl) {
    body += `
      <div class="gb-media">
        <img class="gb-gif" src="${escapeHtml(gifUrl)}" alt="${escapeHtml(gb.gifTitle || 'GIF')}" loading="lazy" />
        <span class="gb-gif-badge">GIF</span>
      </div>
    `;
  }

  if (linkUrl) {
    const host = guessLinkDomain(linkUrl);
    body += `
      <a class="gb-link" href="${escapeAttr(safeUrl(linkUrl))}" target="_blank" rel="noopener noreferrer">
        <span class="gb-link-icon">🔗</span>
        <div class="gb-link-body">
          <strong>${escapeHtml(gb.linkText || host)}</strong>
          <span>${escapeHtml(host)}</span>
        </div>
      </a>
    `;
  }

  if (audioSrc) {
    body += `
      <div class="gb-voice">
        <audio controls src="${escapeHtml(audioSrc)}" preload="metadata"></audio>
        <span class="gb-voice-meta">🎙️ ${gb.audioDuration ? Math.round(gb.audioDuration) + 's' : 'Sprachnachricht'}</span>
      </div>
    `;
  }

  if (message) {
    body += `<p class="gb-msg">${linkifyText(message)}</p>`;
  }

  if (!body) {
    body = `<p class="gb-msg gb-empty">(leer)</p>`;
  }

  const kindClasses = kinds.map(k => `gb-kind-${k}`).join(" ");
  return `<article class="gb-card ${kindClasses}" ${headerStyle}>${headBlock}${body}</article>`;
}

async function deleteGaestebuch(id) {
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "gaestebuch", id)); showToast("Eintrag gelöscht.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.gaestebuch = localStore.gaestebuch.filter(g => g.id !== id);
    gbCache = localStore.gaestebuch;
    saveLocal("gaestebuch", localStore.gaestebuch);
    renderGaestebuch();
  }
}

/* -------- Additive Modul-Chips -------- */

function setGbModule(name, active) {
  if (!GB_OPTIONAL_MODULES.includes(name)) return;
  gbModules[name] = active;
  const chip = document.querySelector(`.gb-add-chip[data-module="${name}"]`);
  const pane = document.querySelector(`.gb-pane[data-pane="${name}"]`);
  if (chip) chip.classList.toggle("active", active);
  if (pane) pane.classList.toggle("hidden", !active);
  if (active && name === "draw") initDrawCanvas();
  if (name === "photo" || name === "draw") updateDrawUsePhotoButton();
}

function toggleGbModule(name) { setGbModule(name, !gbModules[name]); }

$$(".gb-add-chip").forEach(btn => {
  btn.addEventListener("click", () => toggleGbModule(btn.dataset.module));
});

$$("[data-pane-close]").forEach(btn => {
  btn.addEventListener("click", () => {
    const name = btn.dataset.paneClose;
    clearGbModuleData(name);
    setGbModule(name, false);
  });
});

function clearGbModuleData(name) {
  switch (name) {
    case "photo":
      gbPhotoData = null;
      $("gbPhotoPreview")?.classList.add("hidden");
      $("gbPhotoCaption") && ($("gbPhotoCaption").value = "");
      gbPhotoBakedIntoDraw = false;
      break;
    case "gif":
      gbGifData = null;
      $("gbGifPreview")?.classList.add("hidden");
      $("gifUrl") && ($("gifUrl").value = "");
      $("gifSearch") && ($("gifSearch").value = "");
      if ($("gifResults")) $("gifResults").innerHTML = "";
      break;
    case "voice":
      gbVoiceData = null;
      $("voicePreview")?.classList.add("hidden");
      if ($("voicePlayer")) $("voicePlayer").src = "";
      resetVoiceUI();
      break;
    case "link":
      $("linkUrl") && ($("linkUrl").value = "");
      $("linkText") && ($("linkText").value = "");
      break;
    case "draw":
      if (drawCtx) {
        const canvas = $("drawCanvas");
        drawCtx.fillStyle = "#fffaf4";
        drawCtx.fillRect(0, 0, canvas.clientWidth, 440);
        drawDirty = false;
        gbPhotoBakedIntoDraw = false;
      }
      break;
  }
}

function updateDrawUsePhotoButton() {
  const btn = $("drawUsePhoto");
  if (!btn) return;
  const canUse = gbModules.photo && gbPhotoData && gbModules.draw;
  btn.classList.toggle("hidden", !canUse);
}

/* -------- Emoji-Bar -------- */

$$("[data-emoji-insert]").forEach(btn => {
  btn.addEventListener("click", () => {
    const ta = $("gbMessage");
    const emoji = btn.dataset.emojiInsert;
    const start = ta.selectionStart || ta.value.length;
    ta.value = ta.value.slice(0, start) + emoji + ta.value.slice(ta.selectionEnd || start);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + emoji.length;
  });
});

/* -------- Zeichnen -------- */

const DRAW_COLORS = ["#3d2817", "#c67a50", "#8ab88a", "#4b8aa8", "#d4a853", "#b24848", "#6a4d86", "#ffffff"];
let drawCtx = null;
let drawing = false;
let lastX = 0, lastY = 0;
let drawColor = "#3d2817";
let drawSize = 4;
let drawErasing = false;
let drawDirty = false;
let drawCanvasInitialized = false;

function initDrawCanvas() {
  if (drawCanvasInitialized) return;
  drawCanvasInitialized = true;
  const canvas = $("drawCanvas");
  if (!canvas) return;
  drawCtx = canvas.getContext("2d");
  // Retina-Unterstützung + responsive Breite
  const ratio = window.devicePixelRatio || 1;
  const resize = () => {
    const w = canvas.clientWidth;
    const h = 440;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    drawCtx.scale(ratio, ratio);
    drawCtx.fillStyle = "#fffaf4";
    drawCtx.fillRect(0, 0, w, h);
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    drawDirty = false;
  };
  requestAnimationFrame(resize);
  window.addEventListener("resize", () => {
    // Beim Resize nur zurücksetzen wenn nichts gezeichnet wurde
    if (!drawDirty) resize();
  });

  // Farben
  const colorsEl = $("drawColors");
  colorsEl.innerHTML = DRAW_COLORS.map((c, i) =>
    `<button type="button" class="draw-color ${i===0?'active':''}" data-color="${c}" style="background:${c}"></button>`
  ).join("");
  colorsEl.querySelectorAll("[data-color]").forEach(b => {
    b.addEventListener("click", () => {
      drawColor = b.dataset.color;
      drawErasing = false;
      colorsEl.querySelectorAll(".draw-color").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
    });
  });

  $("drawSize").addEventListener("input", (e) => { drawSize = +e.target.value; });
  $("drawErase").addEventListener("click", () => { drawErasing = !drawErasing; $("drawErase").classList.toggle("active", drawErasing); });
  $("drawClear").addEventListener("click", () => {
    if (!drawDirty || confirm("Zeichnung wirklich leeren?")) {
      drawCtx.fillStyle = "#fffaf4";
      drawCtx.fillRect(0, 0, canvas.clientWidth, 440);
      drawDirty = false;
    }
  });

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (e) => { e.preventDefault(); drawing = true; const p = pos(e); lastX = p.x; lastY = p.y; };
  const move = (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    drawCtx.strokeStyle = drawErasing ? "#fffaf4" : drawColor;
    drawCtx.lineWidth = drawErasing ? drawSize * 2.2 : drawSize;
    drawCtx.beginPath();
    drawCtx.moveTo(lastX, lastY);
    drawCtx.lineTo(p.x, p.y);
    drawCtx.stroke();
    lastX = p.x; lastY = p.y;
    drawDirty = true;
  };
  const stop = () => { drawing = false; };

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  canvas.addEventListener("mouseup", stop);
  canvas.addEventListener("mouseleave", stop);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", stop);
}

function getDrawingAsDataUrl() {
  const canvas = $("drawCanvas");
  if (!drawDirty) return null;
  // Zeichnung auf normale Größe herunterrechnen (falls retina)
  const tmp = document.createElement("canvas");
  const w = canvas.clientWidth;
  tmp.width = w;
  tmp.height = 440;
  tmp.getContext("2d").drawImage(canvas, 0, 0, w, 440);
  return tmp.toDataURL("image/jpeg", 0.82);
}

/* -------- Foto -------- */

$("gbPhotoPick")?.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 1400);
      const size = Math.ceil((dataUrl.length * 3) / 4);
      if (size > MAX_IMAGE_BYTES) { showToast("Foto zu gross.", "error"); return; }
      gbPhotoData = dataUrl;
      $("gbPhotoImg").src = dataUrl;
      $("gbPhotoPreview").classList.remove("hidden");
      updateDrawUsePhotoButton();
    } catch (err) { console.error(err); showToast("Foto konnte nicht geladen werden.", "error"); }
  });
  input.click();
});
$("gbPhotoClear")?.addEventListener("click", () => {
  gbPhotoData = null;
  $("gbPhotoPreview").classList.add("hidden");
  gbPhotoBakedIntoDraw = false;
  updateDrawUsePhotoButton();
});

// Foto als Hintergrund auf die Zeichenfläche ziehen
$("drawUsePhoto")?.addEventListener("click", () => {
  if (!gbPhotoData || !drawCtx) return;
  const canvas = $("drawCanvas");
  const doBake = () => {
    const img = new Image();
    img.onload = () => {
      const w = canvas.clientWidth;
      const h = 440;
      drawCtx.fillStyle = "#fffaf4";
      drawCtx.fillRect(0, 0, w, h);
      // Foto proportional einpassen (contain)
      const ratio = Math.min(w / img.width, h / img.height);
      const iw = img.width * ratio;
      const ih = img.height * ratio;
      const ix = (w - iw) / 2;
      const iy = (h - ih) / 2;
      drawCtx.drawImage(img, ix, iy, iw, ih);
      drawDirty = true;
      gbPhotoBakedIntoDraw = true;
      showToast("Foto als Hintergrund geladen – jetzt drübermalen!", "success");
    };
    img.src = gbPhotoData;
  };
  if (drawDirty && !confirm("Die aktuelle Zeichnung wird überschrieben. Fortfahren?")) return;
  doBake();
});

/* -------- GIF -------- */

async function searchGifs(query) {
  const results = $("gifResults");
  if (!GIPHY_API_KEY) {
    results.innerHTML = `<div class="empty-state small">GIF-Suche nicht verfügbar. Du kannst unten einen GIF-Link einfügen.</div>`;
    return;
  }
  results.innerHTML = `<div class="empty-state small"><span class="spinner"></span> Suche…</div>`;
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=18&rating=pg-13&lang=de`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("API Error " + resp.status);
    const data = await resp.json();
    const gifs = (data.data || []).filter(g => g.images?.fixed_width?.url);
    if (!gifs.length) { results.innerHTML = `<div class="empty-state small">Keine Treffer.</div>`; return; }
    results.innerHTML = gifs.map(g => `
      <button type="button" class="gif-result" data-url="${escapeHtml(g.images.downsized_medium?.url || g.images.original.url)}" data-title="${escapeHtml(g.title || '')}">
        <img src="${escapeHtml(g.images.fixed_width.url)}" alt="${escapeHtml(g.title || 'GIF')}" loading="lazy" />
      </button>
    `).join("");
    results.querySelectorAll(".gif-result").forEach(btn => {
      btn.addEventListener("click", () => {
        gbGifData = { url: btn.dataset.url, title: btn.dataset.title };
        $("gbGifImg").src = btn.dataset.url;
        $("gbGifPreview").classList.remove("hidden");
        results.querySelectorAll(".gif-result").forEach(x => x.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });
  } catch (err) {
    console.warn("Giphy Fehler:", err);
    results.innerHTML = `<div class="empty-state small">Suche nicht erreichbar – bitte GIF-URL unten einfügen.</div>`;
  }
}

$("gifSearchBtn")?.addEventListener("click", () => {
  const q = $("gifSearch").value.trim();
  if (q.length < 2) return;
  searchGifs(q);
});
$("gifSearch")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("gifSearchBtn").click(); }
});
$("gifUrlPreview")?.addEventListener("click", () => {
  const url = $("gifUrl").value.trim();
  if (!url) return;
  // Giphy-Seiten-URL → Media-URL versuchen
  let mediaUrl = url;
  const giphyMatch = url.match(/giphy\.com\/gifs\/[^/?]+-([a-zA-Z0-9]+)/) || url.match(/giphy\.com\/media\/([a-zA-Z0-9]+)/);
  if (giphyMatch && !url.endsWith(".gif")) {
    mediaUrl = `https://media.giphy.com/media/${giphyMatch[1]}/giphy.gif`;
  }
  gbGifData = { url: mediaUrl, title: "" };
  $("gbGifImg").src = mediaUrl;
  $("gbGifPreview").classList.remove("hidden");
});
$("gbGifClear")?.addEventListener("click", () => {
  gbGifData = null;
  $("gbGifPreview").classList.add("hidden");
  document.querySelectorAll(".gif-result").forEach(x => x.classList.remove("selected"));
});

/* -------- Sprachnachricht -------- */

let mediaRecorder = null;
let recChunks = [];
let recStart = 0;
let recTimer = null;

$("voiceRecord")?.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("Mikrofon nicht verfügbar.", "error");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recChunks = [];
    recStart = Date.now();
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recTimer);
      const blob = new Blob(recChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      const duration = (Date.now() - recStart) / 1000;
      if (blob.size > MAX_AUDIO_MESSAGE_BYTES) {
        showToast(`Sprachnachricht zu gross (${Math.round(blob.size/1024)} KB). Bitte kürzer halten.`, "error");
        resetVoiceUI();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        gbVoiceData = { audioSrc: reader.result, duration };
        $("voicePlayer").src = reader.result;
        $("voicePreview").classList.remove("hidden");
      };
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    $("voiceRecord").disabled = true;
    $("voiceRecord").textContent = "● Nimmt auf…";
    $("voiceRecord").classList.add("recording");
    $("voiceStop").disabled = false;
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      $("voiceTimer").textContent = `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
      if (s >= MAX_VOICE_SECONDS) {
        showToast(`Max. ${MAX_VOICE_SECONDS} Sekunden.`, "");
        stopRecording();
      }
    }, 250);
  } catch (err) {
    console.error(err);
    showToast("Kein Mikrofon-Zugriff.", "error");
  }
});

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
}
function resetVoiceUI() {
  $("voiceRecord").disabled = false;
  $("voiceRecord").textContent = "🎙️ Aufnahme starten";
  $("voiceRecord").classList.remove("recording");
  $("voiceStop").disabled = true;
  $("voiceTimer").textContent = "0:00";
}
$("voiceStop")?.addEventListener("click", () => { stopRecording(); resetVoiceUI(); });
$("voiceClear")?.addEventListener("click", () => {
  gbVoiceData = null;
  $("voicePreview").classList.add("hidden");
  $("voicePlayer").src = "";
  resetVoiceUI();
});

/* -------- Submit -------- */

$("gbSubmit")?.addEventListener("click", async () => {
  const name = $("gbName").value.trim();
  if (!name) { showToast("Bitte deinen Namen eintragen.", "error"); $("gbName").focus(); return; }
  const emoji = $("gbEmoji").value.trim() || "🌿";
  const color = $("gbColor").value || "";
  const message = ($("gbMessage").value || "").trim();

  // Alle aktiven Module einsammeln – alles optional, alles kombinierbar
  const entry = { name, emoji, color, createdAt: Date.now() };
  const kinds = [];

  // Zeichnung
  if (gbModules.draw) {
    const img = getDrawingAsDataUrl();
    if (img) {
      const size = Math.ceil((img.length * 3) / 4);
      if (size > MAX_IMAGE_BYTES) { showToast("Zeichnung zu gross. Bitte kleiner halten.", "error"); return; }
      entry.drawSrc = img;
      kinds.push("draw");
    }
  }

  // Foto – nur separat speichern, wenn nicht in die Zeichnung eingebacken
  if (gbModules.photo && gbPhotoData) {
    const photoCaption = ($("gbPhotoCaption").value || "").trim();
    if (!(gbModules.draw && gbPhotoBakedIntoDraw && entry.drawSrc)) {
      entry.photoSrc = gbPhotoData;
      kinds.push("photo");
    }
    if (photoCaption) entry.photoCaption = photoCaption;
  }

  // GIF
  if (gbModules.gif) {
    if (!gbGifData?.url) { showToast("GIF ausgewählt, aber keins geladen. Bitte GIF wählen oder Modul entfernen.", "error"); return; }
    entry.gifUrl = gbGifData.url;
    entry.gifTitle = gbGifData.title || "";
    kinds.push("gif");
  }

  // Voice
  if (gbModules.voice) {
    if (!gbVoiceData?.audioSrc) { showToast("Sprachnachricht-Modul offen, aber keine Aufnahme. Aufnehmen oder Modul entfernen.", "error"); return; }
    entry.audioSrc = gbVoiceData.audioSrc;
    entry.audioDuration = gbVoiceData.duration;
    kinds.push("voice");
  }

  // Link
  if (gbModules.link) {
    const url = ($("linkUrl").value || "").trim();
    if (!url) { showToast("Link-Modul offen, aber keine URL. URL eintragen oder Modul entfernen.", "error"); return; }
    try { new URL(url); } catch { showToast("Ungültige URL.", "error"); return; }
    entry.linkUrl = url;
    const linkText = ($("linkText").value || "").trim();
    if (linkText) entry.linkText = linkText;
    kinds.push("link");
  }

  // Text
  if (message) {
    entry.message = message;
    kinds.push("text");
  }

  if (kinds.length === 0) {
    showToast("Bitte mindestens Text schreiben oder ein Element hinzufügen.", "error");
    return;
  }

  // Für Backward-Compat: „primäres“ Kind speichern
  entry.kind = kinds[0];

  const status = $("gbStatus");
  status.textContent = "Wird gespeichert…";
  try {
    if (firebaseReady) {
      await addDoc(collection(db, "gaestebuch"), { ...entry, createdAt: serverTimestamp() });
    } else {
      entry.id = "local_" + Date.now();
      localStore.gaestebuch.unshift(entry);
      gbCache = localStore.gaestebuch;
      saveLocal("gaestebuch", localStore.gaestebuch);
      renderGaestebuch();
    }
    status.textContent = "";
    resetGbComposer();
    showToast("Danke für deinen Eintrag 🌿", "success");
  } catch (err) {
    console.error(err);
    status.textContent = "";
    showToast("Speichern fehlgeschlagen. Bild/Audio evtl. zu gross.", "error");
  }
});

function resetGbComposer() {
  $("gbMessage").value = "";
  $("gbPhotoCaption") && ($("gbPhotoCaption").value = "");
  $("linkUrl") && ($("linkUrl").value = "");
  $("linkText") && ($("linkText").value = "");
  $("gifUrl") && ($("gifUrl").value = "");
  $("gifSearch") && ($("gifSearch").value = "");
  if ($("gifResults")) $("gifResults").innerHTML = "";
  gbPhotoData = null;
  gbGifData = null;
  gbVoiceData = null;
  gbPhotoBakedIntoDraw = false;
  $("gbPhotoPreview")?.classList.add("hidden");
  $("gbGifPreview")?.classList.add("hidden");
  $("voicePreview")?.classList.add("hidden");
  if ($("voicePlayer")) $("voicePlayer").src = "";
  resetVoiceUI();
  if (drawCtx) {
    const canvas = $("drawCanvas");
    drawCtx.fillStyle = "#fffaf4";
    drawCtx.fillRect(0, 0, canvas.clientWidth, 440);
    drawDirty = false;
  }
  // Alle optionalen Module deaktivieren – Text bleibt immer sichtbar
  GB_OPTIONAL_MODULES.forEach(m => setGbModule(m, false));
}

/* ==========================================================================
   Musik-Player (Soundtrack)
   ========================================================================== */

let musikCache = [];
let currentSongIdx = -1;

const audio = $("audioPlayer");
const btnPlayPause = $("btnPlayPause");
const btnPrev = $("btnPrev");
const btnNext = $("btnNext");
const progressBar = $("progressBar");
const volumeBar = $("volumeBar");
const timeCurrent = $("timeCurrent");
const timeTotal = $("timeTotal");
const nowTitle = $("nowTitle");
const nowArtist = $("nowArtist");
const playlistEl = $("playlist");
const playerYoutubeWrap = $("playerYoutubeWrap");
const playerEmbedBox = $("playerEmbedBox");
const playerEmbedHint = $("playerEmbedHint");
const playerYoutubeFrame = $("playerYoutubeFrame");

function extractYouTubeId(url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  const m = u.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/)|youtube\.com\/watch\?[^#]*v=)([a-zA-Z0-9_-]{11})/i
  );
  return m ? m[1] : null;
}

/** Öffentliche SoundCloud-Track-/Set-URL (kein Widget w.soundcloud.com). */
function extractSoundCloudPageUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    const h = u.hostname.toLowerCase();
    if (!/^([a-z0-9-]+\.)?soundcloud\.com$/i.test(h)) return null;
    if (/^w\./i.test(h)) return null;
    return u.origin + u.pathname + u.search;
  } catch {
    return null;
  }
}

function soundcloudWidgetSrc(pageUrl, autoplay) {
  const u = new URL("https://w.soundcloud.com/player/");
  u.searchParams.set("url", pageUrl);
  u.searchParams.set("color", "#ff5500");
  u.searchParams.set("auto_play", autoplay ? "true" : "false");
  u.searchParams.set("hide_related", "true");
  u.searchParams.set("show_comments", "false");
  u.searchParams.set("show_user", "true");
  u.searchParams.set("show_reposts", "false");
  u.searchParams.set("show_teaser", "false");
  u.searchParams.set("visual", "true");
  return u.toString();
}

/** Spotify: open.spotify.com/… oder spotify:track:… → Embed-Pfad. */
function extractSpotifyEmbedRef(url) {
  if (!url || typeof url !== "string") return null;
  const t = url.trim();
  const uriMatch = t.match(/^spotify:(track|album|playlist|episode):([a-zA-Z0-9]+)\s*$/i);
  if (uriMatch) return { type: uriMatch[1].toLowerCase(), id: uriMatch[2] };
  try {
    const u = new URL(t);
    if (u.hostname.toLowerCase() !== "open.spotify.com") return null;
    let path = u.pathname.replace(/\/+$/, "");
    path = path.replace(/^\/intl-[a-z]{2}(?=\/)/i, "");
    const m = path.match(/^\/(track|album|playlist|episode)\/([^/?#]+)/i);
    if (!m) return null;
    const id = decodeURIComponent(m[2]).split("?")[0];
    if (!id) return null;
    return { type: m[1].toLowerCase(), id };
  } catch {
    return null;
  }
}

function spotifyEmbedSrc(ref, autoplay) {
  const u = new URL(`https://open.spotify.com/embed/${ref.type}/${ref.id}`);
  if (autoplay) u.searchParams.set("autoplay", "1");
  return u.toString();
}

function songGetYouTubeId(song) {
  if (!song) return null;
  if (song.youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(song.youtubeId)) return song.youtubeId;
  return extractYouTubeId(song.src || "");
}

function songGetSoundCloudUrl(song) {
  if (!song) return null;
  const fromField =
    typeof song.soundcloudUrl === "string" ? extractSoundCloudPageUrl(song.soundcloudUrl) : null;
  if (fromField) return fromField;
  return extractSoundCloudPageUrl(song.src || "");
}

function songGetSpotify(song) {
  if (!song) return null;
  if (song.kind === "spotify" && song.spotifyType && song.spotifyId) {
    const t = String(song.spotifyType).toLowerCase();
    if (/^(track|album|playlist|episode)$/.test(t)) return { type: t, id: String(song.spotifyId) };
  }
  return extractSpotifyEmbedRef(song.src || "");
}

function songEmbedPlaylistInfo(s) {
  if (songGetYouTubeId(s)) return { cls: "is-youtube", icon: "📺", title: "YouTube" };
  if (songGetSoundCloudUrl(s)) return { cls: "is-soundcloud", icon: "☁️", title: "SoundCloud" };
  if (songGetSpotify(s)) return { cls: "is-spotify", icon: "💚", title: "Spotify" };
  return { cls: "", icon: null, title: "" };
}

function isCurrentTrackYouTube() {
  if (currentSongIdx < 0 || !musikCache.length) return false;
  return !!songGetYouTubeId(musikCache[currentSongIdx]);
}

function isCurrentTrackSoundCloud() {
  if (currentSongIdx < 0 || !musikCache.length) return false;
  return !!songGetSoundCloudUrl(musikCache[currentSongIdx]);
}

function isCurrentTrackSpotify() {
  if (currentSongIdx < 0 || !musikCache.length) return false;
  return !!songGetSpotify(musikCache[currentSongIdx]);
}

function isCurrentTrackExternalEmbed() {
  return isCurrentTrackYouTube() || isCurrentTrackSoundCloud() || isCurrentTrackSpotify();
}

// Gespeicherte Lautstärke wiederherstellen
const savedVol = parseFloat(localStorage.getItem("has_player_vol") || "0.8");
if (audio && volumeBar) {
  audio.volume = isNaN(savedVol) ? 0.8 : savedVol;
  volumeBar.value = audio.volume;
  updateSliderFill(volumeBar);
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateSliderFill(input) {
  if (!input) return;
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const val = parseFloat(input.value) || 0;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--pct", pct + "%");
}

function renderPlaylist() {
  if (!playlistEl) return;
  if (!musikCache.length) {
    playlistEl.innerHTML = `<li class="playlist-empty">Noch keine Songs · WG-Mitglieder können Lieder hinzufügen 🎵</li>`;
    setCurrentSong(-1, { autoplay: false, silent: true });
    updatePlayPauseUI();
    btnPrev.disabled = true;
    btnNext.disabled = true;
    btnPlayPause.disabled = true;
    return;
  }

  btnPlayPause.disabled = false;

  playlistEl.innerHTML = musikCache.map((s, i) => {
    const emb = songEmbedPlaylistInfo(s);
    const iconSpan = emb.icon
      ? `<span class="pi-icon" title="${emb.title}">${emb.icon}</span>`
      : `<span class="pi-icon">${i === currentSongIdx ? "♪" : i + 1}</span>`;
    return `
    <li class="playlist-item ${i === currentSongIdx ? "active" : ""} ${emb.cls}" data-idx="${i}">
      ${iconSpan}
      <div class="pi-meta">
        <span class="pi-title">${escapeHtml(s.title || 'Ohne Titel')}</span>
        <span class="pi-sub">${escapeHtml(s.artist || '')}${s.addedBy ? ` · hinzugefügt von ${escapeHtml(s.addedBy)}` : ''}</span>
      </div>
      ${auth.isAuthed ? `<button class="pi-delete" data-del="${i}" aria-label="Entfernen" title="Entfernen">✕</button>` : ""}
    </li>`;
  }).join("");

  playlistEl.querySelectorAll(".playlist-item").forEach(li => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".pi-delete")) return;
      const idx = parseInt(li.dataset.idx, 10);
      setCurrentSong(idx, { autoplay: true });
    });
  });
  playlistEl.querySelectorAll(".pi-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!requireAuth("Songs entfernen")) return;
      const idx = parseInt(btn.dataset.del, 10);
      const song = musikCache[idx];
      if (!song) return;
      if (confirm(`"${song.title}" aus der Playlist entfernen?`)) deleteSong(song.id);
    });
  });

  btnPrev.disabled = musikCache.length <= 1;
  btnNext.disabled = musikCache.length <= 1;
}

function clearExternalEmbed() {
  if (playerYoutubeFrame) playerYoutubeFrame.src = "about:blank";
  playerYoutubeWrap?.classList.add("hidden");
  playerYoutubeWrap?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-youtube-track", "is-soundcloud-track", "is-spotify-track");
  playerEmbedBox?.classList.remove(
    "is-soundcloud",
    "is-spotify",
    "is-spotify-tall",
    "is-spotify-episode"
  );
}

function setCurrentSong(idx, { autoplay = false, silent = false } = {}) {
  if (!audio) return;
  if (idx < 0 || idx >= musikCache.length) {
    currentSongIdx = -1;
    clearExternalEmbed();
    audio.removeAttribute("src");
    audio.load();
    nowTitle.textContent = "Noch kein Song ausgewählt";
    nowArtist.textContent = "";
    document.body.classList.remove("is-playing");
    if (progressBar) progressBar.disabled = false;
    if (volumeBar) volumeBar.disabled = false;
    if (timeCurrent) timeCurrent.textContent = "0:00";
    if (timeTotal) timeTotal.textContent = "0:00";
    if (volumeBar) volumeBar.title = "";
    return;
  }
  currentSongIdx = idx;
  const song = musikCache[idx];
  const yid = songGetYouTubeId(song);
  const scUrl = !yid ? songGetSoundCloudUrl(song) : null;
  const spRef = !yid && !scUrl ? songGetSpotify(song) : null;
  nowTitle.textContent = song.title || "Ohne Titel";
  nowArtist.textContent = song.artist || "";
  if (yid) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playerEmbedBox?.classList.remove(
      "is-soundcloud",
      "is-spotify",
      "is-spotify-tall",
      "is-spotify-episode"
    );
    if (playerEmbedHint) {
      playerEmbedHint.innerHTML =
        "Dieser Track läuft über <strong>YouTube</strong>. Play und Lautstärke im eingebetteten Video. Der <strong>Lautstärkeregler unten</strong> speichert die Stärke für MP3-/Audio-Links (nicht für das Video).";
    }
    playerYoutubeWrap?.classList.remove("hidden");
    playerYoutubeWrap?.setAttribute("aria-hidden", "false");
    if (playerYoutubeFrame) {
      playerYoutubeFrame.title = "YouTube";
      const ap = autoplay ? "1" : "0";
      playerYoutubeFrame.src = `https://www.youtube.com/embed/${yid}?rel=0&modestbranding=1&playsinline=1&autoplay=${ap}`;
    }
    document.body.classList.add("is-youtube-track");
    document.body.classList.remove("is-soundcloud-track", "is-spotify-track");
    if (progressBar) {
      progressBar.disabled = true;
      progressBar.value = 0;
      updateSliderFill(progressBar);
    }
    if (timeCurrent) timeCurrent.textContent = "∿";
    if (timeTotal) timeTotal.textContent = "YouTube";
  } else if (scUrl) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playerEmbedBox?.classList.add("is-soundcloud");
    if (playerEmbedHint) {
      playerEmbedHint.innerHTML =
        "Dieser Track läuft über <strong>SoundCloud</strong> im Kasten. Der <strong>Lautstärkeregler unten</strong> gilt für MP3-/Audio-Links; im SoundCloud-Player die Lautstärke dort oder über die Gerätetasten.";
    }
    playerYoutubeWrap?.classList.remove("hidden");
    playerYoutubeWrap?.setAttribute("aria-hidden", "false");
    if (playerYoutubeFrame) {
      playerYoutubeFrame.title = "SoundCloud";
      playerYoutubeFrame.src = soundcloudWidgetSrc(scUrl, autoplay);
    }
    document.body.classList.remove("is-youtube-track", "is-spotify-track");
    document.body.classList.add("is-soundcloud-track");
    if (progressBar) {
      progressBar.disabled = true;
      progressBar.value = 0;
      updateSliderFill(progressBar);
    }
    if (timeCurrent) timeCurrent.textContent = "∿";
    if (timeTotal) timeTotal.textContent = "SoundCloud";
  } else if (spRef) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    playerEmbedBox?.classList.remove("is-soundcloud");
    playerEmbedBox?.classList.add("is-spotify");
    playerEmbedBox?.classList.remove("is-spotify-tall", "is-spotify-episode");
    if (spRef.type === "episode") playerEmbedBox?.classList.add("is-spotify-episode");
    else if (spRef.type !== "track") playerEmbedBox?.classList.add("is-spotify-tall");
    if (playerEmbedHint) {
      playerEmbedHint.innerHTML =
        "Dieser Eintrag läuft über <strong>Spotify</strong> im Kasten. Lautstärke dort im Player oder mit den Tasten deines Geräts. Der <strong>Regler unten</strong> speichert die Stärke für MP3-/Audio-Links.";
    }
    playerYoutubeWrap?.classList.remove("hidden");
    playerYoutubeWrap?.setAttribute("aria-hidden", "false");
    if (playerYoutubeFrame) {
      playerYoutubeFrame.title = "Spotify";
      playerYoutubeFrame.src = spotifyEmbedSrc(spRef, autoplay);
    }
    document.body.classList.remove("is-youtube-track", "is-soundcloud-track");
    document.body.classList.add("is-spotify-track");
    if (progressBar) {
      progressBar.disabled = true;
      progressBar.value = 0;
      updateSliderFill(progressBar);
    }
    if (timeCurrent) timeCurrent.textContent = "∿";
    if (timeTotal) timeTotal.textContent = "Spotify";
  } else {
    clearExternalEmbed();
    document.body.classList.remove("is-youtube-track");
    if (progressBar) progressBar.disabled = false;
    if (volumeBar) volumeBar.disabled = false;
    audio.src = song.src;
    audio.load();
    if (autoplay) {
      audio.play().catch((err) => {
        if (!silent) showToast("Song konnte nicht abgespielt werden.", "error");
        console.warn(err);
      });
    }
  }
  if (volumeBar) {
    volumeBar.disabled = false;
    volumeBar.title = isCurrentTrackExternalEmbed()
      ? "Speichert die Lautstärke für MP3- und Audio-URLs. Bei Spotify, YouTube & SoundCloud: Lautstärke im eingebetteten Player oder Gerätelautstärke."
      : "";
  }
  updatePlayPauseUI();
  renderPlaylist();
}

function updatePlayPauseUI() {
  if (!btnPlayPause) return;
  if (isCurrentTrackYouTube()) {
    btnPlayPause.textContent = "🎬";
    btnPlayPause.title =
      "YouTube-Video im Kasten oben; Play/Pause dort steuern. Tipp: nochmal tippen lädt die Einbettung neu (Autoplay-Retry).";
    document.body.classList.add("is-playing", "is-youtube-track");
    return;
  }
  if (isCurrentTrackSoundCloud()) {
    btnPlayPause.textContent = "🎬";
    btnPlayPause.title =
      "SoundCloud-Player oben; dort abspielen. Tipp: nochmal tippen lädt den Player neu (Autoplay-Retry).";
    document.body.classList.add("is-playing", "is-soundcloud-track");
    return;
  }
  if (isCurrentTrackSpotify()) {
    btnPlayPause.textContent = "🎬";
    btnPlayPause.title =
      "Spotify-Player oben; dort abspielen. Tipp: nochmal tippen lädt das Embed neu.";
    document.body.classList.add("is-playing", "is-spotify-track");
    return;
  }
  const playing = !audio.paused && !audio.ended && audio.readyState > 2;
  btnPlayPause.textContent = playing ? "⏸" : "▶";
  btnPlayPause.title = "";
  document.body.classList.toggle("is-playing", playing);
}

btnPlayPause?.addEventListener("click", () => {
  if (!musikCache.length) return;
  if (currentSongIdx < 0) {
    setCurrentSong(0, { autoplay: true });
    return;
  }
  if (isCurrentTrackYouTube() && playerYoutubeFrame) {
    const yid = songGetYouTubeId(musikCache[currentSongIdx]);
    if (yid) {
      const u = new URL(`https://www.youtube.com/embed/${yid}`);
      u.searchParams.set("autoplay", "1");
      u.searchParams.set("rel", "0");
      u.searchParams.set("modestbranding", "1");
      u.searchParams.set("playsinline", "1");
      playerYoutubeFrame.src = u.toString();
    }
    return;
  }
  if (isCurrentTrackSoundCloud() && playerYoutubeFrame) {
    const sc = songGetSoundCloudUrl(musikCache[currentSongIdx]);
    if (sc) playerYoutubeFrame.src = soundcloudWidgetSrc(sc, true);
    return;
  }
  if (isCurrentTrackSpotify() && playerYoutubeFrame) {
    const sp = songGetSpotify(musikCache[currentSongIdx]);
    if (sp) playerYoutubeFrame.src = spotifyEmbedSrc(sp, true);
    return;
  }
  if (audio.paused) {
    audio.play().catch((err) => {
      showToast("Abspielen fehlgeschlagen.", "error");
      console.warn(err);
    });
  } else {
    audio.pause();
  }
});

btnPrev?.addEventListener("click", () => {
  if (!musikCache.length) return;
  const next = currentSongIdx <= 0 ? musikCache.length - 1 : currentSongIdx - 1;
  setCurrentSong(next, { autoplay: true });
});

btnNext?.addEventListener("click", () => {
  if (!musikCache.length) return;
  const next = (currentSongIdx + 1) % musikCache.length;
  setCurrentSong(next, { autoplay: true });
});

audio?.addEventListener("play", updatePlayPauseUI);
audio?.addEventListener("pause", updatePlayPauseUI);
audio?.addEventListener("ended", () => {
  if (musikCache.length > 1) {
    btnNext.click();
  } else {
    updatePlayPauseUI();
  }
});
audio?.addEventListener("timeupdate", () => {
  if (isCurrentTrackExternalEmbed() || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  if (progressBar) progressBar.value = pct;
  updateSliderFill(progressBar);
  if (timeCurrent) timeCurrent.textContent = fmtTime(audio.currentTime);
});
audio?.addEventListener("loadedmetadata", () => {
  if (timeTotal && !isCurrentTrackExternalEmbed()) timeTotal.textContent = fmtTime(audio.duration);
});
audio?.addEventListener("error", () => {
  if (isCurrentTrackExternalEmbed()) return;
  if (audio.src) showToast("Song konnte nicht geladen werden.", "error");
});

progressBar?.addEventListener("input", () => {
  if (isCurrentTrackExternalEmbed() || !audio?.duration) return;
  const t = (parseFloat(progressBar.value) / 100) * audio.duration;
  audio.currentTime = t;
  updateSliderFill(progressBar);
});

volumeBar?.addEventListener("input", () => {
  audio.volume = parseFloat(volumeBar.value);
  updateSliderFill(volumeBar);
  localStorage.setItem("has_player_vol", String(audio.volume));
});

/* Song hinzufügen – URL */
$("addSongUrlBtn")?.addEventListener("click", () => {
  if (!requireAuth("Songs hinzufügen")) return;
  $("songUrlForm").reset();
  $("songUrlDialog").showModal();
});
document.querySelector("#songUrlDialog .dialog-close")?.addEventListener("click", () => {
  $("songUrlDialog").close();
});
$("songUrlDialog")?.addEventListener("click", (e) => {
  if (e.target === $("songUrlDialog")) $("songUrlDialog").close();
});
$("songUrlForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Songs hinzufügen")) return;
  let url = $("songUrlInput").value.trim();
  // Convenience: Dropbox share link → raw
  if (/dropbox\.com/.test(url) && /\?dl=0/.test(url)) url = url.replace("?dl=0", "?raw=1");
  const yid = extractYouTubeId(url);
  const scUrl = !yid ? extractSoundCloudPageUrl(url) : null;
  const spRef = !yid && !scUrl ? extractSpotifyEmbedRef(url) : null;
  const entry = {
    title: $("songTitleInput").value.trim() || "Ohne Titel",
    artist: $("songArtistInput").value.trim(),
    src: url,
    kind: yid ? "youtube" : scUrl ? "soundcloud" : spRef ? "spotify" : "url",
    ...(yid ? { youtubeId: yid } : {}),
    ...(scUrl ? { soundcloudUrl: scUrl } : {}),
    ...(spRef ? { spotifyType: spRef.type, spotifyId: spRef.id } : {}),
    addedBy: auth.member,
    createdAt: Date.now()
  };
  await saveSong(entry);
  $("songUrlDialog").close();
});

/* Song hinzufügen – Datei-Upload */
$("addSongFileBtn")?.addEventListener("click", () => {
  if (!requireAuth("Songs hinzufügen")) return;
  $("songFileInput").click();
});

$("songFileInput")?.addEventListener("change", async (e) => {
  const file = (e.target.files || [])[0];
  e.target.value = "";
  if (!file) return;
  if (!requireAuth("Songs hinzufügen")) return;
  if (!file.type.startsWith("audio/")) {
    showToast("Bitte eine Audio-Datei wählen.", "error");
    return;
  }
  if (file.size > MAX_AUDIO_BYTES) {
    showToast(`Datei zu gross (${Math.round(file.size/1024)} KB). Max. ${Math.round(MAX_AUDIO_BYTES/1024)} KB – bitte Link statt Upload nutzen.`, "error");
    return;
  }

  const progress = document.createElement("div");
  progress.className = "upload-progress";
  progress.innerHTML = `<span class="spinner"></span><span>Lade Song hoch…</span>`;
  document.body.appendChild(progress);

  try {
    const dataUrl = await fileToDataUrl(file);
    const title = (prompt("Titel des Songs?", file.name.replace(/\.[^.]+$/, "")) || file.name).trim();
    const artist = (prompt("Künstler:in (optional):", "") || "").trim();
    const entry = {
      title: title || "Ohne Titel",
      artist,
      src: dataUrl,
      kind: "file",
      addedBy: auth.member,
      createdAt: Date.now()
    };
    await saveSong(entry);
  } catch (err) {
    console.error(err);
    showToast("Upload fehlgeschlagen.", "error");
  } finally {
    progress.remove();
  }
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveSong(entry) {
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "musik"), { ...entry, createdAt: serverTimestamp() });
      showToast(`"${entry.title}" hinzugefügt 🎵`, "success");
    } catch (e) {
      console.error(e);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    entry.id = "local_" + Date.now();
    localStore.musik.push(entry);
    musikCache = [...localStore.musik].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    saveLocal("musik", localStore.musik);
    renderPlaylist();
    showToast(`"${entry.title}" hinzugefügt 🎵`, "success");
  }
}

async function deleteSong(id) {
  if (!requireAuth("Songs entfernen")) return;
  const wasCurrent = musikCache[currentSongIdx]?.id === id;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "musik", id)); showToast("Song entfernt.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); return; }
  } else {
    localStore.musik = localStore.musik.filter(s => s.id !== id);
    musikCache = [...localStore.musik].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    saveLocal("musik", localStore.musik);
    renderPlaylist();
    showToast("Song entfernt.", "success");
  }
  if (wasCurrent) {
    audio.pause();
    setCurrentSong(-1);
  }
}

/* ==========================================================================
   WG-Intern · Tabs
   ========================================================================== */

document.querySelectorAll("[data-intern-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-intern-tab]").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll("#intern .kalender-panel").forEach(p => p.classList.add("hidden"));
    const key = tab.dataset.internTab;
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    $("ternTab" + name)?.classList.remove("hidden");
    if (key === "garten") renderGartenWeek();
  });
});

/* ==========================================================================
   Gartenbewässerung · Wochenplan (config/gartenPlan)
   ========================================================================== */

const GARTEN_DAY_DEF = [
  ["mon", "Montag"],
  ["tue", "Dienstag"],
  ["wed", "Mittwoch"],
  ["thu", "Donnerstag"],
  ["fri", "Freitag"],
  ["sat", "Samstag"],
  ["sun", "Sonntag"],
];

/** 0=So … 6=Sa (Aus Europe/Zurich per en-US weekday long) */
const GARTEN_DAYKEY_TO_DOW0 = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const GARTEN_EN_LONG_TO_DOW0 = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

/** Wand-Uhrzeit in Europe/Zurich → Date (wie die Cloud-Function) */
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

function zurichTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

/**
 * Nächste Kalendertage in Europe/Zurich (ab heute), ohne +24h-Fallen bei DST.
 * (Stündlich vorspulen, bis genug verschiedene YMD gesammelt sind.)
 */
function getZurichYmdListNextDays(count) {
  const ymds = [];
  const seen = new Set();
  const startYmd = zurichTodayYmd();
  const [Y0, M0, D0] = startYmd.split("-").map(Number);
  if ([Y0, M0, D0].some((n) => Number.isNaN(n))) return [];
  const t0 = zurichWallToUtcDate(Y0, M0, D0, 12, 0).getTime();
  for (let h = 0; h < 24 * 16 && ymds.length < count; h += 1) {
    const ymd = new Date(t0 + h * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
    if (!seen.has(ymd)) {
      seen.add(ymd);
      ymds.push(ymd);
    }
  }
  return ymds;
}

function getZurichDow0ForYmd(ymd) {
  const [Y, M, D] = ymd.split("-").map(Number);
  if ([Y, M, D].some((n) => Number.isNaN(n))) return null;
  const t = zurichWallToUtcDate(Y, M, D, 12, 0);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Zurich", weekday: "long" }).formatToParts(t);
  const w = parts.find((p) => p.type === "weekday")?.value;
  if (w == null) return null;
  return GARTEN_EN_LONG_TO_DOW0[w] !== undefined ? GARTEN_EN_LONG_TO_DOW0[w] : null;
}

/** Nächstes Vorkommen dieses Wochentags in Europe/Zurich (heute zählt mit). */
function nextYmdForGartenDayKey(dayKey) {
  const wantD0 = GARTEN_DAYKEY_TO_DOW0[dayKey];
  if (wantD0 === undefined) return null;
  const ymds = getZurichYmdListNextDays(8);
  for (const cand of ymds) {
    if (getZurichDow0ForYmd(cand) === wantD0) return cand;
  }
  return null;
}

const GARTEN_LEGACY_ZONE_LABELS = new Set([
  "Wasserhahn 2 (Wintergarten)",
  "Wasserhahn 1 – links (Manu)",
  "Wasserhahn 1 – rechts (Manu)",
]);

const GARTEN_LEGACY_DEVICE_NAMES = new Set([
  "Bewässerungscomputer",
  "Bewässerungs-Computer",
]);

function normalizeGartenZoneDevice(name, defDevice) {
  const n = String(name || "").trim();
  if (!n || GARTEN_LEGACY_DEVICE_NAMES.has(n)) return defDevice;
  return n;
}

const GARTEN_DEFAULT_ZONES = [
  {
    id: "wh2-wintergarten",
    label: "Beetbewässerung",
    subtitle: "Wasserhahn 2 (Wintergarten)",
    device: "Wasserhahn 2 (Wintergarten)",
    valveType: "irrigation",
    channel: null,
    enabled: true,
  },
  {
    id: "wh1-salat",
    label: "Salatbeete",
    subtitle: "Wasserhahn 1 links (Manu) – Tropfbewässerung Salat",
    device: "Wasserhahn 1 (Manu)",
    valveType: "dual",
    channel: 1,
    enabled: true,
  },
  {
    id: "wh1-rechts",
    label: "Tomatenbewässerung",
    subtitle: "Wasserhahn 1 rechts (Manu) – mit Pumpe",
    device: "Wasserhahn 1 (Manu)",
    valveType: "dual",
    channel: 2,
    enabled: true,
  },
];

function gartenSlotSkipKey(ymd, dayKey, idx, zoneId = "wh2-wintergarten") {
  return `${ymd}|${dayKey}|${idx}|${zoneId}`;
}

function isGartenSlotSkipped(sk, ymd, dayKey, idx, zoneId) {
  if (!sk || typeof sk !== "object") return false;
  if (sk[gartenSlotSkipKey(ymd, dayKey, idx, zoneId)] === true) return true;
  if (zoneId === "wh2-wintergarten" && sk[`${ymd}|${dayKey}|${idx}`] === true) return true;
  if (zoneId === "wh1-salat" && sk[gartenSlotSkipKey(ymd, dayKey, idx, "wh1-links")] === true) return true;
  return false;
}

function emptyGartenDays() {
  return { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
}

function formatGartenYmdShort(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return ymd;
  return `${d}.${m}.`;
}

function pruneGartenSlotSkips(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const t = zurichTodayYmd();
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v) continue;
    const first = String(k).split("|")[0];
    if (first >= t) o[k] = true;
  }
  return o;
}

function defaultGartenPlan() {
  return {
    enabled: false,
    deviceName: "Pumpe",
    nachlaufSec: 30,
    useSequenz: true,
    zones: GARTEN_DEFAULT_ZONES.map((z) => ({
      ...z,
      days: emptyGartenDays(),
    })),
    slotSkips: {},
    waterLog: {},
  };
}

function gartenYmdDaysAgo(ymd, days) {
  const [Y, M, D] = String(ymd || zurichTodayYmd()).split("-").map(Number);
  if ([Y, M, D].some((n) => Number.isNaN(n))) return ymd;
  const t = Date.UTC(Y, M - 1, D) - days * 86400000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Zurich" });
}

function pruneGartenWaterLog(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const cutoff = gartenYmdDaysAgo(zurichTodayYmd(), 21);
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k >= cutoff && v && typeof v === "object") o[k] = v;
  }
  return o;
}

function gartenWaterLogAt(entry) {
  if (!entry?.at) return null;
  if (typeof entry.at.toDate === "function") return entry.at.toDate();
  if (entry.at instanceof Date) return entry.at;
  const d = new Date(entry.at);
  return Number.isNaN(d.getTime()) ? null : d;
}

const GARTEN_WATER_SOURCE_LABELS = {
  plan: "Zeitplan",
  manual: "Manuell",
  whatsapp: "WhatsApp",
  website: "Website",
};

function formatGartenWaterLogLine(entry) {
  if (!entry?.status) return "Noch nicht gegossen";
  const at = gartenWaterLogAt(entry);
  const timeStr = at
    ? at.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })
    : "";
  const src = GARTEN_WATER_SOURCE_LABELS[entry.source] || entry.source || "";
  const tail = [timeStr, src].filter(Boolean).join(" · ");
  if (entry.status === "done") return `✅ Gegossen${tail ? ` · ${tail}` : ""}`;
  if (entry.status === "started") return `💧 Läuft${tail ? ` · ${tail}` : ""}`;
  if (entry.status === "skipped_rain") return "🌧️ Regen – übersprungen";
  if (entry.status === "failed") return "❌ Fehlgeschlagen";
  return "Noch nicht gegossen";
}

function normalizeGartenWaterLogDay(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return {};
  if (typeof entry.status === "string") return { "wh2-wintergarten": { ...entry } };
  return entry;
}

function gartenWaterLogForZone(data, ymd, zoneId) {
  const dayLog = normalizeGartenWaterLogDay(data.waterLog?.[ymd]);
  return dayLog[zoneId] || null;
}

/** Log-Zeile unter dem Wochentag (heutiger Kalendertag für diese Zone). */
function gartenDayLogHtml(dayKey, data, zoneId) {
  const today = zurichTodayYmd();
  const nextYmd = nextYmdForGartenDayKey(dayKey);
  const isToday = nextYmd === today;
  if (!isToday) {
    return nextYmd
      ? `<p class="garten-day-log is-future">Nächster Lauf: ${escapeHtml(formatGartenYmdShort(nextYmd))}</p>`
      : "";
  }
  const entry = gartenWaterLogForZone(data, today, zoneId);
  const cls = entry?.status === "done"
    ? "is-done"
    : entry?.status === "started"
      ? "is-running"
      : entry?.status === "skipped_rain"
        ? "is-rain"
        : "is-pending";
  return `<p class="garten-day-log ${cls}">${escapeHtml(formatGartenWaterLogLine(entry))}</p>`;
}

let gartenPlanCache = null;

function normalizeGartenPlan(raw) {
  const d = defaultGartenPlan();
  if (!raw || typeof raw !== "object") return d;
  d.enabled = !!raw.enabled;
  d.deviceName = (raw.deviceName || "Pumpe").trim() || "Pumpe";
  d.nachlaufSec = typeof raw.nachlaufSec === "number" ? Math.max(0, Math.min(300, raw.nachlaufSec)) : 30;
  d.useSequenz = raw.useSequenz !== false;
  d.slotSkips = pruneGartenSlotSkips(raw.slotSkips);
  d.waterLog = pruneGartenWaterLog(raw.waterLog);

  const emptyDays = emptyGartenDays();
  if (raw.zones && Array.isArray(raw.zones) && raw.zones.length) {
    const rawById = new Map();
    for (const z of raw.zones) {
      let id = String(z.id || "").trim();
      if (id === "wh1-links") id = "wh1-salat";
      if (!id) continue;
      rawById.set(id, { ...z, id });
    }
    d.zones = GARTEN_DEFAULT_ZONES.map((def) => {
      const z = rawById.get(def.id);
      const days = { ...emptyDays };
      if (z) {
        "mon tue wed thu fri sat sun".split(" ").forEach((k) => {
          const arr = z.days?.[k];
          days[k] = Array.isArray(arr)
            ? arr.map((s) => ({
              on: String(s.on || "07:00").slice(0, 5),
              off: String(s.off || "07:15").slice(0, 5),
            }))
            : [];
        });
      }
      const rawLabel = String(z?.label || "").trim();
      const label = (!rawLabel || GARTEN_LEGACY_ZONE_LABELS.has(rawLabel) || rawLabel === "Gartenschlauch")
        ? def.label
        : rawLabel;
      return {
        id: def.id,
        label,
        subtitle: String(z?.subtitle || def.subtitle || "").trim() || def.subtitle || "",
        device: normalizeGartenZoneDevice(z?.device, def.device),
        valveType: def.valveType === "dual" ? "dual" : "irrigation",
        channel: def.valveType === "dual" ? (z?.channel === 2 ? 2 : 1) : null,
        enabled: z ? z.enabled !== false : def.enabled !== false,
        days,
      };
    });
    return d;
  }

  const legacyDays = { ...emptyDays };
  "mon tue wed thu fri sat sun".split(" ").forEach((k) => {
    const arr = raw.days?.[k];
    legacyDays[k] = Array.isArray(arr)
      ? arr.map((s) => ({
        on: String(s.on || "07:00").slice(0, 5),
        off: String(s.off || "07:15").slice(0, 5),
      }))
      : [];
  });
  const legacyDevice = normalizeGartenZoneDevice(raw.deviceComputer, "Wasserhahn 2 (Wintergarten)");
  d.zones = GARTEN_DEFAULT_ZONES.map((def) => ({
    ...def,
    subtitle: def.subtitle || "",
    device: def.id === "wh2-wintergarten" ? legacyDevice : def.device,
    days: def.id === "wh2-wintergarten" ? legacyDays : { ...emptyDays },
  }));
  return d;
}

function gartenSlotRowHtml(zoneId, day, idx, s, nextYmd, skipped) {
  const on = (s.on || "07:00").slice(0, 5);
  const off = (s.off || "07:15").slice(0, 5);
  const hasSkip = !!nextYmd;
  const skLabel = hasSkip
    ? (skipped
      ? "Zurücknehmen (skip aufheben)"
      : `Überspringen (${formatGartenYmdShort(nextYmd)})`)
    : "";
  const skipBtn = hasSkip
    ? `<button type="button" class="mini-btn garten-skip-once" data-zone="${zoneId}" data-day="${day}" data-index="${idx}" data-ymd="${nextYmd}" data-skipped="${skipped ? "1" : "0"}" title="Nur diesen Gießblock (dieses Kalenderdatum)">${escapeHtml(skLabel)}</button>`
    : "";
  return `<div class="garten-slot-row" data-day="${day}" data-index="${idx}">
    <label>Ein <input type="time" class="garten-on" value="${on}" /></label>
    <label>Aus <input type="time" class="garten-off" value="${off}" /></label>
    <div class="garten-slot-actions">
      <button type="button" class="mini-btn danger garten-remove-slot" data-zone="${zoneId}" data-day="${day}" data-index="${idx}">Entfernen</button>
      ${skipBtn}
    </div>
  </div>`;
}

function renderGartenZoneWeek(zone, data) {
  const todayYmd = zurichTodayYmd();
  return GARTEN_DAY_DEF.map(([key, label]) => {
    const slots = zone.days[key] || [];
    const nextYmd = nextYmdForGartenDayKey(key) || todayYmd;
    const isToday = nextYmd === todayYmd;
    const inner = slots.length
      ? slots.map((s, i) =>
        gartenSlotRowHtml(
          zone.id,
          key,
          i,
          s,
          nextYmd,
          isGartenSlotSkipped(data.slotSkips, nextYmd, key, i, zone.id)
        )).join("")
      : "";
    return `<div class="garten-day${isToday ? " is-today" : ""}" data-day="${key}">
      <h4 class="garten-day-title">${escapeHtml(label)}${isToday ? ' <span class="garten-day-today-mark">Heute</span>' : ""}</h4>
      ${gartenDayLogHtml(key, data, zone.id)}
      <div class="garten-slots">${inner || `<p class="form-note" style="margin:0 0 8px;">Noch keine Zeiten — unten «Zeitblock» klicken.</p>`}</div>
      <button type="button" class="btn btn-ghost small garten-add-slot" data-zone="${zone.id}" data-day="${key}">+ Zeitblock</button>
    </div>`;
  }).join("");
}

function renderGartenWeek() {
  const root = $("gartenZones");
  if (!root) return;
  gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
  const data = gartenPlanCache;
  const en = $("gartenPlanEnabled");
  const dev = $("gartenDeviceName");
  const nachlauf = $("gartenNachlauf");
  const zoneSelect = $("gartenWaterNowZone");
  if (en) en.checked = !!data.enabled;
  if (dev) dev.value = data.deviceName || "Pumpe";
  if (nachlauf) nachlauf.value = data.nachlaufSec ?? 30;
  const tabsRoot = $("gartenZoneTabs");
  const activeTab = tabsRoot?.dataset.activeZone || data.zones?.[0]?.id || "wh2-wintergarten";
  const activeZone = (data.zones || []).find((z) => z.id === activeTab) || data.zones?.[0];

  if (zoneSelect) {
    zoneSelect.innerHTML = (data.zones || []).map((z) =>
      `<option value="${escapeHtml(z.id)}">${escapeHtml(z.label)}</option>`
    ).join("");
    zoneSelect.value = activeTab;
  }

  const zoneLabelEl = $("gartenWaterNowZoneLabel");
  const pumpHintEl = $("gartenWaterNowPumpHint");
  if (zoneLabelEl) zoneLabelEl.textContent = activeZone?.label || "—";
  if (pumpHintEl) {
    pumpHintEl.textContent = activeZone?.id === "wh1-rechts"
      ? " (Ventil + Pumpe)"
      : " (nur Ventil, keine Pumpe)";
  }

  if (tabsRoot) {
    tabsRoot.innerHTML = (data.zones || []).map((zone) => `
      <button
        type="button"
        class="garten-zone-tab${zone.id === activeTab ? " is-active" : ""}${zone.enabled === false ? " is-off" : ""}"
        role="tab"
        aria-selected="${zone.id === activeTab ? "true" : "false"}"
        data-zone-tab="${escapeHtml(zone.id)}"
      >${escapeHtml(zone.label)}</button>
    `).join("");
    tabsRoot.dataset.activeZone = activeTab;
    tabsRoot.querySelectorAll(".garten-zone-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        mergeGartenPlanFromDom();
        if (tabsRoot) tabsRoot.dataset.activeZone = btn.dataset.zoneTab || "";
        renderGartenWeek();
      });
    });
  }

  root.innerHTML = (data.zones || []).map((zone) => `
    <fieldset class="garten-zone-box${zone.id === activeTab ? " is-active" : ""}" data-zone-id="${escapeHtml(zone.id)}">
      <legend>${escapeHtml(zone.label)}</legend>
      <label class="toggle-row garten-zone-enabled-row">
        <input type="checkbox" class="garten-zone-enabled" data-zone="${escapeHtml(zone.id)}" ${zone.enabled !== false ? "checked" : ""} />
        <span>Zeitplan für diese Zone aktiv</span>
      </label>
      <p class="form-note garten-zone-device">${escapeHtml(zone.subtitle || zone.device)}${zone.channel ? ` · Ausgang ${zone.channel}` : ""}</p>
      <div class="garten-week garten-zone-week">${renderGartenZoneWeek(zone, data)}</div>
    </fieldset>
  `).join("");

  root.querySelectorAll(".garten-add-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      const zoneId = btn.dataset.zone;
      void (async () => {
        await afterGartenDomStable();
        mergeGartenPlanFromDom();
        gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
        const zone = gartenPlanCache.zones.find((z) => z.id === zoneId);
        if (!zone) return;
        zone.days[day] = zone.days[day] || [];
        zone.days[day].push({ on: "07:00", off: "07:15" });
        renderGartenWeek();
      })();
    });
  });
  root.querySelectorAll(".garten-remove-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      const zoneId = btn.dataset.zone;
      const idx = parseInt(btn.dataset.index, 10);
      void (async () => {
        await afterGartenDomStable();
        mergeGartenPlanFromDom();
        gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
        const zone = gartenPlanCache.zones.find((z) => z.id === zoneId);
        if (zone?.days[day]) zone.days[day].splice(idx, 1);
        renderGartenWeek();
      })();
    });
  });

  root.querySelectorAll(".garten-skip-once").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!requireMember("Gieß-Block anpassen")) return;
      const day = btn.dataset.day;
      const zoneId = btn.dataset.zone;
      const i = parseInt(btn.dataset.index, 10);
      const ymd = btn.dataset.ymd;
      if (!ymd || !day || !zoneId) return;
      const k = gartenSlotSkipKey(ymd, day, i, zoneId);
      const turnOff = btn.dataset.skipped === "1";
      await afterGartenDomStable();
      mergeGartenPlanFromDom();
      gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
      if (!gartenPlanCache.slotSkips) gartenPlanCache.slotSkips = {};
      if (turnOff) delete gartenPlanCache.slotSkips[k];
      else gartenPlanCache.slotSkips[k] = true;
      gartenPlanCache.slotSkips = pruneGartenSlotSkips(gartenPlanCache.slotSkips);
      if (firebaseReady) {
        try {
          await setDoc(
            doc(db, "config", "gartenPlan"),
            {
              slotSkips: gartenPlanCache.slotSkips,
              updatedBy: auth.member,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          showToast(turnOff ? "Skip zurückgenommen. 🌿" : "Dieser Block ist für diesen Termin übersprungen. 🌤️", "success");
        } catch (err) {
          console.error(err);
          showToast("Speichern fehlgeschlagen.", "error");
          try {
            const s = await getDoc(doc(db, "config", "gartenPlan"));
            if (s.exists()) gartenPlanCache = normalizeGartenPlan(s.data());
          } catch (_) { /* Firestore lesen */ }
        }
      } else {
        localStore.gartenPlan = gartenPlanCache;
        saveLocal("gartenPlan", gartenPlanCache);
        showToast("Lokal (Demo) gespeichert.", "success");
      }
      renderGartenWeek();
    });
  });
}

function gartenTimeToMin(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

const GARTEN_DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Damit <input type=time> ggf. aufgesetzte (noch fokusige) Werte wirklich im DOM landen, bevor wir lesen. */
function flushGartenTimeInputs() {
  const root = $("gartenZones");
  if (!root) return;
  const a = document.activeElement;
  if (a && root.contains(a) && (a.classList?.contains("garten-on") || a.classList?.contains("garten-off"))) {
    a.blur();
  }
}

/**
 * time: weder || „07:00" noch leerer String darf echten Wert verwerfen.
 * Leer + prev-Slot: Cache-Zeit (z. B. Rennen Blur/change vor dem Lesen).
 * Ohne prev: Default nur bei wirklich fehlendem Input.
 */
function readGartenTimeField(onEl, field, key, slotIdx, prev) {
  const def = field === "off" ? "07:15" : "07:00";
  const slot = prev?.days?.[key]?.[slotIdx];
  if (!onEl) {
    if (slot) return (field === "off" ? slot.off : slot.on) || def;
    return def;
  }
  const raw = onEl.value;
  if (raw != null && String(raw).trim() !== "") {
    return String(raw).trim().slice(0, 5);
  }
  if (slot) {
    const t = field === "off" ? slot.off : slot.on;
    if (t && String(t).trim() !== "") return String(t).trim().slice(0, 5);
  }
  return def;
}

/**
 * @param {object|null|undefined} prev  Letzter bekannter Plan (für leere time-Werte) — meist gartenPlanCache vor dem Merge.
 */
function collectZoneDaysFromDom(zoneEl, zoneId, last) {
  const days = emptyGartenDays();
  const lastZone = last?.zones?.find((z) => z.id === zoneId);
  GARTEN_DAY_KEYS.forEach((key) => {
    const dayEl = zoneEl.querySelector(`.garten-day[data-day="${key}"]`);
    if (!dayEl) return;
    const slots = dayEl.querySelector(".garten-slots");
    if (!slots) return;
    slots.querySelectorAll(".garten-slot-row").forEach((row, idx) => {
      const prevLike = lastZone ? { days: lastZone.days } : null;
      const on = readGartenTimeField(row.querySelector(".garten-on"), "on", key, idx, prevLike);
      const off = readGartenTimeField(row.querySelector(".garten-off"), "off", key, idx, prevLike);
      days[key].push({ on, off });
    });
  });
  return days;
}

function collectGartenPlanFromDom(prev) {
  const last = prev && typeof prev === "object" ? normalizeGartenPlan(prev) : null;
  const zonesRoot = $("gartenZones");

  const baseFields = {
    enabled: !!$("gartenPlanEnabled")?.checked,
    deviceName: ($("gartenDeviceName")?.value || "Pumpe").trim() || "Pumpe",
    nachlaufSec: parseInt($("gartenNachlauf")?.value, 10) || 30,
    useSequenz: true,
  };

  const zones = (last?.zones || defaultGartenPlan().zones).map((zone) => {
    const zoneEl = zonesRoot?.querySelector(`.garten-zone-box[data-zone-id="${zone.id}"]`);
    const days = zoneEl ? collectZoneDaysFromDom(zoneEl, zone.id, last) : (zone.days || emptyGartenDays());
    const enabledEl = zoneEl?.querySelector(`.garten-zone-enabled[data-zone="${zone.id}"]`);
    const enabled = enabledEl ? !!enabledEl.checked : zone.enabled !== false;
    return { ...zone, days, enabled };
  });

  return {
    ...baseFields,
    zones,
    slotSkips: gartenPlanCache
      ? pruneGartenSlotSkips(gartenPlanCache.slotSkips)
      : {},
    waterLog: gartenPlanCache
      ? pruneGartenWaterLog(gartenPlanCache.waterLog)
      : {},
  };
}

/** Call before add/remove/skip, wenn im DOM noch ungespeicherte Zeiten stehen. */
function mergeGartenPlanFromDom() {
  const zonesRoot = $("gartenZones");
  if (!zonesRoot?.querySelector?.(".garten-zone-box")) return;
  flushGartenTimeInputs();
  const prev = gartenPlanCache;
  gartenPlanCache = normalizeGartenPlan({ ...gartenPlanCache, ...collectGartenPlanFromDom(prev) });
}

/** Warten bis type=time nach Blur/change im Browser verlässlich .value liefert (mobil, Safari). */
function afterGartenDomStable() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => resolve(), 0);
      });
    });
  });
}

$("gartenPlanForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Gartenplan speichern")) return;
  flushGartenTimeInputs();
  await afterGartenDomStable();
  const next = collectGartenPlanFromDom(gartenPlanCache);
  for (const zone of next.zones || []) {
    for (const k of Object.keys(zone.days || {})) {
      for (const slot of zone.days[k]) {
        const a = gartenTimeToMin(slot.on);
        const b = gartenTimeToMin(slot.off);
        if (a === null || b === null) {
          showToast(`Ungültige Zeit in ${zone.label} (${k}). Bitte beide Uhrzeiten prüfen.`, "error");
          return;
        }
        if (a >= b) {
          showToast(`${zone.label}, ${k}: «Ein» muss vor «Aus» liegen (${slot.on} → ${slot.off}).`, "error");
          return;
        }
      }
    }
  }
  gartenPlanCache = normalizeGartenPlan(next);
  const wh2 = gartenPlanCache.zones?.find((z) => z.id === "wh2-wintergarten");
  const savePayload = {
    enabled: gartenPlanCache.enabled,
    deviceName: gartenPlanCache.deviceName,
    nachlaufSec: gartenPlanCache.nachlaufSec,
    useSequenz: true,
    zones: (gartenPlanCache.zones || []).map((z) => ({
      id: z.id,
      label: z.label,
      subtitle: z.subtitle || "",
      device: z.device,
      valveType: z.valveType,
      channel: z.channel,
      enabled: z.enabled !== false,
      days: z.days,
    })),
    slotSkips: gartenPlanCache.slotSkips,
    waterLog: gartenPlanCache.waterLog,
    deviceComputer: wh2?.device || "Wasserhahn 2 (Wintergarten)",
    updatedBy: auth.member,
    updatedAt: serverTimestamp(),
  };
  if (firebaseReady) {
    try {
      await setDoc(
        doc(db, "config", "gartenPlan"),
        savePayload,
        { merge: true }
      );
      showToast("Gartenplan gespeichert. 🌿", "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    localStore.gartenPlan = gartenPlanCache;
    saveLocal("gartenPlan", gartenPlanCache);
    showToast("Gartenplan lokal gespeichert (Demo).", "success");
  }
});

/* ==========================================================================
   Garten · Jetzt bewässern (30 Min, Regen ±6h)
   ========================================================================== */

const GARTEN_MANUAL_MINUTES = 30;
const GARTEN_RAIN_METEO_TTL_MS = 15 * 60 * 1000;
/** Ab dieser Menge (mm/h, Open-Meteo) gilt eine Stunde als «regnerisch». */
const GARTEN_RAIN_MIN_MM = 0.1;
let gartenRainMeteoCache = { t: 0, data: null };

function hourLooksRainy(precipMm, wmoCode) {
  const p = Number(precipMm);
  if (!Number.isNaN(p) && p > GARTEN_RAIN_MIN_MM) return true;
  const c = Number(wmoCode);
  if (Number.isNaN(c)) return p > 0.05;
  if (c >= 51 && c <= 67) return true;
  if (c >= 80 && c <= 82) return true;
  if (c >= 95) return true;
  if (c >= 71 && c <= 77) return true;
  if (c >= 85 && c <= 86) return true;
  return p > 0.05;
}

function formatGartenRainMm(mm) {
  const n = Number(mm);
  if (Number.isNaN(n) || n <= 0) return "0";
  if (n < 0.1) return "< 0,1";
  if (n < 10) return n.toLocaleString("de-CH", { maximumFractionDigits: 1 });
  return Math.round(n).toLocaleString("de-CH");
}

function gartenRainIntensityLabel(maxMm) {
  const m = Number(maxMm) || 0;
  if (m >= 5) return "kräftiger Regen";
  if (m >= 1) return "mässiger Regen";
  if (m >= GARTEN_RAIN_MIN_MM) return "leichter Niederschlag";
  return "Regen laut Wettercode (wenig mm gemeldet)";
}

function buildGartenRainRiskSummary(hits) {
  if (!hits.length) return { rainy: false, summary: "", detail: "", hint: "" };

  const now = Date.now();
  const past = hits.some((h) => h.endMs <= now || h.startMs < now);
  const future = hits.some((h) => h.endMs > now);
  let summary = "In den nächsten 6 Stunden ist Regen gemeldet.";
  if (past && future) summary = "In den letzten und nächsten 6 Stunden ist Regen gemeldet.";
  else if (past && !future) summary = "In den letzten 6 Stunden hat es geregnet.";

  const totalMm = hits.reduce((s, h) => s + (Number(h.precip) || 0), 0);
  const maxMm = hits.reduce((m, h) => Math.max(m, Number(h.precip) || 0), 0);
  const intensity = gartenRainIntensityLabel(maxMm);

  const detail = totalMm > 0
    ? `Erwarteter Niederschlag im Fenster: ca. ${formatGartenRainMm(totalMm)} mm (${intensity}, stärkste Stunde ~${formatGartenRainMm(maxMm)} mm).`
    : `Wettermodell meldet Regen ohne konkrete mm-Angabe (${intensity}).`;

  const hint = `Es zählen Niederschlag ab ${String(GARTEN_RAIN_MIN_MM).replace(".", ",")} mm/h und Regen-Wettercodes (Open-Meteo, ±6 h um jetzt).`;

  return { rainy: true, summary, detail, hint, totalMm, maxMm };
}

async function fetchGartenRainMeteo() {
  if (gartenRainMeteoCache.data && Date.now() - gartenRainMeteoCache.t < GARTEN_RAIN_METEO_TTL_MS) {
    return gartenRainMeteoCache.data;
  }
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(WEATHER_SPOT.lat));
  u.searchParams.set("longitude", String(WEATHER_SPOT.lon));
  u.searchParams.set("hourly", "precipitation,weathercode");
  u.searchParams.set("timezone", "Europe/Zurich");
  u.searchParams.set("past_days", "2");
  u.searchParams.set("forecast_days", "2");
  u.searchParams.set("timeformat", "unixtime");
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`Wetter ${res.status}`);
  const data = await res.json();
  gartenRainMeteoCache = { t: Date.now(), data };
  return data;
}

/** Regen in ±6h um jetzt (wie Server-Gießplan). */
async function gartenRainRiskIn6h() {
  try {
    const data = await fetchGartenRainMeteo();
    const hourly = data?.hourly;
    const times = hourly?.time;
    const prec = hourly?.precipitation;
    const codes = hourly?.weathercode;
    if (!Array.isArray(times) || !times.length) return { rainy: false, summary: "", detail: "", hint: "" };

    const now = Date.now();
    const ws = now - 6 * 60 * 60 * 1000;
    const we = now + 6 * 60 * 60 * 1000;
    const hits = [];

    for (let i = 0; i < times.length; i++) {
      const raw = times[i];
      const hs = (typeof raw === "number" ? raw : Number(raw)) * 1000;
      if (Number.isNaN(hs)) continue;
      const he = hs + 3600 * 1000;
      if (hs >= we || he <= ws) continue;
      if (!hourLooksRainy(prec?.[i], codes?.[i])) continue;
      hits.push({ startMs: hs, endMs: he, precip: Number(prec?.[i]) || 0 });
    }

    return buildGartenRainRiskSummary(hits);
  } catch (e) {
    console.warn("gartenRainRiskIn6h", e);
    return { rainy: false, summary: "", detail: "", hint: "", error: true };
  }
}

function getGartenActiveZoneId() {
  const fromTab = $("gartenZoneTabs")?.dataset.activeZone?.trim();
  if (fromTab) return fromTab;
  const fromSelect = $("gartenWaterNowZone")?.value?.trim();
  if (fromSelect) return fromSelect;
  return gartenPlanCache?.zones?.[0]?.id || "wh2-wintergarten";
}

function getGartenDeviceConfigFromUi() {
  flushGartenTimeInputs();
  mergeGartenPlanFromDom();
  const p = normalizeGartenPlan(gartenPlanCache);
  const zoneId = getGartenActiveZoneId();
  return {
    zoneId,
    devicePumpe: ($("gartenDeviceName")?.value || p.deviceName || "Pumpe").trim(),
    nachlaufSec: typeof p.nachlaufSec === "number" ? p.nachlaufSec : 30,
    pumpAllowed: zoneId === "wh1-rechts",
  };
}

function waitForGartenCommandResult(ref) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve({ ok: false, message: "Timeout – Server antwortet nicht." });
    }, 90000);
    const unsub = onSnapshot(ref, (snap) => {
      const d = snap.data();
      if (!d || d.status === "pending" || d.status === "running") return;
      clearTimeout(timeout);
      unsub();
      resolve({
        ok: d.status === "done",
        message: d.message || (d.status === "done" ? "OK" : "Fehler"),
      });
    }, (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, message: err?.message || "Listener-Fehler" });
    });
  });
}

async function submitGartenCommand(payload) {
  if (!requireMember("Garten bewässern")) return { ok: false, message: "Nur für WG-Mitglieder." };
  if (!firebaseReady) {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
    return { ok: false, message: "Kein Firebase" };
  }
  const ref = await addDoc(collection(db, "garten_commands"), {
    ...payload,
    status: "pending",
    member: auth.member,
    createdAt: serverTimestamp(),
  });
  return waitForGartenCommandResult(ref);
}

function openGartenRainWarnDialog(risk) {
  const summary = risk?.summary || "In den nächsten 6 Stunden ist Regen gemeldet.";
  const detail = risk?.detail || "";
  const hint = risk?.hint || "";
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "auth-dialog garten-rain-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="auth-form garten-rain-form">
        <h2 class="auth-title">🌧️ Regen-Warnung</h2>
        <div class="garten-rain-banner">
          <p class="garten-rain-lead">${escapeHtml(summary)}</p>
          ${detail ? `<p class="garten-rain-detail">${escapeHtml(detail)}</p>` : ""}
        </div>
        <p class="form-note garten-rain-question">
          Möchtest du die Bewässerung trotzdem starten? (Dauer: ${GARTEN_MANUAL_MINUTES} Min)
        </p>
        ${hint ? `<p class="form-note garten-rain-hint">${escapeHtml(hint)}</p>` : ""}
        <div class="garten-rain-actions">
          <button type="button" class="btn btn-ghost" id="gartenRainCancel">Abbrechen</button>
          <button type="button" class="btn btn-primary" id="gartenRainForce">Bewässern</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const done = (v) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.querySelector("#gartenRainCancel").addEventListener("click", () => done(false));
    dialog.querySelector("#gartenRainForce").addEventListener("click", () => done(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(false);
    });
    dialog.showModal();
  });
}

async function runGartenWaterNow(forceRain) {
  const cfg = getGartenDeviceConfigFromUi();
  const result = await submitGartenCommand({
    action: "start",
    minutes: GARTEN_MANUAL_MINUTES,
    forceRain: !!forceRain,
    ...cfg,
  });
  const plain = (result.message || "").replace(/\*/g, "");
  showToast(plain.slice(0, 280) || (result.ok ? "Bewässerung gestartet." : "Fehler"), result.ok ? "success" : "error");
  return result.ok;
}

async function startGartenWaterNow() {
  if (!requireMember("Jetzt bewässern")) return;
  const btn = $("gartenWaterNowBtn");
  const stopBtn = $("gartenWaterStopBtn");
  if (btn) btn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  try {
    showToast("Prüfe Wetter…", "info");
    const risk = await gartenRainRiskIn6h();
    let forceRain = false;
    if (risk.rainy) {
      const proceed = await openGartenRainWarnDialog(risk);
      if (!proceed) return;
      forceRain = true;
    }
    const zoneId = getGartenActiveZoneId();
    const zone = gartenPlanCache?.zones?.find((z) => z.id === zoneId);
    const zoneName = zone?.label || zoneId;
    const pumpNote = zoneId === "wh1-rechts" ? "" : " (nur Ventil)";
    showToast(`Starte ${zoneName}${pumpNote} (${GARTEN_MANUAL_MINUTES} Min)…`, "info");
    await runGartenWaterNow(forceRain);
  } finally {
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
  }
}

async function stopGartenWaterNow() {
  if (!requireMember("Bewässerung stoppen")) return;
  const btn = $("gartenWaterNowBtn");
  const stopBtn = $("gartenWaterStopBtn");
  if (btn) btn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;
  try {
    const result = await submitGartenCommand({ action: "stop" });
    const plain = (result.message || "").replace(/\*/g, "");
    showToast(plain.slice(0, 200) || (result.ok ? "Gestoppt." : "Fehler"), result.ok ? "success" : "error");
  } finally {
    if (btn) btn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
  }
}

$("gartenWaterNowBtn")?.addEventListener("click", () => { void startGartenWaterNow(); });
$("gartenWaterStopBtn")?.addEventListener("click", () => { void stopGartenWaterNow(); });

/* ==========================================================================
   Kandidat:innen (nur für WG)
   ========================================================================== */

let kandidatenCache = [];
const STATUS_LABEL = {
  offen: "Offen",
  eingeladen: "Eingeladen",
  abgelehnt: "Abgelehnt",
  eingezogen: "Eingezogen"
};

function renderKandidaten() {
  const list = $("kandidatenList");
  if (!list) return;
  if (!kandidatenCache.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Kandidat:innen eingetragen. 🏠</div>`;
    return;
  }
  const sorted = [...kandidatenCache].sort((a, b) => (b.createdAt?.toMillis?.() || b.createdAt || 0) - (a.createdAt?.toMillis?.() || a.createdAt || 0));

  list.innerHTML = sorted.map(k => {
    const votes = k.votes || {};
    const counts = { yes: 0, maybe: 0, no: 0 };
    const voters = { yes: [], maybe: [], no: [] };
    Object.entries(votes).forEach(([name, v]) => {
      if (counts[v] !== undefined) {
        counts[v]++;
        voters[v].push(name);
      }
    });
    const myVote = auth.isAuthed ? votes[auth.member] : null;
    const status = k.status || "offen";

    const votersChips = ["yes","maybe","no"].flatMap(v =>
      voters[v].map(n => `<span class="voter-chip ${v}">${mEmoji(n)} ${escapeHtml(mLabel(n))}</span>`)
    ).join("");

    return `
      <article class="kandidat-card status-${status}">
        <div class="kandidat-head">
          <div>
            <h3 class="kandidat-title">${escapeHtml(k.name)}${k.alter ? `<span class="alter">· ${k.alter} Jahre</span>` : ""}</h3>
            <div class="kandidat-meta">
              <span class="status-badge ${status}">${STATUS_LABEL[status] || status}</span>
              ${k.addedBy ? `<span>· eingetragen von ${escapeHtml(mLabel(k.addedBy) || k.addedBy)}</span>` : ""}
            </div>
          </div>
        </div>
        ${k.info ? `<p class="kandidat-info">${escapeHtml(k.info)}</p>` : ""}
        ${k.kontakt ? `<p class="kandidat-kontakt">📧 ${linkifyContact(k.kontakt)}</p>` : ""}

        <div class="kandidat-votes">
          <button class="vote-btn yes ${myVote==='yes'?'active':''}" data-id="${k.id}" data-vote="yes">👍 Dafür <span class="count">${counts.yes}</span></button>
          <button class="vote-btn maybe ${myVote==='maybe'?'active':''}" data-id="${k.id}" data-vote="maybe">🤔 Vielleicht <span class="count">${counts.maybe}</span></button>
          <button class="vote-btn no ${myVote==='no'?'active':''}" data-id="${k.id}" data-vote="no">👎 Dagegen <span class="count">${counts.no}</span></button>
        </div>
        ${votersChips ? `<div class="vote-voters">${votersChips}</div>` : ""}

        <div class="kandidat-actions">
          <label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text-muted);">
            Status:
            <select class="status-select-inline" data-id="${k.id}" data-action="status">
              ${Object.entries(STATUS_LABEL).map(([v,l]) => `<option value="${v}" ${status===v?'selected':''}>${l}</option>`).join("")}
            </select>
          </label>
          <button class="mini-btn danger" data-id="${k.id}" data-action="delete">Löschen</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".vote-btn").forEach(btn => {
    btn.addEventListener("click", () => setKandidatVote(btn.dataset.id, btn.dataset.vote));
  });
  list.querySelectorAll("[data-action='status']").forEach(sel => {
    sel.addEventListener("change", () => setKandidatStatus(sel.dataset.id, sel.value));
  });
  list.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = kandidatenCache.find(x => x.id === btn.dataset.id);
      if (!k) return;
      if (confirm(`"${k.name}" wirklich entfernen?`)) deleteKandidat(btn.dataset.id);
    });
  });
}

function linkifyContact(c) {
  const s = escapeHtml(c);
  if (/^\S+@\S+\.\S+$/.test(c)) return `<a href="mailto:${s}">${s}</a>`;
  if (/^[+0-9\s()-]{6,}$/.test(c)) return `<a href="tel:${c.replace(/\s/g,'')}">${s}</a>`;
  return s;
}

async function setKandidatVote(id, vote) {
  if (!requireAuth("Abstimmen")) return;
  if (firebaseReady) {
    const current = kandidatenCache.find(k => k.id === id);
    const existing = current?.votes?.[auth.member];
    const newValue = existing === vote ? deleteField() : vote;
    try {
      await updateDoc(doc(db, "kandidaten", id), { [`votes.${auth.member}`]: newValue });
    } catch (e) { showToast("Speichern fehlgeschlagen.", "error"); console.error(e); }
  } else {
    const item = localStore.kandidaten.find(k => k.id === id);
    if (!item) return;
    item.votes = item.votes || {};
    if (item.votes[auth.member] === vote) delete item.votes[auth.member];
    else item.votes[auth.member] = vote;
    kandidatenCache = localStore.kandidaten;
    saveLocal("kandidaten", localStore.kandidaten);
    renderKandidaten();
  }
}

async function setKandidatStatus(id, status) {
  if (!requireAuth("Status ändern")) return;
  if (firebaseReady) {
    try { await updateDoc(doc(db, "kandidaten", id), { status }); showToast("Status aktualisiert.", "success"); }
    catch (e) { showToast("Speichern fehlgeschlagen.", "error"); }
  } else {
    const item = localStore.kandidaten.find(k => k.id === id);
    if (!item) return;
    item.status = status;
    kandidatenCache = localStore.kandidaten;
    saveLocal("kandidaten", localStore.kandidaten);
    renderKandidaten();
  }
}

async function deleteKandidat(id) {
  if (!requireAuth("Kandidat:in löschen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "kandidaten", id)); showToast("Entfernt.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.kandidaten = localStore.kandidaten.filter(k => k.id !== id);
    kandidatenCache = localStore.kandidaten;
    saveLocal("kandidaten", localStore.kandidaten);
    renderKandidaten();
  }
}

$("kandidatForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Kandidat:in hinzufügen")) return;
  const alterRaw = $("kandAlter").value.trim();
  const entry = {
    name: $("kandName").value.trim(),
    alter: alterRaw ? parseInt(alterRaw, 10) : null,
    info: $("kandInfo").value.trim(),
    kontakt: $("kandKontakt").value.trim(),
    status: $("kandStatus").value || "offen",
    votes: {},
    addedBy: auth.member,
    createdAt: Date.now()
  };
  if (firebaseReady) {
    try { await addDoc(collection(db, "kandidaten"), { ...entry, createdAt: serverTimestamp() }); }
    catch (err) { showToast("Speichern fehlgeschlagen.", "error"); return; }
  } else {
    entry.id = "local_" + Date.now();
    localStore.kandidaten.push(entry);
    kandidatenCache = localStore.kandidaten;
    saveLocal("kandidaten", localStore.kandidaten);
    renderKandidaten();
  }
  e.target.reset();
  showToast("Kandidat:in gespeichert.", "success");
});

/* ==========================================================================
   Schäden (nur für WG)
   ========================================================================== */

let schaedenCache = [];
const PRIO_LABEL = { low: "Niedrig", medium: "Mittel", high: "Hoch" };
const SCHADEN_STATUS_LABEL = { offen: "Offen", in_bearbeitung: "In Arbeit", erledigt: "Erledigt" };
/** wg = WG intern, vermieter = Frau Schellenberg (Schelly) */
const SCHADEN_KUEMMERER_LABEL = { wg: "WG intern", vermieter: "Vermieterin (Schelly)" };

function normalizeSchadenKuemmerer(v) {
  return v === "vermieter" ? "vermieter" : "wg";
}

function schadenKuemmererLabel(v) {
  return SCHADEN_KUEMMERER_LABEL[normalizeSchadenKuemmerer(v)];
}

function schadenHistoryEntry(action, fields = {}) {
  return {
    at: new Date().toISOString(),
    by: auth.member || "WG",
    action,
    ...fields,
  };
}

function appendSchadenHistory(item, entry) {
  const hist = Array.isArray(item.history) ? [...item.history] : [];
  hist.unshift(entry);
  if (hist.length > 50) hist.length = 50;
  return hist;
}

function schadenTimestampMs(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof ts === "number") return ts;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/** Bestehende Schäden ohne history[]: Anlege-Eintrag aus Metadaten. */
function getSchadenHistory(item) {
  if (Array.isArray(item.history) && item.history.length) return item.history;
  const ms = schadenTimestampMs(item.createdAt);
  if (!ms) return [];
  return [
    {
      at: new Date(ms).toISOString(),
      by: item.addedBy || "WG",
      action: "created",
      titel: item.titel || "",
      ort: item.ort || "",
      prio: item.prio || "medium",
      status: "offen",
      zustaendig: item.zustaendig || "",
      kuemmerer: normalizeSchadenKuemmerer(item.kuemmerer),
    },
  ];
}

function formatSchadenHistoryWhen(at) {
  return new Date(at).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

function schadenHistoryActionLabel(action) {
  if (action === "created") return "Gemeldet";
  if (action === "status") return "Status";
  if (action === "zustaendig") return "Zuständig";
  if (action === "reminder") return "WhatsApp-Erinnerung";
  if (action === "kuemmerer") return "Zuständigkeit";
  return action || "Änderung";
}

function schadenHistoryDetailText(h, item) {
  if (h.action === "created") {
    const parts = [h.titel || item?.titel, h.ort || item?.ort, PRIO_LABEL[h.prio] || h.prio].filter(Boolean);
    return parts.join(" · ") || "Schaden gemeldet";
  }
  if (h.action === "status") {
    const prev = SCHADEN_STATUS_LABEL[h.prev] || h.prev || "—";
    const next = SCHADEN_STATUS_LABEL[h.next] || h.next || "—";
    return `${prev} → ${next}`;
  }
  if (h.action === "zustaendig") {
    const prev = h.prev ? mLabel(h.prev) : "—";
    const next = h.next ? mLabel(h.next) : "—";
    return `${prev} → ${next}`;
  }
  if (h.action === "reminder") {
    if (h.fairNote) return h.fairNote;
    return h.next === "an" || h.next === true ? "eingeschaltet" : "ausgeschaltet";
  }
  if (h.action === "kuemmerer") {
    const prev = schadenKuemmererLabel(h.prev);
    const next = schadenKuemmererLabel(h.next);
    return `${prev} → ${next}`;
  }
  return h.note || "";
}

function formatSchadenHistoryLine(h, item) {
  const detail = schadenHistoryDetailText(h, item);
  const fair = h.note ? `<br><span class="schaden-fair-inline">${escapeHtml(h.note)}</span>` : "";
  return `<li><time>${formatSchadenHistoryWhen(h.at)}</time> · ${escapeHtml(mLabel(h.by) || h.by || "—")} · ${escapeHtml(detail)}${fair}</li>`;
}

function schadenHistoryHtml(item) {
  const hist = getSchadenHistory(item);
  if (!hist.length) return "<p class=\"form-note\">Noch keine Einträge im Verlauf.</p>";
  return `<ul class="schaden-history-list">${hist.map((h) => formatSchadenHistoryLine(h, item)).join("")}</ul>`;
}

function formatSchadenCreated(ts) {
  const ms = schadenTimestampMs(ts);
  if (!ms) return "";
  return new Date(ms).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  });
}

function escapeCsvCell(v) {
  const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadSchaedenExcel() {
  if (!schaedenCache.length) {
    showToast("Keine Schäden zum Exportieren.", "info");
    return;
  }
  const sep = ";";
  const bom = "\uFEFF";
  const ymd = zurichTodayYmd();
  const lines = [];

  lines.push(`${bom}Schäden – Übersicht`);
  lines.push(
        ["ID", "Titel", "Ort", "Status", "Priorität", "Zuständig", "Kümmert", "WhatsApp-Erinnerung", "Gemeldet von", "Erstellt am", "Beschreibung", "Foto"]
      .map(escapeCsvCell)
      .join(sep)
  );
  for (const s of schaedenCache) {
    lines.push(
      [
        s.id,
        s.titel,
        s.ort,
        SCHADEN_STATUS_LABEL[s.status] || s.status,
        PRIO_LABEL[s.prio] || s.prio,
        s.zustaendig ? mLabel(s.zustaendig) : "",
        schadenKuemmererLabel(s.kuemmerer),
        s.zustaendig && s.reminder !== false
          ? reminderEveryDaysLabel(normalizeReminderEveryDays(s.reminderEveryDays, 7))
          : "nein",
        s.addedBy ? mLabel(s.addedBy) : "",
        formatSchadenCreated(s.createdAt),
        s.beschreibung,
        s.image ? "ja" : "nein",
      ]
        .map(escapeCsvCell)
        .join(sep)
    );
  }

  lines.push("");
  lines.push("Schäden – Verlauf");
  lines.push(
    ["Schaden-ID", "Titel", "Datum/Zeit", "Von", "Aktion", "Details"]
      .map(escapeCsvCell)
      .join(sep)
  );
  for (const s of schaedenCache) {
    for (const h of getSchadenHistory(s)) {
      lines.push(
        [
          s.id,
          s.titel,
          formatSchadenHistoryWhen(h.at),
          mLabel(h.by) || h.by,
          schadenHistoryActionLabel(h.action),
          schadenHistoryDetailText(h, s),
        ]
          .map(escapeCsvCell)
          .join(sep)
      );
    }
  }

  const blob = new Blob([lines.join("\r\n")], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Schaeden_${ymd}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("Excel-Export heruntergeladen.", "success");
}

function populateSchadenZustaendigSelect() {
  const select = $("schadZustaendig");
  if (!select) return;
  const current = select.value;
  const adults = getActiveAdults();
  select.innerHTML = `<option value="">Noch offen</option>` +
    adults.map(b => `<option value="${b.name}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`).join("");
  if (current) select.value = current;
}

function renderSchaeden() {
  const list = $("schaedenList");
  if (!list) return;
  if (!schaedenCache.length) {
    list.innerHTML = `<div class="empty-state">Keine offenen Schäden – alles in Ordnung 🔧✨</div>`;
    return;
  }

  // Sortierung: offene zuerst (high-prio ganz oben), erledigte ans Ende
  const prioWeight = { high: 0, medium: 1, low: 2 };
  const statusWeight = { offen: 0, in_bearbeitung: 1, erledigt: 2 };
  const sorted = [...schaedenCache].sort((a, b) => {
    const sw = (statusWeight[a.status] ?? 0) - (statusWeight[b.status] ?? 0);
    if (sw !== 0) return sw;
    return (prioWeight[a.prio] ?? 1) - (prioWeight[b.prio] ?? 1);
  });

  list.innerHTML = sorted.map(s => {
    const prio = s.prio || "medium";
    const status = s.status || "offen";
    const zustaendigBewohner = s.zustaendig ? BEWOHNER.find((b) => b.name === s.zustaendig) : null;
    const zustaendigLabel = zustaendigBewohner
      ? `${mEmoji(zustaendigBewohner.name)} ${escapeHtml(mLabel(zustaendigBewohner.name))}`
      : s.zustaendig ? escapeHtml(mLabel(s.zustaendig) || s.zustaendig) : "noch niemand";
    const schadenReminderOn = !!s.zustaendig && s.reminder !== false && status !== "erledigt";
    const schadenReminderDays = normalizeReminderEveryDays(s.reminderEveryDays, 7);
    const kuemmerer = normalizeSchadenKuemmerer(s.kuemmerer);
    const reminderBadge = schadenReminderOn
      ? `<span class="gartentodo-reminder-badge" title="${escapeAttr(TODO_CARD_LABELS.schadenReminderTitle(schadenReminderDays))}">📱</span>`
      : "";
    const kuemmererBadge = kuemmerer === "vermieter"
      ? `<span class="schaden-kuemmerer-badge vermieter" title="Frau Schellenberg (Schelly)">🏠 Schelly</span>`
      : `<span class="schaden-kuemmerer-badge wg" title="WG kümmert sich intern">🏡 WG</span>`;

    return `
      <article class="schaden-card prio-${prio} status-${status}">
        <div class="schaden-head">
          <h3 class="schaden-titel">${escapeHtml(s.titel)}</h3>
          <div class="schaden-badges">
            <span class="prio-badge ${prio}">${PRIO_LABEL[prio]}</span>
            <span class="status-badge ${status === 'erledigt' ? 'eingezogen' : status === 'in_bearbeitung' ? 'eingeladen' : 'offen'}">
              ${status === 'erledigt' ? '✓ Erledigt' : status === 'in_bearbeitung' ? '🛠️ In Arbeit' : '⏳ Offen'}
            </span>
            ${kuemmererBadge}
            ${reminderBadge}
          </div>
        </div>
        <div class="schaden-meta">
          ${s.ort ? `<span>📍 ${escapeHtml(s.ort)}</span>` : ""}
          <span>${kuemmerer === "vermieter" ? "🏠" : "🏡"} ${escapeHtml(schadenKuemmererLabel(kuemmerer))}</span>
          <span>👤 Kümmert sich: ${zustaendigLabel}</span>
          ${s.addedBy ? `<span>· gemeldet von ${escapeHtml(mLabel(s.addedBy) || s.addedBy)}</span>` : ""}
        </div>
        ${s.beschreibung ? `<p class="schaden-body">${escapeHtml(s.beschreibung)}</p>` : ""}
        ${s.image ? `<div class="schaden-foto"><img src="${escapeAttr(safeUrl(s.image))}" alt="Foto zum Schaden: ${escapeAttr(s.titel || "")}" loading="lazy" /></div>` : ""}
        <details class="schaden-verlauf">
          <summary>Verlauf (${getSchadenHistory(s).length})</summary>
          ${schadenHistoryHtml(s)}
        </details>
        <div class="schaden-actions">
          <div class="schaden-actions-left">
            <select class="status-select-inline" data-id="${s.id}" data-action="status">
              <option value="offen" ${status==='offen'?'selected':''}>⏳ Offen</option>
              <option value="in_bearbeitung" ${status==='in_bearbeitung'?'selected':''}>🛠️ In Arbeit</option>
              <option value="erledigt" ${status==='erledigt'?'selected':''}>✓ Erledigt</option>
            </select>
            <select class="status-select-inline" data-id="${s.id}" data-action="zustaendig">
              <option value="">— Noch offen —</option>
              ${getActiveAdults().map(b => `<option value="${b.name}" ${s.zustaendig===b.name?'selected':''}>${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`).join("")}
            </select>
            <label class="schaden-kuemmerer-check" title="Frau Schellenberg (Schelly) vs. WG intern">
              <input type="checkbox" class="schaden-vermieter-cb" data-id="${s.id}" ${kuemmerer === "vermieter" ? "checked" : ""} ${status === "erledigt" ? "disabled" : ""} />
              Schelly
            </label>
            ${s.zustaendig && status !== "erledigt"
              ? reminderCadenceRowHtml({
                  id: s.id,
                  type: "schaden",
                  checked: schadenReminderOn,
                  everyDays: s.reminderEveryDays,
                  fallback: 7,
                  cbDisabled: false,
                  selectDisabled: !schadenReminderOn,
                })
              : ""}
          </div>
          <button class="mini-btn danger" data-id="${s.id}" data-action="delete">Löschen</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-action='status']").forEach(sel => {
    sel.addEventListener("change", () => setSchadenField(sel.dataset.id, "status", sel.value));
  });
  list.querySelectorAll("[data-action='zustaendig']").forEach(sel => {
    sel.addEventListener("change", () => setSchadenField(sel.dataset.id, "zustaendig", sel.value));
  });
  list.querySelectorAll(".schaden-vermieter-cb").forEach((cb) => {
    cb.addEventListener("change", () =>
      setSchadenKuemmerer(cb.dataset.id, cb.checked ? "vermieter" : "wg")
    );
  });
  bindReminderCadenceControls(list);
  list.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => {
      const s = schaedenCache.find(x => x.id === btn.dataset.id);
      if (!s) return;
      if (confirm(`Schaden "${s.titel}" wirklich löschen?`)) deleteSchaden(btn.dataset.id);
    });
  });

  list.querySelectorAll(".schaden-foto img").forEach((img) => {
    img.addEventListener("click", () => {
      openLightbox({ src: img.src, caption: img.alt || "" });
    });
  });
  renderGustavHub();
}

async function setSchadenField(id, field, value) {
  if (!requireAuth("Schaden aktualisieren")) return;
  const item = schaedenCache.find((s) => s.id === id);
  if (!item) return;
  const prev = item[field] ?? "";
  if (prev === value) return;
  const historyAction =
    field === "status" ? "status" : field === "kuemmerer" ? "kuemmerer" : "zustaendig";
  const history = appendSchadenHistory(
    item,
    schadenHistoryEntry(historyAction, {
      field,
      prev,
      next: value,
    })
  );
  const updates = { [field]: value, history };
  if (field === "zustaendig") {
    updates.reminder = !!value;
    if (value && item.reminderEveryDays == null) {
      updates.reminderEveryDays = 7;
    }
    if (!value) updates.lastReminderAt = null;
  }
  if (field === "status" && value === "erledigt") {
    updates.erledigtAt = new Date().toISOString();
    updates.reminder = false;
  }
  if (firebaseReady) {
    try {
      await updateDoc(doc(db, "schaeden", id), updates);
    } catch (e) {
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    Object.assign(item, updates);
    schaedenCache = localStore.schaeden;
    saveLocal("schaeden", localStore.schaeden);
    renderSchaeden();
  }
}

async function setSchadenKuemmerer(id, kuemmerer) {
  if (!requireAuth("Zuständigkeit speichern")) return;
  const item = schaedenCache.find((s) => s.id === id);
  if (!item || item.status === "erledigt") return;
  const next = normalizeSchadenKuemmerer(kuemmerer);
  const prev = normalizeSchadenKuemmerer(item.kuemmerer);
  if (prev === next) return;
  const history = appendSchadenHistory(
    item,
    schadenHistoryEntry("kuemmerer", { prev, next })
  );
  const updates = { kuemmerer: next, history };
  if (firebaseReady) {
    try {
      await updateDoc(doc(db, "schaeden", id), updates);
    } catch (e) {
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    Object.assign(item, updates);
    schaedenCache = localStore.schaeden;
    saveLocal("schaeden", localStore.schaeden);
    renderSchaeden();
  }
}

async function deleteSchaden(id) {
  if (!requireAuth("Schaden löschen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "schaeden", id)); showToast("Entfernt.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.schaeden = localStore.schaeden.filter(s => s.id !== id);
    schaedenCache = localStore.schaeden;
    saveLocal("schaeden", localStore.schaeden);
    renderSchaeden();
  }
}

$("schadenForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Schaden melden")) return;
  const entry = {
    titel: $("schadTitel").value.trim(),
    ort: $("schadOrt").value.trim(),
    beschreibung: $("schadBeschreibung").value.trim(),
    prio: $("schadPrio").value || "medium",
    zustaendig: $("schadZustaendig").value || "",
    kuemmerer: $("schadVermieter")?.checked ? "vermieter" : "wg",
    reminder: !!$("schadZustaendig").value && $("schadReminder")?.checked !== false,
    reminderEveryDays: normalizeReminderEveryDays($("schadReminderEvery")?.value, 7),
    status: "offen",
    addedBy: auth.member,
    createdAt: Date.now(),
    history: [
      schadenHistoryEntry("created", {
        titel: $("schadTitel").value.trim(),
        ort: $("schadOrt").value.trim(),
        prio: $("schadPrio").value || "medium",
        status: "offen",
        zustaendig: $("schadZustaendig").value || "",
        kuemmerer: $("schadVermieter")?.checked ? "vermieter" : "wg",
      }),
    ],
  };

  const fotoInput = $("schadFoto");
  const fotoFile = fotoInput?.files?.[0];
  if (fotoFile) {
    try {
      entry.image = await resizeImage(fotoFile, 1200);
    } catch (err) {
      console.warn("Foto-Resize fehlgeschlagen:", err);
      showToast("Foto konnte nicht verarbeitet werden.", "warning");
    }
  }

  if (firebaseReady) {
    try { await addDoc(collection(db, "schaeden"), { ...entry, createdAt: serverTimestamp() }); }
    catch (err) { showToast("Speichern fehlgeschlagen.", "error"); return; }
  } else {
    entry.id = "local_" + Date.now();
    localStore.schaeden.push(entry);
    schaedenCache = localStore.schaeden;
    saveLocal("schaeden", localStore.schaeden);
    renderSchaeden();
  }
  e.target.reset();
  showToast("Schaden gespeichert.", "success");
});

/* ==========================================================================
   Nachrichten · öffentliches Kontaktformular, WG-interne Inbox
   ========================================================================== */

let nachrichtenCache = [];

function updateNachrichtenBadge() {
  const badge = $("nachrichtenBadge");
  if (!badge) return;
  const unread = nachrichtenCache.filter(n => !n.read).length;
  if (unread > 0) {
    badge.textContent = unread;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderNachrichten() {
  const list = $("nachrichtenList");
  if (!list) return;
  updateNachrichtenBadge();

  if (!nachrichtenCache.length) {
    list.innerHTML = `<div class="empty-state">Noch keine Nachrichten. 📭</div>`;
    return;
  }

  const sorted = [...nachrichtenCache].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  list.innerHTML = sorted.map(n => {
    const when = fmtDateTime(n.createdAt);
    const mail = n.email ? `<a href="mailto:${escapeHtml(n.email)}" class="nachricht-mail">${escapeHtml(n.email)}</a>` : "";
    const isBewerbung = n.type === "bewerbung";
    const extras = [];
    if (isBewerbung && n.alter) extras.push(`<span>🎂 ${escapeHtml(n.alter)} Jahre</span>`);
    if (isBewerbung && n.einzug) extras.push(`<span>📅 Einzug: ${escapeHtml(n.einzug)}</span>`);
    const mailSubject = isBewerbung ? "Re: Deine Bewerbung fürs Haus am See" : "Re: Haus am See";
    return `
      <article class="nachricht-card ${n.read ? 'is-read' : 'is-unread'} ${isBewerbung ? 'is-bewerbung' : ''}">
        <div class="nachricht-head">
          <div class="nachricht-from">
            <strong>${escapeHtml(n.name || "Unbekannt")}</strong>
            ${mail}
          </div>
          <div class="nachricht-head-right">
            ${isBewerbung ? `<span class="nachricht-badge">🚪 Bewerbung</span>` : ""}
            <span class="nachricht-time">${when}</span>
          </div>
        </div>
        ${extras.length ? `<div class="nachricht-extras">${extras.join("")}</div>` : ""}
        <p class="nachricht-body">${escapeHtml(n.message || "")}</p>
        <div class="nachricht-actions">
          <button class="mini-btn" data-id="${n.id}" data-action="toggle-read">
            ${n.read ? "Als ungelesen markieren" : "Als gelesen markieren"}
          </button>
          ${n.email ? `<a class="mini-btn" href="mailto:${escapeHtml(n.email)}?subject=${encodeURIComponent(mailSubject)}">↩️ Antworten</a>` : ""}
          ${isBewerbung ? `<button class="mini-btn" data-id="${n.id}" data-action="add-kandidat">🚪 Zu Kandidat:innen</button>` : ""}
          <button class="mini-btn danger" data-id="${n.id}" data-action="delete">Löschen</button>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll("[data-action='toggle-read']").forEach(btn => {
    btn.addEventListener("click", () => toggleNachrichtRead(btn.dataset.id));
  });
  list.querySelectorAll("[data-action='delete']").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Nachricht wirklich löschen?")) deleteNachricht(btn.dataset.id);
    });
  });
  list.querySelectorAll("[data-action='add-kandidat']").forEach(btn => {
    btn.addEventListener("click", () => addNachrichtToKandidaten(btn.dataset.id));
  });
}

async function toggleNachrichtRead(id) {
  if (!requireMember("Nachrichten verwalten")) return;
  const n = nachrichtenCache.find(x => x.id === id);
  if (!n) return;
  const read = !n.read;
  if (firebaseReady) {
    try { await updateDoc(doc(db, "nachrichten", id), { read, readAt: read ? Date.now() : null }); }
    catch (e) { showToast("Speichern fehlgeschlagen.", "error"); }
  } else {
    n.read = read;
    n.readAt = read ? Date.now() : null;
    nachrichtenCache = [...localStore.nachrichten];
    saveLocal("nachrichten", localStore.nachrichten);
    renderNachrichten();
  }
}

async function deleteNachricht(id) {
  if (!requireMember("Nachrichten löschen")) return;
  if (firebaseReady) {
    try { await deleteDoc(doc(db, "nachrichten", id)); showToast("Entfernt.", "success"); }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.nachrichten = localStore.nachrichten.filter(n => n.id !== id);
    nachrichtenCache = localStore.nachrichten;
    saveLocal("nachrichten", localStore.nachrichten);
    renderNachrichten();
  }
}

async function addNachrichtToKandidaten(id) {
  if (!requireMember("Kandidat:innen verwalten")) return;
  const n = nachrichtenCache.find(x => x.id === id);
  if (!n || n.type !== "bewerbung") {
    showToast("Keine Bewerbung gefunden.", "error");
    return;
  }
  
  const kandidatData = {
    name: n.name || "Unbekannt",
    alter: n.alter || null,
    info: n.message || "",
    kontakt: n.email || "",
    einzug: n.einzug || null,
    status: "offen",
    source: "kontaktformular",
    createdAt: Date.now(),
  };
  
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "kandidaten"), { ...kandidatData, createdAt: serverTimestamp() });
      showToast(`🚪 ${n.name} zu Kandidat:innen hinzugefügt!`, "success");
    } catch (e) {
      console.error(e);
      showToast("Hinzufügen fehlgeschlagen.", "error");
    }
  } else {
    kandidatData.id = "local_" + Date.now();
    if (!localStore.kandidaten) localStore.kandidaten = [];
    localStore.kandidaten.push(kandidatData);
    kandidatenCache = localStore.kandidaten;
    saveLocal("kandidaten", localStore.kandidaten);
    renderKandidaten();
    showToast(`🚪 ${n.name} zu Kandidat:innen hinzugefügt!`, "success");
  }
}

$("kontaktForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("kontaktName").value.trim();
  const email = $("kontaktEmail").value.trim();
  const message = $("kontaktMessage").value.trim();
  if (!name || !message) return;
  const isBewerbung = !!$("kontaktIsBewerbung")?.checked && !!roomOfferCache?.active;
  const alter = $("kontaktAlter")?.value.trim() || "";
  const einzug = $("kontaktEinzug")?.value.trim() || "";
  const entry = {
    name,
    email,
    message,
    type: isBewerbung ? "bewerbung" : "nachricht",
    ...(isBewerbung ? { alter, einzug } : {}),
    read: false,
    createdAt: Date.now(),
  };
  const submitBtn = e.target.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "nachrichten"), { ...entry, createdAt: serverTimestamp() });
    } catch (err) {
      console.error("kontaktForm submit:", err);
      const code = err?.code || "";
      const msg = code === "permission-denied"
        ? "Keine Berechtigung – Firestore-Rules für 'nachrichten' sind noch nicht deployt. Bitte in der Firebase-Konsole die Rules aus firestore.rules veröffentlichen."
        : `Senden fehlgeschlagen (${code || err?.message || "unbekannt"}).`;
      showToast(msg, "error");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
  } else {
    entry.id = "local_" + Date.now();
    localStore.nachrichten.push(entry);
    nachrichtenCache = localStore.nachrichten;
    saveLocal("nachrichten", localStore.nachrichten);
    renderNachrichten();
  }
  e.target.reset();
  if (submitBtn) submitBtn.disabled = false;
  syncBewerbungToggleVisibility();
  showToast(isBewerbung ? "Danke! Bewerbung ist raus. 🚪" : "Danke! Nachricht ist raus. 💌", "success");
});

/* ==========================================================================
   Zimmer frei · Hero-Kachel + WG-Admin + Bewerbung via Kontaktformular
   ========================================================================== */

let roomOfferCache = null;
let zimmerfotosCache = [];
let roomPhotosMigrating = false;

function dataUrlByteSize(dataUrl) {
  return Math.ceil((String(dataUrl || "").length * 3) / 4);
}

/** Zimmerfotos: eigene Docs (nicht im config/roomOffer – sonst 1-MB-Limit). */
function getRoomPhotosList() {
  if (zimmerfotosCache.length) {
    return zimmerfotosCache
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? a.createdAt ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? b.createdAt ?? 0;
        return ta - tb;
      })
      .map((p) => ({ id: p.id, src: p.src }));
  }
  const legacy = roomOfferCache?.photos;
  if (Array.isArray(legacy) && legacy.length) {
    return legacy
      .filter((src) => typeof src === "string" && src)
      .map((src, i) => ({ id: `legacy_${i}`, src, legacy: true }));
  }
  return [];
}

async function migrateLegacyRoomPhotosIfNeeded() {
  if (!firebaseReady || roomPhotosMigrating) return;
  const legacy = roomOfferCache?.photos;
  if (!Array.isArray(legacy) || !legacy.length) return;
  if (zimmerfotosCache.length) {
    // Schon neue Fotos da – alte Inline-Felder entfernen, damit roomOffer wieder klein wird
    try {
      await updateDoc(doc(db, "config", "roomOffer"), { photos: deleteField() });
    } catch (e) {
      console.warn("roomOffer photos clear", e);
    }
    return;
  }
  const dataUrls = legacy.filter((p) => typeof p === "string" && p.startsWith("data:"));
  if (!dataUrls.length) return;
  roomPhotosMigrating = true;
  try {
    for (const src of dataUrls) {
      const size = dataUrlByteSize(src);
      if (size > MAX_IMAGE_BYTES) {
        console.warn("Legacy-Zimmerfoto zu gross, übersprungen", Math.round(size / 1024), "KB");
        continue;
      }
      await addDoc(collection(db, "zimmerfotos"), {
        src,
        createdAt: serverTimestamp(),
        migrated: true,
        addedBy: auth.member || "migrate",
      });
    }
    await updateDoc(doc(db, "config", "roomOffer"), { photos: deleteField() });
    showToast("Alte Zimmerfotos wurden migriert.", "success");
  } catch (e) {
    console.error("Zimmerfoto-Migration", e);
  } finally {
    roomPhotosMigrating = false;
  }
}

function getRoomShareUrl() {
  let p = window.location.pathname || "/";
  if (/\/index\.html$/i.test(p)) p = p.slice(0, -10) || "/";
  if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
  return `${window.location.origin}${p}#zimmer`;
}

function buildRoomShareTitle(ro) {
  return `${(ro.title || "Zimmer frei").trim()} · Haus am See`;
}

function buildRoomShareText(ro) {
  const url = getRoomShareUrl();
  const titleLine = `🚪 ${(ro.title || "Zimmer frei – Haus am See").trim()}`;
  const factBits = [];
  if (ro.miete) factBits.push(`💰 ${ro.miete}`);
  if (ro.groesse) factBits.push(`📐 ${ro.groesse}`);
  if (ro.freiAb) factBits.push(`📅 Frei ab ${ro.freiAb}`);
  const factLine = factBits.join(" · ");
  const desc = (ro.description || "").trim();
  const shortDesc = desc.length > 380 ? `${desc.slice(0, 377)}…` : desc;
  const lines = [titleLine, factLine, "", shortDesc, "", url].filter((line, i, arr) => {
    if (line === "" && arr[i - 1] === "") return false;
    return true;
  });
  return lines.join("\n");
}

function setOrCreateMeta(attr, key, content) {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function syncRoomOfferPageMeta(ro) {
  const title = buildRoomShareTitle(ro);
  const bits = [];
  if (ro.miete) bits.push(ro.miete);
  if (ro.groesse) bits.push(ro.groesse);
  if (ro.freiAb) bits.push(`ab ${ro.freiAb}`);
  const head = bits.join(" · ");
  const body = (ro.description || "").trim().slice(0, 180);
  const desc = [head, body].filter(Boolean).join(" – ") || "Zimmer frei in unserer WG in Pfäffikon ZH.";
  document.title = `${(ro.title || "Zimmer frei").trim()} · Haus am See`;
  setOrCreateMeta("name", "description", desc);
  setOrCreateMeta("property", "og:title", title);
  setOrCreateMeta("property", "og:description", desc);
  setOrCreateMeta("name", "twitter:title", title);
  setOrCreateMeta("name", "twitter:description", desc);
}

const DEFAULT_PAGE_TITLE = "Haus am See · Pilatusstrasse 40, Pfäffikon ZH";
const DEFAULT_META_DESC =
  "Unsere WG an der Pilatusstrasse in Pfäffikon ZH. Events, WG-Termine, Kalender und Eindrücke aus dem Haus am See.";

function resetRoomOfferPageMeta() {
  document.title = DEFAULT_PAGE_TITLE; // sync with index.html <title>
  setOrCreateMeta("name", "description", DEFAULT_META_DESC);
  setOrCreateMeta("property", "og:title", "Haus am See · WG Pilatusstrasse 40, Pfäffikon ZH");
  setOrCreateMeta("property", "og:description", "Unsere WG am Pfäffikersee – Events, Kalender, Gemeinschaft.");
  setOrCreateMeta("name", "twitter:title", "Haus am See · WG Pfäffikon");
  setOrCreateMeta("name", "twitter:description", "Unsere WG am Pfäffikersee – Events, Kalender, Gemeinschaft.");
}

/** Meta-Tags / Titel für Inserat – ohne sichtbare „Social-Kachel“. */
function syncRoomOfferShareBackground(ro) {
  if (ro?.active) syncRoomOfferPageMeta(ro);
}

function setupRoomShareUI() {
  const shareBtn = $("roomShareBtn");
  if (!shareBtn || shareBtn.dataset.roomShareBound) return;
  shareBtn.dataset.roomShareBound = "1";
  shareBtn.addEventListener("click", async () => {
    const ro = roomOfferCache;
    if (!ro?.active) {
      showToast("Zimmer-Inserat ist nicht aktiv.", "error");
      return;
    }
    const url = getRoomShareUrl();
    const text = buildRoomShareText(ro);
    const title = buildRoomShareTitle(ro);
    await shareOrCopy({ title, text, url });
  });
}

function renderRoomOffer() {
  const section = $("zimmer");
  if (!section) return;
  const ro = roomOfferCache || {};
  const active = !!ro.active;

  section.classList.toggle("hidden", !active);
  if (!active) {
    resetRoomOfferPageMeta();
    populateRoomForm();
    renderRoomAdminPhotos();
    return;
  }

  $("roomOfferTitle").textContent = ro.title?.trim() || "Wir suchen eine:n neue:n Mitbewohner:in";
  const desc = ro.description?.trim() || "Melde dich einfach über das Kontaktformular – wir freuen uns von dir zu hören.";
  $("roomOfferDesc").textContent = desc;

  const facts = [];
  if (ro.miete) facts.push({ icon: "💰", label: "Miete", value: ro.miete });
  if (ro.groesse) facts.push({ icon: "📐", label: "Grösse", value: ro.groesse });
  if (ro.freiAb) facts.push({ icon: "📅", label: "Frei ab", value: ro.freiAb });
  $("roomOfferFacts").innerHTML = facts
    .map(f => `<li><span>${f.icon}</span><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}</li>`)
    .join("");

  const photos = getRoomPhotosList();
  const photoEl = $("roomOfferPhotos");
  if (!photos.length) {
    photoEl.innerHTML = `<div class="room-offer-photo-placeholder">📸 Noch keine Fotos hinzugefügt</div>`;
  } else {
    photoEl.innerHTML = photos.map((p, i) => `
      <div class="room-offer-photo" data-id="${escapeHtml(p.id)}" data-idx="${i}"><img src="${escapeHtml(p.src)}" alt="Zimmer-Foto ${i + 1}" loading="lazy" /></div>
    `).join("");
    photoEl.querySelectorAll(".room-offer-photo").forEach(el => {
      el.addEventListener("click", () => {
        const idx = Number(el.dataset.idx);
        openLightbox({ src: photos[idx]?.src, caption: "Zimmer-Foto" });
      });
    });
  }

  syncRoomOfferShareBackground(ro);
  renderRoomAdminPhotos();
  populateRoomForm();
  void migrateLegacyRoomPhotosIfNeeded();
}

function populateRoomForm() {
  const ro = roomOfferCache || {};
  if ($("roomActive")) $("roomActive").checked = !!ro.active;
  if ($("roomTitle")) $("roomTitle").value = ro.title || "";
  if ($("roomDesc")) $("roomDesc").value = ro.description || "";
  if ($("roomMiete")) $("roomMiete").value = ro.miete || "";
  if ($("roomGroesse")) $("roomGroesse").value = ro.groesse || "";
  if ($("roomFreiAb")) $("roomFreiAb").value = ro.freiAb || "";
}

function renderRoomAdminPhotos() {
  const wrap = $("roomAdminPhotos");
  if (!wrap) return;
  const photos = getRoomPhotosList();
  if (!photos.length) {
    wrap.innerHTML = `<p class="form-note">Noch keine Fotos hochgeladen – so viele wie du willst.</p>`;
    return;
  }
  wrap.innerHTML = `
    <p class="form-note">${photos.length} Foto${photos.length === 1 ? "" : "s"}</p>
    ${photos.map((p, i) => `
    <div class="room-admin-photo">
      <img src="${escapeHtml(p.src)}" alt="Zimmer-Foto ${i + 1}" loading="lazy" />
      <button type="button" class="mini-btn danger" data-id="${escapeHtml(p.id)}" data-legacy="${p.legacy ? "1" : "0"}" data-idx="${i}" data-action="remove-room-photo">Entfernen</button>
    </div>
  `).join("")}`;
  wrap.querySelectorAll("[data-action='remove-room-photo']").forEach(btn => {
    btn.addEventListener("click", () => removeRoomPhoto(btn.dataset.id, Number(btn.dataset.idx), btn.dataset.legacy === "1"));
  });
}

async function saveRoomOffer(partial) {
  const current = roomOfferCache || {};
  const next = { ...current, ...partial, updatedAt: Date.now(), updatedBy: auth.member || "" };
  if (firebaseReady) {
    try { await setDoc(doc(db, "config", "roomOffer"), next, { merge: true }); }
    catch (e) { console.error(e); showToast("Speichern fehlgeschlagen.", "error"); return false; }
  } else {
    localStore.roomOffer = next;
    roomOfferCache = next;
    saveLocal("roomOffer", next);
    renderRoomOffer();
  }
  return true;
}

async function removeRoomPhoto(id, idx, isLegacy) {
  if (!requireMember("Fotos verwalten")) return;
  try {
    if (isLegacy || String(id).startsWith("legacy_")) {
      const photos = [...(roomOfferCache?.photos || [])];
      if (idx < 0 || idx >= photos.length) return;
      photos.splice(idx, 1);
      if (await saveRoomOffer({ photos })) showToast("Foto entfernt.", "success");
      return;
    }
    if (firebaseReady) {
      await deleteDoc(doc(db, "zimmerfotos", id));
      showToast("Foto entfernt.", "success");
    } else {
      showToast("Nur mit Firebase-Verbindung möglich.", "error");
    }
  } catch (e) {
    console.error(e);
    showToast("Entfernen fehlgeschlagen.", "error");
  }
}

$("roomForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Zimmer-Angebot speichern")) return;
  const payload = {
    active: $("roomActive").checked,
    title: $("roomTitle").value.trim(),
    description: $("roomDesc").value.trim(),
    miete: $("roomMiete").value.trim(),
    groesse: $("roomGroesse").value.trim(),
    freiAb: $("roomFreiAb").value.trim(),
  };
  if (await saveRoomOffer(payload)) showToast("Gespeichert. ✨", "success");
});

$("roomPhotos")?.addEventListener("change", async (e) => {
  if (!requireMember("Fotos hochladen")) return;
  const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;
  if (!firebaseReady) {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
    e.target.value = "";
    return;
  }

  const progress = document.createElement("div");
  progress.className = "upload-progress";
  progress.innerHTML = `<span class="spinner"></span><span>Lade 0 / ${files.length} …</span>`;
  document.body.appendChild(progress);

  let success = 0;
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progress.querySelector("span:last-child").textContent = `Lade ${i + 1} / ${files.length} …`;
      const dataUrl = await resizeImage(file, 1100, 0.72);
      const sizeBytes = dataUrlByteSize(dataUrl);
      if (sizeBytes > MAX_IMAGE_BYTES) {
        showToast(`„${file.name}" zu gross (${Math.round(sizeBytes / 1024)} KB).`, "error");
        continue;
      }
      await addDoc(collection(db, "zimmerfotos"), {
        src: dataUrl,
        createdAt: serverTimestamp(),
        addedBy: auth.member || "",
        fileName: String(file.name || "").slice(0, 120),
      });
      success += 1;
    }
    if (success) {
      showToast(`${success} Foto${success > 1 ? "s" : ""} hinzugefügt.`, "success");
    } else {
      showToast("Kein Foto konnte gespeichert werden.", "error");
    }
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || err || "");
    if (/exceeds|too large|invalid-argument|ResourceExhausted/i.test(msg)) {
      showToast("Foto zu gross für die Datenbank – bitte kleineres Bild wählen.", "error");
    } else {
      showToast("Upload fehlgeschlagen.", "error");
    }
  } finally {
    progress.remove();
    e.target.value = "";
  }
});

/* --- Bewerbungs-Modus im Kontaktformular --- */

function syncBewerbungToggleVisibility() {
  const toggle = $("bewerbungToggle");
  const cb = $("kontaktIsBewerbung");
  const active = !!roomOfferCache?.active;
  if (toggle) toggle.hidden = !active;
  if (!active && cb) cb.checked = false;
  updateBewerbungVisibility();
}

function updateBewerbungVisibility() {
  const cb = $("kontaktIsBewerbung");
  const bewerbungFields = document.querySelectorAll(".bewerbung-only");
  const heading = $("kontaktHeading");
  const intro = $("kontaktIntro");
  const message = $("kontaktMessage");
  const isBewerbung = !!(cb && cb.checked);

  bewerbungFields.forEach(el => el.classList.toggle("hidden", !isBewerbung));

  if (heading) heading.textContent = isBewerbung ? "🚪 Bewerbung fürs Zimmer" : "✉️ Schreib uns";
  if (intro) intro.textContent = isBewerbung
    ? "Erzähl uns kurz von dir – wer du bist, was du machst, wie du wohnst. Wir melden uns zurück."
    : "Fragen zu Events, Ideen oder einfach mal Hallo sagen? Wir lesen alles – versprochen.";
  if (message) {
    message.placeholder = isBewerbung
      ? "Ein paar Zeilen zu dir, deinem Alltag, Hobbys, was dir in einer WG wichtig ist…"
      : "Was möchtest du uns mitteilen?";
  }
}

$("kontaktIsBewerbung")?.addEventListener("change", updateBewerbungVisibility);

$("roomApplyBtn")?.addEventListener("click", () => {
  const cb = $("kontaktIsBewerbung");
  if (cb) cb.checked = true;
  updateBewerbungVisibility();
  document.getElementById("kontakt")?.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("kontaktName")?.focus(), 500);
});

/* ==========================================================================
   Einstellungen · Profil, Passwort, Einladung, Gäste
   ========================================================================== */

$("memberProfileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Profil speichern")) return;
  const displayName = $("profileDisplayName")?.value.replace(/\s+/g, " ").trim().slice(0, 32) || "";
  const emoji = $("profileEmoji")?.value || "";
  const phone = $("profilePhone")?.value.replace(/[^\d+]/g, "").trim() || "";
  if (!displayName) { showToast("Bitte einen Anzeigenamen eintragen.", "error"); return; }
  if (!EMOJI_CHOICES_SET.has(emoji)) { showToast("Bitte ein Icon aus der Liste wählen.", "error"); return; }
  
  const profileData = { ...(authConfig.memberPrefs[auth.member] || {}), displayName, emoji, updatedBy: auth.member };
  if (phone) profileData.phone = phone;
  else delete profileData.phone;
  const birthRaw = $("profileBirthDate")?.value.replace(/\s+/g, " ").trim() || "";
  if (birthRaw) profileData.birthDate = birthRaw.slice(0, 12);
  else delete profileData.birthDate;

  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "memberPrefs"), {
        [auth.member]: { ...profileData, updatedAt: serverTimestamp() }
      }, { merge: true });
      authConfig.memberPrefs[auth.member] = { ...profileData };
      showToast("Profil gespeichert.", "success");
      onMemberPrefsChanged();
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    const next = { ...localStore.memberPrefs, [auth.member]: profileData };
    localStore.memberPrefs = next;
    saveLocal("memberPrefs", next);
    applyMemberPrefsDoc(next);
    onMemberPrefsChanged();
    showToast("Profil lokal gespeichert.", "success");
  }
});

let einkaufslisteCache = [];
let hausWikiCache = null;

const HAUS_WIKI_DEFAULTS = {
  wlan: { title: "📶 WLAN", text: "WLAN-Name und Passwort stehen im WG-Intern-Bereich der Website (nach Login)." },
  muell: { title: "🗑️ Müll", text: "Mülltonnen beim Carport. Kehricht/Altpapier/Grüngut getrennt – Details am schwarzen Plan im Gang." },
  notfall: { title: "🚨 Notfall", text: "Notfall: 117 (Polizei), 118 (Feuer), 144 (Sanität). Vermieterin (Schelly) über die WG." },
  adresse: { title: "📍 Adresse", text: "Haus am See, Pilatusstrasse 40, 8330 Pfäffikon ZH." },
};

function gustavNamesMatch(who, resident) {
  if (!who || !resident) return false;
  const w = String(who).toLowerCase().trim();
  const r = String(resident).toLowerCase().trim();
  return w === r || w.startsWith(r) || r.startsWith(w) || w.includes(r) || r.includes(w);
}

function gustavTaskUrgency(rank) {
  if (rank <= 1) return "overdue";
  if (rank === 2) return "due-today";
  return "upcoming";
}

function buildGustavMyTasksPreview() {
  if (!auth.isMember || !auth.member) return [];
  const member = auth.member;
  const tasks = [];

  for (const item of giessplanCache) {
    if (!gustavNamesMatch(item.who, member)) continue;
    const st = getGiessStatus(item);
    if (st === "done-today") continue;
    const summary = formatGiessCardSummary(item);
    const rank = st === "overdue" ? 0 : st === "due-today" ? 1 : 3;
    tasks.push({ emoji: "🌱", label: item.plant, when: summary.when, rank, kind: "giess" });
  }

  for (const item of gartenTodoCache) {
    if (!gustavNamesMatch(item.who, member)) continue;
    const st = getGartenTodoStatus(item);
    if (st === "done-today" || st === "scheduled") continue;
    const next = formatGartenTodoNext(item);
    const rank = st === "overdue" ? 0 : st === "due-today" ? 1 : 3;
    tasks.push({ emoji: "🌿", label: item.task, when: next.text, rank, kind: "garten" });
  }

  for (const item of putzCache) {
    if (!gustavNamesMatch(item.who, member)) continue;
    const st = getAufgabenStatus(item);
    if (st === "done" || st === "done-today") continue;
    const summary = formatAufgabenCardSummary(item);
    const rank = st === "overdue" ? 0 : st === "due-today" ? 1 : 3;
    tasks.push({ emoji: "📋", label: item.task, when: summary.when, rank, kind: "aufgabe" });
  }

  for (const s of schaedenCache) {
    if (s.status === "erledigt") continue;
    if (!gustavNamesMatch(s.zustaendig, member)) continue;
    const prioRank = s.prio === "hoch" ? 0 : s.prio === "mittel" ? 2 : 4;
    tasks.push({
      emoji: "🔧",
      label: s.titel || "Schaden",
      when: SCHADEN_STATUS_LABEL[s.status] || s.status || "offen",
      rank: prioRank,
      kind: "schaden",
    });
  }

  return tasks.sort((a, b) => a.rank - b.rank).slice(0, 6);
}

function renderGustavHub() {
  const el = $("gustavHubPanel");
  if (!el) return;
  if (!auth.isMember) {
    el.innerHTML = "";
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");

  const tasks = buildGustavMyTasksPreview();
  const tasksHtml = tasks.length
    ? `<ul class="gustav-hub-tasks">${tasks.map((t) =>
        `<li class="gustav-hub-task is-${gustavTaskUrgency(t.rank)}"><span class="gustav-hub-task-emoji">${t.emoji}</span><span><strong>${escapeHtml(t.label)}</strong><span class="form-note"> · ${escapeHtml(t.when)}</span></span></li>`
      ).join("")}</ul>`
    : `<p class="form-note">Keine offenen Aufgaben für dich 🎉 – Gustav: <em>Meine Aufgaben?</em></p>`;

  const openEinkauf = einkaufslisteCache.filter((x) => !x.done).slice(0, 5);
  const einkaufHtml = openEinkauf.length
    ? `<ul class="gustav-hub-einkauf">${openEinkauf.map((x) =>
        `<li>${escapeHtml(x.item)}</li>`
      ).join("")}</ul>`
    : `<p class="form-note small">Einkaufsliste leer ✅</p>`;

  const dt = authConfig.memberPrefs[auth.member]?.deinTag || {};
  const morgenOn = dt.enabled ? `an (${dt.cadence || "daily"})` : "aus";

  el.innerHTML = `
    <div class="gustav-hub-grid">
      <section class="gustav-hub-card">
        <h3>📋 Meine Aufgaben</h3>
        ${tasksHtml}
        <p class="form-note small">Vollständige Liste per WhatsApp: <em>Meine Aufgaben?</em> · mit Kalender-Link</p>
      </section>
      <section class="gustav-hub-card">
        <h3>🛒 Einkaufsliste</h3>
        ${einkaufHtml}
        <form class="gustav-hub-einkauf-form" id="gustavHubEinkaufForm">
          <input id="gustavHubEinkaufInput" placeholder="Auf die Liste…" maxlength="80" />
          <button type="submit" class="btn btn-ghost small">+</button>
        </form>
      </section>
      <section class="gustav-hub-card gustav-hub-card-wide">
        <h3>🤖 Gustav</h3>
        <p class="form-note small">📱 WhatsApp Morgen-Zusammenfassung: <strong>${escapeHtml(morgenOn)}</strong> · <a href="#wg-intern">Einstellungen</a></p>
        <details class="gustav-hub-cheats">
          <summary>WhatsApp-Befehle</summary>
          <ul class="gustav-hub-cmds">
            <li><em>Jacuzzi warm?</em> · <em>Wasserqualität?</em></li>
            <li><em>Kino frei?</em> · <em>Sauna frei?</em></li>
            <li><em>WLAN?</em> · <em>WLAN QR</em> · <em>Müll?</em></li>
            <li><em>Mitbringen Spieleabend: Salat</em></li>
            <li><em>Kino heute Avatar</em></li>
          </ul>
        </details>
      </section>
    </div>`;

  $("gustavHubEinkaufForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("gustavHubEinkaufInput");
    void addEinkaufslisteItem(input?.value, input);
  });
}

function syncWlanQrForm() {
  const ssidEl = $("wlanSsid");
  const passEl = $("wlanPassword");
  if (!ssidEl || !passEl) return;
  const data = hausWikiCache && typeof hausWikiCache === "object" ? hausWikiCache : {};
  ssidEl.value = data.wlanSsid || "Haus am See 2.0";
  passEl.value = data.wlanPassword || "";
}

async function saveWlanQrSettings(e) {
  e?.preventDefault();
  if (!requireMember("WLAN-QR-Einstellungen speichern")) return;
  const ssid = ($("wlanSsid")?.value || "Haus am See 2.0").trim() || "Haus am See 2.0";
  const password = ($("wlanPassword")?.value || "").trim();
  if (!password) {
    showToast("Bitte WLAN-Passwort eintragen.", "error");
    return;
  }
  const payload = { wlanSsid: ssid, wlanPassword: password, wlanSecurity: "WPA" };
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "hausWiki"), payload, { merge: true });
      showToast("WLAN für Gustav-QR gespeichert.", "success");
    } catch {
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    hausWikiCache = { ...(hausWikiCache || {}), ...payload };
    saveLocal("hausWiki", hausWikiCache);
    showToast("WLAN lokal gespeichert.", "success");
  }
}

function renderHausWiki() {
  const el = $("hausWikiList");
  if (!el) return;
  if (!auth.isMember) {
    el.innerHTML = "";
    return;
  }
  syncWlanQrForm();
  const wiki = { ...HAUS_WIKI_DEFAULTS };
  if (hausWikiCache && typeof hausWikiCache === "object") {
    for (const [key, val] of Object.entries(hausWikiCache)) {
      if (["wlanSsid", "wlanPassword", "wlanSecurity"].includes(key)) continue;
      if (typeof val === "string" && val.trim()) {
        wiki[key] = { ...(wiki[key] || { title: key }), text: val.trim() };
      }
    }
  }
  el.innerHTML = Object.entries(wiki)
    .map(([key, entry]) => {
      const title = entry.title || key;
      return `<article class="haus-wiki-item"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(entry.text)}</p></article>`;
    })
    .join("");
}

function einkaufItemMatches(stored, hint) {
  const a = String(stored || "").toLowerCase().trim();
  const b = String(hint || "").toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function addEinkaufslisteItem(raw, inputEl = null) {
  if (!requireAuth("Einkaufsliste")) return;
  const name = String(raw || "").trim().slice(0, 80);
  if (!name) return;
  const dup = einkaufslisteCache.find((x) => !x.done && einkaufItemMatches(x.item, name));
  if (dup) {
    showToast("Schon auf der Liste.", "info");
    return;
  }
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "einkaufsliste"), {
        item: name,
        addedBy: auth.member || "",
        done: false,
        createdAt: serverTimestamp(),
      });
      if (inputEl) inputEl.value = "";
      showToast("Auf die Liste.", "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    showToast("Nur mit Firebase-Verbindung möglich.", "error");
  }
}

async function markEinkaufslisteDone(id) {
  if (!requireAuth("Einkaufsliste")) return;
  if (firebaseReady) {
    try {
      await updateDoc(doc(db, "einkaufsliste", id), {
        done: true,
        doneBy: auth.member || "",
        doneAt: serverTimestamp(),
      });
      showToast("Erledigt.", "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  }
}

function renderEinkaufsliste() {
  const el = $("einkaufslisteList");
  const form = $("einkaufslisteForm");
  if (!el) return;
  if (!auth.isMember) {
    el.innerHTML = `<p class="form-note">Nur für WG-Mitglieder sichtbar.</p>`;
    if (form) form.classList.add("hidden");
    return;
  }
  if (form) form.classList.remove("hidden");
  const open = einkaufslisteCache.filter((x) => !x.done);
  if (!open.length) {
    el.innerHTML = `<p class="form-note">Liste leer ✅</p>`;
    renderGustavHub();
    return;
  }
  el.innerHTML = `<ul class="einkaufsliste-ul">${open.map((x) =>
    `<li class="einkaufsliste-li"><span><strong>${escapeHtml(x.item)}</strong>${x.addedBy ? ` <span class="form-note">(${escapeHtml(x.addedBy)})</span>` : ""}</span>
      <button type="button" class="mini-btn einkaufsliste-done" data-id="${escapeHtml(x.id)}" title="Erledigt">✅</button></li>`
  ).join("")}</ul>`;
  el.querySelectorAll(".einkaufsliste-done").forEach((btn) => {
    btn.addEventListener("click", () => void markEinkaufslisteDone(btn.dataset.id));
  });
  renderGustavHub();
}

$("einkaufslisteForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("einkaufslisteInput");
  void addEinkaufslisteItem(input?.value, input);
});

$("wlanQrForm")?.addEventListener("submit", (e) => { void saveWlanQrSettings(e); });

setupWhatsappSettings();

$("wgInviteShareNative")?.addEventListener("click", () => shareWgInviteFromSheet());
$("wgInviteWhatsApp")?.addEventListener("click", () => openWgInviteWhatsApp());
$("wgInviteCopy")?.addEventListener("click", () => copyWgInviteToClipboard());

$("adminSetWgPasswordToHausamsee")?.addEventListener("click", async () => {
  if (!requireMember("Gruppenpasswort setzen")) return;
  if (!confirm("Das gemeinsame Passwort in der Cloud wirklich auf «hausamsee» setzen? Alle ohne persönliches Passwort loggen so ein.")) return;
  if (firebaseReady) {
    try {
      const r = await authApiCall("setGroupDefault", { token: authSessionToken });
      showToast(r.ok ? "Gruppenpasswort ist jetzt «hausamsee» (in der Cloud)." : (r.reason === "auth" ? "Bitte neu anmelden." : "Speichern fehlgeschlagen."), r.ok ? "success" : "error");
    } catch (e) {
      console.error(e);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    authConfig.passwordHash = WG_PASSWORD_HASH;
    localStore.config = { ...localStore.config, passwordHash: WG_PASSWORD_HASH };
    saveLocal("config", localStore.config);
    showToast("Lokal: Gruppenpasswort auf «hausamsee».", "success");
  }
});

$("adminClearPersonalBtn")?.addEventListener("click", async () => {
  if (!requireMember("Passwort entfernen")) return;
  const name = ($("adminClearPersonalSelect")?.value || "").trim();
  if (!name || !ADULT_NAMES.has(name)) {
    showToast("Bitte eine Person auswählen.", "error");
    return;
  }
  if (!confirm(`Persönliches Passwort von ${name} wirklich entfernen? ${name} loggt mit dem Gruppenpasswort ein (und hausamsee, falls das gilt).`)) return;
  try {
    if (firebaseReady) {
      const r = await authApiCall("clearPersonal", { token: authSessionToken, target: name });
      if (!r.ok) {
        showToast(r.reason === "auth" ? "Bitte neu anmelden." : "Speichern fehlgeschlagen.", "error");
        return;
      }
      if (authConfig.memberHashes[name]) delete authConfig.memberHashes[name];
      onMemberPrefsChanged();
      showToast("Persönliches Passwort entfernt – Login mit Gruppenpasswort.", "success");
    } else {
      await clearMemberAppPrefsInCloud(name);
      onMemberPrefsChanged();
      showToast("Lokal: Passwort-Profil entfernt.", "success");
    }
  } catch (e) {
    console.error(e);
    showToast("Speichern fehlgeschlagen.", "error");
  }
});

$("changePasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Passwort ändern")) return;
  const current = $("currentPassword").value;
  const newPw = $("newPassword").value;
  const newPw2 = $("newPassword2").value;
  if (newPw !== newPw2) { showToast("Die neuen Passwörter stimmen nicht überein.", "error"); return; }
  if (newPw.length < 4) { showToast("Mindestens 4 Zeichen.", "error"); return; }
  if (firebaseReady) {
    try {
      const r = await authApiCall("changePassword", {
        member: auth.member, currentPassword: current, newPassword: newPw,
      });
      if (!r.ok) {
        showToast(r.reason === "wrong-current"
          ? (r.hasPersonal ? "Aktuelles (persönliches) Passwort ist falsch." : "Aktuelles Passwort ist falsch (gemeinsames Passwort).")
          : r.reason === "short" ? "Mindestens 4 Zeichen." : "Speichern fehlgeschlagen.", "error");
        return;
      }
      auth.refreshToken(r.token);
      auth.loginKind = "personal";
      authConfig.memberHashes[auth.member] = true;
      e.target.reset();
      showToast(`Passwort für ${auth.member} gespeichert. Nur du nutzt dieses Passwort zum Login. 🔑`, "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    const newHash = await sha256(normPasswordInput(newPw));
    authConfig.memberHashes[auth.member] = newHash;
    localStore.memberPasswords = { ...localStore.memberPasswords, [auth.member]: newHash };
    saveLocal("memberPasswords", localStore.memberPasswords);
    applyMemberPasswordsDoc(localStore.memberPasswords);
    e.target.reset();
    showToast("Passwort lokal gespeichert (Demo).", "success");
  }
});

/** Optionales gemeinsames Fallback (nur für Mitglieder ohne eigenes Passwort) – nur wer das aktuelle kennt */
$("changeSharedPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Gemeinsames Passwort ändern")) return;
  const current = $("sharedCurrentPassword").value;
  const newPw = $("sharedNewPassword").value;
  const newPw2 = $("sharedNewPassword2").value;
  if (newPw !== newPw2) { showToast("Die neuen Passwörter stimmen nicht überein.", "error"); return; }
  if (newPw.length < 4) { showToast("Mindestens 4 Zeichen.", "error"); return; }
  if (firebaseReady) {
    try {
      const r = await authApiCall("changeShared", { token: authSessionToken, currentPassword: current, newPassword: newPw });
      if (!r.ok) {
        showToast(r.reason === "wrong-current" ? "Aktuelles gemeinsames Passwort ist falsch."
          : r.reason === "taken" ? "Dieses Passwort ist schon als persönliches Passwort vergeben."
          : r.reason === "auth" ? "Bitte neu anmelden."
          : r.reason === "short" ? "Mindestens 4 Zeichen." : "Speichern fehlgeschlagen.", "error");
        return;
      }
      e.target.reset();
      showToast("Gemeinsames Fallback-Passwort aktualisiert. Nur Leute ohne eigenes Passwort brauchen das Neue.", "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    const newHash = await sha256(normPasswordInput(newPw));
    authConfig.passwordHash = newHash;
    localStore.config = { ...localStore.config, passwordHash: newHash };
    saveLocal("config", localStore.config);
    e.target.reset();
    showToast("Gemeinsames Passwort lokal aktualisiert.", "success");
  }
});

$("guestForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Gäste-Zugänge erstellen")) return;
  const name = $("guestName").value.trim();
  const pw = $("guestPassword").value;
  const expires = $("guestExpires").value;
  if (!name || pw.length < 4) return;
  const expiresAt = expires ? new Date(expires + "T23:59:59").getTime() : null;
  if (firebaseReady) {
    try {
      const r = await authApiCall("createGuest", { token: authSessionToken, name, password: pw, expiresAt });
      if (!r.ok) {
        showToast(r.reason === "taken" ? "Dieses Passwort ist schon vergeben (WG oder persönlich) – bitte ein anderes wählen."
          : r.reason === "auth" ? "Bitte neu anmelden."
          : "Speichern fehlgeschlagen.", "error");
        return;
      }
    } catch (err) { showToast("Speichern fehlgeschlagen.", "error"); return; }
  } else {
    const hash = await sha256(normPasswordInput(pw));
    const entry = { name, hash, expiresAt, createdBy: auth.member, createdAt: Date.now(), id: "local_" + Date.now() };
    localStore.guests.push(entry);
    guestsCache = localStore.guests;
    saveLocal("guests", localStore.guests);
    renderGuestsList();
  }
  e.target.reset();
  showToast(`Gast-Zugang für ${name} erstellt 🎟️`, "success");
});

function renderGuestsList() {
  // Login-Dropdown aktuell halten – bei jeder Gast-Änderung
  populateLoginMemberSelect();

  const list = $("guestsList");
  if (!list) return;
  if (!guestsCache.length) {
    list.innerHTML = `<div class="empty-state small">Noch keine Gäste-Zugänge.</div>`;
    return;
  }
  const now = Date.now();
  const sorted = [...guestsCache].sort((a, b) => (b.createdAt?.toMillis?.() || b.createdAt || 0) - (a.createdAt?.toMillis?.() || a.createdAt || 0));
  list.innerHTML = sorted.map(g => {
    const expired = g.expiresAt && g.expiresAt < now;
    const expiresLabel = g.expiresAt
      ? `bis ${new Date(g.expiresAt).toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" })}`
      : "unbegrenzt";
    return `
      <div class="guest-row ${expired ? 'expired' : ''}">
        <div class="guest-info">
          <strong>🎟️ ${escapeHtml(g.name)}</strong>
          <span class="guest-meta">Gültig ${expiresLabel}${expired ? ' · abgelaufen' : ''} · erstellt von ${escapeHtml(g.createdBy || '—')}</span>
        </div>
        <button class="mini-btn danger" data-id="${g.id}" data-action="delete-guest">Entfernen</button>
      </div>
    `;
  }).join("");
  list.querySelectorAll("[data-action='delete-guest']").forEach(btn => {
    btn.addEventListener("click", () => {
      const g = guestsCache.find(x => x.id === btn.dataset.id);
      if (!g) return;
      if (confirm(`Zugang für "${g.name}" entfernen?`)) deleteGuest(btn.dataset.id);
    });
  });
}

async function deleteGuest(id) {
  if (!requireMember("Gast-Zugang entfernen")) return;
  if (firebaseReady) {
    try {
      const r = await authApiCall("deleteGuest", { token: authSessionToken, id });
      showToast(r.ok ? "Gast-Zugang entfernt." : (r.reason === "auth" ? "Bitte neu anmelden." : "Löschen fehlgeschlagen."), r.ok ? "success" : "error");
    }
    catch (e) { showToast("Löschen fehlgeschlagen.", "error"); }
  } else {
    localStore.guests = localStore.guests.filter(g => g.id !== id);
    guestsCache = localStore.guests;
    saveLocal("guests", localStore.guests);
    renderGuestsList();
  }
}

/* ==========================================================================
   Firebase Listeners (Live)
   ========================================================================== */

/** Leichte Collections – beim Start sofort aus localStorage */
function hydrateCachesFromLocalStore() {
  eventsCache = localStore.events || [];
  putzCache = localStore.putzplan || [];
  termineCache = localStore.termine || [];
  anwesendCache = localStore.anwesenheit || {};
  kandidatenCache = localStore.kandidaten || [];
  hausfeaturesCache = localStore.hausfeatures || {};
  guestsCache = localStore.guests || [];
  anmeldungenCache = localStore.anmeldungen || [];
  nachrichtenCache = localStore.nachrichten || [];
  bewohnertexteCache = localStore.bewohnertexte || {};
  giessplanCache = localStore.giessplan || [];
  gartenTodoCache = localStore.gartentodos || [];
  einkaufslisteCache = localStore.einkaufsliste || [];
  eventBringCache = localStore.eventBring || [];
  wellnessBookingsCache = localStore.wellnessBookings || [];
  jacuzziReadingsCache = localStore.jacuzziReadings || [];
}

/** Sichtbare Medien – einmal parsen, Above-the-fold */
function hydrateAboveFoldHeavyFromLocal() {
  galerieCache = getHeavyLocal("galerie", []);
  galerieFirestoreSynced = !firebaseReady || galerieCache.length > 0;
  hausbilderCache = getHeavyLocal("hausbilder", {});
  bewohnerfotosCache = getHeavyLocal("bewohnerfotos", {});
  jacuzziStatusCache = getHeavyLocal("jacuzziStatus", null);
}

/** Weitere Medien – erst wenn Browser idle ist */
function hydrateDeferredHeavyFromLocal() {
  gbCache = getHeavyLocal("gaestebuch", []);
  musikCache = [...getHeavyLocal("musik", [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  schaedenCache = getHeavyLocal("schaeden", []);
  eventfotosCache = getHeavyLocal("eventfotos", []);
  roomOfferCache = getHeavyLocal("roomOffer", null);
  gartenPlanCache = normalizeGartenPlan(getHeavyLocal("gartenPlan", null));
  hausWikiCache = getHeavyLocal("hausWiki", null);
}

/** Sichtbarer Seiteninhalt zuerst – Rest wenn Browser Luft hat */
function renderAboveFoldFromCaches() {
  renderEvents();
  renderBewohner();
  renderHausFeatures();
  renderGallery();
  renderAnwesend();
  renderTermine();
  renderJacuzziPanel();
  renderWellnessBelegung();
}

function renderDeferredFromCaches() {
  renderAufgaben();
  renderGiessplan();
  renderGartenTodos();
  populateGiessWhoSelect();
  populateGartenTodoWhoSelect();
  renderGaestebuch();
  renderPlaylist();
  renderKandidaten();
  renderSchaeden();
  renderGuestsList();
  renderNachrichten();
  renderRoomOffer();
  renderEinkaufsliste();
  renderHausWiki();
  syncBewerbungToggleVisibility();
}

let deferredRenderScheduled = false;

function scheduleDeferredRenders() {
  if (deferredRenderScheduled) return;
  deferredRenderScheduled = true;
  const run = () => {
    deferredRenderScheduled = false;
    hydrateDeferredHeavyFromLocal();
    renderDeferredFromCaches();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 1200 });
  } else {
    setTimeout(run, 16);
  }
}

function renderAllFromCaches() {
  hydrateCachesFromLocalStore();
  hydrateAboveFoldHeavyFromLocal();
  hydrateDeferredHeavyFromLocal();
  renderAboveFoldFromCaches();
  renderDeferredFromCaches();
}

let loadAuthConfigPromise = null;

async function loadAuthConfig() {
  if (loadAuthConfigPromise) return loadAuthConfigPromise;
  loadAuthConfigPromise = loadAuthConfigOnce();
  return loadAuthConfigPromise;
}

async function loadAuthConfigOnce() {
  if (firebaseReady) {
    try {
      // Passwort-Hashes sind nicht mehr öffentlich lesbar. Wir laden nur noch
      // config/authMeta (reine Namensliste, wer ein persönliches Passwort hat).
      const meta = await getDoc(doc(db, "config", "authMeta"));
      if (meta.exists()) applyAuthMetaDoc(meta.data());

      onSnapshot(doc(db, "config", "authMeta"), (d) => {
        applyAuthMetaDoc(d.exists() ? d.data() : { withPersonal: [] });
      }, (err) => console.warn("authMeta listener:", err.message));

      const mPrefSnap = await getDoc(doc(db, "config", "memberPrefs"));
      if (mPrefSnap.exists()) applyMemberPrefsDoc(mPrefSnap.data());
      let memberPrefsListenerPrimed = false;
      onSnapshot(doc(db, "config", "memberPrefs"), (d) => {
        applyMemberPrefsDoc(d.exists() ? d.data() : {});
        if (!memberPrefsListenerPrimed) { memberPrefsListenerPrimed = true; return; }
        onMemberPrefsChanged();
      }, (err) => console.warn("memberPrefs listener:", err.message));

      const moSnap = await getDoc(doc(db, "config", "movedOut"));
      if (moSnap.exists()) applyMovedOutDoc(moSnap.data());
      let movedOutListenerPrimed = false;
      onSnapshot(doc(db, "config", "movedOut"), (d) => {
        applyMovedOutDoc(d.exists() ? d.data() : { names: [] });
        if (!movedOutListenerPrimed) { movedOutListenerPrimed = true; return; }
        onMovedOutChanged();
      }, (err) => console.warn("movedOut listener:", err.message));
    } catch (e) {
      console.warn("Auth-Config konnte nicht geladen werden, nutze Default.", e.message);
    }
  } else {
    if (localStore.config?.passwordHash) authConfig.passwordHash = localStore.config.passwordHash;
    applyMemberPasswordsDoc(localStore.memberPasswords);
    applyMemberPrefsDoc(localStore.memberPrefs);
    applyMovedOutDoc({ names: localStore.movedOut || [] });
  }
  authConfig.ready = true;
}

function setupListeners() {
  if (!firebaseReady) {
    hydrateCachesFromLocalStore();
    renderAllFromCaches();
    return;
  }

  onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc")), (snap) => {
    eventsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("events", eventsCache);
    renderEvents();
  }, (err) => console.warn("events listener:", err.message));

  onSnapshot(collection(db, "anmeldungen"), (snap) => {
    anmeldungenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("anmeldungen", anmeldungenCache);
    renderEvents();
  }, (err) => console.warn("anmeldungen listener:", err.message));

  onSnapshot(query(collection(db, "putzplan"), orderBy("createdAt", "desc")), (snap) => {
    putzCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("putzplan", putzCache);
    renderAufgaben();
  }, (err) => console.warn("putzplan listener:", err.message));

  onSnapshot(query(collection(db, "giessplan"), orderBy("createdAt", "desc")), (snap) => {
    giessplanCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("giessplan", giessplanCache);
    renderGiessplan();
  }, (err) => console.warn("giessplan listener:", err.message));

  onSnapshot(query(collection(db, "gartentodos"), orderBy("createdAt", "desc")), (snap) => {
    gartenTodoCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("gartentodos", gartenTodoCache);
    renderGartenTodos();
  }, (err) => console.warn("gartentodos listener:", err.message));

  onSnapshot(query(collection(db, "einkaufsliste"), orderBy("createdAt", "desc")), (snap) => {
    einkaufslisteCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("einkaufsliste", einkaufslisteCache);
    renderEinkaufsliste();
  }, (err) => console.warn("einkaufsliste listener:", err.message));

  onSnapshot(query(collection(db, "eventBring"), orderBy("createdAt", "desc")), (snap) => {
    eventBringCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("eventBring", eventBringCache);
    renderEvents();
  }, (err) => console.warn("eventBring listener:", err.message));

  onSnapshot(doc(db, "config", "hausWiki"), (snap) => {
    hausWikiCache = snap.exists() ? snap.data() : null;
    persistFirestoreCache("hausWiki", hausWikiCache);
    renderHausWiki();
  }, (err) => console.warn("hausWiki listener:", err.message));

  onSnapshot(query(collection(db, "termine"), orderBy("createdAt", "desc")), (snap) => {
    termineCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("termine", termineCache);
    renderTermine();
  }, (err) => console.warn("termine listener:", err.message));

  onSnapshot(collection(db, "anwesenheit"), (snap) => {
    anwesendCache = {};
    snap.docs.forEach(d => { anwesendCache[d.id] = d.data(); });
    persistFirestoreCache("anwesenheit", anwesendCache);
    renderAnwesend();
  }, (err) => console.warn("anwesenheit listener:", err.message));

  onSnapshot(query(collection(db, "gaestebuch"), orderBy("createdAt", "desc")), (snap) => {
    gbCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("gaestebuch", gbCache);
    renderGaestebuch();
  }, (err) => console.warn("gaestebuch listener:", err.message));

  onSnapshot(query(collection(db, "galerie"), orderBy("createdAt", "desc")), (snap) => {
    galerieFirestoreSynced = true;
    galerieCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("galerie", galerieCache);
    renderGallery();
  }, (err) => console.warn("galerie listener:", err.message));

  onSnapshot(query(collection(db, "kandidaten"), orderBy("createdAt", "desc")), (snap) => {
    kandidatenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("kandidaten", kandidatenCache);
    renderKandidaten();
  }, (err) => console.warn("kandidaten listener:", err.message));

  onSnapshot(query(collection(db, "schaeden"), orderBy("createdAt", "desc")), (snap) => {
    schaedenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("schaeden", schaedenCache);
    renderSchaeden();
  }, (err) => console.warn("schaeden listener:", err.message));

  onSnapshot(query(collection(db, "musik"), orderBy("createdAt", "asc")), (snap) => {
    const prevId = musikCache[currentSongIdx]?.id;
    musikCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (prevId) {
      const newIdx = musikCache.findIndex(s => s.id === prevId);
      currentSongIdx = newIdx;
    }
    persistFirestoreCache("musik", musikCache);
    renderPlaylist();
  }, (err) => console.warn("musik listener:", err.message));

  onSnapshot(collection(db, "bewohnerfotos"), (snap) => {
    bewohnerfotosCache = {};
    snap.docs.forEach(d => { bewohnerfotosCache[d.id] = d.data(); });
    persistFirestoreCache("bewohnerfotos", bewohnerfotosCache);
    renderBewohner();
  }, (err) => console.warn("bewohnerfotos listener:", err.message));

  onSnapshot(collection(db, "hausbilder"), (snap) => {
    hausbilderCache = {};
    snap.docs.forEach(d => { hausbilderCache[d.id] = d.data(); });
    persistFirestoreCache("hausbilder", hausbilderCache);
    renderHausFeatures();
  }, (err) => console.warn("hausbilder listener:", err.message));

  onSnapshot(collection(db, "hausfeatures"), (snap) => {
    hausfeaturesCache = {};
    snap.docs.forEach(d => { hausfeaturesCache[d.id] = d.data(); });
    persistFirestoreCache("hausfeatures", hausfeaturesCache);
    renderHausFeatures();
  }, (err) => console.warn("hausfeatures listener:", err.message));

  onSnapshot(query(collection(db, "eventfotos"), orderBy("createdAt", "desc")), (snap) => {
    eventfotosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("eventfotos", eventfotosCache);
    renderEvents();
  }, (err) => console.warn("eventfotos listener:", err.message));

  onSnapshot(query(collection(db, "guests"), orderBy("createdAt", "desc")), (snap) => {
    guestsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("guests", guestsCache);
    renderGuestsList();
  }, (err) => console.warn("guests listener:", err.message));

  onSnapshot(query(collection(db, "nachrichten"), orderBy("createdAt", "desc")), (snap) => {
    nachrichtenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("nachrichten", nachrichtenCache);
    renderNachrichten();
  }, (err) => console.warn("nachrichten listener:", err.message));

  onSnapshot(doc(db, "config", "roomOffer"), (snap) => {
    roomOfferCache = snap.exists() ? snap.data() : null;
    renderRoomOffer();
    syncBewerbungToggleVisibility();
  }, (err) => console.warn("roomOffer listener:", err.message));

  onSnapshot(collection(db, "zimmerfotos"), (snap) => {
    zimmerfotosCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderRoomOffer();
  }, (err) => console.warn("zimmerfotos listener:", err.message));

  onSnapshot(doc(db, "config", "gartenPlan"), (snap) => {
    gartenPlanCache = normalizeGartenPlan(snap.exists() ? snap.data() : null);
    if (document.querySelector('[data-intern-tab="garten"].active')) renderGartenWeek();
  }, (err) => console.warn("gartenPlan listener:", err.message));

  onSnapshot(collection(db, "bewohnertexte"), (snap) => {
    bewohnertexteCache = {};
    snap.docs.forEach(d => { bewohnertexteCache[d.id] = d.data(); });
    persistFirestoreCache("bewohnertexte", bewohnertexteCache);
    renderBewohner();
  }, (err) => console.warn("bewohnertexte listener:", err.message));

  onSnapshot(doc(db, "config", "jacuzzi"), (snap) => {
    jacuzziStatusCache = snap.exists() ? snap.data() : null;
    persistFirestoreCache("jacuzziStatus", jacuzziStatusCache);
    renderJacuzziPanel();
  }, (err) => console.warn("jacuzzi status listener:", err.message));

  onSnapshot(query(collection(db, "jacuzziReadings"), orderBy("at", "desc"), limit(48)), (snap) => {
    jacuzziReadingsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("jacuzziReadings", jacuzziReadingsCache);
    renderJacuzziPanel();
  }, (err) => console.warn("jacuzziReadings listener:", err.message));

  onSnapshot(query(collection(db, "wellnessBookings"), orderBy("startAt", "asc")), (snap) => {
    wellnessBookingsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    persistFirestoreCache("wellnessBookings", wellnessBookingsCache);
    renderWellnessBelegung();
    renderJacuzziPanel();
  }, (err) => console.warn("wellnessBookings listener:", err.message));
}

/* ==========================================================================
   Scroll-Animation
   ========================================================================== */

function setupScrollAnim() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll(".section").forEach(s => {
    s.classList.add("fade-up");
    io.observe(s);
  });
}

/* ==========================================================================
   Init
   ========================================================================== */

populateProfileEmojiSelect();
populateLoginMemberSelect();
populateAufgabenWhoSelect();
setAufgabenFormDefaults();
populateSchadenZustaendigSelect();
$("schaedenExportBtn")?.addEventListener("click", () => downloadSchaedenExcel());
hydrateCachesFromLocalStore();
hydrateAboveFoldHeavyFromLocal();
renderAboveFoldFromCaches();
scheduleDeferredRenders();
setupListeners();
setupScrollAnim();
setupJacuzziVerlaufToggles();
function placeWeatherWidget() {
  const w = document.getElementById("weatherWidget");
  const d = document.getElementById("weatherSlotDesktop");
  const m = document.getElementById("weatherSlotMobile");
  if (!w || !d || !m) return;
  if (window.matchMedia("(max-width: 560px)").matches) {
    m.appendChild(w);
  } else {
    d.appendChild(w);
  }
}
placeWeatherWidget();
{
  const mq = window.matchMedia("(max-width: 560px)");
  const onChange = () => placeWeatherWidget();
  if (mq.addEventListener) mq.addEventListener("change", onChange);
  else if (mq.addListener) mq.addListener(onChange);
}
initWeather();

// Auth-Config parallel (Firestore-Listener starten schon oben via setupListeners)
wireLoginAutofillSync();
if (hydrateAuthHashesSessionCache()) markLoginHashesReady();
prefetchLoginHashesInBackground();

loadAuthConfig().then(() => {
  auth.init();
  onMovedOutChanged();
  populateLoginMemberSelect();
  populateAufgabenWhoSelect();
  setupRoomShareUI();
  if (new URLSearchParams(window.location.search).get("openLogin") === "1" ||
      new URLSearchParams(window.location.search).get("login") === "1") {
    requestAnimationFrame(() => { openLoginDialog(); });
  }
});
