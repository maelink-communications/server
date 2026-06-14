// Home service logic
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
log("Home module loaded", "gray");
const db = connectDB();

async function resolveUser(token) {
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) throw new Error("User not found");
  return payload.uuid;
}

async function resolveUsername(token) {
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT username FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) throw new Error("User not found");
  return user[0];
}

export async function createPost(token, content) {
  if (!token || !content) return false;
  log(`createPost called with: ${token}, ${content}`);
  try {
    const id = await resolveUser(token);
    const author = await resolveUsername(token);
    const ts = Date.now();
    const postUuid = crypto.randomUUID();
    db.prepare(
      `INSERT INTO posts (uuid, user_id, content, ts, author) VALUES (?, ?, ?, ?, ?)`
    ).run(postUuid, id, content, ts, author);
    const postId = db.prepare(`SELECT id FROM posts WHERE uuid = ?`).value(postUuid)?.[0];
    return { error: false, content: content, postId, postUuid, ts: ts };
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
    const postUuid = db.prepare(`SELECT uuid FROM posts WHERE id = ?`).value(postId)?.[0];
    if (!postUuid) return false;
    db.exec(
      `UPDATE posts SET content = ?, ts = ? WHERE id = ? AND user_id = ?`,
      [content, Date.now(), postId, id],
    );
    return true;
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
    const postUuid = db.prepare(`SELECT uuid FROM posts WHERE id = ?`).value(postId)?.[0];
    if (!postUuid) return false;
    db.exec(`DELETE FROM posts WHERE id = ? AND user_id = ?`, [postId, id]);
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
    const post = db.prepare(`SELECT uuid, users_liked FROM posts WHERE id = ?`).value(postId);
    if (!post) {
      log(`Post ${postId} not found`, "red");
      return false;
    }
    const liked = JSON.parse(post[1] || '[]');
    if (!liked.includes(id)) {
      db.prepare(
        `UPDATE posts SET users_liked = json_insert(users_liked, '$[#]', ?), likes = likes + 1 WHERE id = ? AND users_liked NOT LIKE '%"' || ? || '"%'
        `
      ).run(id, postId, id);
    } else {
      const index = liked.indexOf(id);
      if (index > -1) {
        liked.splice(index, 1);
        db.prepare(`UPDATE posts SET users_liked = ?, likes = likes - 1 WHERE id = ?`)
          .run(JSON.stringify(liked), postId);
      }
    }
    return true;
  } catch (e) {
    throw e;
  }
}
