/**
 * Tuya Cloud API Wrapper (keine externe SDK-Abhängigkeit).
 *
 * Unterstützt Smart Life / Maxcio / TuyaSmart / einfach alles was in der
 * Tuya-Cloud registriert ist. Benutzt die offizielle Tuya Open API v1.0
 * mit HMAC-SHA256-Signatur.
 *
 * Env-Variablen:
 *   TUYA_ACCESS_ID       Aus iot.tuya.com → Cloud → Project → Overview
 *   TUYA_ACCESS_SECRET   dito
 *   TUYA_UID             "Linked Devices" → User-ID des verknüpften Accounts
 *   TUYA_REGION          "eu" | "us" | "cn" | "in" (Default: "eu")
 */

const crypto = require("crypto");

const REGIONS = {
  eu: "https://openapi.tuyaeu.com",
  us: "https://openapi.tuyaus.com",
  cn: "https://openapi.tuyacn.com",
  in: "https://openapi.tuyain.com",
};

function cfg() {
  const region = (process.env.TUYA_REGION || "eu").toLowerCase();
  return {
    accessId: process.env.TUYA_ACCESS_ID || "",
    accessSecret: process.env.TUYA_ACCESS_SECRET || "",
    uid: process.env.TUYA_UID || "",
    baseUrl: REGIONS[region] || REGIONS.eu,
  };
}

function isConfigured() {
  const c = cfg();
  return !!(c.accessId && c.accessSecret && c.uid);
}

/* ---------------- Signing ---------------- */

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data || "", "utf8").digest("hex");
}

function hmacSha256UpperHex(message, key) {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest("hex").toUpperCase();
}

/**
 * Baut den "stringToSign" für die Tuya-Signatur:
 *   HTTPMethod \n Content-SHA256 \n OptionalSignatureHeaders \n URL(+query)
 */
function buildStringToSign(method, url, body) {
  const contentHash = sha256Hex(body || "");
  return `${method.toUpperCase()}\n${contentHash}\n\n${url}`;
}

function sortQuery(query) {
  const keys = Object.keys(query).sort();
  return keys.map((k) => `${k}=${query[k]}`).join("&");
}

/**
 * Signatur-Berechnung gem. Tuya "Signature Algorithm" (business/simple mode).
 * Für den Token-Endpoint wird kein access_token genutzt.
 */
function signRequest({ method, path, query, body, t, nonce, accessToken = "" }) {
  const c = cfg();
  const queryStr = query && Object.keys(query).length ? `?${sortQuery(query)}` : "";
  const fullPath = `${path}${queryStr}`;
  const stringToSign = buildStringToSign(method, fullPath, body);
  const str = `${c.accessId}${accessToken}${t}${nonce}${stringToSign}`;
  return {
    sign: hmacSha256UpperHex(str, c.accessSecret),
    fullPath,
  };
}

/* ---------------- Token-Caching ---------------- */

let cachedToken = null; // { access_token, expires_at }

