/**
 * Kalender-Links & ICS für Gustav-Aufgaben (kommender Samstag).
 */

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";
const LOCATION = "Haus am See, Pilatusstrasse 40, Pfäffikon ZH";
const WORK_HOUR = 10;
const WORK_MINUTE = 0;
const WORK_DURATION_MIN = 60;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Nächster Samstag (heute Samstag = heute). */
function nextSaturday(fromDate = new Date()) {
  const d = startOfDay(fromDate);
  const daysUntil = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + daysUntil);
  return d;
}

function zurichWallToUtcDate(y, m, day, h, min) {
  let guess = Date.UTC(y, m - 1, day, h, min, 0);
  for (let i = 0; i < 20; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const p = (t) => +parts.find((x) => x.type === t).value;
    const Y = p("year");
    const M = p("month");
    const D = p("day");
    const H = p("hour");
    const Mi = p("minute");
    if (Y === y && M === m && D === day && H === h && Mi === min) {
      return new Date(guess);
    }
    guess += (h * 60 + min - (H * 60 + Mi)) * 60 * 1000;
  }
  return new Date(guess);
}

function toIcsDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function toGoogleCalLocal(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const p = (t) => parts.find((x) => x.type === t).value;
  return `${p("year")}${p("month")}${p("day")}T${p("hour")}${p("minute")}00`;
}

function icsEscape(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldIcsLine(line) {
  const max = 75;
  if (line.length <= max) return line;
  let out = line.slice(0, max);
  let rest = line.slice(max);
  while (rest.length) {
    out += `\r\n ${rest.slice(0, max - 1)}`;
    rest = rest.slice(max - 1);
  }
  return out;
}

function fmtWeekdayDate(d) {
  return d.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function saturdayEventTimes(saturday) {
  const y = saturday.getFullYear();
  const m = saturday.getMonth() + 1;
  const day = saturday.getDate();
  const start = zurichWallToUtcDate(y, m, day, WORK_HOUR, WORK_MINUTE);
  const endMin = WORK_MINUTE + WORK_DURATION_MIN;
  const end = zurichWallToUtcDate(y, m, day, WORK_HOUR + Math.floor(endMin / 60), endMin % 60);
  return { start, end };
}

function buildTaskDescriptions(tasks) {
  const lines = [];
  for (const t of tasks || []) {
    const icon =
      t.category === "giess" ? "🌱" :
      t.category === "garten" ? "🌿" :
      t.category === "putz" ? "🧹" :
      t.category === "schaden" ? "🔧" :
      t.category === "erinnerung" ? "🔔" : "•";
    lines.push(`${icon} ${t.title}`);
  }
  return lines.join("\n");
}

function buildGoogleCalendarUrl({ title, saturday, details }) {
  const { start, end } = saturdayEventTimes(saturday);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGoogleCalLocal(start)}/${toGoogleCalLocal(end)}`,
    details: details || "",
    location: LOCATION,
    ctz: "Europe/Zurich",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildTasksSaturdayIcs({ resident, saturday, tasks }) {
  const { start, end } = saturdayEventTimes(saturday);
  const now = new Date();
  const summary = `📋 Haus am See – Aufgaben ${resident || ""}`.trim();
  const desc = [
    `Aufgaben für ${resident || "WG"}:`,
    buildTaskDescriptions(tasks),
    "",
    WEBSITE_URL + "/#kalender",
  ].join("\n");
  const uid = `gustav-tasks-${resident || "wg"}-${toIcsDate(saturday).slice(0, 8)}@hausamsee`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Haus am See//Gustav Aufgaben//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(now)}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    foldIcsLine(`SUMMARY:${icsEscape(summary)}`),
    foldIcsLine(`LOCATION:${icsEscape(LOCATION)}`),
    foldIcsLine(`DESCRIPTION:${icsEscape(desc)}`),
    foldIcsLine(`URL:${WEBSITE_URL}/#kalender`),
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    foldIcsLine(`DESCRIPTION:${icsEscape(`Morgen: ${summary}`)}`),
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

/**
 * @param {{ resident: string, tasks: Array<{title:string,category:string}>, saturday?: Date }} opts
 */
function buildSaturdayCalendarLinks(opts) {
  const saturday = opts.saturday || nextSaturday();
  const resident = opts.resident || "WG";
  const tasks = opts.tasks || [];
  const title = `Haus am See – Aufgaben ${resident}`;
  const details = buildTaskDescriptions(tasks);
  const label = fmtWeekdayDate(saturday);
  return {
    saturday,
    label,
    googleUrl: buildGoogleCalendarUrl({ title, saturday, details }),
    ics: buildTasksSaturdayIcs({ resident, saturday, tasks }),
  };
}

function saturday10Iso(saturday) {
  const sat = saturday || nextSaturday();
  const y = sat.getFullYear();
  const m = sat.getMonth() + 1;
  const day = sat.getDate();
  return zurichWallToUtcDate(y, m, day, WORK_HOUR, WORK_MINUTE).toISOString();
}

module.exports = {
  nextSaturday,
  saturday10Iso,
  buildSaturdayCalendarLinks,
  buildTasksSaturdayIcs,
};
