/**
 * Blue Riiot / Blue Connect Cloud API (inoffiziell, wie MBW.Client.BlueRiiotApi).
 * Login → temporäre AWS-Credentials → SigV4-signierte Requests an api.riiotlabs.com/prod/
 */

const https = require("https");
const aws4 = require("aws4");
const logger = require("firebase-functions/logger");

const API_HOST = "api.riiotlabs.com";
const API_BASE = "/prod/";
const API_REGION = "eu-west-1";
const API_SERVICE = "execute-api";

let sessionCache = null;

function blueriiotEnabled() {
  const v = String(process.env.BLUERIIOT_SYNC || "").toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return !!(process.env.BLUERIIOT_EMAIL && process.env.BLUERIIOT_PASSWORD);
}

function httpsJson(opts, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (e) {
          return reject(new Error(`Blue Riiot: invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`));
        }
        if (res.statusCode >= 400) {
          const msg = json?.errorMessage || json?.message || text.slice(0, 200);
          return reject(new Error(`Blue Riiot HTTP ${res.statusCode}: ${msg}`));
        }
        if (json?.errorMessage) {
          return reject(new Error(`Blue Riiot API: ${json.errorMessage}`));
        }
        resolve(json);
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login() {
  const email = process.env.BLUERIIOT_EMAIL;
  const password = process.env.BLUERIIOT_PASSWORD;
  const body = JSON.stringify({ email, password });
  const opts = {
    host: API_HOST,
    path: `${API_BASE}user/login`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "HausAmSee-Gustav/1.0",
      Accept: "application/json",
    },
  };
  const resp = await httpsJson(opts, body);
  const creds = resp?.credentials;
  if (!creds?.access_key || !creds?.secret_key || !creds?.session_token) {
    throw new Error("Blue Riiot Login: keine AWS-Credentials in Antwort");
  }
  sessionCache = {
    accessKeyId: creds.access_key,
    secretAccessKey: creds.secret_key,
    sessionToken: creds.session_token,
    expiration: creds.expiration ? new Date(creds.expiration).getTime() : Date.now() + 3600000,
  };
  return sessionCache;
}

async function ensureSession() {
  if (sessionCache && Date.now() < sessionCache.expiration - 5 * 60 * 1000) {
    return sessionCache;
  }
  return login();
}

function signedApiOpts(method, path, bodyStr = null) {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const fullPath = `${API_BASE}${cleanPath}`;
  const opts = {
    host: API_HOST,
    path: fullPath,
    method,
    service: API_SERVICE,
    region: API_REGION,
    headers: {
      "User-Agent": "HausAmSee-Gustav/1.0",
      Accept: "application/json",
      "X-Amz-Security-Token": sessionCache.sessionToken,
    },
  };
  if (bodyStr) {
    opts.headers["Content-Type"] = "application/json";
    opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }
  aws4.sign(opts, {
    accessKeyId: sessionCache.accessKeyId,
    secretAccessKey: sessionCache.secretAccessKey,
    sessionToken: sessionCache.sessionToken,
  });
  return opts;
}

async function apiGet(path) {
  await ensureSession();
  return httpsJson(signedApiOpts("GET", path));
}

async function apiPost(path, body = null) {
  await ensureSession();
  const bodyStr = body != null ? JSON.stringify(body) : null;
  return httpsJson(signedApiOpts("POST", path, bodyStr), bodyStr);
}

