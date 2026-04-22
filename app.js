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
  getDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* =============================
   Static Data (im Code editierbar)
   ============================= */
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

const GALLERY_IMAGES = [
  { src: "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80", alt: "Bergsee bei Sonnenuntergang" },
  { src: "https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=800&q=80", alt: "Gemütliche Holzhütte" },
  { src: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80", alt: "Boot auf dem See" },
  { src: "https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=800&q=80", alt: "See im Morgennebel" },
  { src: "https://images.unsplash.com/photo-1530982011887-3cc11cc85693?w=800&q=80", alt: "Lagerfeuer im Garten" },
  { src: "https://images.unsplash.com/photo-1502781252888-9143ba7f074e?w=1200&q=80", alt: "Sonnenuntergang am See" }
];

/* =============================
   Firebase Setup
   ============================= */
let db = null;
let firebaseReady = false;
try {
  if (firebaseConfig.apiKey !== "PLACEHOLDER") {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    firebaseReady = true;
  } else {
    console.info("[Haus am See] Firebase noch nicht konfiguriert – Daten nur lokal.");
  }
} catch (e) {
  console.error("Firebase-Init fehlgeschlagen", e);
}

/* Lokaler Fallback (wenn Firebase nicht bereit) */
const localStore = {
  events: JSON.parse(localStorage.getItem("has_events") || "[]"),
  besuche: JSON.parse(localStorage.getItem("has_besuche") || "[]"),
  putzplan: JSON.parse(localStorage.getItem("has_putzplan") || "[]"),
  termine: JSON.parse(localStorage.getItem("has_termine") || "[]"),
  anwesenheit: JSON.parse(localStorage.getItem("has_anwesenheit") || "{}"),
  gaestebuch: JSON.parse(localStorage.getItem("has_gaestebuch") || "[]"),
};

function saveLocal(key, value) {
  localStorage.setItem(`has_${key}`, JSON.stringify(value));
}

/* =============================
   Helpers
   ============================= */
const $ = (id) => document.getElementById(id);
const fmtDate = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "long", year: "numeric" });
};
const fmtDateTime = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
};
const monthShort = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];

/* =============================
   Navigation (Mobile)
   ============================= */
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

/* =============================
   Lightbox
   ============================= */
const lightbox = $("lightbox");
const lightboxImg = $("lightboxImg");
document.querySelector(".lightbox-close")?.addEventListener("click", () => lightbox.close());
lightbox?.addEventListener("click", (e) => {
  if (e.target === lightbox) lightbox.close();
});

function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.showModal();
}

/* =============================
   Bewohner rendern
   ============================= */
function renderBewohner() {
  const grid = $("bewohnerGrid");
  grid.innerHTML = BEWOHNER.map(b => `
    <article class="bewohner-card">
      <div class="bewohner-avatar">${b.emoji}</div>
      <div class="bewohner-info">
        <h3>${b.name}</h3>
        <span class="bewohner-role">${b.role}</span>
        <p class="bewohner-bio">${b.bio}</p>
      </div>
    </article>
  `).join("");
  $("statBewohner").textContent = BEWOHNER.length;
}

/* =============================
   Galerie rendern
   ============================= */
function renderGallery() {
  const grid = $("gallery");
  grid.innerHTML = GALLERY_IMAGES.map(img => `
    <div class="gallery-item" data-src="${img.src.replace(/w=\d+/, 'w=1600')}">
      <img src="${img.src}" alt="${img.alt}" loading="lazy" />
    </div>
  `).join("");
  grid.querySelectorAll(".gallery-item").forEach(item => {
    item.addEventListener("click", () => openLightbox(item.dataset.src));
  });
}

/* =============================
   Events
   ============================= */
let eventsCache = [];

