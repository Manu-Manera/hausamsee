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
    name: "Andy",
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
    name: "Fanny",
    role: "Kreativ-Kopf",
    emoji: "🎨",
    bio: "Bringt Farbe ins Haus, liebt lange Gespräche am Feuer und kocht leidenschaftlich gerne."
  },
  {
    name: "Elliot",
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
const BEWOHNER_NAME_SET = new Set(BEWOHNER.map((b) => b.name));

// Gallery-Konstanten
const MAX_GALLERY_IMAGES = 20;
const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.82;
const MAX_IMAGE_BYTES = 900_000; // ~900 KB per Bild (Firestore Document Limit = 1MB)

// Audio-Konstanten
const MAX_AUDIO_BYTES = 900_000; // ~900 KB pro Audio-Datei (Firestore Document Limit)

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

const localStore = {
  events: JSON.parse(localStorage.getItem("has_events") || "[]"),
  putzplan: JSON.parse(localStorage.getItem("has_putzplan") || "[]"),
  termine: JSON.parse(localStorage.getItem("has_termine") || "[]"),
  anwesenheit: JSON.parse(localStorage.getItem("has_anwesenheit") || "{}"),
  gaestebuch: JSON.parse(localStorage.getItem("has_gaestebuch") || "[]"),
  galerie: JSON.parse(localStorage.getItem("has_galerie") || "[]"),
  musik: JSON.parse(localStorage.getItem("has_musik") || "[]"),
  kandidaten: JSON.parse(localStorage.getItem("has_kandidaten") || "[]"),
  schaeden: JSON.parse(localStorage.getItem("has_schaeden") || "[]"),
  bewohnerfotos: JSON.parse(localStorage.getItem("has_bewohnerfotos") || "{}"),
  hausbilder: JSON.parse(localStorage.getItem("has_hausbilder") || "{}"),
  eventfotos: JSON.parse(localStorage.getItem("has_eventfotos") || "[]"),
  config: JSON.parse(localStorage.getItem("has_config") || "{}"),
  guests: JSON.parse(localStorage.getItem("has_guests") || "[]"),
  anmeldungen: JSON.parse(localStorage.getItem("has_anmeldungen") || "[]"),
  nachrichten: JSON.parse(localStorage.getItem("has_nachrichten") || "[]"),
  roomOffer: JSON.parse(localStorage.getItem("has_roomOffer") || "null"),
  bewohnertexte: JSON.parse(localStorage.getItem("has_bewohnertexte") || "{}"),
  gartenPlan: JSON.parse(localStorage.getItem("has_gartenPlan") || "null"),
  memberPasswords: JSON.parse(localStorage.getItem("has_memberPasswords") || "{}"),
  memberPrefs: JSON.parse(localStorage.getItem("has_memberPrefs") || "{}"),
  movedOut: JSON.parse(localStorage.getItem("has_movedOut") || "[]"),
};
function saveLocal(key, value) { localStorage.setItem(`has_${key}`, JSON.stringify(value)); }

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
  return String(s ?? "").normalize("NFC").trim();
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
  get isAuthed() { return !!this.member; },
  get isMember() { return !!this.member && !this.isGuest; },
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
        this.apply();
      } else if (BEWOHNER.find(b => b.name === session.member) && !movedOutNames.has(session.member)) {
        this.member = session.member;
        this.isGuest = false;
        this.apply();
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch { localStorage.removeItem(SESSION_KEY); }
  },
  login(member, { isGuest = false } = {}) {
    this.member = member;
    this.isGuest = isGuest;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      member,
      isGuest,
      until: Date.now() + SESSION_DURATION
    }));
    this.apply();
    const greeting = isGuest ? `Willkommen als Gast, ${member} 🎟️` : `Willkommen zurück, ${mLabel(member)} 🌿`;
    showToast(greeting, "success");
  },
  logout() {
    this.member = null;
    this.isGuest = false;
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
    renderPutzplan();
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

function applyMemberPasswordsDoc(data) {
  authConfig.memberHashes = {};
  if (!data || typeof data !== "object") return;
  const skipKeys = new Set(["updatedAt", "updatedBy", "createdAt"]);
  for (const [k, v] of Object.entries(data)) {
    if (skipKeys.has(k)) continue;
    if (v == null) continue;
    if (typeof v !== "string") continue;
    const raw = v.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(raw)) continue;
    const kTrim = k.trim();
    let canonical = [...ADULT_NAMES].find((n) => n === kTrim);
    if (!canonical) canonical = [...ADULT_NAMES].find((n) => n.toLowerCase() === kTrim.toLowerCase());
    if (!canonical) continue;
    authConfig.memberHashes[canonical] = raw;
  }
}

