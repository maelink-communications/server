// Guilds service
import { connectDB, logChange } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
const db = connectDB();
log("Guilds module loaded", "gray");
export async function createGuild(token, name, description) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = crypto.randomUUID();
    db.exec(
      `INSERT INTO guilds (uuid, name, description, ownerID) VALUES (?, ?, ?, ?)`,
      [id, name, description, payload.uuid],
    );
    logChange("guilds", "INSERT", id, { uuid, name, description, ownerID: payload.uuid });
    return { id, name, description };
  } catch (e) {
    throw e;
  }
}

export async function fetchGuilds(token) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const offset = (page - 1) * 25;
  const stmt = db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM guilds ORDER BY id DESC LIMIT 25 OFFSET ?`,
  );
  const posts = stmt.all(offset);
  return posts;
  } catch (e) {
    throw e;
  }
}