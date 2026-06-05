/**
 * WG-Einkaufs- / Vorratsliste (Pfeffer, Öl, Küchenpapier, …)
 * Collection: einkaufsliste
 */

const { FieldValue } = require("firebase-admin/firestore");

const COLLECTION = "einkaufsliste";

function parseEinkaufCommand(raw) {
  const s = String(raw || "").trim();
  const low = s.toLowerCase();
  if (/^(einkaufsliste|einkauf\s*liste|vorratsliste|was\s+fehlt|was\s+brauchen\s+wir)\s*[?.!]*$/i.test(s)) {
    return { action: "list" };
  }
  let m = s.match(/^(?:auf\s+die\s+liste|liste|einkauf)\s*[:\-–]?\s*(.+)$/i);
  if (m) return { action: "add", item: m[1].trim() };
  m = s.match(/^(.+?)\s+auf\s+die\s+liste\s*$/i);
  if (m) return { action: "add", item: m[1].trim() };
  m = s.match(/^(.+?)\s+(?:erledigt|gekauft|haben\s+wir)\s*$/i);
  if (m && !/\b(putz|garten|schaden|event)\b/i.test(m[1])) return { action: "done", item: m[1].trim() };
  m = s.match(/^(?:entfernen|löschen|loeschen|weg)\s*[:\-–]?\s*(.+)$/i);
  if (m) return { action: "remove", item: m[1].trim() };
  return null;
}

function itemMatches(stored, hint) {
  const a = String(stored || "").toLowerCase().trim();
  const b = String(hint || "").toLowerCase().trim();
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function listOpenItems(db) {
  const snap = await db.collection(COLLECTION).where("done", "==", false).get();
  const items = [];
  snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
  items.sort((a, b) => {
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return ta - tb;
  });
  return items;
}

async function addItem(db, item, addedBy) {
  const name = String(item || "").trim().slice(0, 80);
  if (!name) return null;
  const open = await listOpenItems(db);
  const dup = open.find((x) => itemMatches(x.item, name));
  if (dup) return { duplicate: true, item: dup };
  const ref = await db.collection(COLLECTION).add({
    item: name,
    addedBy: addedBy || "",
    done: false,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, item: name };
}

async function markItemDone(db, hint, who) {
  const open = await listOpenItems(db);
  const matches = open.filter((x) => itemMatches(x.item, hint));
  if (!matches.length) return { found: false };
  const one = matches.length === 1 ? matches[0] : matches[0];
  await db.collection(COLLECTION).doc(one.id).update({
    done: true,
    doneBy: who || "",
    doneAt: FieldValue.serverTimestamp(),
  });
  return { found: true, item: one.item, multiple: matches.length > 1 };
}

async function removeItem(db, hint) {
  const open = await listOpenItems(db);
  const matches = open.filter((x) => itemMatches(x.item, hint));
  if (!matches.length) return { found: false };
  await db.collection(COLLECTION).doc(matches[0].id).delete();
  return { found: true, item: matches[0].item };
}

function formatListReply(items) {
  if (!items.length) return "🛒 *Einkaufsliste* ist leer – alles da! ✅";
  const lines = items.map((x) => {
    const by = x.addedBy ? ` _(${x.addedBy})_` : "";
    return `• ${x.item}${by}`;
  });
  return (
    `🛒 *Einkaufsliste* (${items.length}):\n\n${lines.join("\n")}\n\n` +
    "_Hinzufügen: «Pfeffer auf die Liste» · Erledigt: «Pfeffer erledigt»_"
  );
}

module.exports = {
  parseEinkaufCommand,
  listOpenItems,
  addItem,
  markItemDone,
  removeItem,
  formatListReply,
};
