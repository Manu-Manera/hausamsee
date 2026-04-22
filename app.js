import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
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
    name: "Anna",
    role: "Seekapitänin & Gärtnerin",
    emoji: "🌻",
    bio: "Hat die meisten Pflanzen im Haus, kocht am liebsten vegetarisch und kennt jeden Schwan beim Namen."
  },
  {
    name: "Chris",
    role: "Grillmeister",
    emoji: "🔥",
    bio: "Zuständig für Feuerstelle, Playlist und spontane Spieleabende. Schwimmt im Winter gerne im See."
  },
  {
    name: "Lea",
    role: "Brunch-Queen",
    emoji: "🥐",
    bio: "Steht früh auf, backt oft Sonntags-Gipfeli und organisiert die gemeinsamen Ausflüge."
  },
  {
    name: "Jonas",
    role: "SUP-Liebhaber",
    emoji: "🛶",
    bio: "Paddelt bei jedem Wetter, baut Möbel aus Palettenholz und hat immer ein kaltes Bier im Kühlschrank."
  }
];

// SHA-256 Hash des WG-Passworts. Standard: "hausamsee"
// Passwort ändern? -> hier den SHA-256-Hash des neuen Passworts eintragen.
//   Neuen Hash erzeugen: im Browser-Konsole:
//     crypto.subtle.digest("SHA-256", new TextEncoder().encode("neuesPasswort")).then(b=>console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")))
// Default "hausamsee":
const WG_PASSWORD_HASH = "a89881e9359c985da03b139154082072ba21de07e264891470ac67b2be1bd28f";

// Gallery-Konstanten
const MAX_GALLERY_IMAGES = 20;
const MAX_IMAGE_DIM = 1600;
const JPEG_QUALITY = 0.82;
const MAX_IMAGE_BYTES = 900_000; // ~900 KB per Bild (Firestore Document Limit = 1MB)

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

/* ==========================================================================
   Auth (WG-Login)
   ========================================================================== */

const SESSION_KEY = "has_wg_session";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 Tage

const auth = {
  member: null,
  get isAuthed() { return !!this.member; },
  init() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session.until > Date.now() && BEWOHNER.find(b => b.name === session.member)) {
        this.member = session.member;
        this.apply();
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch { localStorage.removeItem(SESSION_KEY); }
  },
  login(member) {
    this.member = member;
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      member,
      until: Date.now() + SESSION_DURATION
    }));
    this.apply();
    showToast(`Willkommen zurück, ${member} 🌿`, "success");
  },
  logout() {
    this.member = null;
    localStorage.removeItem(SESSION_KEY);
    this.apply();
    showToast("Abgemeldet.");
  },
  apply() {
    document.body.classList.toggle("wg-authed", this.isAuthed);
    updateLoginChip();
    // Re-render dynamic sections so buttons/states reflect auth
    renderTermine();
    renderAnwesend();
    renderGallery();
    renderEvents();
    renderPutzplan();
  }
};

function updateLoginChip() {
  const btn = $("loginBtn");
  if (auth.isAuthed) {
    btn.classList.add("logged-in");
    btn.innerHTML = `<span class="login-icon">👋</span><span class="login-label">${escapeHtml(auth.member)} · Abmelden</span>`;
  } else {
    btn.classList.remove("logged-in");
    btn.innerHTML = `<span class="login-icon">🔑</span><span class="login-label">Anmelden</span>`;
  }
}

function populateLoginMemberSelect() {
  const select = $("loginMember");
  select.innerHTML = `<option value="" disabled selected>Wähle dich aus…</option>` +
    BEWOHNER.map(b => `<option value="${b.name}">${b.emoji} ${b.name}</option>`).join("");
}

