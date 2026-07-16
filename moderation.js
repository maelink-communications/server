import { connectDB } from "./db.js";
import { sendMessage } from "./inbox.js";
import {
  AccessError,
  ALL_PERMISSIONS,
  getUserByIdentifier,
  isMasterUser,
  listPermissions,
  PERMISSIONS,
  requirePermission,
  revokeSessions,
} from "./access.js";
import { disconnectUser, emitHomePostDelete } from "./socket.js";

const db = connectDB();

function audit(actorId, action, targetType, targetId, details = {}) {
  db.prepare(
    `INSERT INTO moderation_audit
      (actorID, action, targetType, targetID, details, ts)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    actorId,
    action,
    targetType,
    String(targetId),
    JSON.stringify(details),
    BigInt(Date.now()),
  );
}

function requireTarget(identifier) {
  const target = getUserByIdentifier(identifier);
  if (!target) {
    throw new AccessError("User not found", 404, "USER_NOT_FOUND");
  }
  return target;
}

function assertModeratable(actor, target) {
  if (isMasterUser(target.uuid)) {
    throw new AccessError(
      "The master account cannot be moderated",
      403,
      "MASTER_PROTECTED",
    );
  }
  if (actor.uuid === target.uuid) {
    throw new AccessError(
      "You cannot moderate your own account",
      400,
      "SELF_MODERATION",
    );
  }
}

function normalizeReason(reason) {
  if (reason === undefined || reason === null || reason === "") return null;
  if (typeof reason !== "string" || reason.trim().length > 1000) {
    throw new AccessError(
      "Reason must be a string of at most 1000 characters",
      400,
      "INVALID_REASON",
    );
  }
  return reason.trim();
}

function normalizeDuration(durationSeconds) {
  if (durationSeconds === undefined || durationSeconds === null) return null;
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 315_360_000) {
    throw new AccessError(
      "durationSeconds must be between 1 and 315360000",
      400,
      "INVALID_DURATION",
    );
  }
  return Math.floor(duration * 1000);
}

function validatePermissionNames(permissions) {
  if (!Array.isArray(permissions)) {
    throw new AccessError(
      "Permissions must be an array",
      400,
      "INVALID_PERMISSIONS",
    );
  }
  const unique = [...new Set(permissions)];
  for (const permission of unique) {
    if (!ALL_PERMISSIONS.includes(permission)) {
      throw new AccessError(
        `Unknown permission: ${permission}`,
        400,
        "UNKNOWN_PERMISSION",
      );
    }
  }
  return unique;
}

export async function getOwnPermissions(token) {
  const principal = await requirePermission(
    token,
    PERMISSIONS.MANAGE_PERMISSIONS,
  );
  return {
    userId: principal.uuid,
    username: principal.username,
    isMaster: principal.isMaster,
    permissions: principal.permissions,
    availablePermissions: [...ALL_PERMISSIONS],
  };
}

export async function getUserPermissions(token, identifier) {
  await requirePermission(token, PERMISSIONS.MANAGE_PERMISSIONS);
  const target = requireTarget(identifier);
  return {
    userId: target.uuid,
    username: target.username,
    isMaster: isMasterUser(target.uuid),
    permissions: listPermissions(target.uuid),
  };
}

export async function changeUserPermissions(
  token,
  identifier,
  grants = [],
  revocations = [],
) {
  const actor = await requirePermission(
    token,
    PERMISSIONS.MANAGE_PERMISSIONS,
  );
  const target = requireTarget(identifier);
  if (isMasterUser(target.uuid)) {
    throw new AccessError(
      "Master permissions are implicit and cannot be changed",
      403,
      "MASTER_PROTECTED",
    );
  }

  const grant = validatePermissionNames(grants);
  const revoke = validatePermissionNames(revocations);
  if (grant.length === 0 && revoke.length === 0) {
    throw new AccessError(
      "At least one permission must be granted or revoked",
      400,
      "NO_PERMISSION_CHANGES",
    );
  }

  if (!actor.isMaster) {
    const unauthorizedGrant = grant.find((permission) =>
      !actor.permissions.includes(permission)
    );
    if (unauthorizedGrant) {
      throw new AccessError(
        `You cannot grant a permission you do not hold: ${unauthorizedGrant}`,
        403,
        "CANNOT_DELEGATE_PERMISSION",
      );
    }
  }

  for (const permission of grant) {
    db.prepare(
      `INSERT INTO user_permissions (userID, permission, grantedBy, ts)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(userID, permission) DO UPDATE SET
         grantedBy = excluded.grantedBy,
         ts = excluded.ts`,
    ).run(target.uuid, permission, actor.uuid, BigInt(Date.now()));
  }
  for (const permission of revoke) {
    db.prepare(
      `DELETE FROM user_permissions WHERE userID = ? AND permission = ?`,
    ).run(target.uuid, permission);
  }

  audit(actor.uuid, "permissions.change", "user", target.uuid, {
    grant,
    revoke,
  });
  return {
    userId: target.uuid,
    username: target.username,
    isMaster: false,
    permissions: listPermissions(target.uuid),
  };
}

export async function banUser(
  token,
  identifier,
  reason,
  durationSeconds,
) {
  const actor = await requirePermission(token, PERMISSIONS.BAN_USERS);
  const target = requireTarget(identifier);
  assertModeratable(actor, target);
  const normalizedReason = normalizeReason(reason);
  const durationMs = normalizeDuration(durationSeconds);
  const untilTs = durationMs === null ? null : Date.now() + durationMs;
  const ts = Date.now();

  db.prepare(
    `INSERT INTO global_bans (userID, reason, untilTs, createdBy, ts)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(userID) DO UPDATE SET
       reason = excluded.reason,
       untilTs = excluded.untilTs,
       createdBy = excluded.createdBy,
       ts = excluded.ts`,
  ).run(
    target.uuid,
    normalizedReason,
    untilTs === null ? null : BigInt(untilTs),
    actor.uuid,
    BigInt(ts),
  );
  revokeSessions(target.uuid);
  disconnectUser(target.uuid, "banned", normalizedReason);
  audit(actor.uuid, "user.ban", "user", target.uuid, {
    reason: normalizedReason,
    untilTs,
  });

  return {
    userId: target.uuid,
    username: target.username,
    reason: normalizedReason,
    untilTs,
    createdBy: actor.uuid,
    ts,
  };
}

export async function unbanUser(token, identifier) {
  const actor = await requirePermission(token, PERMISSIONS.BAN_USERS);
  const target = requireTarget(identifier);
  if (isMasterUser(target.uuid)) {
    throw new AccessError(
      "The master account cannot be moderated",
      403,
      "MASTER_PROTECTED",
    );
  }
  const existing = db.prepare(
    `SELECT userID FROM global_bans WHERE userID = ?`,
  ).get(target.uuid);
  if (!existing) {
    throw new AccessError("User is not banned", 404, "BAN_NOT_FOUND");
  }
  db.prepare(`DELETE FROM global_bans WHERE userID = ?`).run(target.uuid);
  audit(actor.uuid, "user.unban", "user", target.uuid);
  return { userId: target.uuid, username: target.username, unbanned: true };
}

export async function listBans(token) {
  await requirePermission(token, PERMISSIONS.BAN_USERS);
  db.prepare(
    `DELETE FROM global_bans WHERE untilTs IS NOT NULL AND untilTs <= ?`,
  ).run(BigInt(Date.now()));
  return db.prepare(
    `SELECT b.userID as userId, u.username, b.reason,
            CAST(b.untilTs AS TEXT) as untilTsText, b.createdBy,
            CAST(b.ts AS TEXT) as tsText
     FROM global_bans b
     JOIN users u ON u.uuid = b.userID
     ORDER BY b.ts DESC`,
  ).all().map((ban) => ({
    userId: ban.userId,
    username: ban.username,
    reason: ban.reason,
    untilTs: ban.untilTsText === null ? null : Number(ban.untilTsText),
    createdBy: ban.createdBy,
    ts: Number(ban.tsText),
  }));
}

export async function kickUser(token, identifier, reason) {
  const actor = await requirePermission(token, PERMISSIONS.KICK_USERS);
  const target = requireTarget(identifier);
  assertModeratable(actor, target);
  const normalizedReason = normalizeReason(reason);
  revokeSessions(target.uuid);
  disconnectUser(target.uuid, "kicked", normalizedReason);
  audit(actor.uuid, "user.kick", "user", target.uuid, {
    reason: normalizedReason,
  });
  return {
    userId: target.uuid,
    username: target.username,
    kicked: true,
  };
}

export async function deleteHomePost(token, postIdentifier, reason) {
  const actor = await requirePermission(
    token,
    PERMISSIONS.DELETE_HOME_POSTS,
  );
  const numericId = typeof postIdentifier === "number"
    ? postIdentifier
    : /^\d+$/.test(String(postIdentifier))
    ? Number(postIdentifier)
    : -1;
  const post = db.prepare(
    `SELECT id, uuid, user_id, author FROM posts WHERE id = ? OR uuid = ?`,
  ).get(numericId, String(postIdentifier));
  if (!post) {
    throw new AccessError("Home post not found", 404, "POST_NOT_FOUND");
  }
  const normalizedReason = normalizeReason(reason);
  db.prepare(`DELETE FROM posts WHERE id = ?`).run(post.id);
  emitHomePostDelete(post.id);
  audit(actor.uuid, "home_post.delete", "home_post", post.uuid, {
    reason: normalizedReason,
    authorId: post.user_id,
  });
  return { postId: post.id, postUuid: post.uuid, deleted: true };
}

export async function sendInboxMessage(token, recipient, content) {
  const actor = await requirePermission(
    token,
    PERMISSIONS.SEND_INBOX_MESSAGES,
  );
  const target = requireTarget(recipient);
  if (typeof content !== "string" || !content.trim() || content.length > 4000) {
    throw new AccessError(
      "Message content must be between 1 and 4000 characters",
      400,
      "INVALID_MESSAGE",
    );
  }
  const result = await sendMessage(
    target.username,
    content.trim(),
    `Moderation (${actor.username})`,
  );
  if (result !== true) {
    throw new AccessError("Could not send message", 400, "MESSAGE_FAILED");
  }
  audit(actor.uuid, "inbox.send", "user", target.uuid, {
    length: content.trim().length,
  });
  return { userId: target.uuid, username: target.username, sent: true };
}
