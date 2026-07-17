// Home service logic
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { normalizeAttachments } from "./uploads.js";
import {
  emitHomeDiscussion,
  emitHomePost,
  emitHomePostEdit,
  emitHomePostDelete,
  emitHomePostLike,
} from "./socket.js";
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Home module loaded", "gray");
}
const db = connectDB();

function normalizeId(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return value ?? null;
}

async function resolveUser(token) {
  const payload = await verifyToken(token);
  const user = db
    .prepare(`SELECT uuid FROM users WHERE uuid = ?`)
    .value(payload.uuid);
  if (!user) throw new Error("User not found");
  return payload.uuid;
}

async function resolveAuthor(token) {
  const payload = await verifyToken(token);
  const user = db
    .prepare(`SELECT uuid, username, bio FROM users WHERE uuid = ?`)
    .get(payload.uuid);
  if (!user) throw new Error("User not found");
  return user;
}

function postAuthor(post) {
  return {
    uuid: post.authorUuid ?? post.user_id,
    username: post.authorUsername ?? post.author,
    bio: post.authorBio ?? null,
  };
}

function publicPost(post) {
  let attachments;
  try {
    attachments = JSON.parse(post.attachments || "[]");
  } catch {
    attachments = [];
  }
  return {
    id: post.id,
    userId: post.user_id,
    author: postAuthor(post),
    uuid: post.uuid,
    content: post.content,
    ts: post.ts,
    clientId: post.client,
    likes: post.likes,
    usersLiked: likedUsers(post.users_liked),
    replyCount: post.reply_count,
    commentCount: post.comment_count,
    attachments,
  };
}

function publicDiscussion(row) {
  const result = {
    id: row.id,
    uuid: row.uuid,
    postId: row.post_id,
    userId: row.user_id,
    content: row.content,
    ts: row.ts,
    author: row.author,
    pfp: row.pfp,
  };
  if (Object.hasOwn(row, "parent_reply_id")) {
    result.parentReplyId = row.parent_reply_id;
  }
  if (Object.hasOwn(row, "likes")) result.likes = row.likes;
  return result;
}

