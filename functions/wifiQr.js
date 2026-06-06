/**
 * WLAN-QR-Code für Gäste (WiFi QR-Standard, scan = automatisch verbinden).
 * Credentials: config/hausWiki { wlanSsid, wlanPassword } oder Env-Fallback.
 */

const QRCode = require("qrcode");

const DEFAULT_SSID = "Haus am See 2.0";

function escapeWifiField(value) {
  return String(value || "").replace(/([\\;,:"])/g, "\\$1");
}

function buildWifiQrPayload({ ssid, password, security = "WPA", hidden = false }) {
  const T = security === "nopass" ? "nopass" : security || "WPA";
  const S = escapeWifiField(ssid);
  const P = T === "nopass" ? "" : escapeWifiField(password);
  const H = hidden ? "true" : "false";
  if (T === "nopass") return `WIFI:T:nopass;S:${S};H:${H};;`;
  return `WIFI:T:${T};S:${S};P:${P};H:${H};;`;
}

function parseWifiQrQuery(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  if (/^(wlan|wifi)\s*(qr|qrcode|code)\b/i.test(s)) return true;
  if (/^(qr|qrcode)\s*(code\s*)?(für\s+)?(wlan|wifi)\b/i.test(s)) return true;
  if (/\b(wlan|wifi)\s+qr\b/i.test(s)) return true;
  if (/^qr\s+wlan\b/i.test(s)) return true;
  return false;
}

async function loadWifiCredentials(db) {
  let ssid = (process.env.WLAN_SSID || DEFAULT_SSID).trim();
  let password = (process.env.WLAN_PASSWORD || "").trim();
  let security = "WPA";
  try {
    const snap = await db.doc("config/hausWiki").get();
    if (snap.exists) {
      const d = snap.data();
      if (d.wlanSsid && String(d.wlanSsid).trim()) ssid = String(d.wlanSsid).trim();
      if (d.wlanPassword != null && String(d.wlanPassword).length) password = String(d.wlanPassword);
      if (d.wlanSecurity && String(d.wlanSecurity).trim()) security = String(d.wlanSecurity).trim();
    }
  } catch {
    /* env defaults */
  }
  return { ssid, password, security };
}

async function generateWifiQrPng(credentials) {
  const payload = buildWifiQrPayload(credentials);
  return QRCode.toBuffer(payload, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#1a3d2e", light: "#ffffff" },
  });
}

/**
 * @param {{ db, reply: Function, sendImage: Function, to: string, phoneId?: string }} ctx
 */
async function handleWifiQrRequest(ctx) {
  const creds = await loadWifiCredentials(ctx.db);
  if (!creds.password && creds.security !== "nopass") {
    await ctx.reply(
      "📶 *WLAN-QR* ist noch nicht konfiguriert.\n\n" +
        "Trag SSID und Passwort unter *WG-Intern → Einstellungen → Haus-Wiki → WLAN QR-Code* ein – oder setz `WLAN_PASSWORD` in functions/.env."
    );
    return true;
  }

  try {
    const png = await generateWifiQrPng(creds);
    const caption =
      `📶 *WLAN «${creds.ssid}»*\n\n` +
      "QR-Code scannen → Handy verbindet sich automatisch.\n\n" +
      `Netzwerk: *${creds.ssid}*\n` +
      `Passwort: *${creds.password}*\n\n` +
      "_Gustav · Haus am See_";
    const ok = await ctx.sendImage(ctx.to, png, caption, ctx.phoneId);
    if (!ok) {
      await ctx.reply(
        `📶 *WLAN «${creds.ssid}»*\nPasswort: *${creds.password}*\n\n_(QR-Bild konnte nicht gesendet werden – Text als Fallback.)_`
      );
    }
    return true;
  } catch (e) {
    await ctx.reply(`📶 WLAN-QR konnte nicht erstellt werden: ${e?.message || "Fehler"}`);
    return true;
  }
}

module.exports = {
  DEFAULT_SSID,
  parseWifiQrQuery,
  loadWifiCredentials,
  buildWifiQrPayload,
  generateWifiQrPng,
  handleWifiQrRequest,
};
