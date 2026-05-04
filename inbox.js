import { connectDB } from "./db.js";
import { log } from "./logging.js";
import * as jose from "@panva/jose";
log("Inbox module loaded", "gray");
const db = connectDB();

export async function sendMessage(recipient, content, senderDisplay) {
  const stmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const recip = stmt.all(recipient)[0];
  if (!recip) return { error: "Recipient not found" };
  db.exec(
    `INSERT INTO inbox (id, user_id, sender_id, content, ts, read) VALUES (?, ?, ?, ?, ?, 0)`,
    [crypto.randomUUID(), recip.uuid, senderDisplay, content, Date.now()],
  );
  return true;
}

export async function fetchMessages(token, page) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));

  let id;
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const stmt = db.prepare(`SELECT uuid FROM users WHERE token = ?`);
    const user = stmt.all(token)[0];
    if (!user) {
      return false;
    }
    id = user.uuid.toString();
    if (payload.uuid !== id) {
      return false;
    }
  } catch (e) {
    console.log(e);
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
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  let id;
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const stmt = db.prepare(`SELECT uuid FROM users WHERE token = ?`);
    const user = stmt.all(token)[0];
    if (!user) {
      return false;
    }
    id = user.uuid.toString();
    if (payload.uuid !== id) {
      return false;
    }
  } catch (e) {
    log("Error verifying token: " + e, "red");
    return false;
  }
  db.exec(`UPDATE inbox SET read = 1 WHERE id = ? AND user_id = ?`, [
    messageId,
    id,
  ]);
  return true;
}

export async function checkNewMessages(token) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));

  let id;
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const stmt = db.prepare(`SELECT uuid FROM users WHERE token = ?`);
    const user = stmt.all(token)[0];
    if (!user) {
      return false;
    }
    id = user.uuid.toString();
    if (payload.uuid !== id) {
      return false;
    }
  } catch (e) {
    console.log(e);
    return false;
  }
  const stmt = db.prepare(
    `SELECT COUNT(*) as count FROM inbox WHERE user_id = ? AND read = 0`
  );
  const result = stmt.all(id)[0];
  return result.count > 0;
}
