// Home service logic
import * as jose from "@panva/jose";
import { connectDB } from "./db.js";
import { log } from "./logging.js";
log("Home module loaded", "gray");
const db = connectDB();
export async function createPost(token, content) {
  if (!token || !content) return false;
  log(`createPost called with: ${token}, ${content}`);
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

    const ts = Date.now();
    db.exec(
      `INSERT INTO posts (uuid, user_id, content, ts) VALUES (?, ?, ?, ?)`,
      [crypto.randomUUID(), id, content, ts],
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

export async function editPost(token, postId, content) {
  log(
    `editPost called with: { postId: ${postId}, token: ${token}, content: ${content} }`,
  );
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
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
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  let id;
    try {
      const { payload } = await jose.jwtVerify(token, secret);
      if (payload.exp < Date.now() / 1000) {
        console.log("Token expired");
        return false;
      }
      const stmt = db.prepare(`SELECT uuid FROM users WHERE token = ?`);
      const user = stmt.all(token)[0];
      console.log("User from token verification: ", user);
      if (!user) {
        return false;
      }
      id = user.uuid.toString();
      console.log("User ID from token verification: ", id);
      if (payload.uuid !== id) {
        return false;
      }
    const post = db.prepare(`SELECT users_liked FROM posts WHERE id = ?`, [
      postId,
    ]);
    const liked = post.all(1)[0].users_liked;
    if (!liked.includes(id)) {
      db.exec(
        `UPDATE posts SET users_liked = json_insert(users_liked, '$[#]', ?), likes = likes + 1 WHERE id = ? AND users_liked NOT LIKE '%' || ? || '%'`,
        [id, postId, id],
      );
    } else {
      const post = db.prepare(`SELECT users_liked FROM posts WHERE id = ?`, [
        postId,
      ]);
      const likedBase = post.all(1)[0].users_liked;
      const liked = JSON.parse(likedBase);
      const index = liked.indexOf(id);

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
