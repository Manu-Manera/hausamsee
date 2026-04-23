/* eslint-disable no-undef */
/**
 * Meross Cloud Wrapper.
 *
 * Erlaubt Cloud Functions, Refoss/Meross Smart Plugs per Cloud-API zu
 * schalten — ohne lokalen Raspi. Benutzt meross-cloud npm package, das
 * sich per MQTT mit dem Meross-Cloud-Broker verbindet.
 *
 * Umgebungsvariablen:
 *   MEROSS_EMAIL       E-Mail des Meross/Refoss-Accounts
 *   MEROSS_PASSWORD    Passwort
 */

const MerossCloud = require("meross-cloud");

const LOGIN_OPTIONS = {
  logger: () => {},
  localHttpFirst: false,
  onlyLocalForGet: false,
  timeout: 10000,
};

function creds() {
  return {
    email: process.env.MEROSS_EMAIL || "",
    password: process.env.MEROSS_PASSWORD || "",
  };
}

function isConfigured() {
  const { email, password } = creds();
  return !!(email && password);
}

/**
 * Öffnet eine Meross-Cloud-Session, führt die Aktion aus und schließt alles
 * wieder. Wir halten die Session bewusst nicht offen, weil Cloud Functions
 * bei Inaktivität eingefroren werden und dann MQTT-Verbindungen sterben.
 *
 * @param {(devices) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSession(fn) {
  const { email, password } = creds();
  if (!email || !password) {
    throw new Error("Meross Account nicht konfiguriert (MEROSS_EMAIL/MEROSS_PASSWORD).");
  }

  const meross = new MerossCloud({ email, password, ...LOGIN_OPTIONS });
  const devices = new Map();
  let ready = 0;
  let expected = 0;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Meross connect timeout")), 25000);

    meross.on("deviceInitialized", (deviceId, deviceDef, device) => {
      expected += 1;
      devices.set(deviceId, { def: deviceDef, dev: device, connected: false });
      device.on("connected", () => {
        const rec = devices.get(deviceId);
        if (rec) rec.connected = true;
        ready += 1;
        if (ready === expected) {
          clearTimeout(timeout);
          resolve();
        }
      });
      device.on("error", () => {
        ready += 1;
        if (ready === expected) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    meross.on("connected", () => {});
    meross.on("error", (err) => {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    meross.connect((err) => {
      if (err) {
        clearTimeout(timeout);
        reject(err);
      }
      // Wenn kein einziges deviceInitialized in 5s kommt, liefern wir leere Liste.
      setTimeout(() => {
        if (expected === 0) {
          clearTimeout(timeout);
          resolve();
        }
      }, 5000);
    });
  });

  try {
    return await fn(devices);
  } finally {
    try {
      for (const { dev } of devices.values()) {
        try { dev.disconnect && dev.disconnect(); } catch {}
      }
      try { meross.disconnectAll && meross.disconnectAll(true); } catch {}
      try { meross.logout && meross.logout(() => {}); } catch {}
    } catch {}
  }
}

function normalizeName(s) {
  return String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Fuzzy-Match: findet das am besten passende Gerät zu einem Namen.
 */
function findDevice(devices, wantedName) {
  const needle = normalizeName(wantedName);
  if (!needle) return null;

  let best = null;
  let bestScore = -1;

  for (const rec of devices.values()) {
    const name = normalizeName(rec.def?.devName || rec.def?.deviceName || "");
    if (!name) continue;
    let score = 0;
    if (name === needle) score = 100;
    else if (name.startsWith(needle) || needle.startsWith(name)) score = 70;
    else if (name.includes(needle) || needle.includes(name)) score = 40;
    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return bestScore > 0 ? best : null;
}

async function listDevices() {
  return withSession(async (devices) => {
    const out = [];
    for (const rec of devices.values()) {
      out.push({
        uuid: rec.def.uuid,
        name: rec.def.devName || rec.def.deviceName || "(ohne Name)",
        online: !!rec.connected,
        type: rec.def.deviceType || "",
      });
    }
    return out;
  });
}

/**
 * Schaltet ein Gerät ein oder aus. Gibt Info zurück, welches Gerät getroffen wurde.
 */
async function setPower(nameOrUuid, on, channel = 0) {
  return withSession(async (devices) => {
    let rec = devices.get(nameOrUuid); // UUID?
    if (!rec) rec = findDevice(devices, nameOrUuid);
    if (!rec) {
      const names = [...devices.values()].map((r) => r.def?.devName).filter(Boolean);
      const hint = names.length ? ` Bekannte Geräte: ${names.join(", ")}` : "";
      throw new Error(`Gerät "${nameOrUuid}" nicht gefunden.${hint}`);
    }
    if (!rec.connected) {
      throw new Error(`Gerät "${rec.def.devName}" ist gerade offline.`);
    }

    await new Promise((resolve, reject) => {
      rec.dev.controlToggleX(channel, !!on, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return { uuid: rec.def.uuid, name: rec.def.devName, on: !!on };
  });
}

/**
 * Holt Power-Status aller Geräte.
 */
async function getAllStatus() {
  return withSession(async (devices) => {
    const results = [];
    for (const rec of devices.values()) {
      if (!rec.connected) {
        results.push({ name: rec.def.devName, online: false, on: null });
        continue;
      }
      try {
        const status = await new Promise((resolve, reject) => {
          rec.dev.getSystemAllData((err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
        // Toggle-X wird in "digest.togglex" als Array zurückgegeben
        const togglex = status?.all?.digest?.togglex;
        const onState = Array.isArray(togglex) ? togglex[0]?.onoff === 1 : null;
        results.push({ name: rec.def.devName, online: true, on: onState });
      } catch (e) {
        results.push({ name: rec.def.devName, online: true, on: null, error: String(e.message || e) });
      }
    }
    return results;
  });
}

module.exports = {
  isConfigured,
  listDevices,
  setPower,
  getAllStatus,
};
