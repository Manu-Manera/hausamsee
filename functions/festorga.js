/**
 * Festorga – wiederverwendbares Framework für WG-Feste & Partys.
 *
 * Firestore:
 *   festorga/{id}       – ein Fest/Party (beliebig viele, Status draft|active|archived)
 *   festorgaTasks/{id}  – Aufgaben mit Assignees, Deadline, Reminder-Tagen, Kategorie
 *
 * Gustav: Festorga · Festorga [Festname] · Festorga Aufgabe: … · …
 */

const { FieldValue } = require("firebase-admin/firestore");

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";
const EVENTS_URL = `${WEBSITE_URL}/#events`;
const FESTORGA_URL = `${WEBSITE_URL}/#festorga`;

/** Standard-Erinnerungstage vor Deadline (pro Aufgabe überschreibbar) */
const DEFAULT_REMIND_DAYS = [7, 3, 1];

const FOOD_MODES = {
  potluck: "Mitbring-Buffet",
  catered: "Organisiertes Essen",
  mixed: "Gemischt",
  none: "Kein Fokus Essen",
};

const TASK_CATEGORIES = {
  musik: "Musik",
  gaeste: "Gäste / Promo",
  deko: "Dekoration",
  bar: "Bar / Getränke",
  essen: "Essen / Grill",
  location: "Ort / Setup",
  cleanup: "Aufräumen",
  other: "Sonstiges",
};

/**
 * Vorlagen – beim Anlegen eines Fests auswählbar.
 * Assignees absichtlich leer: pro Fest neu verteilen.
 */
const FEST_TEMPLATES = {
  blank: {
    id: "blank",
    label: "Leer (nur Rahmen)",
    foodMode: "none",
    notes: "",
    tasks: [],
  },
  grillfest: {
    id: "grillfest",
    label: "Grillfest / Sommerparty",
    foodMode: "potluck",
    notes:
      "Jeder Gast bringt etwas mit. Kontingent & Gästeliste absprechen. Eine Person übernimmt den Grill.",
    tasks: [
      { title: "Musik / Sound", category: "musik", description: "Playlist, Band oder DJ", sort: 10, daysBeforeFest: 1 },
      { title: "Gästeliste / Promo / Einladung", category: "gaeste", description: "Einladen, Kontingent im Blick", sort: 20, daysBeforeFest: 5 },
      { title: "Dekoration / Gestaltung", category: "deko", description: "Ambiente & Deko", sort: 30, daysBeforeFest: 1 },
      { title: "Bar / Getränke", category: "bar", description: "Getränke & Bar vorbereiten", sort: 40, daysBeforeFest: 1 },
      { title: "Grill", category: "essen", description: "Grill, Würste, Gemüse, Fleisch", sort: 50, daysBeforeFest: 1 },
      { title: "Mitbring-Liste pushen", category: "essen", description: "Website → Wer bringt was", sort: 60, daysBeforeFest: 3 },
    ],
  },
  indoor: {
    id: "indoor",
    label: "Indoor-Party",
    foodMode: "mixed",
    notes: "Snacks/Getränke organisieren, Lautstärke & Nachbarn im Blick.",
    tasks: [
      { title: "Musik / Playlist", category: "musik", sort: 10, daysBeforeFest: 1 },
      { title: "Einladungen / Gästeliste", category: "gaeste", sort: 20, daysBeforeFest: 5 },
      { title: "Raum / Setup", category: "location", sort: 30, daysBeforeFest: 1 },
      { title: "Deko", category: "deko", sort: 40, daysBeforeFest: 1 },
      { title: "Getränke", category: "bar", sort: 50, daysBeforeFest: 1 },
      { title: "Snacks / Essen", category: "essen", sort: 60, daysBeforeFest: 1 },
      { title: "Aufräumen am nächsten Tag", category: "cleanup", sort: 70, daysBeforeFest: 0 },
    ],
  },
  brunch: {
    id: "brunch",
    label: "Brunch / Tagesfest",
    foodMode: "potluck",
    notes: "Mitbring-Brunch: Salate, Gebäck, Obst. Kaffee/Tee + Sekt optional.",
    tasks: [
      { title: "Einladungen", category: "gaeste", sort: 10, daysBeforeFest: 5 },
      { title: "Tisch / Deko", category: "deko", sort: 20, daysBeforeFest: 1 },
      { title: "Getränke (Kaffee, Saft, …)", category: "bar", sort: 30, daysBeforeFest: 1 },
      { title: "Warmhaltendes / Hauptstück", category: "essen", sort: 40, daysBeforeFest: 1 },
      { title: "Mitbring-Liste koordinieren", category: "essen", sort: 50, daysBeforeFest: 3 },
      { title: "Aufräumen", category: "cleanup", sort: 60, daysBeforeFest: 0 },
    ],
  },
  winter: {
    id: "winter",
    label: "Winterfest / Fondue",
    foodMode: "mixed",
    notes: "Fondue/Raclette oder warmes Buffet. Glühwein/Punsch optional.",
    tasks: [
      { title: "Einladungen", category: "gaeste", sort: 10, daysBeforeFest: 7 },
      { title: "Deko / Lichter", category: "deko", sort: 20, daysBeforeFest: 1 },
      { title: "Getränke", category: "bar", sort: 30, daysBeforeFest: 1 },
      { title: "Fondue / Hauptessen", category: "essen", sort: 40, daysBeforeFest: 1 },
      { title: "Musik", category: "musik", sort: 50, daysBeforeFest: 1 },
      { title: "Aufräumen", category: "cleanup", sort: 60, daysBeforeFest: 0 },
    ],
  },
};