function populatePutzWhoSelect() {
  const select = $("putzWho");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Wer?</option>` +
    BEWOHNER.map(b => `<option value="${b.name}">${b.emoji} ${b.name}</option>`).join("");
  if (current) select.value = current;
}

$("loginBtn")?.addEventListener("click", () => {
  if (auth.isAuthed) {
    if (confirm(`${auth.member}, wirklich abmelden?`)) auth.logout();
  } else {
    $("loginError").classList.add("hidden");
    $("loginForm").reset();
    $("loginDialog").showModal();
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
  const member = $("loginMember").value;
  const password = $("loginPassword").value;
  if (!member) return;
  const hash = await sha256(password);
  if (hash === WG_PASSWORD_HASH) {
    auth.login(member);
    $("loginDialog").close();
  } else {
    $("loginError").classList.remove("hidden");
    $("loginPassword").value = "";
    $("loginPassword").focus();
  }
});

/* Guard helper: prüft Auth, zeigt sonst Hinweis */
function requireAuth(actionName = "Diese Aktion") {
  if (auth.isAuthed) return true;
  showToast(`${actionName} ist nur für angemeldete WG-Mitglieder.`, "error");
  $("loginDialog").showModal();
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

function openLightbox({ src, caption = "", id = null }) {
  lightboxImg.src = src;
  lightboxCaption.textContent = caption;
  lightboxCurrentId = id;
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
  if (!confirm("Bild wirklich aus der Galerie entfernen?")) return;
  await deleteGalleryItem(lightboxCurrentId);
  lightbox.close();
});

/* ==========================================================================
   Bewohner rendern
   ========================================================================== */

function renderBewohner() {
  const grid = $("bewohnerGrid");
  grid.innerHTML = BEWOHNER.map(b => `
    <article class="bewohner-card">
      <div class="bewohner-avatar">${b.emoji}</div>
      <div class="bewohner-info">
        <h3>${escapeHtml(b.name)}</h3>
        <span class="bewohner-role">${escapeHtml(b.role)}</span>
        <p class="bewohner-bio">${escapeHtml(b.bio)}</p>
      </div>
    </article>
  `).join("");
  $("statBewohner").textContent = BEWOHNER.length;
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

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
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

function renderEvents() {
  const list = $("eventsList");
  const upcoming = eventsCache
    .filter(e => new Date(e.date) >= new Date(new Date().setHours(0,0,0,0)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) {
    list.innerHTML = `<div class="empty-state">Gerade kein Event geplant – aber das ändert sich schnell 🫖</div>`;
    $("statEvents").textContent = 0;
    return;
  }

  list.innerHTML = upcoming.map(ev => {
    const d = new Date(ev.date);
    const yes = (ev.rsvp?.yes || 0);
    const no = (ev.rsvp?.no || 0);
    const userVote = localStorage.getItem(`rsvp_${ev.id}`);
    return `
      <article class="event-card">
        <div class="event-date">
          <span class="day">${String(d.getDate()).padStart(2,"0")}</span>
          <span class="month">${monthShort[d.getMonth()]}</span>
          <span class="time">${d.toLocaleTimeString("de-CH",{hour:"2-digit",minute:"2-digit"})}</span>
        </div>
        <div class="event-info">
          <h3>${ev.emoji || "🎉"} ${escapeHtml(ev.title)}</h3>
          <div class="event-meta">📍 ${escapeHtml(ev.location || "Haus am See")}</div>
          ${ev.description ? `<p>${escapeHtml(ev.description)}</p>` : ""}
        </div>
        <div class="event-actions">
          <div class="rsvp-count">
            <span>✓ ${yes}</span>
            <span>✗ ${no}</span>
          </div>
          <div class="rsvp-buttons">
            <button class="rsvp-btn yes ${userVote === 'yes' ? 'active' : ''}" data-id="${ev.id}" data-vote="yes">Bin dabei</button>
            <button class="rsvp-btn no ${userVote === 'no' ? 'active' : ''}" data-id="${ev.id}" data-vote="no">Kann nicht</button>
          </div>
          ${auth.isAuthed ? `<button class="event-delete" data-id="${ev.id}">Löschen</button>` : ""}
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".rsvp-btn").forEach(btn => {
    btn.addEventListener("click", () => handleEventRsvp(btn.dataset.id, btn.dataset.vote));
  });
  list.querySelectorAll(".event-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!requireAuth("Events löschen")) return;
      if (confirm("Event wirklich löschen?")) deleteEvent(btn.dataset.id);
    });
  });

  $("statEvents").textContent = upcoming.length;
}

async function handleEventRsvp(eventId, vote) {
  const previous = localStorage.getItem(`rsvp_${eventId}`);
  if (previous === vote) return;
  if (firebaseReady) {
    const updates = {};
    if (previous) updates[`rsvp.${previous}`] = increment(-1);
    updates[`rsvp.${vote}`] = increment(1);
    try { await updateDoc(doc(db, "events", eventId), updates); }
    catch (e) { console.error(e); }
  } else {
    const idx = localStore.events.findIndex(e => e.id === eventId);
    if (idx >= 0) {
      localStore.events[idx].rsvp = localStore.events[idx].rsvp || { yes: 0, no: 0 };
      if (previous) localStore.events[idx].rsvp[previous] = Math.max(0, localStore.events[idx].rsvp[previous] - 1);
      localStore.events[idx].rsvp[vote] = (localStore.events[idx].rsvp[vote] || 0) + 1;
      eventsCache = localStore.events;
      saveLocal("events", localStore.events);
      renderEvents();
    }
  }
  localStorage.setItem(`rsvp_${eventId}`, vote);
}

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

