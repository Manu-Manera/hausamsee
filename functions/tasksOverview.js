/**
 * Persönliche & WG-Aufgaben aus Firestore (Giessplan, Garten, Putz, Schäden, Erinnerungen).
 */

const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { buildSaturdayCalendarLinks } = require("./calendarIcs");

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function fmtWeekdayDate(d) {
  return new Date(d).toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function daysOverdue(dueDate) {
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  return Math.max(1, Math.ceil((today - due) / 86400000));
}

function daysUntil(dueDate) {
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  return Math.max(0, Math.ceil((due - today) / 86400000));
}

function giessNextDue(data) {
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

function giessDoneToday(data) {
  if (!data.lastWatered) return false;
  const today = startOfDay(new Date());
  const last = startOfDay(new Date(data.lastWatered));
  return last.getTime() === today.getTime();
}

function snapToGartenSaturdayDate(d) {
  const x = startOfDay(d instanceof Date ? d : new Date(d));
  const daysUntilSat = (6 - x.getDay() + 7) % 7;
  if (daysUntilSat > 0) x.setDate(x.getDate() + daysUntilSat);
  return x;
}

function gartenNextDue(data) {
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

function gartenDoneToday(data) {
  if (!data.lastDone) return false;
  const today = startOfDay(new Date());
  const next = gartenNextDue(data);
  if (next.getTime() > today.getTime()) return false;
  const last = startOfDay(new Date(data.lastDone));
  return last.getTime() === today.getTime();
}

function taskUrgency(dueDate, doneToday) {
  if (doneToday) return 9;
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  if (due < today) return 0;
  if (due.getTime() === today.getTime()) return 1;
  return 2 + daysUntil(due);
}

function formatWhenLine(dueDate, doneToday) {
  if (doneToday) return "heute erledigt ✅";
  const today = startOfDay(new Date());
  const due = startOfDay(dueDate);
  const label = fmtWeekdayDate(due);
  if (due < today) return `${label} · überfällig (${daysOverdue(due)} Tag${daysOverdue(due) > 1 ? "e" : ""})`;
  if (due.getTime() === today.getTime()) return `${label} · heute`;
  const d = daysUntil(due);
  return `${label} · in ${d} Tag${d > 1 ? "en" : ""}`;
}

function namesMatch(who, resident) {
  if (!who || !resident) return false;
  const w = String(who).toLowerCase().trim();
  const r = String(resident).toLowerCase().trim();
  return w === r || w.startsWith(r) || r.startsWith(w) || w.includes(r) || r.includes(w);
}

/**
 * @returns {{ scope: "mine" | "all" } | null}
 */
function parseMyTasksQuery(raw) {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  if (!s) return null;

  if (
    /^(meine\s+aufgaben|my\s+tasks|mes\s+taches)\s*[?.!]*$/i.test(s) ||
    /^(aufgaben|tasks|taches)\s*[?.!]*$/i.test(s) ||
    /^(was\s+steht\s+an|wer\s+muss\s+was)\s*[?.!]*$/i.test(s)
  ) {
    const scope = /^(aufgaben|was\s+steht\s+an|wer\s+muss\s+was)\s*[?.!]*$/i.test(s) ? "all" : "mine";
    return { scope: scope === "all" && !/\b(ich|meine|my|mes)\b/i.test(s) ? "all" : "mine" };
  }

  if (
    /\b(wann|was)\b.*\b(muss|soll|darf)\b.*\b(ich|mir)\b.*\b(machen|mach|tun|erledigen|giessen|gießen|putzen|gärtnern|gartnern|noch)\b/i.test(s) ||
    /\b(ich|mir)\b.*\b(muss|soll)\b.*\b(machen|mach|tun|erledigen|giessen|gießen|wieder)\b/i.test(s) ||
    /\b(nächste|naechste|next)\b.*\b(aufgabe|task|todo|pflicht|termin|mal)\b/i.test(s) ||
    /\bwann\s+muss\s+ich\b/i.test(s) ||
    /\bwas\s+steht\s+(bei\s+mir|für\s+mich)\s+an\b/i.test(s) ||
    /\bwhat\s+do\s+i\s+need\s+to\s+do\b/i.test(s) ||
    /\bquand\s+dois[- ]je\b/i.test(s)
  ) {
    return { scope: "mine" };
  }

  if (
    /\b(wer\s+muss|wer\s+ist\s+dran|aufgaben\s*übersicht|aufgaben\s*uebersicht|haus\s*aufgaben)\b/i.test(s)
  ) {
    return { scope: "all" };
  }

  return null;
}

function makeTask({ category, title, who, dueDate, doneToday, extra, icon }) {
  const urgency = taskUrgency(dueDate, doneToday);
  if (doneToday && urgency >= 9) return null;
  return {
    category,
    title,
    who: who || "",
    dueDate,
    urgency,
    line: `${icon || "•"} *${title}*${who && extra !== "hideWho" ? ` (${who})` : ""}\n   _${formatWhenLine(dueDate, doneToday)}_`,
  };
}

async function loadGiessTasks(db, resident, scope) {
  const snap = await db.collection("giessplan").get();
  const tasks = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d?.plant) return;
    if (scope === "mine" && !namesMatch(d.who, resident)) return;
    const due = giessNextDue(d);
    const done = giessDoneToday(d);
    const t = makeTask({
      category: "giess",
      title: d.plant,
      who: d.who,
      dueDate: due,
      doneToday: done,
      icon: "🌱",
      extra: scope === "mine" ? "hideWho" : undefined,
    });
    if (t) tasks.push(t);
  });
  return tasks;
}