/** Historisches Sommerfest 2026 – nur einmal seeden, wenn noch nichts existiert */
const SOMMERFEST_SEED = {
  title: "Sommerfest",
  date: "2026-08-15",
  status: "active",
  maxGuestsTotal: 70,
  maxGuestsPerPerson: 10,
  foodMode: "potluck",
  templateId: "grillfest",
  location: "Haus am See",
  remindDaysBefore: DEFAULT_REMIND_DAYS,
  notes:
    "Jeder Gast bringt etwas mit (Salate, Brot, Obst/Dessert). Eine WG-Person übernimmt den Grill. Kontingent: max. 10 Gäste pro Bewohner:in, max. 70 total. Corina schreibt Bierkastelauf-Leute an.",
};

const SOMMERFEST_TASKS = [
  { title: "Musik / Band", category: "musik", assignees: ["Andi"], description: "Stimmung & Sound mit der Band", sort: 10, dueDate: "2026-08-14" },
  { title: "Gästeliste / Promo / Einladung", category: "gaeste", assignees: ["Corina"], description: "Bierkastelauf + Rest auffüllen, Einladungen", sort: 20, dueDate: "2026-08-10" },
  { title: "Dekoration / Gestaltung", category: "deko", assignees: ["Jasmin"], description: "Dekoration & Ambiente", sort: 30, dueDate: "2026-08-14" },
  { title: "Bar / Getränke", category: "bar", assignees: ["Manu", "Dino"], description: "Getränke & Bar vorbereiten", sort: 40, dueDate: "2026-08-14" },
  { title: "Grill", category: "essen", assignees: ["Fannie", "Hugues"], description: "Grill mit Würsten, Gemüse, Fleisch etc.", sort: 50, dueDate: "2026-08-14" },
  { title: "Mitbring-Liste pushen", category: "essen", assignees: ["Dino"], description: "Alle erinnern: Website → Wer bringt was", sort: 60, dueDate: "2026-08-12" },
];

const SHARE_LANG = {
  Corina: "ch",
  Jasmin: "ch",
  Dino: "ch",
  Andi: "de",
  Manu: "de",
  Hugues: "de",
  Fannie: "fr",
};

function addDaysToYmd(ymd, delta) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dueFromFestDate(festDate, daysBeforeFest) {
  if (!festDate || daysBeforeFest == null) return null;
  return addDaysToYmd(festDate, -Number(daysBeforeFest));
}