function renderEvents() {
  const list = $("eventsList");
  const upcoming = eventsCache
    .filter(e => new Date(e.date) >= new Date(new Date().setHours(0,0,0,0)))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) {
    list.innerHTML = `<div class="empty-state">Gerade kein Event geplant – aber das ändert sich schnell 🫖</div>`;
  } else {
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
            <button class="event-delete" data-id="${ev.id}">Löschen</button>
          </div>
        </article>
      `;
    }).join("");

    list.querySelectorAll(".rsvp-btn").forEach(btn => {
      btn.addEventListener("click", () => handleRsvp(btn.dataset.id, btn.dataset.vote));
    });
    list.querySelectorAll(".event-delete").forEach(btn => {
      btn.addEventListener("click", () => {
        if (confirm("Event wirklich löschen?")) deleteEvent(btn.dataset.id);
      });
    });
  }
  $("statEvents").textContent = upcoming.length;
}

async function handleRsvp(eventId, vote) {
  const previous = localStorage.getItem(`rsvp_${eventId}`);
  if (previous === vote) return;

  if (firebaseReady) {
    const updates = {};
    if (previous) updates[`rsvp.${previous}`] = increment(-1);
    updates[`rsvp.${vote}`] = increment(1);
    try {
      await updateDoc(doc(db, "events", eventId), updates);
    } catch (e) {
      console.error(e);
    }
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
    try { await deleteDoc(doc(db, "events", eventId)); } catch (e) { console.error(e); }
  } else {
    localStore.events = localStore.events.filter(e => e.id !== eventId);
    eventsCache = localStore.events;
    saveLocal("events", localStore.events);
    renderEvents();
  }
}

$("eventForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const entry = {
    title: $("evTitle").value.trim(),
    date: $("evDate").value,
    description: $("evDesc").value.trim(),
    location: $("evLocation").value.trim() || "Haus am See, Pfäffikon ZH",
    emoji: $("evEmoji").value.trim() || "🎉",
    rsvp: { yes: 0, no: 0 },
    createdAt: Date.now()
  };
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "events"), { ...entry, createdAt: serverTimestamp() });
    } catch (err) { alert("Speichern fehlgeschlagen: " + err.message); return; }
  } else {
    entry.id = "local_" + Date.now();
    localStore.events.push(entry);
    eventsCache = localStore.events;
    saveLocal("events", localStore.events);
    renderEvents();
  }
  e.target.reset();
  e.target.parentElement.open = false;
});

/* =============================
   Besuch / Übernachtungsanfragen
   ============================= */
$("besuchForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const entry = {
    name: $("bName").value.trim(),
    contact: $("bContact").value.trim(),
    from: $("bFrom").value,
    to: $("bTo").value,
    guests: parseInt($("bGuests").value, 10),
    message: $("bMessage").value.trim(),
    status: "new",
    createdAt: Date.now()
  };
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Sende…";
  if (firebaseReady) {
    try {
      await addDoc(collection(db, "besuche"), { ...entry, createdAt: serverTimestamp() });
    } catch (err) {
      alert("Speichern fehlgeschlagen: " + err.message);
      btn.disabled = false;
      btn.textContent = "Anfrage senden";
      return;
    }
  } else {
    localStore.besuche.push({ id: "local_" + Date.now(), ...entry });
    saveLocal("besuche", localStore.besuche);
  }
  btn.disabled = false;
  btn.textContent = "Anfrage senden";
  e.target.reset();
  alert("Danke! Wir melden uns zurück 🌿");
});

/* =============================
   Kalender-Tabs
   ============================= */
document.querySelectorAll(".kalender-tabs .tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".kalender-tabs .tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.querySelectorAll(".kalender-panel").forEach(p => p.classList.add("hidden"));
    $(`tab${tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)}`).classList.remove("hidden");
  });
});

/* =============================
   Putzplan
   ============================= */
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
      <div class="putz-actions">
        <button class="mini-btn" data-id="${p.id}" data-action="toggle">${p.done ? "↺ rückgängig" : "✓ erledigt"}</button>
        <button class="mini-btn" data-id="${p.id}" data-action="delete">Löschen</button>
      </div>
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
  const entry = {
    task: $("putzTask").value.trim(),
    who: $("putzWho").value.trim(),
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
});

/* =============================
   Termine
   ============================= */
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
  list.innerHTML = upcoming.map(t => `
    <div class="termin-item">
      <div class="termin-info">
        <strong>${escapeHtml(t.title)}</strong>
        <span>${fmtDateTime(t.date)}${t.note ? " · " + escapeHtml(t.note) : ""}</span>
      </div>
      <button class="mini-btn" data-id="${t.id}">Löschen</button>
    </div>
  `).join("");
  list.querySelectorAll(".mini-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteTermin(btn.dataset.id));
  });
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
}

$("termineForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const entry = {
    title: $("termTitle").value.trim(),
    date: $("termDate").value,
    note: $("termNote").value.trim(),
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
});

/* =============================
   Anwesenheit (Wochenende)
   ============================= */
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
    return `
      <div class="anwesend-card">
        <div class="anwesend-emoji">${b.emoji}</div>
        <strong>${b.name}</strong>
        <div class="anwesend-btn">
          <button data-name="${b.name}" data-status="da" class="${status==='da'?'active':''}">Da</button>
          <button data-name="${b.name}" data-status="weg" class="${status==='weg'?'active':''}">Weg</button>
        </div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll("button[data-status]").forEach(btn => {
    btn.addEventListener("click", () => setAnwesend(btn.dataset.name, btn.dataset.status));
  });
}

async function setAnwesend(name, status) {
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

/* =============================
   Gästebuch
   ============================= */
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
});

/* =============================
   Firebase Listeners (Live)
   ============================= */
function setupListeners() {
  if (!firebaseReady) {
    eventsCache = localStore.events;
    putzCache = localStore.putzplan;
    termineCache = localStore.termine;
    anwesendCache = localStore.anwesenheit;
    gbCache = localStore.gaestebuch;
    renderEvents();
    renderPutzplan();
    renderTermine();
    renderAnwesend();
    renderGaestebuch();
    return;
  }

  onSnapshot(query(collection(db, "events"), orderBy("createdAt", "desc")), (snap) => {
    eventsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEvents();
  });

  onSnapshot(query(collection(db, "putzplan"), orderBy("createdAt", "desc")), (snap) => {
    putzCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderPutzplan();
  });

  onSnapshot(query(collection(db, "termine"), orderBy("createdAt", "desc")), (snap) => {
    termineCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTermine();
  });

  onSnapshot(collection(db, "anwesenheit"), (snap) => {
    anwesendCache = {};
    snap.docs.forEach(d => { anwesendCache[d.id] = d.data(); });
    renderAnwesend();
  });

  onSnapshot(query(collection(db, "gaestebuch"), orderBy("createdAt", "desc")), (snap) => {
    gbCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGaestebuch();
  });
}

/* =============================
   Scroll-Animation (fade-up)
   ============================= */
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

/* =============================
   Helper: HTML Escape
   ============================= */
function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* =============================
   Init
   ============================= */
renderBewohner();
renderGallery();
setupScrollAnim();
setupListeners();