async function loadGartenTasks(db, resident, scope) {
  const snap = await db.collection("gartentodos").get();
  const tasks = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d?.task) return;
    if (scope === "mine" && !namesMatch(d.who, resident)) return;
    const due = gartenNextDue(d);
    const done = gartenDoneToday(d);
    const t = makeTask({
      category: "garten",
      title: d.task,
      who: d.who,
      dueDate: due,
      doneToday: done,
      icon: "🌿",
      extra: scope === "mine" ? "hideWho" : undefined,
    });
    if (t) tasks.push(t);
  });
  return tasks;
}

async function loadPutzTasks(db, resident, scope) {
  const snap = await db.collection("putzplan").get();
  const today = startOfDay(new Date());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 21);
  const tasks = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d?.task || d.done) return;
    const when = d.when ? new Date(d.when) : null;
    if (!when || when < today || when > horizon) return;
    if (scope === "mine" && !namesMatch(d.who, resident)) return;
    const t = makeTask({
      category: "putz",
      title: d.task,
      who: d.who,
      dueDate: startOfDay(when),
      doneToday: false,
      icon: "🧹",
      extra: scope === "mine" ? "hideWho" : undefined,
    });
    if (t) tasks.push(t);
  });
  return tasks;
}

async function loadSchadenTasks(db, resident, scope) {
  const snap = await db.collection("schaeden").get();
  const tasks = [];
  const today = startOfDay(new Date());
  snap.forEach((doc) => {
    const d = doc.data();
    if (!d?.titel || d.status === "erledigt") return;
    if (scope === "mine" && !namesMatch(d.zustaendig, resident)) return;
    const prio = d.prio === "high" ? "⚠️" : d.prio === "low" ? "·" : "🔧";
    const due = today;
    tasks.push({
      category: "schaden",
      title: d.titel,
      who: d.zustaendig || "",
      dueDate: due,
      urgency: d.prio === "high" ? -1 : d.prio === "low" ? 3 : 0,
      line: `${prio} *${d.titel}*${d.ort ? ` (${d.ort})` : ""}${scope === "all" && d.zustaendig ? ` – ${d.zustaendig}` : ""}`,
    });
  });
  return tasks;
}

async function loadErinnerungTasks(db, from, resident, scope) {
  const normFrom = String(from || "").replace(/\D/g, "");
  const snap = await db.collection("erinnerungen").where("sent", "==", false).get();
  const tasks = [];
  const now = new Date();
  snap.forEach((doc) => {
    const d = doc.data();
    const whenRaw = d.when || d.date;
    if (!d?.text || !whenRaw) return;
    const when = new Date(whenRaw);
    if (Number.isNaN(when.getTime())) return;
    const owner = String(d.owner || "").replace(/\D/g, "");
    if (scope === "mine") {
      if (!normFrom) return;
      if (!owner || owner !== normFrom) return;
    }
    tasks.push({
      category: "erinnerung",
      title: d.text,
      who: "",
      dueDate: when,
      urgency: when <= now ? 0 : 2,
      line: `🔔 *${d.text}*\n   _${fmtDateTime(when)}_`,
    });
  });
  return tasks;
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency - b.urgency;
    return a.dueDate - b.dueDate;
  });
}

function groupLines(tasks) {
  const now = [];
  const soon = [];
  const schaden = [];
  const erinnerungen = [];

  for (const t of tasks) {
    if (t.category === "schaden") schaden.push(t.line);
    else if (t.category === "erinnerung") erinnerungen.push(t.line);
    else if (t.urgency <= 1) now.push(t.line);
    else soon.push(t.line);
  }

  const parts = [];
  if (now.length) parts.push(`🔥 *Jetzt / heute:*\n${now.join("\n")}`);
  if (soon.length) parts.push(`📅 *Demnächst:*\n${soon.join("\n")}`);
  if (schaden.length) parts.push(`🔧 *Offene Schäden:*\n${schaden.join("\n")}`);
  if (erinnerungen.length) parts.push(`🔔 *Erinnerungen:*\n${erinnerungen.join("\n")}`);
  return parts;
}