function likedUsers(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolvePost(postId) {
  if (postId === undefined || postId === null) return null;
  const value = String(postId);
  return db
    .prepare(
      `SELECT id, uuid FROM posts WHERE uuid = ? OR CAST(id AS TEXT) = ?`,
    )
    .get(value, value);
}

function discussionContent(content) {
  if (typeof content !== "string" || !content.trim()) return null;
  const normalized = content.trim();
  return normalized.length <= 4000 ? normalized : null;
}

function discussionRow(table, identifier) {
  const value = String(identifier);
  return db
    .prepare(
      `SELECT d.*, u.username AS author, u.pfp
     FROM ${table} d
     LEFT JOIN users u ON u.uuid = d.user_id
     WHERE d.uuid = ? OR CAST(d.id AS TEXT) = ?`,
    )
    .get(value, value);
}

export async function createComment(token, postId, content) {
  const userId = await resolveUser(token);
  const post = resolvePost(postId);
  const normalized = discussionContent(content);
  if (!post || !normalized) return false;
  const uuid = crypto.randomUUID();
  const ts = Date.now();
  db.prepare(
    `INSERT INTO comments (uuid, post_id, user_id, content, ts)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(uuid, post.uuid, userId, normalized, ts);
  db.prepare(
    `UPDATE posts SET comment_count = comment_count + 1 WHERE uuid = ?`,
  ).run(post.uuid);
  const comment = discussionRow("comments", uuid);
  emitHomeDiscussion("comment:create", post.uuid, comment);
  return publicDiscussion(comment);
}

export async function fetchComments(token, postId) {
  await resolveUser(token);
  const post = resolvePost(postId);
  if (!post) return false;
  return db
    .prepare(
      `SELECT c.*, u.username AS author, u.pfp
     FROM comments c
     LEFT JOIN users u ON u.uuid = c.user_id
     WHERE c.post_id = ? ORDER BY c.id ASC`,
    )
    .all(post.uuid)
    .map(publicDiscussion);
}

export async function deleteComment(token, postId, commentId) {
  const userId = await resolveUser(token);
  const post = resolvePost(postId);
  const comment = discussionRow("comments", commentId);
  if (
    !post ||
    !comment ||
    comment.post_id !== post.uuid ||
    comment.user_id !== userId
  ) {
    return false;
  }
  db.prepare(`DELETE FROM comments WHERE id = ?`).run(comment.id);
  db.prepare(
    `UPDATE posts SET comment_count = MAX(comment_count - 1, 0) WHERE uuid = ?`,
  ).run(post.uuid);
  emitHomeDiscussion("comment:delete", post.uuid, {
    id: comment.id,
    uuid: comment.uuid,
  });
  return true;
}

export async function createReply(
  token,
  postId,
  content,
  parentReplyId = null,
) {
  const userId = await resolveUser(token);
  const post = resolvePost(postId);
  const normalized = discussionContent(content);
  if (!post || !normalized) return false;
  let parentUuid = null;
  if (parentReplyId !== null && parentReplyId !== undefined) {
    const parent = discussionRow("replies", parentReplyId);
    if (!parent || parent.post_id !== post.uuid) return false;
    parentUuid = parent.uuid;
  }
  const uuid = crypto.randomUUID();
  const ts = Date.now();
  db.prepare(
    `INSERT INTO replies (uuid, post_id, user_id, parent_reply_id, content, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uuid, post.uuid, userId, parentUuid, normalized, ts);
  db.prepare(
    `UPDATE posts SET reply_count = reply_count + 1 WHERE uuid = ?`,
  ).run(post.uuid);
  const reply = discussionRow("replies", uuid);
  emitHomeDiscussion("reply:create", post.uuid, reply);
  return publicDiscussion(reply);
}

export async function fetchReplies(token, postId) {
  await resolveUser(token);
  const post = resolvePost(postId);
  if (!post) return false;
  return db
    .prepare(
      `SELECT r.*, u.username AS author, u.pfp
     FROM replies r
     LEFT JOIN users u ON u.uuid = r.user_id
     WHERE r.post_id = ? ORDER BY r.id ASC`,
    )
    .all(post.uuid)
    .map(publicDiscussion);
}

export async function deleteReply(token, postId, replyId) {
  const userId = await resolveUser(token);
  const post = resolvePost(postId);
  const reply = discussionRow("replies", replyId);
  if (
    !post ||
    !reply ||
    reply.post_id !== post.uuid ||
    reply.user_id !== userId
  ) {
    return false;
  }
  const descendants =
    db
      .prepare(
        `WITH RECURSIVE tree(uuid) AS (
       SELECT uuid FROM replies WHERE uuid = ?
       UNION ALL
       SELECT r.uuid FROM replies r JOIN tree t ON r.parent_reply_id = t.uuid
     ) SELECT COUNT(*) AS count FROM tree`,
      )
      .get(reply.uuid)?.count ?? 1;
  db.prepare(`DELETE FROM replies WHERE uuid = ?`).run(reply.uuid);
  db.prepare(
    `UPDATE posts SET reply_count = MAX(reply_count - ?, 0) WHERE uuid = ?`,
  ).run(Number(descendants), post.uuid);
  emitHomeDiscussion("reply:delete", post.uuid, {
    id: reply.id,
    uuid: reply.uuid,
  });
  return true;
}

export async function createPost(token, content, clientId, attachmentsValue) {
  if (!token) return false;
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(`createPost called with: ${token}, ${content}`);
  }
  try {
    const author = await resolveAuthor(token);
    const id = author.uuid;
    const ts = Date.now();
    const postUuid = crypto.randomUUID();
    const attachments = normalizeAttachments(attachmentsValue);
    if ((!content || !String(content).trim()) && attachments.length === 0) {
      return false;
    }
    db.prepare(
      `INSERT INTO posts (uuid, user_id, content, ts, author, client, attachments, likes, users_liked, reply_count, comment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      postUuid,
      id,
      content || "",
      ts,
      author.username,
      clientId || "unknown",
      JSON.stringify(attachments),
      0,
      "[]",
      0,
      0,
    );
    const createdPost = db
      .prepare(`SELECT id FROM posts WHERE uuid = ?`)
      .get(postUuid);
    const postId = normalizeId(createdPost?.id ?? null);
    const post = {
      error: false,
      content: content || "",
      postId,
      postUuid,
      ts,
      author,
      clientId: clientId || "unknown",
      likes: 0,
      usersLiked: [],
      replyCount: 0,
      commentCount: 0,
      attachments,
    };
    emitHomePost(post);
    return post;
  } catch (e) {
    throw e;
  }
}

export async function fetchPosts(page, token) {
  const offset = (page - 1) * 25;
  if (page > 1) {
    const payload = await verifyToken(token);
    if (!payload) {
      return { error: true, msg: "Token invalid" };
    }
  }
  const stmt = db.prepare(
    `SELECT p.*, CAST(p.ts AS REAL) AS ts,
            u.uuid AS authorUuid, u.username AS authorUsername,
            u.bio AS authorBio
     FROM posts p
     LEFT JOIN users u ON u.uuid = p.user_id
     ORDER BY p.id DESC LIMIT 25 OFFSET ?`,
  );
  const posts = stmt.all(offset).map(publicPost);
  return posts;
}

export async function editPost(token, postId, content) {
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(
      `editPost called with: { postId: ${postId}, token: ${token}, content: ${content} }`,
    );
  }
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const post = db
      .prepare(`SELECT uuid, user_id FROM posts WHERE id = ?`)
      .get(normalizedPostId);
    if (!post) return false;
    if (post.user_id !== id) return false;
    db.prepare(
      `UPDATE posts SET content = ?, ts = ? WHERE id = ? AND user_id = ?`,
    ).run(content, Date.now(), normalizedPostId, id);
    const { ts, author } = db
      .prepare(`SELECT ts, author FROM posts WHERE id = ?`)
      .get(normalizedPostId);
    emitHomePostEdit(postId, content);
    return { error: false, content, postId, postUuid: post.uuid, ts, author };
  } catch (e) {
    throw e;
  }
}

export async function destroyPost(token, postId) {
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(`destroyPost called with: { postId: ${postId}, token: ${token} }`);
  }
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const postUuid = db
      .prepare(`SELECT uuid FROM posts WHERE id = ?`)
      .value(normalizedPostId);
    if (!postUuid) return false;
    db.prepare(`DELETE FROM posts WHERE id = ? AND user_id = ?`).run(
      normalizedPostId,
      id,
    );
    emitHomePostDelete(postId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function postLikeSet(token, postId) {
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(`postLikeSet called with: { postId: ${postId}, token: ${token} }`);
  }
  if (!postId || !token) {
    log("Missing postId or token, returning false", "red");
    return false;
  }
  try {
    const id = await resolveUser(token);
    const normalizedPostId = normalizeId(postId);
    if (!normalizedPostId) return false;
    const post = db
      .prepare(`SELECT uuid, users_liked FROM posts WHERE id = ?`)
      .get(normalizedPostId);
    if (!post) {
      log(`Post ${normalizedPostId} not found`, "red");
      return false;
    }
    const liked = likedUsers(post.users_liked);
    if (!liked.includes(id)) {
      liked.push(id);
      db.prepare(
        `UPDATE posts SET users_liked = ?, likes = likes + 1 WHERE id = ?`,
      ).run(JSON.stringify(liked), normalizedPostId);
    } else {
      const index = liked.indexOf(id);
      if (index > -1) {
        liked.splice(index, 1);
        db.prepare(
          `UPDATE posts SET users_liked = ?, likes = likes - 1 WHERE id = ?`,
        ).run(JSON.stringify(liked), normalizedPostId);
      }
    }
    emitHomePostLike(postId, JSON.stringify(liked));
    if (Deno.env.get("LOG_LEVEL") === "trace") {
      log(
        `Post ${normalizedPostId} like status updated for user ${id}`,
        "gray",
      );
    }
    return true;
  } catch (e) {
    throw e;
  }
}
