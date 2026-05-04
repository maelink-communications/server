// Home service logic
import * as jose from "@panva/jose";
import { connectDB } from "./db.js";
import { log } from "./logging.js";
log("Home module loaded", "gray");
const db = connectDB();
export async function createPost(token, userId, content) {
  if (!userId || !content) return false;
  log(`createPost called with: ${userId}, ${content}`);
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const ts = Date.now();
    db.exec(
      `INSERT INTO posts (uuid, user_id, content, ts) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, content, ts],
    );
    return { error: false, content: content, postId: db.lastInsertRowId, ts: ts };
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

export async function editPost(token, postId, userId, content) {
  log(
    `editPost called with: { postId: ${postId}, userId: ${userId}, content: ${content} }`,
  );
  if (!postId || !userId) {
    log("Missing postId or userId, returning false", "red");
    return false;
  }
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
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
  log(`destroyPost called with: { postId: ${postId}, userId: ${userId} }`);
  if (!postId || !userId) {
    log("Missing postId or userId, returning false", "red");
    return false;
  }
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    db.exec(`DELETE FROM posts WHERE id = ? AND user_id = ?`, [postId, userId]);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function postLikeSet(token, postId, userId) {
  log(`postLikeSet called with: { postId: ${postId}, userId: ${userId} }`);
  if (!postId || !userId) {
    log("Missing postId or userId, returning false", "red");
    return false;
  }
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const post = db.prepare(`SELECT users_liked FROM posts WHERE id = ?`, [
      postId,
    ]);
    const liked = post.all(1)[0].users_liked;
    if (!liked.includes(userId)) {
      db.exec(
        `UPDATE posts SET users_liked = json_insert(users_liked, '$[#]', ?), likes = likes + 1 WHERE id = ? AND users_liked NOT LIKE '%' || ? || '%'`,
        [userId, postId, userId],
      );
    } else {
      const post = db.prepare(`SELECT users_liked FROM posts WHERE id = ?`, [
        postId,
      ]);
      const likedBase = post.all(1)[0].users_liked;
      const liked = JSON.parse(likedBase);
      const index = liked.indexOf(userId);

      if (index > -1) {
        liked.splice(index, 1);
        db.exec(
          `UPDATE posts SET users_liked = ?, likes = likes - 1 WHERE id = ?`,
          [JSON.stringify(liked), postId],
        );
      }
    }
    return true;
  } catch (e) {
    throw e;
  }
}
