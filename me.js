import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { normalizeMediaUrl } from "./uploads.js";

const db = connectDB();
const PAGE_SIZE = 25;

if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("User module loaded", "gray");
}

export class UserError extends Error {
  constructor(message, status = 400, code = "USER_ERROR") {
    super(message);
    this.name = "UserError";
    this.status = status;
    this.code = code;
  }
}

async function authenticatedUser(token) {
  if (!token) {
    throw new UserError("Authentication required", 401, "AUTH_REQUIRED");
  }
  const payload = await verifyToken(token);
  const user = db.prepare(
    `SELECT uuid, username, pfp, bio FROM users WHERE uuid = ?`,
  ).get(payload.uuid);
  if (!user) throw new UserError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

function targetUser(identifier) {
  if (typeof identifier !== "string" || !identifier.trim()) {
    throw new UserError("User not found", 404, "USER_NOT_FOUND");
  }
  const value = identifier.trim();
  const user = db.prepare(
    `SELECT uuid, username, pfp, bio
     FROM users WHERE uuid = ? OR username = ?`,
  ).get(value, value);
  if (!user) throw new UserError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

function pageOffset(page) {
  const normalized = Number(page);
  if (!Number.isInteger(normalized) || normalized < 1) {
    throw new UserError("page must be a positive integer", 400, "INVALID_PAGE");
  }
  return { page: normalized, offset: (normalized - 1) * PAGE_SIZE };
}

function followCounts(userId) {
  const row = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM followers WHERE followedID = ?) AS followerCount,
       (SELECT COUNT(*) FROM followers WHERE followerID = ?) AS followingCount`,
  ).get(userId, userId);
  return {
    followerCount: Number(row?.followerCount ?? 0),
    followingCount: Number(row?.followingCount ?? 0),
  };
}

function relationship(viewerId, targetId) {
  const following = Boolean(
    db.prepare(
      `SELECT 1 FROM followers WHERE followerID = ? AND followedID = ?`,
    ).get(viewerId, targetId),
  );
  const followedBy = Boolean(
    db.prepare(
      `SELECT 1 FROM followers WHERE followerID = ? AND followedID = ?`,
    ).get(targetId, viewerId),
  );
  return { following, followedBy, mutual: following && followedBy };
}

export async function fetchUser(token, identifier) {
  const viewer = await authenticatedUser(token);
  const user = targetUser(identifier);
  const followers = db.prepare(
    `SELECT u.uuid, u.username, u.pfp
     FROM followers f
     JOIN users u ON u.uuid = f.followerID
     WHERE f.followedID = ?
     ORDER BY u.username`,
  ).all(user.uuid);
  return {
    ...user,
    ...followCounts(user.uuid),
    relationship: relationship(viewer.uuid, user.uuid),
    followers,
  };
}

export async function fetchUserPosts(token, identifier, page = 1) {
  await authenticatedUser(token);
  const user = targetUser(identifier);
  const { offset } = pageOffset(page);
  return db.prepare(
    `SELECT p.*, CAST(p.ts AS REAL) AS ts,
            u.uuid AS authorUuid, u.username AS authorUsername,
            u.bio AS authorBio
     FROM posts p
     LEFT JOIN users u ON u.uuid = p.user_id
     WHERE p.user_id = ?
     ORDER BY p.id DESC LIMIT ? OFFSET ?`,
  ).all(user.uuid, PAGE_SIZE, offset).map((post) => {
    let attachments;
    try {
      attachments = JSON.parse(post.attachments || "[]");
    } catch {
      attachments = [];
    }
    return {
      id: post.id,
      userId: post.user_id,
      author: {
        uuid: post.authorUuid ?? post.user_id,
        username: post.authorUsername ?? post.author,
        bio: post.authorBio ?? null,
      },
      uuid: post.uuid,
      content: post.content,
      ts: post.ts,
      client: post.client,
      likes: post.likes,
      usersLiked: post.users_liked,
      replyCount: post.reply_count,
      commentCount: post.comment_count,
      attachments,
    };
  });
}

export async function editUser(token, username, pfp, bio) {
  const user = await authenticatedUser(token);
  const updates = [];
  const values = [];

  if (username?.trim().length > 2 && username.trim().length < 25) {
    updates.push("username = ?");
    values.push(username.trim());
  }
  if (pfp !== undefined) {
    updates.push("pfp = ?");
    values.push(normalizeMediaUrl(pfp, "pfp"));
  }
  if (bio?.trim().length > 0 && bio.trim().length < 1025) {
    updates.push("bio = ?");
    values.push(bio.trim());
  }
  if (updates.length === 0) return false;

  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE uuid = ?`)
    .run(...values, user.uuid);
  return true;
}

export async function followUser(token, identifier) {
  const follower = await authenticatedUser(token);
  const followed = targetUser(identifier);
  if (follower.uuid === followed.uuid) {
    throw new UserError(
      "You cannot follow yourself",
      400,
      "CANNOT_FOLLOW_SELF",
    );
  }

  const existed = relationship(follower.uuid, followed.uuid).following;
  if (!existed) {
    db.prepare(
      `INSERT INTO followers (followerID, followedID) VALUES (?, ?)`,
    ).run(follower.uuid, followed.uuid);
  }
  return {
    userId: followed.uuid,
    username: followed.username,
    following: true,
    created: !existed,
  };
}

export async function unfollowUser(token, identifier) {
  const follower = await authenticatedUser(token);
  const followed = targetUser(identifier);
  const existed = relationship(follower.uuid, followed.uuid).following;
  if (existed) {
    db.prepare(
      `DELETE FROM followers WHERE followerID = ? AND followedID = ?`,
    ).run(follower.uuid, followed.uuid);
  }
  return {
    userId: followed.uuid,
    username: followed.username,
    following: false,
    removed: existed,
  };
}

export async function getRelationship(token, identifier) {
  const viewer = await authenticatedUser(token);
  const target = targetUser(identifier);
  return {
    userId: target.uuid,
    username: target.username,
    ...relationship(viewer.uuid, target.uuid),
  };
}

async function listConnections(token, identifier, page, direction) {
  await authenticatedUser(token);
  const target = targetUser(identifier);
  const pagination = pageOffset(page);
  const followers = direction === "followers";
  const connectionColumn = followers ? "f.followerID" : "f.followedID";
  const filterColumn = followers ? "f.followedID" : "f.followerID";
  const rows = db.prepare(
    `SELECT u.uuid, u.username, u.pfp, u.bio
     FROM followers f
     JOIN users u ON u.uuid = ${connectionColumn}
     WHERE ${filterColumn} = ?
     ORDER BY u.username
     LIMIT ? OFFSET ?`,
  ).all(target.uuid, PAGE_SIZE + 1, pagination.offset);
  return {
    userId: target.uuid,
    username: target.username,
    page: pagination.page,
    users: rows.slice(0, PAGE_SIZE),
    hasMore: rows.length > PAGE_SIZE,
  };
}

export function listFollowers(token, identifier, page = 1) {
  return listConnections(token, identifier, page, "followers");
}

export function listFollowing(token, identifier, page = 1) {
  return listConnections(token, identifier, page, "following");
}