async function getAccessToken() {
  if (cachedToken && cachedToken.expires_at > Date.now() + 30_000) {
    return cachedToken.access_token;
  }
  const c = cfg();
  const t = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const { sign, fullPath } = signRequest({
    method: "GET",
    path: "/v1.0/token",
    query: { grant_type: "1" },
    body: "",
    t,
    nonce,
  });

  const res = await fetch(`${c.baseUrl}${fullPath}`, {
    method: "GET",
    headers: {
      client_id: c.accessId,
      sign_method: "HMAC-SHA256",
      t,
      nonce,
      sign,
      "Content-Type": "application/json",
    },
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Tuya Token-Fehler: ${json.msg || json.code || "unbekannt"}`);
  }
  cachedToken = {
    access_token: json.result.access_token,
    expires_at: Date.now() + (json.result.expire_time || 7200) * 1000,
  };
  return cachedToken.access_token;
}

/* ---------------- API-Aufrufe ---------------- */

async function apiCall({ method, path, query = {}, body = null }) {
  const c = cfg();
  const accessToken = await getAccessToken();
  const bodyStr = body ? JSON.stringify(body) : "";
  const t = Date.now().toString();
  const nonce = crypto.randomBytes(8).toString("hex");
  const { sign, fullPath } = signRequest({
    method,
    path,
    query,
    body: bodyStr,
    t,
    nonce,
    accessToken,
  });

  const res = await fetch(`${c.baseUrl}${fullPath}`, {
    method,
    headers: {
      client_id: c.accessId,
      access_token: accessToken,
      sign_method: "HMAC-SHA256",
      t,
      nonce,
      sign,
      "Content-Type": "application/json",
    },
    body: bodyStr || undefined,
  });
  const json = await res.json();
  if (!json.success) {
    // Token kaputt? Ein Retry mit frischem Token.
    if (["1010", "1011", "1012"].includes(String(json.code))) {
      cachedToken = null;
      return apiCall({ method, path, query, body });
    }
    throw new Error(`Tuya API-Fehler (${json.code}): ${json.msg || "unbekannt"}`);
  }
  return json.result;
}

/* ---------------- Device-Operationen ---------------- */

function normalizeName(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function findDevice(devices, wantedName) {
  const needle = normalizeName(wantedName);
  if (!needle) return null;
  let best = null;
  let bestScore = -1;
  for (const d of devices) {
    const name = normalizeName(d.name);
    if (!name) continue;
    let score = 0;
    if (name === needle) score = 100;
    else if (name.startsWith(needle) || needle.startsWith(name)) score = 70;
    else if (name.includes(needle) || needle.includes(name)) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * Findet den "Switch"-Datapoint-Code des Geräts.
 * Tuya-Plugs benutzen meist "switch_1", manche Multi-Outlet "switch_2" etc.,
 * ältere einfach "switch".
 */
function findSwitchCode(status) {
  if (!Array.isArray(status)) return "switch_1";
  const preferred = ["switch_1", "switch"];
  for (const p of preferred) {
    if (status.find((s) => s.code === p)) return p;
  }
  const any = status.find((s) => /^switch(_\d+)?$/.test(s.code));
  return any ? any.code : "switch_1";
}

async function listDevices() {
  const c = cfg();
  const result = await apiCall({
    method: "GET",
    path: `/v1.0/users/${c.uid}/devices`,
  });
  // result ist ein Array von Devices
  return (result || []).map((d) => ({
    id: d.id,
    name: d.name || d.product_name || "(ohne Name)",
    online: !!d.online,
    category: d.category,
    product_name: d.product_name,
    status: d.status || [],
  }));
}

async function getDeviceStatus(deviceId) {
  return apiCall({
    method: "GET",
    path: `/v1.0/devices/${deviceId}/status`,
  });
}

async function setPower(nameOrId, on) {
  let devices = await listDevices();
  // Versuche erst exakte ID
  let device = devices.find((d) => d.id === nameOrId);
  if (!device) device = findDevice(devices, nameOrId);
  if (!device) {
    const names = devices.map((d) => d.name).filter(Boolean);
    const hint = names.length ? ` Bekannte Geräte: ${names.join(", ")}` : "";
    throw new Error(`Gerät "${nameOrId}" nicht gefunden.${hint}`);
  }
  if (!device.online) {
    throw new Error(`Gerät "${device.name}" ist offline. (Router an? Plug im WLAN?)`);
  }
  const code = findSwitchCode(device.status);
  await apiCall({
    method: "POST",
    path: `/v1.0/devices/${device.id}/commands`,
    body: { commands: [{ code, value: !!on }] },
  });
  return { id: device.id, name: device.name, on: !!on, code };
}

async function getAllStatus() {
  const devices = await listDevices();
  return devices.map((d) => {
    const code = findSwitchCode(d.status);
    const entry = (d.status || []).find((s) => s.code === code);
    const on = entry ? !!entry.value : null;
    return { id: d.id, name: d.name, online: !!d.online, on };
  });
}

module.exports = {
  isConfigured,
  listDevices,
  setPower,
  getAllStatus,
};
