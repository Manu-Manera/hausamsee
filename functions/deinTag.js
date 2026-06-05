/**
 * «Dein Tag» – persönliche Morgen-Zusammenfassung per WhatsApp (Opt-in + Turnus).
 * memberPrefs[name].deinTag: { enabled, cadence, lastSentAt? }
 * cadence: daily | weekdays | weekly | every2days
 */

const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";
const CADENCES = new Set(["daily", "weekdays", "weekly", "every2days"]);

function normalizeCadence(raw) {
  const v = String(raw || "daily").toLowerCase().trim();
  return CADENCES.has(v) ? v : "daily";
}

function parseDeinTagSettingsCommand(raw) {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  if (/^dein\s*tag\s*(aus|off|stop)\s*$/i.test(s)) return { action: "off" };
  if (/^dein\s*tag\s*(an|ein|on|start)\s*$/i.test(s)) return { action: "on", cadence: "daily" };
  if (/^dein\s*tag\s*(täglich|taeglich|daily)\s*$/i.test(s)) return { action: "on", cadence: "daily" };
  if (/^dein\s*tag\s*(werktags|weekdays)\s*$/i.test(s)) return { action: "on", cadence: "weekdays" };
  if (/^dein\s*tag\s*(wöchentlich|woechentlich|weekly)\s*$/i.test(s)) return { action: "on", cadence: "weekly" };
  if (/^dein\s*tag\s*(alle\s*2\s*tage|every2days|2\s*tage)\s*$/i.test(s)) return { action: "on", cadence: "every2days" };
  if (/^dein\s*tag\s*(status|einstellung|settings?)\s*$/i.test(s)) return { action: "status" };
  if (/^dein\s*tag\s*$/i.test(s) || /^mein\s*tag\s*\??$/i.test(s)) return { action: "preview" };
  return null;
}

function cadenceLabel(c) {
  const map = {
    daily: "täglich (7:30)",
    weekdays: "werktags (Mo–Fr)",
    weekly: "wöchentlich (Montag)",
    every2days: "alle 2 Tage",
  };
  return map[c] || map.daily;
}

function shouldSendDeinTagToday(cadence, now = new Date()) {
  const c = normalizeCadence(cadence);
  const day = now.getDay();
  if (c === "weekdays") return day >= 1 && day <= 5;
  if (c === "weekly") return day === 1;
  return true;
}

function shouldSendDeinTagInterval(lastSentAt, cadence, now = new Date()) {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt);
  if (Number.isNaN(last.getTime())) return true;
  const diffDays = Math.floor((startOfDay(now) - startOfDay(last)) / 86400000);
  if (normalizeCadence(cadence) === "every2days") return diffDays >= 2;
  return diffDays >= 1;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * @param {{ resident: string, weatherLine?: string, tasksText?: string, events?: Array, wellnessLine?: string, anwesenheitLine?: string }} ctx
 */
function buildDeinTagMessage(ctx) {
  const { resident, weatherLine, tasksText, events, wellnessLine, anwesenheitLine } = ctx;
  const lines = [
    `☀️ *Dein Tag – ${resident}*`,
    fmtDate(new Date()),
    "",
  ];
  if (weatherLine) {
    lines.push(weatherLine, "");
  }
  if (tasksText) {
    lines.push("*📋 Deine Aufgaben:*", tasksText, "");
  }
  if (events?.length) {
    lines.push("*📅 Events:*");
    events.slice(0, 4).forEach((e) => lines.push(`• ${e.title} – ${fmtDateTime(e.date)}`));
    lines.push("");
  }
  if (wellnessLine) {
    lines.push(wellnessLine, "");
  }
  if (anwesenheitLine) {
    lines.push(anwesenheitLine, "");
  }
  lines.push(`🌐 ${WEBSITE_URL}`);
  lines.push("_Dein Tag: «Dein Tag aus» zum Abmelden_");
  return lines.filter(Boolean).join("\n");
}

module.exports = {
  CADENCES,
  normalizeCadence,
  parseDeinTagSettingsCommand,
  cadenceLabel,
  shouldSendDeinTagToday,
  shouldSendDeinTagInterval,
  buildDeinTagMessage,
};