$("eventForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!requireAuth("Events erstellen")) return;
  const entry = {
    title: $("evTitle").value.trim(),
    date: $("evDate").value,
    description: $("evDesc").value.trim(),
    location: $("evLocation").value.trim() || "Haus am See, Pilatusstrasse 40, Pfäffikon ZH",
    emoji: $("evEmoji").value.trim() || "🎉",
    rsvp: { yes: 0, no: 0 },
    createdBy: auth.member,
    createdAt: Date.now()
  };
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
  e.target.parentElement.open = false;
  showToast("Event gespeichert.", "success");
});

/* ==========================================================================
   Kalender Tabs
   ========================================================================== */

document.querySelectorAll(".kalender-tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".kalender-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".kalender-panel").forEach(p => p.classList.add("hidden"));
    $(`tab${tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)}`).classList.remove("hidden");
  });
});

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

    // Response-Badges: Alle Bewohner inkl. Status
    const badges = BEWOHNER.map(b => {
      const status = responses[b.name];
      const classes = status ? status : "pending";
      const icon = status === "yes" ? "✓" : status === "no" ? "✗" : status === "maybe" ? "?" : "…";
      return `<span class="response-badge ${classes}">${b.emoji} ${escapeHtml(b.name)} ${icon}</span>`;
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
          ${t.createdBy ? `<p class="termin-creator">Erstellt von ${escapeHtml(t.createdBy)}</p>` : ""}
          <div class="termin-responses">${badges}</div>
          ${auth.isAuthed ? `
            <div class="termin-my-response">
              <span class="label">Deine Antwort (${escapeHtml(auth.member)}):</span>
              <div class="response-buttons">
                <button class="response-btn yes ${myResponse === 'yes' ? 'active' : ''}" data-id="${t.id}" data-response="yes">✓ Zusage</button>
                <button class="response-btn maybe ${myResponse === 'maybe' ? 'active' : ''}" data-id="${t.id}" data-response="maybe">? Vielleicht</button>
                <button class="response-btn no ${myResponse === 'no' ? 'active' : ''}" data-id="${t.id}" data-response="no">✗ Absage</button>
              </div>
            </div>
          ` : `<p class="form-note" style="text-align:left;margin-top:10px;">Zum Zu-/Absagen bitte anmelden.</p>`}
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
  grid.innerHTML = BEWOHNER.map(b => {
    const status = weekendData[b.name] || "unknown";
    const canEdit = auth.isAuthed && auth.member === b.name;
    return `
      <div class="anwesend-card">
        <div class="anwesend-emoji">${b.emoji}</div>
        <strong>${escapeHtml(b.name)}</strong>
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
   Gästebuch
   ========================================================================== */

let gbCache = [];

function renderGaestebuch() {
  const list = $("gbList");
  if (gbCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Sei die erste Stimme im Gästebuch 💌</div>`;
  } else {
    list.innerHTML = gbCache.map(gb => `
      <article class="gb-card">
        <div class="gb-emoji">${gb.emoji || "🌿"}</div>
        <p class="gb-msg">„${escapeHtml(gb.message)}"</p>
        <div class="gb-meta">
          <strong>${escapeHtml(gb.name)}</strong>
          <span>${fmtDate(gb.createdAt)}</span>
        </div>
      </article>
    `).join("");
  }
  $("statGaeste").textContent = gbCache.length;
}

$("gbForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const entry = {
    name: $("gbName").value.trim(),
    emoji: $("gbEmoji").value.trim() || "🌿",
    message: $("gbMessage").value.trim(),
    createdAt: Date.now()
  };
  if (firebaseReady) {
    await addDoc(collection(db, "gaestebuch"), { ...entry, createdAt: serverTimestamp() });
  } else {
    entry.id = "local_" + Date.now();
    localStore.gaestebuch.unshift(entry);
    gbCache = localStore.gaestebuch;
    saveLocal("gaestebuch", localStore.gaestebuch);
    renderGaestebuch();
  }
  e.target.reset();
  showToast("Danke für deinen Eintrag 🌿", "success");
});

/* ==========================================================================
   Firebase Listeners (Live)
   ========================================================================== */

function setupListeners() {
  if (!firebaseReady) {
    eventsCache = localStore.events;
    putzCache = localStore.putzplan;
    termineCache = localStore.termine;
    anwesendCache = localStore.anwesenheit;
    gbCache = localStore.gaestebuch;
    galerieCache = localStore.galerie;
    renderEvents();
    renderPutzplan();
    renderTermine();
    renderAnwesend();
    renderGaestebuch();
    renderGallery();
    return;
  }

  onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc")), (snap) => {
    eventsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
  }, (err) => console.warn("events listener:", err.message));

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

populateLoginMemberSelect();
populatePutzWhoSelect();
renderBewohner();
renderGallery();
setupScrollAnim();
auth.init();
setupListeners();
updateLoginChip();
