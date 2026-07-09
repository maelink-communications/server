// Home service logic
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { emitHomePost, emitHomePostEdit, emitHomePostDelete } from "./socket.js";
log("Home module loaded", "gray");
const db = connectDB();

function normalizeId(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value ?? null;
}

async function resolveUser(token) {
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) throw new Error("User not found");
  return payload.uuid;
}

export async function resolveUsername(token) {
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT username FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) throw new Error("User not found");
  return user[0];
}

export async function createPost(token, content, clientId) {
  if (!token || !content) return false;
  log(`createPost called with: ${token}, ${content}`);
  try {
    const id = await resolveUser(token);
    const author = await resolveUsername(token);
    const ts = Date.now();
    const postUuid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO posts (uuid, user_id, content, ts, author, client) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(postUuid, id, content, ts, author, clientId || "unknown");
    const createdPost = db.prepare(`SELECT id FROM posts WHERE uuid = ?`).get(postUuid);
    const postId = normalizeId(createdPost?.id ?? null);
    const post = { error: false, content, postId, postUuid, ts, author, clientId };
    emitHomePost(post);
    return post;
  } catch (e) {
    throw e;
  }
}

export async function fetchPosts(page) {
  const offset = (page - 1) * 25;
  const stmt = db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM posts ORDER BY id DESC LIMIT 25 OFFSET ?`,
  );
  const posts = stmt.all(offset);
  return posts;
}

export async function editPost(token, postId, content) {
  log(`editPost called with: { postId: ${postId}, token: ${token}, content: ${content} }`);
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const postUuid = db.prepare(`SELECT uuid FROM posts WHERE id = ?`).value(normalizedPostId);
    if (!postUuid) return false;
    db.prepare(
      `UPDATE posts SET content = ?, ts = ? WHERE id = ? AND user_id = ?`
    ).run(content, Date.now(), normalizedPostId, id);
    const { ts, author } = db.prepare(`SELECT ts, author FROM posts WHERE id = ?`).get(normalizedPostId);
    emitHomePostEdit(postId, content);
    return { error: false, content, postId, postUuid, ts, author };
  } catch (e) {
    throw e;
  }
}

export async function destroyPost(token, postId) {
  log(`destroyPost called with: { postId: ${postId}, token: ${token} }`);
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const postUuid = db.prepare(`SELECT uuid FROM posts WHERE id = ?`).value(normalizedPostId);
    if (!postUuid) return false;
    db.prepare(`DELETE FROM posts WHERE id = ? AND user_id = ?`).run(normalizedPostId, id);
    emitHomePostDelete(postId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function postLikeSet(token, postId) {
  log(`postLikeSet called with: { postId: ${postId}, token: ${token} }`);
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const post = db.prepare(`SELECT uuid, users_liked FROM posts WHERE id = ?`).get(normalizedPostId);
    if (!post) {
      log(`Post ${normalizedPostId} not found`, "red");
      return false;
    }
    const liked = JSON.parse(post.users_liked || '[]');
    if (!liked.includes(id)) {
      liked.push(id);
      db.prepare(`UPDATE posts SET users_liked = ?, likes = likes + 1 WHERE id = ?`)
        .run(JSON.stringify(liked), normalizedPostId);
    } else {
      const index = liked.indexOf(id);
      if (index > -1) {
        liked.splice(index, 1);
        db.prepare(`UPDATE posts SET users_liked = ?, likes = likes - 1 WHERE id = ?`)
          .run(JSON.stringify(liked), normalizedPostId);
      }
    }
    log(`Post ${normalizedPostId} like status updated for user ${id}`, "green");
    return true;
  } catch (e) {
    throw e;
  }
}