function formatShortDate(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${Number(d)}.${Number(m)}.`;
}

function buildShareMessage(fest, name, lang = "de") {
  const title = fest.title || "Fest";
  const dateStr = formatShortDate(fest.date);
  const datePart = dateStr ? ` (${dateStr})` : "";
  const custom = String(fest.shareMessage || "").trim();
  if (custom) {
    return custom
      .replaceAll("{name}", name)
      .replaceAll("{title}", title)
      .replaceAll("{date}", dateStr)
      .replaceAll("{eventsUrl}", EVENTS_URL)
      .replaceAll("{festorgaUrl}", FESTORGA_URL);
  }

  if (lang === "ch") {
    return (
      `🦆 *Gustav · ${title}*\n\n` +
      `Hoi ${name}! ☀️ S *${title}*${datePart} rückt näher.\n\n` +
      `Bitte *teil d Website* mit dim Link und lad dini Fründe ii:\n` +
      `👉 ${EVENTS_URL}\n\n` +
      (fest.foodMode === "potluck" ? `Dort chönd si sich ahmälde und bi *«Wer bringt was»* ischriibe.\n\n` : `\n`) +
      `📋 Festorga (wer macht was): ${FESTORGA_URL}\n` +
      `(WG-Intern → Festorga – nach Login)\n\n` +
      `Merci! 🎉`
    );
  }
  if (lang === "fr") {
    return (
      `🦆 *Gustav · ${title}*\n\n` +
      `Salut ${name}! ☀️ *${title}*${datePart} approche.\n\n` +
      `Merci de *partager le site* avec le lien et d'inviter tes ami·es :\n` +
      `👉 ${EVENTS_URL}\n\n` +
      (fest.foodMode === "potluck" ? `Ils peuvent s'inscrire et indiquer ce qu'ils apportent (*« Wer bringt was »*).\n\n` : `\n`) +
      `📋 Organisation : ${FESTORGA_URL}\n` +
      `(WG-Intern → Festorga – après login)\n\n` +
      `Merci ! 🎉`
    );
  }
  return (
    `🦆 *Gustav · ${title}*\n\n` +
    `Hallo ${name}! ☀️ Das *${title}*${datePart} rückt näher.\n\n` +
    `Bitte *teile die Website* mit dem Link und lade deine Freunde ein:\n` +
    `👉 ${EVENTS_URL}\n\n` +
    (fest.foodMode === "potluck" ? `Dort können sie sich anmelden und unter *«Wer bringt was»* eintragen.\n\n` : `\n`) +
    `📋 Festorga (wer macht was): ${FESTORGA_URL}\n` +
    `(WG-Intern → Festorga – nach Login)\n\n` +
    `Danke! 🎉`
  );
}

function taskPayloadFromTemplate(festId, t, festDate, remindDays) {
  return {
    festId,
    title: t.title,
    description: t.description || "",
    category: t.category || "other",
    assignees: Array.isArray(t.assignees) ? t.assignees : [],
    dueDate: t.dueDate || dueFromFestDate(festDate, t.daysBeforeFest) || null,
    dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    status: "open",
    sort: t.sort || 100,
    remindDaysBefore: Array.isArray(t.remindDaysBefore) ? t.remindDaysBefore : remindDays,
    lastReminderAt: null,
    lastReminderDayKey: null,
    createdAt: FieldValue.serverTimestamp(),
  };
}

async function createFestFromTemplate(db, {
  title,
  date = null,
  templateId = "blank",
  status = "draft",
  createdBy = "web",
  extras = {},
} = {}) {
  const tpl = FEST_TEMPLATES[templateId] || FEST_TEMPLATES.blank;
  const remindDays = Array.isArray(extras.remindDaysBefore) ? extras.remindDaysBefore : DEFAULT_REMIND_DAYS;
  const fest = {
    title: String(title || tpl.label || "Neues Fest").trim(),
    date: date || null,
    status,
    foodMode: extras.foodMode || tpl.foodMode || "none",
    maxGuestsTotal: extras.maxGuestsTotal ?? null,
    maxGuestsPerPerson: extras.maxGuestsPerPerson ?? null,
    location: extras.location || "",
    notes: extras.notes != null ? extras.notes : tpl.notes || "",
    shareMessage: extras.shareMessage || "",
    templateId: tpl.id,
    remindDaysBefore: remindDays,
    eventTitleHint: extras.eventTitleHint || "",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy,
  };
  const ref = await db.collection("festorga").add(fest);
  if (tpl.tasks?.length) {
    const batch = db.batch();
    for (const t of tpl.tasks) {
      const tr = db.collection("festorgaTasks").doc();
      batch.set(tr, taskPayloadFromTemplate(ref.id, t, date, remindDays));
    }
    await batch.commit();
  }
  return { id: ref.id, created: true, templateId: tpl.id };
}

