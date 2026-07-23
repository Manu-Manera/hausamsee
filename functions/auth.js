/**
 * Server-seitige Authentifizierung für Haus am See.
 *
 * Zweck: Passwort-Hashes (Gruppen-, persönliche- und Gäste-Passwörter) müssen
 * NICHT mehr öffentlich in Firestore lesbar sein. Diese Function prüft Passwörter
 * serverseitig (Admin SDK umgeht die – jetzt gesperrten – Regeln) und gibt ein
 * kurzlebiges Session-Token aus. Privilegierte Schreibaktionen (Passwort ändern,
 * Gäste anlegen/löschen …) laufen nur mit gültigem Token bzw. Passwort-Nachweis.
 *
 * Gespeicherte Hash-Formate bleiben identisch (SHA-256 über normalisierte
 * Eingabe), damit bestehende Passwörter weitergelten – keine Migration nötig.
 *
 * Firestore-Layout:
 *   config/auth            { passwordHash }              – gesperrt (nur hier)
 *   config/memberPasswords { Name: hash }                – gesperrt
 *   config/authMeta        { withPersonal: [Namen] }     – öffentlich lesbar (nur Namen!)
 *   guests/{id}            { name, expiresAt, createdBy } – öffentlich lesbar (ohne Hash)
 *   guestAuth/{id}         { hash }                       – gesperrt
 *   authSessions/{token}   { member, role, kind, exp }    – gesperrt
 *   authThrottle/{key}     { count, resetAt }             – gesperrt
 */

const crypto = require("crypto");
const { FieldValue } = require("firebase-admin/firestore");

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Tage
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;        // 10 Min
const THROTTLE_MAX_FAILS = 20;                    // pro Fenster & Schlüssel

// Muss exakt der Frontend-Normalisierung entsprechen (iOS/Autofill/Unicode).
function normPasswordInput(s) {
  return String(s == null ? "" : s)
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/[\r\n]+/g, "")
    .trim();
}

function sha256hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function hashPassword(pw) {
  return sha256hex(normPasswordInput(pw));
}

function timingEqualHex(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch (_) { return false; }
}

function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Erlaubte Web-Origins (GitHub Pages + lokale Tests). Andere Origins → kein CORS-Header.
const ALLOWED_ORIGINS = new Set([
  "https://manu-manera.github.io",
  "http://localhost:5000",
  "http://localhost:8080",
  "http://127.0.0.1:5500",
  "null", // file:// (lokaler Test)
]);