function buildWhatsAppReminderHint(nextTask, saturdayLabel) {
  const exampleTask = nextTask?.title || "Aufgaben";
  const when =
    saturdayLabel && nextTask?.category !== "erinnerung"
      ? `am ${saturdayLabel} um 10 Uhr`
      : "Samstag um 10 Uhr";
  return (
    `\n\n📱 *Soll ich dich hier auf WhatsApp erinnern?*\n` +
    `Schreib z. B.:\n*Erinner mich ${when} an: ${exampleTask}*`
  );
}

/**
 * @param {{ db: import('firebase-admin/firestore').Firestore, resident: string | null, from: string, scope: "mine" | "all" }} opts
 */
async function saveIcsCalendarToken(db, ics, meta) {
  const token = crypto.randomBytes(12).toString("hex");
  await db.collection("gustavCalendarLinks").doc(token).set({
    ics,
    resident: meta.resident || "",
    saturday: meta.saturday || "",
    createdAt: FieldValue.serverTimestamp(),
  });
  return token;
}

async function buildTasksOverviewReply(opts) {
  const { db, resident, from, scope } = opts;
  if (scope === "mine" && !resident) {
    return {
      text:
        "🤷 Dich konnte ich keiner Bewohner-Person zuordnen.\n\n" +
        "Schreib z. B. *Meine Aufgaben?* nachdem du auf der Website deine Nummer verknüpft hast – " +
        `oder frag *Wer putzt?* / *Aufgaben?* für die WG.\n\n🌐 ${WEBSITE_URL}/#kalender`,
      calendar: null,
    };
  }

  const [giess, garten, putz, schaden, erinnerungen] = await Promise.all([
    loadGiessTasks(db, resident, scope),
    loadGartenTasks(db, resident, scope),
    loadPutzTasks(db, resident, scope),
    loadSchadenTasks(db, resident, scope),
    loadErinnerungTasks(db, from, resident, scope),
  ]);

  const tasks = sortTasks([...giess, ...garten, ...putz, ...schaden, ...erinnerungen]);
  const title =
    scope === "all"
      ? "📋 *WG-Aufgaben* (Giessplan · Garten · Putz · Schäden)"
      : `📋 *Deine Aufgaben${resident ? ` – ${resident}` : ""}*`;

  if (!tasks.length) {
    const reminderHint =
      scope === "mine" ? buildWhatsAppReminderHint(null, null) : "";
    return {
      text: `${title}\n\n✨ Aktuell nichts Fälliges – du bist frei! 🎉${reminderHint}\n\n🌐 ${WEBSITE_URL}/#kalender`,
      calendar: null,
    };
  }

  const sections = groupLines(tasks);
  const next = tasks.find((t) => t.category !== "schaden" && t.category !== "erinnerung");
  let headline = "";
  if (next && scope === "mine") {
    headline = `\n⏭️ *Als Nächstes:* ${next.title} – ${formatWhenLine(next.dueDate, false)}\n`;
  }

  let calendar = null;
  if (scope === "mine" && resident) {
    const cal = buildSaturdayCalendarLinks({
      resident,
      tasks: tasks.map((t) => ({ title: t.title, category: t.category })),
    });
    const token = await saveIcsCalendarToken(db, cal.ics, {
      resident,
      saturday: cal.saturday.toISOString().slice(0, 10),
    });
    const icsBase = (process.env.GUSTAV_CALENDAR_URL || "").replace(/\/$/, "");
    calendar = {
      label: cal.label,
      saturday: cal.saturday.toISOString(),
      googleUrl: cal.googleUrl,
      icsUrl: icsBase ? `${icsBase}?token=${token}` : null,
    };
  }

  const reminderHint =
    scope === "mine" ? buildWhatsAppReminderHint(next, calendar?.label || null) : "";

  return {
    text: `${title}${headline}\n${sections.join("\n\n")}${reminderHint}\n\n🌐 ${WEBSITE_URL}/#kalender`,
    calendar,
    remind:
      scope === "mine" && next && calendar?.saturday
        ? { taskTitle: next.title, saturday: calendar.saturday }
        : null,
  };
}

module.exports = {
  parseMyTasksQuery,
  buildTasksOverviewReply,
};