async function ensureSommerfestSeed(db) {
  const any = await db.collection("festorga").limit(1).get();
  if (!any.empty) {
    const existing = await db.collection("festorga").where("title", "==", "Sommerfest").limit(1).get();
    if (!existing.empty) return { id: existing.docs[0].id, created: false };
    return { id: any.docs[0].id, created: false };
  }
  const ref = await db.collection("festorga").add({
    ...SOMMERFEST_SEED,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdBy: "gustav-seed",
  });
  const batch = db.batch();
  for (const t of SOMMERFEST_TASKS) {
    const tr = db.collection("festorgaTasks").doc();
    batch.set(tr, {
      festId: ref.id,
      title: t.title,
      description: t.description || "",
      category: t.category || "other",
      assignees: t.assignees || [],
      dueDate: t.dueDate || null,
      dependsOn: [],
      subtasks: [],
      status: "open",
      sort: t.sort || 100,
      remindDaysBefore: DEFAULT_REMIND_DAYS,
      lastReminderAt: null,
      lastReminderDayKey: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { id: ref.id, created: true };
}

async function loadFestById(db, festId) {
  if (!festId) return null;
  const snap = await db.collection("festorga").doc(festId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function loadActiveFest(db, titleHint = null) {
  let snap = await db.collection("festorga").where("status", "==", "active").get();
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  if (titleHint) {
    const h = String(titleHint).toLowerCase();
    const hit = docs.find((f) => String(f.title || "").toLowerCase().includes(h));
    if (hit) return hit;
  }
  if (docs.length) return docs[0];

  // Drafts / archived als Fallback nur mit Hint
  if (titleHint) {
    snap = await db.collection("festorga").get();
    docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const h = String(titleHint).toLowerCase();
    return docs.find((f) => String(f.title || "").toLowerCase().includes(h)) || null;
  }
  return null;
}

async function listFests(db) {
  const snap = await db.collection("festorga").get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const rank = { active: 0, draft: 1, archived: 2 };
      const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      if (r !== 0) return r;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
}

async function loadFestTasks(db, festId) {
  const snap = await db.collection("festorgaTasks").where("festId", "==", festId).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.sort || 100) - (b.sort || 100) || String(a.title).localeCompare(String(b.title)));
}

function findTaskByHint(tasks, hint) {
  const h = String(hint || "").toLowerCase().trim();
  if (!h) return null;
  return (
    tasks.find((t) => String(t.title || "").toLowerCase() === h) ||
    tasks.find((t) => String(t.title || "").toLowerCase().includes(h)) ||
    null
  );
}

function findFestByHint(fests, hint) {
  const h = String(hint || "").toLowerCase().trim();
  if (!h) return null;
  return (
    fests.find((f) => String(f.title || "").toLowerCase() === h) ||
    fests.find((f) => String(f.title || "").toLowerCase().includes(h)) ||
    null
  );
}

/**
 * Befehle:
 *   Festorga
 *   Festorga Liste
 *   Festorga Feste
 *   Festorga Sommerfest
 *   Meine Festorga
 *   Festorga Aufgabe: Deko
 *   Festorga erledigt: Musik
 *   Festorga offen: Musik
 *   Festorga Aufgabe Sommerfest: Deko
 */
function parseFestorgaCommand(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  if (/^festorga\s+feste\s*[?.!]?\s*$/i.test(s) || /^feste\s+orga\s*[?.!]?\s*$/i.test(s)) {
    return { action: "fests" };
  }
  if (/^meine\s+festorga(?:\s+(.+))?\s*[?.!]?\s*$/i.test(s)) {
    const m = s.match(/^meine\s+festorga(?:\s+(.+))?\s*[?.!]?\s*$/i);
    return { action: "mine", festHint: (m[1] || "").trim() || null };
  }
  if (/^festorga\s*(status|liste)?\s*[?.!]?\s*$/i.test(s) || /^fest\s*orga\s*$/i.test(s)) {
    return { action: "list", festHint: null };
  }

  let m = s.match(/^festorga\s+(?:aufgabe|task)\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "claim", festHint: m[1].trim(), titleHint: m[2].trim() };
  m = s.match(/^festorga\s+(?:erledigt|done)\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "done", festHint: m[1].trim(), titleHint: m[2].trim() };
  m = s.match(/^festorga\s+(?:offen|open)\s+(.+?)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "reopen", festHint: m[1].trim(), titleHint: m[2].trim() };

  m = s.match(/^festorga\s+(?:aufgabe|task)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "claim", festHint: null, titleHint: m[1].trim() };
  m = s.match(/^festorga\s+(?:erledigt|done)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "done", festHint: null, titleHint: m[1].trim() };
  m = s.match(/^festorga\s+(?:offen|open)\s*[:\-–]\s*(.+)$/i);
  if (m) return { action: "reopen", festHint: null, titleHint: m[1].trim() };

  m = s.match(/^festorga\s+(?:liste|status)\s+(.+)$/i);
  if (m) return { action: "list", festHint: m[1].trim() };
  m = s.match(/^festorga\s+(.+)$/i);
  if (m) {
    const rest = m[1].trim();
    if (!/^(aufgabe|task|erledigt|done|offen|open|feste)/i.test(rest)) {
      return { action: "list", festHint: rest };
    }
  }
  return null;
}

function daysUntilDate(ymd, tz = "Europe/Zurich") {
  if (!ymd) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const a = new Date(`${today}T12:00:00Z`);
  const b = new Date(`${ymd}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function formatFestorgaList(fest, tasks) {
  const food = FOOD_MODES[fest.foodMode] || fest.foodMode || null;
  const lines = [
    `🎉 *Festorga · ${fest.title}*`,
    fest.status && fest.status !== "active" ? `📌 Status: ${fest.status}` : null,
    fest.date ? `📅 ${fest.date}` : null,
    fest.location ? `📍 ${fest.location}` : null,
    food ? `🥗 Essen: ${food}${fest.foodMode === "potluck" ? ` → ${EVENTS_URL}` : ""}` : null,
    fest.maxGuestsPerPerson || fest.maxGuestsTotal
      ? `👥 ${fest.maxGuestsPerPerson ? `max. ${fest.maxGuestsPerPerson}/Person` : ""}${fest.maxGuestsPerPerson && fest.maxGuestsTotal ? " · " : ""}${fest.maxGuestsTotal ? `${fest.maxGuestsTotal} total` : ""}`
      : null,
    (() => {
      const budget = Number(fest.budget);
      if (!Number.isFinite(budget)) return null;
      const spent = tasks.reduce((s, t) => s + (Number(t.cost) > 0 ? Number(t.cost) : 0), 0);
      const cur = fest.currency || "CHF";
      const rest = Math.round((budget - spent) * 100) / 100;
      return `💰 Budget: ${spent.toFixed(2)} / ${budget.toFixed(2)} ${cur} (Rest ${rest.toFixed(2)})`;
    })(),
    "",
  ].filter((x) => x !== null);

  if (!tasks.length) {
    lines.push("_Noch keine Aufgaben._");
  } else {
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    for (const t of tasks) {
      const who = (t.assignees || []).length ? t.assignees.join(", ") : "offen";
      const due = t.dueDate ? ` · bis ${t.dueDate}` : "";
      const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      const blocked = t.status !== "done" && deps.some((id) => byId[id] && byId[id].status !== "done");
      const mark = t.status === "done" ? "✅" : blocked ? "⏳" : "⬜";
      const cat = t.category && TASK_CATEGORIES[t.category] ? ` [${TASK_CATEGORIES[t.category]}]` : "";
      const costN = Number(t.cost);
      const costBit = Number.isFinite(costN) && costN > 0 ? ` · ${costN.toFixed(2)} ${fest.currency || "CHF"}` : "";
      const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
      const subDone = subs.filter((s) => s && s.done).length;
      const subBit = subs.length ? ` · Checklist ${subDone}/${subs.length}` : "";
      lines.push(`${mark} *${t.title}*${cat} — ${who}${due}${costBit}${subBit}`);
      if (blocked) {
        const wait = deps
          .map((id) => byId[id])
          .filter((d) => d && d.status !== "done")
          .map((d) => d.title);
        if (wait.length) lines.push(`   ↳ wartet auf: ${wait.join(", ")}`);
      }
      for (const s of subs.slice(0, 8)) {
        if (!s || !s.title) continue;
        lines.push(`   ${s.done ? "✅" : "▫️"} ${s.title}${s.dueDate ? ` (${s.dueDate})` : ""}`);
      }
      if (subs.length > 8) lines.push(`   _… +${subs.length - 8} weitere_`);
    }
  }
  lines.push(
    "",
    `_Website:_ ${FESTORGA_URL}`,
    `_Befehle:_ Festorga · Festorga Feste · Festorga ${fest.title} · Festorga Aufgabe: … · Festorga erledigt: …`
  );
  return lines.join("\n");
}

function formatFestList(fests) {
  if (!fests.length) return "🎉 Noch keine Feste in der Festorga. Auf der Website anlegen.";
  const lines = ["🎉 *Festorga · alle Feste*", ""];
  for (const f of fests) {
    const mark = f.status === "active" ? "🟢" : f.status === "draft" ? "🟡" : "⚪";
    lines.push(`${mark} *${f.title}*${f.date ? ` · ${f.date}` : ""} (${f.status || "?"})`);
  }
  lines.push("", `_Details:_ «Festorga Sommerfest» (Name anpassen)`, `_Website:_ ${FESTORGA_URL}`);
  return lines.join("\n");
}

async function sendFestShareAnnounce({
  db,
  getBewohnerPhone,
  sendWhatsApp,
  logger,
  onlyName = null,
  festId = null,
  festHint = null,
} = {}) {
  if (!db) return { sent: 0, total: 0, results: [], error: "db fehlt" };
  let fest = festId ? await loadFestById(db, festId) : null;
  if (!fest) fest = await loadActiveFest(db, festHint || null);
  if (!fest) {
    const all = await listFests(db);
    fest = all[0] || null;
  }
  if (!fest) return { sent: 0, total: 0, results: [], error: "kein Fest gefunden" };

  const names = Object.keys(SHARE_LANG);
  const list = onlyName ? names.filter((n) => n === onlyName) : names;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];

  for (const name of list) {
    const phone = await getBewohnerPhone(name);
    if (!phone) {
      results.push({ name, ok: false, error: "keine Telefonnummer" });
      continue;
    }
    try {
      const msg = buildShareMessage(fest, name, SHARE_LANG[name] || "de");
      const ok = await sendWhatsApp(phone, msg);
      results.push({ name, ok: !!ok, phone: phone.slice(-4) });
      if (!ok) results[results.length - 1].error = "Versand fehlgeschlagen";
      await delay(1200);
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }
  const sent = results.filter((x) => x.ok).length;
  logger.info(`Fest-Share-Announce (${fest.title}): ${sent}/${results.length}`, { results });
  return { sent, total: results.length, results, festId: fest.id, festTitle: fest.title };
}

/** Rückwärtskompatibel: aktives Sommerfest oder erstes aktives Fest */
async function sendSommerfestShareAnnounce(opts = {}) {
  return sendFestShareAnnounce({ ...opts, festHint: opts.festHint || "Sommerfest" });
}

async function processFestorgaReminders(db, { getBewohnerPhone, sendWhatsApp, logger }) {
  const festSnap = await db.collection("festorga").where("status", "==", "active").get();
  let sent = 0;
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  async function pingAssignees(names, text) {
    let n = 0;
    for (const name of names) {
      const phone = await getBewohnerPhone(name);
      if (!phone) {
        logger.warn("Festorga-Reminder: keine Nummer", { name });
        continue;
      }
      const ok = await sendWhatsApp(phone, text);
      if (ok) n += 1;
      await new Promise((r) => setTimeout(r, 800));
    }
    return n;
  }

  for (const festDoc of festSnap.docs) {
    const fest = { id: festDoc.id, ...festDoc.data() };
    const festDefaults = Array.isArray(fest.remindDaysBefore) && fest.remindDaysBefore.length
      ? fest.remindDaysBefore.map(Number)
      : DEFAULT_REMIND_DAYS;
    const tasks = await loadFestTasks(db, fest.id);
    for (const t of tasks) {
      if (t.status === "done") continue;
      const assignees = t.assignees || [];
      const remindDaysTask = Array.isArray(t.remindDaysBefore) && t.remindDaysBefore.length
        ? t.remindDaysBefore.map(Number)
        : festDefaults;

      if (t.dueDate && assignees.length) {
        const days = daysUntilDate(t.dueDate);
        if (days !== null && days >= 0 && remindDaysTask.includes(days)) {
          const dayKey = `${todayKey}:${days}`;
          if (t.lastReminderDayKey !== dayKey) {
            const when = days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;
            const openSubs = (Array.isArray(t.subtasks) ? t.subtasks : []).filter((s) => s && !s.done);
            const checklist = openSubs.length
              ? `\nChecklist offen:\n${openSubs.slice(0, 6).map((s) => `▫️ ${s.title}`).join("\n")}\n`
              : "";
            const text =
              `🎉 *Festorga-Erinnerung · ${fest.title}*\n\n` +
              `⬜ *${t.title}* ist ${when} fällig (${t.dueDate}).\n` +
              (t.description ? `${t.description}\n` : "") +
              checklist +
              `\n👉 ${FESTORGA_URL}\n` +
              `_Erledigt?_ «Festorga erledigt: ${t.title}»`;
            sent += await pingAssignees(assignees, text);
            await db.collection("festorgaTasks").doc(t.id).update({
              lastReminderAt: FieldValue.serverTimestamp(),
              lastReminderDayKey: dayKey,
            });
          }
        }
      }

      // Unteraufgaben mit eigener Fälligkeit
      const subs = Array.isArray(t.subtasks) ? [...t.subtasks] : [];
      let subsChanged = false;
      for (let i = 0; i < subs.length; i++) {
        const s = subs[i];
        if (!s || s.done || !s.dueDate || !assignees.length) continue;
        const days = daysUntilDate(s.dueDate);
        if (days === null || days < 0) continue;
        const remindDays = Array.isArray(s.remindDaysBefore) && s.remindDaysBefore.length
          ? s.remindDaysBefore.map(Number)
          : remindDaysTask;
        if (!remindDays.includes(days)) continue;
        const dayKey = `${todayKey}:sub:${s.id || i}:${days}`;
        if (s.lastReminderDayKey === dayKey) continue;
        const when = days === 0 ? "heute" : days === 1 ? "morgen" : `in ${days} Tagen`;
        const text =
          `🎉 *Festorga-Checklist · ${fest.title}*\n\n` +
          `▫️ *${s.title}* (${t.title}) ist ${when} fällig (${s.dueDate}).\n` +
          `\n👉 ${FESTORGA_URL}`;
        sent += await pingAssignees(assignees, text);
        subs[i] = { ...s, lastReminderDayKey: dayKey };
        subsChanged = true;
      }
      if (subsChanged) {
        await db.collection("festorgaTasks").doc(t.id).update({
          subtasks: subs,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  }
  if (sent) logger.info(`Festorga-Reminders gesendet: ${sent}`);
  return { sent };
}

module.exports = {
  WEBSITE_URL,
  EVENTS_URL,
  FESTORGA_URL,
  DEFAULT_REMIND_DAYS,
  FOOD_MODES,
  TASK_CATEGORIES,
  FEST_TEMPLATES,
  SOMMERFEST_SEED,
  SOMMERFEST_TASKS,
  ensureSommerfestSeed,
  createFestFromTemplate,
  sendFestShareAnnounce,
  sendSommerfestShareAnnounce,
  parseFestorgaCommand,
  formatFestorgaList,
  formatFestList,
  loadActiveFest,
  loadFestById,
  listFests,
  loadFestTasks,
  findTaskByHint,
  findFestByHint,
  processFestorgaReminders,
  daysUntilDate,
  dueFromFestDate,
  buildShareMessage,
};