function releaseEventEnabled() {
  const v = String(process.env.BLUERIIOT_RELEASE_EVENT || "1").toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/**
 * Experimentell: hängende Bluetooth-Messungen aus der App in die Cloud übernehmen.
 * @see MBW.Client.BlueRiiotApi BlueReleaseLastUnprocessedEvent
 */
async function tryReleaseLastUnprocessedEvent(deviceSerial) {
  try {
    const resp = await apiPost(`blue/${encodeURIComponent(deviceSerial)}/releaseLastUnprocessedEvent`);
    return { ok: true, resp: resp || null };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function fetchLastMeasurements(poolId, deviceSerial) {
  const path = `swimming_pool/${encodeURIComponent(poolId)}/blue/${encodeURIComponent(deviceSerial)}/lastMeasurements?mode=blue_and_strip`;
  return apiGet(path);
}

function parseLastMeasurementsResponse(resp, poolId, deviceSerial, releaseMeta = null) {
  const rows = resp?.data || [];
  const tempRow =
    rows.find((r) => r.name === "temperature" && !r.expired) ||
    rows.find((r) => r.name === "temperature" && r.value != null);
  if (!tempRow || tempRow.value == null) {
    return null;
  }

  const measuredAt =
    tempRow.timestamp ||
    resp?.last_blue_measure_timestamp ||
    new Date().toISOString();

  function pickRow(name) {
    return (
      rows.find((r) => r.name === name && !r.expired) ||
      rows.find((r) => r.name === name && r.value != null)
    );
  }

  function rowToMetric(row) {
    if (!row || row.value == null) return null;
    return {
      value: Number(row.value),
      okMin: row.ok_min,
      okMax: row.ok_max,
      warnLow: row.warning_low,
      warnHigh: row.warning_high,
      expired: !!row.expired,
    };
  }

  const reading = {
    tempC: Number(tempRow.value),
    measuredAt: new Date(measuredAt).toISOString(),
    ph: rowToMetric(pickRow("ph")),
    orp: rowToMetric(pickRow("orp")),
    poolId,
    deviceSerial,
    status: resp?.status || "OK",
    cloudTimestamp: resp?.last_blue_measure_timestamp
      ? new Date(resp.last_blue_measure_timestamp).toISOString()
      : null,
  };
  if (releaseMeta) reading.releaseMeta = releaseMeta;
  return reading;
}

async function resolvePoolAndDevice(cached = {}) {
  let poolId = process.env.BLUERIIOT_POOL_ID || cached.poolId || "";
  let deviceSerial = process.env.BLUERIIOT_DEVICE_SERIAL || cached.deviceSerial || "";

  if (!poolId) {
    const pools = await apiGet("swimming_pool?deleted=false");
    const list = pools?.data || pools?.swimming_pools || pools;
    const first = Array.isArray(list) ? list[0] : null;
    poolId = first?.swimming_pool_id || first?.id || first?.swimmingPoolId || "";
    if (!poolId && pools && typeof pools === "object") {
      const keys = Object.keys(pools).filter((k) => k.includes("-"));
      if (keys.length) poolId = keys[0];
    }
  }
  if (!poolId) throw new Error("Blue Riiot: keine Pool-ID (BLUERIIOT_POOL_ID setzen)");

  if (!deviceSerial) {
    const blues = await apiGet(`swimming_pool/${encodeURIComponent(poolId)}/blue`);
    const list = blues?.data || blues?.blues || blues;
    const first = Array.isArray(list) ? list[0] : null;
    deviceSerial =
      first?.blue_device_serial ||
      first?.serial ||
      first?.blueDeviceSerial ||
      first?.blue_key ||
      "";
  }
  if (!deviceSerial) throw new Error("Blue Riiot: kein Gerät (BLUERIIOT_DEVICE_SERIAL setzen)");

  return { poolId, deviceSerial };
}

/**
 * @returns {{ tempC: number, measuredAt: string, ph?: number, poolId: string, deviceSerial: string, raw?: object } | null}
 */
async function fetchLatestTemperature(cached = {}) {
  if (!blueriiotEnabled()) return null;

  const { poolId, deviceSerial } = await resolvePoolAndDevice(cached);

  let respBefore;
  try {
    respBefore = await fetchLastMeasurements(poolId, deviceSerial);
  } catch (e) {
    logger.error("Blue Riiot: lastMeasurements (vor Release)", e?.message || e);
    throw e;
  }

  const tsBefore = respBefore?.last_blue_measure_timestamp || null;
  let releaseMeta = {
    attempted: false,
    ok: null,
    error: null,
    measuredAtBefore: tsBefore ? new Date(tsBefore).toISOString() : null,
    measuredAtAfter: null,
    timestampChanged: false,
  };

  let resp = respBefore;
  if (releaseEventEnabled()) {
    releaseMeta.attempted = true;
    const releaseResult = await tryReleaseLastUnprocessedEvent(deviceSerial);
    releaseMeta.ok = releaseResult.ok;
    releaseMeta.error = releaseResult.error || null;
    if (releaseResult.ok) {
      logger.info("Blue Riiot: releaseLastUnprocessedEvent", {
        deviceSerial,
        response: releaseResult.resp,
      });
      try {
        resp = await fetchLastMeasurements(poolId, deviceSerial);
      } catch (e) {
        logger.warn("Blue Riiot: lastMeasurements nach Release fehlgeschlagen", e?.message || e);
      }
    } else {
      logger.info("Blue Riiot: releaseLastUnprocessedEvent nicht verfügbar", {
        deviceSerial,
        error: releaseResult.error,
      });
    }
    const tsAfter = resp?.last_blue_measure_timestamp || null;
    releaseMeta.measuredAtAfter = tsAfter ? new Date(tsAfter).toISOString() : null;
    releaseMeta.timestampChanged =
      !!tsBefore && !!tsAfter && String(tsBefore) !== String(tsAfter);
    if (releaseMeta.timestampChanged) {
      logger.info("Blue Riiot: Zeitstempel nach Release aktualisiert", releaseMeta);
    }
  }

  const reading = parseLastMeasurementsResponse(resp, poolId, deviceSerial, releaseMeta);
  if (!reading) {
    logger.warn("Blue Riiot: keine Temperatur in lastMeasurements", {
      status: resp?.status,
      last: resp?.last_blue_measure_timestamp,
      releaseMeta,
    });
    return null;
  }

  return reading;
}

module.exports = {
  blueriiotEnabled,
  fetchLatestTemperature,
  releaseEventEnabled,
};