function applyCors(req, res) {
  const origin = req.get("origin") || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function createAuthApi(db, opts = {}) {
  const ADULTS = Array.isArray(opts.adults) ? opts.adults : [];
  const canonical = typeof opts.canonicalName === "function" ? opts.canonicalName : (n) => n;
  const DEFAULT_GROUP_HASH = opts.defaultGroupHash || "";

  const col = (name) => db.collection(name);
  const cfgDoc = (id) => db.collection("config").doc(id);

  async function getGroupHash() {
    const snap = await cfgDoc("auth").get();
    const h = snap.exists ? snap.data().passwordHash : "";
    return h || DEFAULT_GROUP_HASH;
  }

  async function getMemberHashes() {
    const snap = await cfgDoc("memberPasswords").get();
    if (!snap.exists) return {};
    const out = {};
    const skip = new Set(["updatedAt", "updatedBy", "createdAt"]);
    for (const [k, v] of Object.entries(snap.data() || {})) {
      if (skip.has(k) || typeof v !== "string") continue;
      const raw = v.trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(raw)) continue;
      const name = canonical(k.trim());
      if (ADULTS.includes(name)) out[name] = raw;
    }
    return out;
  }

  async function syncAuthMeta() {
    const hashes = await getMemberHashes();
    const withPersonal = Object.keys(hashes).sort();
    await cfgDoc("authMeta").set(
      { withPersonal, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return withPersonal;
  }

  async function throttleCheck(key) {
    const ref = col("authThrottle").doc(key);
    const now = Date.now();
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.resetAt > now && d.count >= THROTTLE_MAX_FAILS) {
      return false;
    }
    return true;
  }

  async function throttleFail(key) {
    const ref = col("authThrottle").doc(key);
    const now = Date.now();
    const snap = await ref.get();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.resetAt <= now) {
      await ref.set({ count: 1, resetAt: now + THROTTLE_WINDOW_MS });
    } else {
      await ref.set({ count: (d.count || 0) + 1, resetAt: d.resetAt }, { merge: true });
    }
  }

  async function throttleReset(key) {
    await col("authThrottle").doc(key).delete().catch(() => {});
  }

  async function createSession(member, role, kind) {
    const token = newToken();
    const exp = Date.now() + SESSION_TTL_MS;
    await col("authSessions").doc(token).set({
      member, role, kind: kind || null, exp,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { token, exp };
  }

  async function requireMemberSession(token) {
    if (!token) return null;
    const snap = await col("authSessions").doc(String(token)).get();
    if (!snap.exists) return null;
    const d = snap.data();
    if (!d || d.exp <= Date.now() || d.role !== "member") return null;
    return d;
  }

  async function guestList() {
    const snap = await col("guests").get();
    const now = Date.now();
    return snap.docs.map((doc) => {
      const g = doc.data() || {};
      return {
        id: doc.id,
        name: g.name || "",
        expiresAt: g.expiresAt || null,
        createdBy: g.createdBy || null,
        expired: !!(g.expiresAt && g.expiresAt < now),
      };
    });
  }

  // Hash eines Gasts: neu in guestAuth, alt (Legacy) noch im öffentlichen guests-Doc.
  async function getGuestHash(id) {
    const ga = await col("guestAuth").doc(id).get();
    if (ga.exists && ga.data().hash) return ga.data().hash;
    const g = await col("guests").doc(id).get();
    return g.exists ? (g.data().hash || "") : "";
  }

  // ---- Aktionen ---------------------------------------------------------

  async function actLogin(body, ip) {
    const member = canonical(String(body.member || "").trim());
    const password = String(body.password || "");
    const key = `login:${ip}:${member || "?"}`;
    if (!(await throttleCheck(key))) {
      return { status: 429, json: { ok: false, reason: "throttled" } };
    }
    if (!member || !password) {
      return { status: 400, json: { ok: false, reason: "missing" } };
    }
    const hash = hashPassword(password);
    const memberHashes = await getMemberHashes();
    const personal = memberHashes[member];
    if (personal) {
      if (timingEqualHex(hash, personal)) {
        await throttleReset(key);
        const s = await createSession(member, "member", "personal");
        return { status: 200, json: { ok: true, kind: "personal", member, token: s.token, exp: s.exp } };
      }
      await throttleFail(key);
      return { status: 200, json: { ok: false, reason: "wrong", hasPersonal: true } };
    }
    const groupHash = await getGroupHash();
    if (timingEqualHex(hash, groupHash) || (DEFAULT_GROUP_HASH && timingEqualHex(hash, DEFAULT_GROUP_HASH))) {
      await throttleReset(key);
      const s = await createSession(member, "member", "group");
      return { status: 200, json: { ok: true, kind: "group", member, token: s.token, exp: s.exp } };
    }
    await throttleFail(key);
    return { status: 200, json: { ok: false, reason: "wrong", hasPersonal: false } };
  }

  async function actGuestLogin(body, ip) {
    const password = String(body.password || "");
    const guestKey = body.guestKey != null ? String(body.guestKey) : ""; // id oder name (optional)
    const key = `guest:${ip}`;
    if (!(await throttleCheck(key))) {
      return { status: 429, json: { ok: false, reason: "throttled" } };
    }
    if (!password) return { status: 400, json: { ok: false, reason: "missing" } };
    const hash = hashPassword(password);
    const now = Date.now();
    const guests = await col("guests").get();
    // Erst gezielten Gast (falls Key übergeben), sonst alle prüfen.
    const docs = guests.docs.filter((d) => {
      if (!guestKey) return true;
      return d.id === guestKey || (d.data().name || "") === guestKey;
    });
    for (const d of docs) {
      const g = d.data() || {};
      const gh = await getGuestHash(d.id);
      if (!gh || !timingEqualHex(hash, gh)) continue;
      if (g.expiresAt && g.expiresAt < now) {
        return { status: 200, json: { ok: false, reason: "expired", guestName: g.name } };
      }
      await throttleReset(key);
      const s = await createSession(g.name, "guest", null);
      return { status: 200, json: { ok: true, kind: "guest", guestName: g.name, member: g.name, token: s.token, exp: s.exp } };
    }
    await throttleFail(key);
    return { status: 200, json: { ok: false, reason: "wrong" } };
  }

  async function actChangePassword(body) {
    const member = canonical(String(body.member || "").trim());
    const current = String(body.currentPassword || "");
    const newPw = String(body.newPassword || "");
    if (!member || !ADULTS.includes(member)) return { status: 400, json: { ok: false, reason: "member" } };
    if (normPasswordInput(newPw).length < 4) return { status: 400, json: { ok: false, reason: "short" } };
    const memberHashes = await getMemberHashes();
    const personal = memberHashes[member];
    const curHash = hashPassword(current);
    const ok = personal ? timingEqualHex(curHash, personal)
      : (timingEqualHex(curHash, await getGroupHash()) || (DEFAULT_GROUP_HASH && timingEqualHex(curHash, DEFAULT_GROUP_HASH)));
    if (!ok) return { status: 200, json: { ok: false, reason: "wrong-current", hasPersonal: !!personal } };
    await cfgDoc("memberPasswords").set(
      { [member]: hashPassword(newPw), updatedBy: member, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    await syncAuthMeta();
    const s = await createSession(member, "member", "personal");
    return { status: 200, json: { ok: true, token: s.token, exp: s.exp } };
  }

  async function actChangeShared(body) {
    const session = await requireMemberSession(body.token);
    if (!session) return { status: 401, json: { ok: false, reason: "auth" } };
    const current = String(body.currentPassword || "");
    const newPw = String(body.newPassword || "");
    if (normPasswordInput(newPw).length < 4) return { status: 400, json: { ok: false, reason: "short" } };
    const curHash = hashPassword(current);
    const ok = timingEqualHex(curHash, await getGroupHash()) || (DEFAULT_GROUP_HASH && timingEqualHex(curHash, DEFAULT_GROUP_HASH));
    if (!ok) return { status: 200, json: { ok: false, reason: "wrong-current" } };
    const newHash = hashPassword(newPw);
    const memberHashes = await getMemberHashes();
    if (Object.values(memberHashes).includes(newHash)) {
      return { status: 200, json: { ok: false, reason: "taken" } };
    }
    await cfgDoc("auth").set(
      { passwordHash: newHash, updatedBy: session.member, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { status: 200, json: { ok: true } };
  }

  async function actSetGroupDefault(body) {
    const session = await requireMemberSession(body.token);
    if (!session) return { status: 401, json: { ok: false, reason: "auth" } };
    if (!DEFAULT_GROUP_HASH) return { status: 400, json: { ok: false, reason: "no-default" } };
    await cfgDoc("auth").set(
      { passwordHash: DEFAULT_GROUP_HASH, updatedBy: session.member, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return { status: 200, json: { ok: true } };
  }

  async function actClearPersonal(body) {
    const session = await requireMemberSession(body.token);
    if (!session) return { status: 401, json: { ok: false, reason: "auth" } };
    const target = canonical(String(body.target || "").trim());
    if (!target || !ADULTS.includes(target)) return { status: 400, json: { ok: false, reason: "target" } };
    await cfgDoc("memberPasswords").set({ [target]: FieldValue.delete() }, { merge: true });
    await cfgDoc("memberPrefs").set({ [target]: FieldValue.delete() }, { merge: true }).catch(() => {});
    await syncAuthMeta();
    return { status: 200, json: { ok: true } };
  }

  async function actCreateGuest(body) {
    const session = await requireMemberSession(body.token);
    if (!session) return { status: 401, json: { ok: false, reason: "auth" } };
    const name = String(body.name || "").trim().slice(0, 80);
    const password = String(body.password || "");
    const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;
    if (!name || normPasswordInput(password).length < 4) return { status: 400, json: { ok: false, reason: "invalid" } };
    const hash = hashPassword(password);
    // Nicht identisch mit Gruppen-/persönlichem Passwort
    const memberHashes = await getMemberHashes();
    if (timingEqualHex(hash, await getGroupHash()) || Object.values(memberHashes).includes(hash)) {
      return { status: 200, json: { ok: false, reason: "taken" } };
    }
    const ref = col("guests").doc();
    await ref.set({
      name, expiresAt: expiresAt || null,
      createdBy: session.member, createdAt: FieldValue.serverTimestamp(),
    });
    await col("guestAuth").doc(ref.id).set({ hash });
    return { status: 200, json: { ok: true, id: ref.id } };
  }

  async function actDeleteGuest(body) {
    const session = await requireMemberSession(body.token);
    if (!session) return { status: 401, json: { ok: false, reason: "auth" } };
    const id = String(body.id || "");
    if (!id) return { status: 400, json: { ok: false, reason: "id" } };
    await col("guests").doc(id).delete().catch(() => {});
    await col("guestAuth").doc(id).delete().catch(() => {});
    return { status: 200, json: { ok: true } };
  }

  async function actLogout(body) {
    if (body.token) await col("authSessions").doc(String(body.token)).delete().catch(() => {});
    return { status: 200, json: { ok: true } };
  }

  // Verschiebt Legacy-Gast-Hashes aus dem öffentlichen guests-Doc nach guestAuth
  // und initialisiert authMeta. Einmalig (idempotent) per POST {action:"migrate", secret}.
  async function actMigrate(body) {
    if (!opts.migrateSecret || body.secret !== opts.migrateSecret) {
      return { status: 401, json: { ok: false, reason: "auth" } };
    }
    const guests = await col("guests").get();
    let moved = 0;
    for (const d of guests.docs) {
      const g = d.data() || {};
      if (g.hash) {
        await col("guestAuth").doc(d.id).set({ hash: g.hash }, { merge: true });
        await col("guests").doc(d.id).set({ hash: FieldValue.delete() }, { merge: true });
        moved++;
      }
    }
    const withPersonal = await syncAuthMeta();
    return { status: 200, json: { ok: true, movedGuestHashes: moved, withPersonal } };
  }

  const HANDLERS = {
    login: actLogin,
    guestLogin: actGuestLogin,
    changePassword: actChangePassword,
    changeShared: actChangeShared,
    setGroupDefault: actSetGroupDefault,
    clearPersonal: actClearPersonal,
    createGuest: actCreateGuest,
    deleteGuest: actDeleteGuest,
    logout: actLogout,
    migrate: actMigrate,
  };

  return async function handler(req, res) {
    applyCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "method" });

    const body = req.body || {};
    const action = String(body.action || "");
    const fn = HANDLERS[action];
    if (!fn) return res.status(400).json({ ok: false, reason: "unknown-action" });

    const ip = (req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim() || "unknown";
    try {
      const passIp = ["login", "guestLogin"].includes(action);
      const out = await fn(body, passIp ? ip : undefined);
      return res.status(out.status).json(out.json);
    } catch (e) {
      console.error("authApi error", action, e);
      return res.status(500).json({ ok: false, reason: "server" });
    }
  };
}

module.exports = { createAuthApi, hashPassword, normPasswordInput };