function applyMemberPrefsDoc(data) {
  const next = {};
  if (data && typeof data === "object") {
    for (const [k, v] of Object.entries(data)) {
      if (!BEWOHNER_NAME_SET.has(k) || !v || typeof v !== "object") continue;
      const rawName = v.displayName != null ? String(v.displayName) : "";
      const displayName = rawName.replace(/\s+/g, " ").trim().slice(0, 32);
      const rawEmoji = v.emoji != null ? String(v.emoji).trim() : "";
      if (rawEmoji && !EMOJI_CHOICES_SET.has(rawEmoji)) continue;
      const o = {};
      if (displayName) o.displayName = displayName;
      if (rawEmoji) o.emoji = rawEmoji;
      if (Object.keys(o).length) next[k] = o;
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
  populateLoginMemberSelect();
  populatePutzWhoSelect();
  populateSchadenZustaendigSelect();
  renderSettingsBewohnerRoster();
}

function onMovedOutChanged() {
  renderBewohner();
  renderAnwesend();
  renderTermine();
  renderSchaeden();
  populateLoginMemberSelect();
  populatePutzWhoSelect();
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
  await setDoc(doc(db, "config", "memberPasswords"), { [name]: deleteField() }, { merge: true });
  await setDoc(doc(db, "config", "memberPrefs"), { [name]: deleteField() }, { merge: true });
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
  const re = new RegExp(`\\n*\\s*${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const textNoUrl = text.replace(re, "").trimEnd();
  if (navigator.share) {
    try {
      await navigator.share({ title: shareTitle, text: textNoUrl, url });
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("Einladung in die Zwischenablage kopiert.", "success");
  } catch {
    showToast("Teilen war nicht möglich.", "error");
  }
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
  if (!elName || !elEmoji) return;
  if (!auth.isMember) {
    elName.value = "";
    if (elEmoji.options.length) elEmoji.selectedIndex = 0;
    return;
  }
  const p = authConfig.memberPrefs[auth.member];
  const base = BEWOHNER.find((b) => b.name === auth.member);
  elName.value = p?.displayName || auth.member;
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

/** Login für eine konkrete Bewohner:in: eigenes Passwort, sonst gemeinsames Fallback. */
async function verifyMemberPassword(memberName, pw) {
  const hash = await sha256(normPasswordInput(pw));
  const personal = authConfig.memberHashes[memberName];
  if (personal) {
    if (hash === personal) return { ok: true, kind: "member" };
    return { ok: false, reason: "wrong" };
  }
  if (hashMatchesWgLoginFallback(hash)) return { ok: true, kind: "member" };
  return { ok: false, reason: "wrong" };
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
    } else {
      lku.value = v;
    }
  }
  const cpu = $("changePwKeychainUser");
  if (cpu) {
    if (auth.isMember && !auth.isGuest) cpu.value = auth.member;
    else cpu.value = "";
  }
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
  const now = Date.now();
  const activeGuests = (guestsCache || []).filter(g => !g.expiresAt || g.expiresAt > now);

  const memberOpts = adults
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

  select.innerHTML =
    `<option value="" disabled ${previous ? "" : "selected"}>Wähle dich aus…</option>` +
    `<optgroup label="Bewohner:innen">${memberOpts}</optgroup>` +
    guestGroup;

  if (previous) select.value = previous;
  syncKeychainUserFields();
}

$("loginMember")?.addEventListener("change", () => { syncKeychainUserFields(); });

function openLoginDialog() {
  $("loginError")?.classList.add("hidden");
  $("loginForm")?.reset();
  populateLoginMemberSelect();
  syncKeychainUserFields();
  try { $("loginDialog")?.showModal(); } catch (_) { /* */ }
}

function populatePutzWhoSelect() {
  const select = $("putzWho");
  if (!select) return;
  const current = select.value;
  const adults = getActiveAdults();
  select.innerHTML = `<option value="">Wer?</option>` +
    adults.map(b => `<option value="${b.name}">${mEmoji(b.name)} ${escapeHtml(mLabel(b.name))}</option>`).join("");
  if (current) select.value = current;
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
  const selected = $("loginMember").value;
  const password = $("loginPassword").value;
  if (!selected) return;

  const errorEl = $("loginError");
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
    $("loginPassword").value = "";
    $("loginPassword").focus();
  };

  // Fall 1: Konkreter Gast-Eintrag gewählt (mit ID/Namen)
  if (selected.startsWith("__guest__:")) {
    const key = selected.slice("__guest__:".length);
    const guest = (guestsCache || []).find(g => g.id === key || g.name === key);
    if (!guest) { showError("Gast-Zugang nicht gefunden."); return; }
    const now = Date.now();
    if (guest.expiresAt && guest.expiresAt < now) { showError("Dieser Gast-Zugang ist abgelaufen."); return; }
    const hash = await sha256(normPasswordInput(password));
    if (hash !== guest.hash) { showError("Falsches Passwort · versuch's nochmal."); return; }
    auth.login(guest.name, { isGuest: true });
    $("loginDialog").close();
    return;
  }

  // Fall 2: Generische Gast-Option (keine Gäste im Cache konfiguriert oder Fallback)
  if (selected === "__guest__") {
    const result = await verifyPassword(password);
    if (!result.ok) {
      showError(result.reason === "expired"
        ? "Dieser Gast-Zugang ist abgelaufen."
        : "Falsches Passwort · versuch's nochmal.");
      return;
    }
    if (result.kind !== "guest") { showError("Das ist kein Gast-Passwort."); return; }
    auth.login(result.guestName, { isGuest: true });
    $("loginDialog").close();
    return;
  }

  // Fall 3: WG-Mitglied — eigenes Passwort oder gemeinsames Fallback (siehe verifyMemberPassword)
  const mres = await verifyMemberPassword(selected, password);
  if (!mres.ok) {
    showError("Falsches Passwort · versuch's nochmal.");
    return;
  }
  auth.login(selected, { isGuest: false });
  $("loginDialog").close();
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

const HAUS_FEATURES = [
  { id: "garten",    emoji: "🌿", title: "Garten mit Trampolin",      text: "Liegewiese, Feuerstelle und ein Trampolin, auf dem wir uns bei jedem Wetter austoben." },
  { id: "wohnzimmer",emoji: "🔥", title: "Wohnzimmer mit Kamin",      text: "Das Herzstück: knisterndes Feuer, grosse Sofas und lange Abende mit Gesprächen bis in die Nacht." },
  { id: "kino",      emoji: "🎬", title: "Kinobereich mit Gästebett", text: "Beamer, Leinwand, viele Kissen – und ein ausziehbares Bett für Gäste, die über Nacht bleiben." },
  { id: "sauna",     emoji: "🧖", title: "Sauna",                      text: "Unsere Wohlfühl-Ecke für kalte Tage und lange Wochenenden. Aufguss inklusive." },
  { id: "jacuzzi",   emoji: "🛁", title: "Jacuzzi",                    text: "Warmes Wasser, perlende Blasen, Sternenhimmel oben drüber – mehr braucht's nicht." },
  { id: "sup",       emoji: "🏄", title: "SUPs",                       text: "Unsere Stand-Up-Paddles warten darauf, aufs Wasser gebracht zu werden – der See ist fast vor der Tür." }
];

let hausbilderCache = {};

function renderHausFeatures() {
  const grid = $("hausGrid");
  if (!grid) return;
  grid.innerHTML = HAUS_FEATURES.map(f => {
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
            <button class="mini-btn" data-feature="${f.id}" data-action="upload">${photo ? "📷 Ändern" : "📷 Foto hinzufügen"}</button>
            ${photo ? `<button class="mini-btn danger" data-feature="${f.id}" data-action="delete">Entfernen</button>` : ""}
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
      } else {
        localStore.hausbilder[featureId] = payload;
        hausbilderCache = localStore.hausbilder;
        saveLocal("hausbilder", localStore.hausbilder);
        renderHausFeatures();
      }
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
  } else {
    delete localStore.hausbilder[featureId];
    hausbilderCache = localStore.hausbilder;
    saveLocal("hausbilder", localStore.hausbilder);
    renderHausFeatures();
  }
  showToast("Foto entfernt.", "success");
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
  grid.innerHTML = getActiveBewohner().map(b => {
    const photo = bewohnerfotosCache[b.name]?.src;
    const text = getBewohnerText(b.name);
    const hasMore = !!(text.longBio || text.hobby || text.food || text.motto || text.link);
    const dlabel = mLabel(b.name);
    return `
      <article class="bewohner-card ${b.kid ? 'is-kid' : ''}" data-name="${escapeHtml(b.name)}" tabindex="0" role="button" aria-label="Profil von ${escapeHtml(dlabel)} öffnen">
        <div class="bewohner-avatar">
          ${photo
      ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(dlabel)}" loading="lazy" />`
      : `<span class="avatar-emoji">${mEmoji(b.name)}</span>`}
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
  $("statBewohner").textContent = String(getActiveBewohner().length);

  grid.querySelectorAll(".avatar-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      uploadBewohnerFoto(btn.dataset.name);
    });
  });
  grid.querySelectorAll(".bewohner-card").forEach(card => {
    const openProfile = () => openBewohnerProfile(card.dataset.name);
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      openProfile();
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProfile(); }
    });
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
      showToast("Foto-Upload fehlgeschlagen.", "error");
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

