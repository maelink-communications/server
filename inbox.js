import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { emitInboxMessage } from "./socket.js";
log("Inbox module loaded", "gray");
const db = connectDB();

async function resolveUser(token) {
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) throw new Error("User not found");
  return payload.uuid;
}

export async function sendMessage(recipient, content, senderDisplay) {
  const stmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const recip = stmt.all(recipient)[0];
  if (!recip) return { error: "Recipient not found" };
  const messageId = crypto.randomUUID();
  const ts = Date.now();
  db.exec(
    `INSERT INTO inbox (id, user_id, sender_id, content, ts, read) VALUES (?, ?, ?, ?, ?, 0)`,
    [messageId, recip.uuid, senderDisplay, content, ts],
  );
  emitInboxMessage(recip.uuid, { id: messageId, sender_id: senderDisplay, content, ts, read: 0 });
  return true;
}

export async function fetchMessages(token, page) {
  let id;
  try {
    id = await resolveUser(token);
  } catch {
    return false;
  }
  const offset = (page - 1) * 25;
  const stmt = db.prepare(`SELECT *, CAST(ts AS REAL) as ts FROM inbox WHERE user_id = ? ORDER BY id DESC LIMIT 25 OFFSET ?`);
  const messages = stmt.all(id, offset);
  return messages;
}

export async function deleteMessage(messageId, userId) {
  db.exec(`DELETE FROM inbox WHERE id = ? AND user_id = ?`, [
    messageId,
    userId,
  ]);
  return true;
}

export async function setRead(messageId, token) {
  let id;
  try {
    id = await resolveUser(token);
  } catch {
    return false;
  }
  db.exec(`UPDATE inbox SET read = 1 WHERE id = ? AND user_id = ?`, [
    messageId,
    id,
  ]);
  return true;
}

export async function checkNewMessages(token) {
  let id;
  try {
    id = await resolveUser(token);
  } catch {
    return false;
  }
  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM inbox WHERE user_id = ? AND read = 0`
  );
  const result = stmt.all(id)[0];
  return result.count > 0;
}
