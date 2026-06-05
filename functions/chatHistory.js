/**
 * Kurzzeit-Chat-Verlauf pro WhatsApp-Nummer (für Gustav / OpenAI).
 * GUSTAV_CHAT_HISTORY=off zum Deaktivieren.
 */

const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const COLLECTION = "gustavChatHistory";
const MAX_MESSAGES = 12;
const MAX_MSG_CHARS = 2000;

function isChatHistoryEnabled() {
  const v = (process.env.GUSTAV_CHAT_HISTORY || "1").toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

function phoneDocId(from) {
  const key = String(from || "").replace(/\D/g, "");
  return key || "unknown";
}

function trimMessages(messages) {
  return (messages || [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({
      role: m.role,
      content: String(m.content).slice(0, MAX_MSG_CHARS),
    }))
    .slice(-MAX_MESSAGES);
}

async function loadChatHistory(from) {
  if (!isChatHistoryEnabled()) return [];
  const db = getFirestore();
  const id = phoneDocId(from);
  try {
    const snap = await db.collection(COLLECTION).doc(id).get();
    if (!snap.exists) return [];
    return trimMessages(snap.data()?.messages);
  } catch {
    return [];
  }
}

async function appendChatHistory(from, userText, assistantText) {
  if (!isChatHistoryEnabled()) return;
  const user = String(userText || "").trim().slice(0, MAX_MSG_CHARS);
  const assistant = String(assistantText || "").trim().slice(0, MAX_MSG_CHARS);
  if (!user || !assistant) return;

  const db = getFirestore();
  const id = phoneDocId(from);
  const ref = db.collection(COLLECTION).doc(id);
  const snap = await ref.get();
  const prev = trimMessages(snap.exists ? snap.data()?.messages : []);
  const messages = trimMessages([
    ...prev,
    { role: "user", content: user },
    { role: "assistant", content: assistant },
  ]);

  await ref.set({
    messages,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function clearChatHistory(from) {
  const db = getFirestore();
  const id = phoneDocId(from);
  try {
    await db.collection(COLLECTION).doc(id).delete();
  } catch {
    /* ignore */
  }
}

module.exports = {
  isChatHistoryEnabled,
  loadChatHistory,
  appendChatHistory,
  clearChatHistory,
};