function renderGallery() {
  const grid = $("gallery");
  const userImages = [...galerieCache].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  // Default-Bilder nur zeigen wenn noch keine eigenen da sind
  const images = userImages.length > 0 ? userImages : DEFAULT_GALLERY;

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

  $("statEvents").textContent = upcoming.length;
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
      </div>
      <div class="event-info">
        <h3>${ev.emoji || "🎉"} ${escapeHtml(ev.title)} ${flyerButton}</h3>
        <div class="event-meta">📍 ${escapeHtml(ev.location || "Haus am See")}</div>
        ${ev.description ? `<p>${escapeHtml(ev.description)}</p>` : ""}
        ${signupBlock}
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
  showToast("Termin-Datei heruntergeladen.", "success");
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

async function shareEvent(ev, hash = "events") {
  const fullText = buildShareText(ev, hash);
  const url = eventPermalink(ev, hash);
  // Für native share: Permalink entfernen, da er ins url-Feld geht (sonst doppelt)
  const textWithoutLink = fullText.replace(/\n*\s*https?:\/\/\S+$/, "").trimEnd();

  // 1. Native Web-Share-API (iOS/Android Share-Sheet)
  if (navigator.share) {
    const shareData = { title: `${ev.title} · Haus am See`, text: textWithoutLink, url };

    // Flyer als Datei anhängen, wenn vorhanden und vom Browser unterstützt
    if (ev.flyerSrc && typeof ev.flyerSrc === "string" && ev.flyerSrc.startsWith("data:")) {
      const file = dataUrlToFile(ev.flyerSrc, ev.title);
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        shareData.files = [file];
      }
    }

    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err?.name === "AbortError") return;
      // Bei anderen Fehlern (z. B. "permission denied" für files): erneut ohne Datei versuchen
      if (shareData.files) {
        try {
          delete shareData.files;
          await navigator.share(shareData);
          return;
        } catch (err2) {
          if (err2?.name === "AbortError") return;
        }
      }
    }
  }
  // 2. Fallback: direkt WhatsApp (volltext mit Link)
  const waUrl = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
  const win = window.open(waUrl, "_blank", "noopener");
  if (!win) {
    // 3. Letzter Fallback: Zwischenablage
    try {
      await navigator.clipboard.writeText(fullText);
      showToast("In Zwischenablage kopiert.", "success");
    } catch {
      showToast("Teilen nicht möglich.", "error");
    }
  }
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
              <span class="signup-names">${escapeHtml(a.name)}</span>
              ${ownIds.has(a.id) || auth.isMember
                ? `<button type="button" class="signup-remove" data-id="${a.id}" data-eventid="${ev.id}" title="Anmeldung entfernen">×</button>`
                : ""}
            </li>
          `).join("")}
        </ul>
      ` : `<div class="empty-state small">Noch niemand angemeldet. Mach den Anfang!</div>`}
      <form class="signup-form" data-eventid="${ev.id}">
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

  const entry = { eventId, name, createdAt: Date.now() };
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
    form.reset();
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
   Putzplan
   ========================================================================== */

