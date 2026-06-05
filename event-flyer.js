/**
 * Event-Flyer im Haus-am-See-Look (SVG → JPEG für Website).
 */

const FLYER_W = 1080;
const FLYER_H = 1350;
const WEBSITE_URL = "https://manu-manera.github.io/hausamsee";

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapFlyerLines(text, maxChars = 38, maxLines = 4) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function parseFlyerDate(dateInput) {
  if (!dateInput) return null;
  const d = new Date(dateInput);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEventFlyerDateLabel(dateInput) {
  const d = parseFlyerDate(dateInput);
  if (!d) return "";
  return d.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatEventFlyerTimeRange(startInput, endInput) {
  const start = parseFlyerDate(startInput);
  if (!start) return "";
  const startStr = start.toLocaleTimeString("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = parseFlyerDate(endInput);
  if (!end || end <= start) return `${startStr} Uhr`;
  const sameDay = end.toDateString() === start.toDateString();
  const endStr = end.toLocaleTimeString("de-CH", {
    timeZone: "Europe/Zurich",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `${startStr} – ${endStr} Uhr`;
  const endDate = end.toLocaleDateString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "short",
  });
  return `${startStr} Uhr – ${endDate} ${endStr}`;
}

/**
 * @param {{ title?: string, date?: string, endDate?: string|null, description?: string, location?: string, emoji?: string }} event
 */
export function buildEventFlyerSvg(event = {}) {
  const title = escapeXml((event.title || "Event").trim());
  const emoji = escapeXml(event.emoji || "🎉");
  const dateLabel = escapeXml(formatEventFlyerDateLabel(event.date));
  const timeLabel = escapeXml(formatEventFlyerTimeRange(event.date, event.endDate));
  const location = escapeXml((event.location || "Haus am See, Pilatusstrasse 40, Pfäffikon ZH").trim());
  const descLines = wrapFlyerLines(event.description, 40, 4);
  const descY = 920;
  const descSvg = descLines
    .map((line, i) => `<tspan x="90" dy="${i === 0 ? 0 : 34}">${escapeXml(line)}</tspan>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${FLYER_W}" height="${FLYER_H}" viewBox="0 0 ${FLYER_W} ${FLYER_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fdf9f2"/>
      <stop offset="55%" stop-color="#f3e9d6"/>
      <stop offset="100%" stop-color="#e9dcc0"/>
    </linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6b9ba8"/>
      <stop offset="100%" stop-color="#3f6b7a"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#c67a50"/>
      <stop offset="100%" stop-color="#d9a03a"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#3d2817" flood-opacity="0.12"/>
    </filter>
  </defs>
  <rect width="${FLYER_W}" height="${FLYER_H}" fill="url(#bg)"/>
  <path d="M0,0 H${FLYER_W} V220 C900,180 700,260 540,210 C380,160 180,250 0,200 Z" fill="url(#lake)" opacity="0.92"/>
  <path d="M0,200 C200,250 400,170 540,230 C700,300 900,210 ${FLYER_W},250 V0 H0 Z" fill="#b8cfd6" opacity="0.35"/>
  <rect x="54" y="54" width="${FLYER_W - 108}" height="${FLYER_H - 108}" rx="28" fill="none" stroke="#c67a50" stroke-width="4" opacity="0.55"/>
  <rect x="72" y="72" width="${FLYER_W - 144}" height="${FLYER_H - 144}" rx="22" fill="rgba(255,251,243,0.72)" filter="url(#shadow)"/>
  <text x="540" y="300" text-anchor="middle" font-size="120">${emoji}</text>
  <text x="540" y="430" text-anchor="middle" font-family="Fraunces, Georgia, 'Times New Roman', serif" font-size="72" font-weight="700" fill="#3d2817">${title}</text>
  <rect x="120" y="470" width="840" height="6" rx="3" fill="url(#sun)" opacity="0.85"/>
  <text x="540" y="560" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="42" font-weight="600" fill="#5a3b24">${dateLabel}</text>
  <text x="540" y="630" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="36" font-weight="600" fill="#a55c35">🕐 ${timeLabel}</text>
  <text x="540" y="710" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="30" fill="#5a4634">📍 ${location}</text>
  ${descLines.length ? `<text x="90" y="${descY}" font-family="Inter, Arial, sans-serif" font-size="28" fill="#5a4634" font-style="italic">${descSvg}</text>` : ""}
  <rect x="120" y="1120" width="840" height="2" fill="#c67a50" opacity="0.35"/>
  <text x="540" y="1185" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="34" font-weight="700" letter-spacing="3" fill="#3d2817">HAUS AM SEE</text>
  <text x="540" y="1235" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="24" fill="#8a7763">Pilatusstrasse 40 · Pfäffikon ZH</text>
  <text x="540" y="1275" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="22" fill="#6b9ba8">${escapeXml(WEBSITE_URL.replace("https://", ""))}</text>
</svg>`;
}

export function eventFlyerSvgDataUrl(event) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(buildEventFlyerSvg(event))}`;
}

export async function rasterizeEventFlyerSvg(svgString, width = FLYER_W, height = FLYER_H) {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fdf9f2";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** JPEG-Data-URL für Firestore / Flyer-Vorschau. */
export async function generateEventFlyerJpeg(event) {
  const svg = buildEventFlyerSvg(event);
  return rasterizeEventFlyerSvg(svg);
}

export function eventDataFromFormFields(fields) {
  return {
    title: fields.title?.trim() || "",
    date: fields.date || "",
    endDate: fields.endDate || null,
    description: fields.description?.trim() || "",
    location: fields.location?.trim() || "Haus am See, Pilatusstrasse 40, Pfäffikon ZH",
    emoji: fields.emoji?.trim() || "🎉",
  };
}
