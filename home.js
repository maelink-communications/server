// Home service logic
import * as jose from "@panva/jose";
import { connectDB } from "./db.js";
import { log } from "./logging.js";
log("Home module loaded", "gray");
const db = connectDB();
export async function createPost(token, userId, content) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      throw new Error("Unauthorized");
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }
    db.exec(
      `INSERT INTO posts (uuid, user_id, content, ts) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, content, Date.now()],
    );
    return true;
  } catch (e) {
    throw e;
  }
}

export async function fetchPosts(page) {
  const offset = (page - 1) * 25;
  const stmt = db.prepare(
    `SELECT * FROM posts ORDER BY id DESC LIMIT 25 OFFSET ?`,
  );
  const posts = stmt.all(offset);
  return posts;
}

export async function editPost(token, postId, userId, content) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      throw new Error("Unauthorized");
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }
    db.exec(
      `UPDATE posts SET content = ?, ts = ? WHERE id = ? AND user_id = ?`,
      [content, Date.now(), postId, userId],
    );
    return true;
  } catch (e) {
    throw e;
  }
}

export async function destroyPost(token, postId, userId) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      throw new Error("Unauthorized");
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }
    db.exec(
      `DELETE FROM posts WHERE id = ? AND user_id = ?`,
      [postId, userId],
    );
    return true;
  } catch (e) {
    throw e;
  }
}