let putzCache = [];

function renderPutzplan() {
  const grid = $("putzplanGrid");
  const sorted = [...putzCache].sort((a, b) => new Date(a.when) - new Date(b.when));
  if (sorted.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">Noch keine Aufgaben – zum Glück! 🧼</div>`;
    return;
  }
  grid.innerHTML = sorted.map(p => `
    <div class="putz-card ${p.done ? 'done' : ''}">
      <div class="putz-task">${escapeHtml(p.task)}</div>
      <div class="putz-meta">
        <span>${escapeHtml(p.who)} · ${new Date(p.when).toLocaleDateString("de-CH", {weekday:"short", day:"2-digit", month:"short"})}</span>
      </div>
      ${auth.isAuthed ? `<div class="putz-actions">
        <button class="mini-btn" data-id="${p.id}" data-action="toggle">${p.done ? "↺ rückgängig" : "✓ erledigt"}</button>
        <button class="mini-btn danger" data-id="${p.id}" data-action="delete">Löschen</button>
      </div>` : ""}
    </div>
  `).join("");
  grid.querySelectorAll(".mini-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "toggle") togglePutz(btn.dataset.id);
      else if (btn.dataset.action === "delete") deletePutz(btn.dataset.id);
    });
  });
}

async function togglePutz(id) {
  if (!requireAuth("Putzplan ändern")) return;
  const item = putzCache.find(p => p.id === id);
  if (!item) return;
  if (firebaseReady) {
    await updateDoc(doc(db, "putzplan", id), { done: !item.done });
  } else {
    item.done = !item.done;
    localStore.putzplan = putzCache;
    saveLocal("putzplan", localStore.putzplan);
    renderPutzplan();
  }
}

async function deletePutz(id) {
  if (!requireAuth("Putzplan ändern")) return;
  if (firebaseReady) {
    await deleteDoc(doc(db, "putzplan", id));
  } else {
    localStore.putzplan = localStore.putzplan.filter(p => p.id !== id);
    putzCache = localStore.putzplan;
    saveLocal("putzplan", localStore.putzplan);
    renderPutzplan();
  }
}

$("putzForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Putzplan ändern")) return;
  const entry = {
    task: $("putzTask").value.trim(),
    who: $("putzWho").value,
    when: $("putzWhen").value,
    done: false,
    createdAt: Date.now()
  };
  if (firebaseReady) {
    await addDoc(collection(db, "putzplan"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    localStore.putzplan.push(entry);
    putzCache = localStore.putzplan;
    saveLocal("putzplan", localStore.putzplan);
    renderPutzplan();
  }
  e.target.reset();
  showToast("Gespeichert.", "success");
});

/* ==========================================================================
   Termine (mit WG-RSVP)
   ========================================================================== */

let termineCache = [];

function renderTermine() {
  const list = $("termineList");
  const upcoming = termineCache
    .filter(t => new Date(t.date) >= new Date(new Date().setHours(0,0,0,0)))
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
      <div class="termin-card">
        <div class="termin-date">
          <span class="day">${String(d.getDate()).padStart(2,"0")}</span>
          <span class="month">${monthShort[d.getMonth()]}</span>
          <span class="time">${d.toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"})}</span>
        </div>
        <div class="termin-body">
          <h3>${escapeHtml(t.title)}</h3>
          ${t.note ? `<p class="termin-note">${escapeHtml(t.note)}</p>` : ""}
          ${t.createdBy ? `<p class="termin-creator">Erstellt von ${escapeHtml(mLabel(t.createdBy))}</p>` : ""}
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
        ${auth.isAuthed ? `<button class="mini-btn danger termin-delete" data-id="${t.id}">Löschen</button>` : ""}
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

function renderAnwesend() {
  const grid = $("anwesendGrid");
  const weekendKey = getWeekendKey();
  const weekendData = anwesendCache[weekendKey] || {};
  grid.innerHTML = getActiveBewohner().map(b => {
    const status = weekendData[b.name] || "unknown";
    const canEdit = auth.isAuthed && auth.member === b.name;
    return `
      <div class="anwesend-card">
        <div class="anwesend-emoji">${mEmoji(b.name)}</div>
        <strong>${escapeHtml(mLabel(b.name))}</strong>
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
      setAnwesend(btn.dataset.name, btn.dataset.status);
    });
  });
}

async function setAnwesend(name, status) {
  if (!auth.isAuthed || auth.member !== name) {
    showToast("Du kannst nur deinen eigenen Status ändern.", "error");
    return;
  }
  const weekendKey = getWeekendKey();
  if (firebaseReady) {
    await setDoc(doc(db, "anwesenheit", weekendKey), { [name]: status }, { merge: true });
  } else {
    anwesendCache[weekendKey] = { ...(anwesendCache[weekendKey] || {}), [name]: status };
    localStore.anwesenheit = anwesendCache;
    saveLocal("anwesenheit", localStore.anwesenheit);
    renderAnwesend();
  }
}

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
      <div class="gb-avatar" ${headerStyle}>${gb.emoji || "🌿"}</div>
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
      <a class="gb-link" href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer">
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

function defaultGartenPlan() {
  return {
    enabled: false,
    deviceName: "Pumpe",
    days: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  };
}

let gartenPlanCache = null;

function normalizeGartenPlan(raw) {
  const d = defaultGartenPlan();
  if (!raw || typeof raw !== "object") return d;
  d.enabled = !!raw.enabled;
  d.deviceName = (raw.deviceName || "Pumpe").trim() || "Pumpe";
  "mon tue wed thu fri sat sun".split(" ").forEach((k) => {
    const arr = raw.days?.[k];
    d.days[k] = Array.isArray(arr)
      ? arr.map((s) => ({
        on: String(s.on || "07:00").slice(0, 5),
        off: String(s.off || "07:15").slice(0, 5),
      }))
      : [];
  });
  return d;
}

function gartenSlotRowHtml(day, idx, s) {
  const on = (s.on || "07:00").slice(0, 5);
  const off = (s.off || "07:15").slice(0, 5);
  return `<div class="garten-slot-row" data-day="${day}" data-index="${idx}">
    <label>Ein <input type="time" class="garten-on" value="${on}" /></label>
    <label>Aus <input type="time" class="garten-off" value="${off}" /></label>
    <button type="button" class="mini-btn danger garten-remove-slot" data-day="${day}" data-index="${idx}">Entfernen</button>
  </div>`;
}

function renderGartenWeek() {
  const root = $("gartenWeek");
  if (!root) return;
  gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
  const data = gartenPlanCache;
  const en = $("gartenPlanEnabled");
  const dev = $("gartenDeviceName");
  if (en) en.checked = !!data.enabled;
  if (dev) dev.value = data.deviceName || "Pumpe";

  root.innerHTML = GARTEN_DAY_DEF.map(([key, label]) => {
    const slots = data.days[key] || [];
    const inner = slots.length
      ? slots.map((s, i) => gartenSlotRowHtml(key, i, s)).join("")
      : "";
    return `<div class="garten-day" data-day="${key}">
      <h4 class="garten-day-title">${label}</h4>
      <div class="garten-slots">${inner || `<p class="form-note" style="margin:0 0 8px;">Noch keine Zeiten — unten «Zeitblock» klicken.</p>`}</div>
      <button type="button" class="btn btn-ghost small garten-add-slot" data-day="${key}">+ Zeitblock</button>
    </div>`;
  }).join("");

  root.querySelectorAll(".garten-add-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
      gartenPlanCache.days[day] = gartenPlanCache.days[day] || [];
      gartenPlanCache.days[day].push({ on: "07:00", off: "07:15" });
      renderGartenWeek();
    });
  });
  root.querySelectorAll(".garten-remove-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      const idx = parseInt(btn.dataset.index, 10);
      gartenPlanCache = normalizeGartenPlan(gartenPlanCache);
      if (gartenPlanCache.days[day]) gartenPlanCache.days[day].splice(idx, 1);
      renderGartenWeek();
    });
  });
}

function gartenTimeToMin(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function collectGartenPlanFromDom() {
  const days = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
  document.querySelectorAll("#gartenWeek .garten-day").forEach((dayEl) => {
    const key = dayEl.dataset.day;
    if (!days[key]) return;
    dayEl.querySelectorAll(".garten-slot-row").forEach((row) => {
      const on = row.querySelector(".garten-on")?.value || "07:00";
      const off = row.querySelector(".garten-off")?.value || "07:15";
      days[key].push({ on, off });
    });
  });
  return {
    enabled: !!$("gartenPlanEnabled")?.checked,
    deviceName: ($("gartenDeviceName")?.value || "Pumpe").trim() || "Pumpe",
    days,
  };
}

$("gartenPlanForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireMember("Gartenplan speichern")) return;
  const next = collectGartenPlanFromDom();
  for (const k of Object.keys(next.days)) {
    for (const slot of next.days[k]) {
      const a = gartenTimeToMin(slot.on);
      const b = gartenTimeToMin(slot.off);
      if (a === null || b === null) {
        showToast(`Ungültige Zeit in ${k}. Bitte beide Uhrzeiten prüfen.`, "error");
        return;
      }
      if (a >= b) {
        showToast(`Bei ${k}: «Ein» muss vor «Aus» liegen (${slot.on} → ${slot.off}).`, "error");
        return;
      }
    }
  }
  gartenPlanCache = normalizeGartenPlan(next);
  if (firebaseReady) {
    try {
      await setDoc(
        doc(db, "config", "gartenPlan"),
        { ...gartenPlanCache, updatedBy: auth.member, updatedAt: serverTimestamp() },
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

    return `
      <article class="schaden-card prio-${prio} status-${status}">
        <div class="schaden-head">
          <h3 class="schaden-titel">${escapeHtml(s.titel)}</h3>
          <div class="schaden-badges">
            <span class="prio-badge ${prio}">${PRIO_LABEL[prio]}</span>
            <span class="status-badge ${status === 'erledigt' ? 'eingezogen' : status === 'in_bearbeitung' ? 'eingeladen' : 'offen'}">
              ${status === 'erledigt' ? '✓ Erledigt' : status === 'in_bearbeitung' ? '🛠️ In Arbeit' : '⏳ Offen'}
            </span>
          </div>
        </div>
        <div class="schaden-meta">
          ${s.ort ? `<span>📍 ${escapeHtml(s.ort)}</span>` : ""}
          <span>👤 Kümmert sich: ${zustaendigLabel}</span>
          ${s.addedBy ? `<span>· gemeldet von ${escapeHtml(mLabel(s.addedBy) || s.addedBy)}</span>` : ""}
        </div>
        ${s.beschreibung ? `<p class="schaden-body">${escapeHtml(s.beschreibung)}</p>` : ""}
        ${s.image ? `<div class="schaden-foto"><img src="${s.image}" alt="Foto zum Schaden: ${escapeAttr(s.titel || "")}" loading="lazy" /></div>` : ""}
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
}

async function setSchadenField(id, field, value) {
  if (!requireAuth("Schaden aktualisieren")) return;
  if (firebaseReady) {
    try { await updateDoc(doc(db, "schaeden", id), { [field]: value }); }
    catch (e) { showToast("Speichern fehlgeschlagen.", "error"); }
  } else {
    const item = localStore.schaeden.find(s => s.id === id);
    if (!item) return;
    item[field] = value;
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
    status: "offen",
    addedBy: auth.member,
    createdAt: Date.now()
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
    if (!ro?.active) return;
    const url = getRoomShareUrl();
    const text = buildRoomShareText(ro);
    const title = buildRoomShareTitle(ro);
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("Text mit Link kopiert.", "success");
    } catch {
      showToast("Teilen nicht möglich.", "error");
    }
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

  const photos = Array.isArray(ro.photos) ? ro.photos : [];
  const photoEl = $("roomOfferPhotos");
  if (!photos.length) {
    photoEl.innerHTML = `<div class="room-offer-photo-placeholder">📸 Noch keine Fotos hinzugefügt</div>`;
  } else {
    photoEl.innerHTML = photos.map((src, i) => `
      <div class="room-offer-photo" data-idx="${i}"><img src="${escapeHtml(src)}" alt="Zimmer-Foto ${i + 1}" loading="lazy" /></div>
    `).join("");
    photoEl.querySelectorAll(".room-offer-photo").forEach(el => {
      el.addEventListener("click", () => {
        const idx = Number(el.dataset.idx);
        openLightbox({ src: photos[idx], caption: "Zimmer-Foto" });
      });
    });
  }

  syncRoomOfferShareBackground(ro);
  renderRoomAdminPhotos();
  populateRoomForm();
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
  const photos = Array.isArray(roomOfferCache?.photos) ? roomOfferCache.photos : [];
  if (!photos.length) {
    wrap.innerHTML = `<p class="form-note">Noch keine Fotos hochgeladen.</p>`;
    return;
  }
  wrap.innerHTML = photos.map((src, i) => `
    <div class="room-admin-photo">
      <img src="${escapeHtml(src)}" alt="Zimmer-Foto ${i + 1}" loading="lazy" />
      <button type="button" class="mini-btn danger" data-idx="${i}" data-action="remove-room-photo">Entfernen</button>
    </div>
  `).join("");
  wrap.querySelectorAll("[data-action='remove-room-photo']").forEach(btn => {
    btn.addEventListener("click", () => removeRoomPhoto(Number(btn.dataset.idx)));
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

async function removeRoomPhoto(idx) {
  if (!requireMember("Fotos verwalten")) return;
  const photos = [...(roomOfferCache?.photos || [])];
  if (idx < 0 || idx >= photos.length) return;
  photos.splice(idx, 1);
  if (await saveRoomOffer({ photos })) showToast("Foto entfernt.", "success");
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
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const current = [...(roomOfferCache?.photos || [])];
  const slotsLeft = Math.max(0, 6 - current.length);
  const toProcess = files.slice(0, slotsLeft);
  if (!toProcess.length) {
    showToast("Maximal 6 Fotos – bitte zuerst welche entfernen.", "error");
    e.target.value = "";
    return;
  }
  try {
    for (const file of toProcess) {
      const dataUrl = await resizeImage(file, 1200);
      current.push(dataUrl);
    }
    await saveRoomOffer({ photos: current });
    showToast(`${toProcess.length} Foto${toProcess.length > 1 ? "s" : ""} hinzugefügt.`, "success");
  } catch (err) {
    console.error(err);
    showToast("Upload fehlgeschlagen.", "error");
  }
  e.target.value = "";
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
  if (!displayName) { showToast("Bitte einen Anzeigenamen eintragen.", "error"); return; }
  if (!EMOJI_CHOICES_SET.has(emoji)) { showToast("Bitte ein Icon aus der Liste wählen.", "error"); return; }
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "memberPrefs"), {
        [auth.member]: { displayName, emoji, updatedBy: auth.member, updatedAt: serverTimestamp() }
      }, { merge: true });
      authConfig.memberPrefs[auth.member] = { displayName, emoji };
      showToast("Profil gespeichert.", "success");
      onMemberPrefsChanged();
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
    const next = { ...localStore.memberPrefs, [auth.member]: { displayName, emoji } };
    localStore.memberPrefs = next;
    saveLocal("memberPrefs", next);
    applyMemberPrefsDoc(next);
    onMemberPrefsChanged();
    showToast("Profil lokal gespeichert.", "success");
  }
});

$("wgInviteShareNative")?.addEventListener("click", () => shareWgInviteFromSheet());
$("wgInviteWhatsApp")?.addEventListener("click", () => openWgInviteWhatsApp());
$("wgInviteCopy")?.addEventListener("click", () => copyWgInviteToClipboard());

$("adminSetWgPasswordToHausamsee")?.addEventListener("click", async () => {
  if (!requireMember("Gruppenpasswort setzen")) return;
  if (!confirm("Das gemeinsame Passwort in der Cloud wirklich auf «hausamsee» setzen? Alle ohne persönliches Passwort loggen so ein.")) return;
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "auth"), { passwordHash: WG_PASSWORD_HASH, updatedBy: auth.member, updatedAt: serverTimestamp() }, { merge: true });
      authConfig.passwordHash = WG_PASSWORD_HASH;
      showToast("Gruppenpasswort ist jetzt «hausamsee» (in der Cloud).", "success");
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
    await clearMemberAppPrefsInCloud(name);
    if (firebaseReady) {
      onMemberPrefsChanged();
      showToast("Persönliches Passwort entfernt – Login mit Gruppenpasswort.", "success");
    } else {
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
  const currentHash = await sha256(normPasswordInput(current));
  const personal = authConfig.memberHashes[auth.member];
  const currentOk = personal
    ? currentHash === personal
    : hashMatchesWgLoginFallback(currentHash);
  if (!currentOk) {
    showToast(personal ? "Aktuelles (persönliches) Passwort ist falsch." : "Aktuelles Passwort ist falsch (gemeinsames Passwort: Cloud oder z. B. «hausamsee»).", "error");
    return;
  }
  const newHash = await sha256(normPasswordInput(newPw));
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "memberPasswords"), { [auth.member]: newHash, updatedBy: auth.member, updatedAt: serverTimestamp() }, { merge: true });
      const verSnap = await getDoc(doc(db, "config", "memberPasswords"));
      if (verSnap.exists()) applyMemberPasswordsDoc(verSnap.data());
      if (!authConfig.memberHashes[auth.member]) {
        authConfig.memberHashes[auth.member] = newHash;
        console.warn("[auth] memberPasswords: lokalen Hash gesetzt, Server-Lesung fehlte für", auth.member);
      }
      e.target.reset();
      showToast(`Passwort für ${auth.member} gespeichert. Nur du nutzt dieses Passwort zum Login. 🔑`, "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
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
  const currentHash = await sha256(normPasswordInput(current));
  if (!hashMatchesWgLoginFallback(currentHash)) {
    showToast("Aktuelles gemeinsames Passwort ist falsch (Cloud-Stand oder «hausamsee»).", "error");
    return;
  }
  const newHash = await sha256(normPasswordInput(newPw));
  if (Object.values(authConfig.memberHashes).includes(newHash)) {
    showToast("Dieses Passwort ist schon als persönliches Passwort vergeben.", "error");
    return;
  }
  if (firebaseReady) {
    try {
      await setDoc(doc(db, "config", "auth"), { passwordHash: newHash, updatedBy: auth.member, updatedAt: serverTimestamp() }, { merge: true });
      authConfig.passwordHash = newHash;
      e.target.reset();
      showToast("Gemeinsames Fallback-Passwort aktualisiert. Nur Leute ohne eigenes Passwort brauchen das Neue.", "success");
    } catch (err) {
      console.error(err);
      showToast("Speichern fehlgeschlagen.", "error");
    }
  } else {
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
  const hash = await sha256(normPasswordInput(pw));
  // Prüfen ob nicht mit Haupt-Passwort identisch
  if (hashMatchesWgLoginFallback(hash) || Object.values(authConfig.memberHashes).includes(hash)) {
    showToast("Dieses Passwort ist schon vergeben (WG oder persönlich) – bitte ein anderes wählen.", "error");
    return;
  }
  const entry = {
    name,
    hash,
    expiresAt: expires ? new Date(expires + "T23:59:59").getTime() : null,
    createdBy: auth.member,
    createdAt: Date.now()
  };
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "guests"), { ...entry, createdAt: serverTimestamp() });
    } catch (err) { showToast("Speichern fehlgeschlagen.", "error"); return; }
  } else {
    entry.id = "local_" + Date.now();
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
    try { await deleteDoc(doc(db, "guests", id)); showToast("Gast-Zugang entfernt.", "success"); }
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

async function loadAuthConfig() {
  if (firebaseReady) {
    try {
      const snap = await getDoc(doc(db, "config", "auth"));
      if (snap.exists() && snap.data().passwordHash) {
        authConfig.passwordHash = snap.data().passwordHash;
      } else {
        await setDoc(doc(db, "config", "auth"), { passwordHash: WG_PASSWORD_HASH, createdAt: serverTimestamp() }, { merge: true });
      }
      onSnapshot(doc(db, "config", "auth"), (d) => {
        if (d.exists() && d.data().passwordHash) authConfig.passwordHash = d.data().passwordHash;
      });

      const mp = await getDoc(doc(db, "config", "memberPasswords"));
      if (mp.exists()) applyMemberPasswordsDoc(mp.data());
      onSnapshot(doc(db, "config", "memberPasswords"), (d) => {
        applyMemberPasswordsDoc(d.exists() ? d.data() : {});
      }, (err) => console.warn("memberPasswords listener:", err.message));

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
    eventsCache = localStore.events;
    putzCache = localStore.putzplan;
    termineCache = localStore.termine;
    anwesendCache = localStore.anwesenheit;
    gbCache = localStore.gaestebuch;
    galerieCache = localStore.galerie;
    musikCache = [...localStore.musik].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    kandidatenCache = localStore.kandidaten;
    schaedenCache = localStore.schaeden;
    bewohnerfotosCache = localStore.bewohnerfotos;
    hausbilderCache = localStore.hausbilder;
    eventfotosCache = localStore.eventfotos;
    guestsCache = localStore.guests;
    anmeldungenCache = localStore.anmeldungen;
    nachrichtenCache = localStore.nachrichten;
    roomOfferCache = localStore.roomOffer || null;
    bewohnertexteCache = localStore.bewohnertexte || {};
    gartenPlanCache = normalizeGartenPlan(localStore.gartenPlan);
    renderEvents();
    renderPutzplan();
    renderTermine();
    renderAnwesend();
    renderGaestebuch();
    renderGallery();
    renderPlaylist();
    renderKandidaten();
    renderSchaeden();
    renderBewohner();
    renderHausFeatures();
    renderGuestsList();
    renderNachrichten();
    renderRoomOffer();
    syncBewerbungToggleVisibility();
    return;
  }

  onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc")), (snap) => {
    eventsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
  }, (err) => console.warn("events listener:", err.message));

  onSnapshot(collection(db, "anmeldungen"), (snap) => {
    anmeldungenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
  }, (err) => console.warn("anmeldungen listener:", err.message));

  onSnapshot(query(collection(db, "putzplan"), orderBy("createdAt", "desc")), (snap) => {
    putzCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPutzplan();
  }, (err) => console.warn("putzplan listener:", err.message));

  onSnapshot(query(collection(db, "termine"), orderBy("createdAt", "desc")), (snap) => {
    termineCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTermine();
  }, (err) => console.warn("termine listener:", err.message));

  onSnapshot(collection(db, "anwesenheit"), (snap) => {
    anwesendCache = {};
    snap.docs.forEach(d => { anwesendCache[d.id] = d.data(); });
    renderAnwesend();
  }, (err) => console.warn("anwesenheit listener:", err.message));

  onSnapshot(query(collection(db, "gaestebuch"), orderBy("createdAt", "desc")), (snap) => {
    gbCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGaestebuch();
  }, (err) => console.warn("gaestebuch listener:", err.message));

  onSnapshot(query(collection(db, "galerie"), orderBy("createdAt", "desc")), (snap) => {
    galerieCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGallery();
  }, (err) => console.warn("galerie listener:", err.message));

  onSnapshot(query(collection(db, "kandidaten"), orderBy("createdAt", "desc")), (snap) => {
    kandidatenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderKandidaten();
  }, (err) => console.warn("kandidaten listener:", err.message));

  onSnapshot(query(collection(db, "schaeden"), orderBy("createdAt", "desc")), (snap) => {
    schaedenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSchaeden();
  }, (err) => console.warn("schaeden listener:", err.message));

  onSnapshot(query(collection(db, "musik"), orderBy("createdAt", "asc")), (snap) => {
    const prevId = musikCache[currentSongIdx]?.id;
    musikCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (prevId) {
      const newIdx = musikCache.findIndex(s => s.id === prevId);
      currentSongIdx = newIdx;
    }
    renderPlaylist();
  }, (err) => console.warn("musik listener:", err.message));

  onSnapshot(collection(db, "bewohnerfotos"), (snap) => {
    bewohnerfotosCache = {};
    snap.docs.forEach(d => { bewohnerfotosCache[d.id] = d.data(); });
    renderBewohner();
  }, (err) => console.warn("bewohnerfotos listener:", err.message));

  onSnapshot(collection(db, "hausbilder"), (snap) => {
    hausbilderCache = {};
    snap.docs.forEach(d => { hausbilderCache[d.id] = d.data(); });
    renderHausFeatures();
  }, (err) => console.warn("hausbilder listener:", err.message));

  onSnapshot(query(collection(db, "eventfotos"), orderBy("createdAt", "desc")), (snap) => {
    eventfotosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
  }, (err) => console.warn("eventfotos listener:", err.message));

  onSnapshot(query(collection(db, "guests"), orderBy("createdAt", "desc")), (snap) => {
    guestsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGuestsList();
  }, (err) => console.warn("guests listener:", err.message));

  onSnapshot(query(collection(db, "nachrichten"), orderBy("createdAt", "desc")), (snap) => {
    nachrichtenCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderNachrichten();
  }, (err) => console.warn("nachrichten listener:", err.message));

  onSnapshot(doc(db, "config", "roomOffer"), (snap) => {
    roomOfferCache = snap.exists() ? snap.data() : null;
    renderRoomOffer();
    syncBewerbungToggleVisibility();
  }, (err) => console.warn("roomOffer listener:", err.message));

  onSnapshot(doc(db, "config", "gartenPlan"), (snap) => {
    gartenPlanCache = normalizeGartenPlan(snap.exists() ? snap.data() : null);
    if (document.querySelector('[data-intern-tab="garten"].active')) renderGartenWeek();
  }, (err) => console.warn("gartenPlan listener:", err.message));

  onSnapshot(collection(db, "bewohnertexte"), (snap) => {
    bewohnertexteCache = {};
    snap.docs.forEach(d => { bewohnertexteCache[d.id] = d.data(); });
    renderBewohner();
  }, (err) => console.warn("bewohnertexte listener:", err.message));
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
populatePutzWhoSelect();
populateSchadenZustaendigSelect();
renderBewohner();
renderHausFeatures();
renderGallery();
setupScrollAnim();

// Auth-Config zuerst laden (wichtig für korrekte Passwort-Prüfung beim Auto-Login)
loadAuthConfig().then(() => {
  auth.init();
  onMovedOutChanged();
  populateLoginMemberSelect();
  populatePutzWhoSelect();
  setupListeners();
  setupRoomShareUI();
  if (new URLSearchParams(window.location.search).get("openLogin") === "1" ||
      new URLSearchParams(window.location.search).get("login") === "1") {
    requestAnimationFrame(() => { openLoginDialog(); });
  }
});
