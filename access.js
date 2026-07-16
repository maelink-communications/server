import { hash } from "@felix/argon2";
import { connectDB } from "./db.js";
import { verifyToken } from "./keys.js";
import { log } from "./logging.js";

const db = connectDB();
const MASTER_USER_SETTING = "master_user_id";
const DEFAULT_MASTER_CODE_FILE = ".master-code";

export const PERMISSIONS = Object.freeze({
  MANAGE_PERMISSIONS: "moderation.manage_permissions",
  BAN_USERS: "moderation.ban_users",
  KICK_USERS: "moderation.kick_users",
  DELETE_HOME_POSTS: "moderation.delete_home_posts",
  SEND_INBOX_MESSAGES: "moderation.send_inbox_messages",
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

export class AccessError extends Error {
  constructor(message, status = 403, code = "ACCESS_DENIED", details) {
    super(message);
    this.name = "AccessError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let masterCodeDigest;
let masterUserId;

function randomHex(byteLength = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(byteLength)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function loadMasterCode() {
  const codeFile = Deno.env.get("MASTER_CODE_FILE") ||
    DEFAULT_MASTER_CODE_FILE;
  let code;

  try {
    code = (await Deno.readTextFile(codeFile)).trim();
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  if (!code || code.length < 32) {
    code = randomHex();
    await Deno.writeTextFile(codeFile, `${code}\n`, { mode: 0o600 });
  }

  try {
    await Deno.chmod(codeFile, 0o600);
  } catch {
    // Windows does not apply POSIX file modes. The file remains git-ignored.
  }

  masterCodeDigest = await digest(code);
  log(`MASTER LOGIN CODE (${codeFile}): ${code}`, "yellow");
}

async function ensureMasterUser() {
  const setting = db.prepare(
    `SELECT setting_value FROM server_settings WHERE setting_key = ?`,
  ).get(MASTER_USER_SETTING);
  if (setting?.setting_value) {
    const user = db.prepare(
      `SELECT uuid FROM users WHERE uuid = ?`,
    ).get(setting.setting_value);
    if (user) {
      masterUserId = user.uuid;
      return;
    }
  }

  let username = "maelink";
  while (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
    username = `System_${randomHex(3)}`;
  }

  const uuid = crypto.randomUUID();
  const unusablePassword = await hash(randomHex(48));
  const passwordHash = typeof unusablePassword === "string"
    ? unusablePassword
    : new TextDecoder().decode(unusablePassword);

  db.prepare(
    `INSERT INTO users (uuid, username, password, pfp, bio, auth_version)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(uuid, username, passwordHash, null, "Server master account");
  db.prepare(
    `INSERT INTO server_settings (setting_key, setting_value) VALUES (?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
  ).run(MASTER_USER_SETTING, uuid);
  masterUserId = uuid;
}

export async function initAccessControl() {
  await loadMasterCode();
  await ensureMasterUser();
}

export function isMasterUser(userId) {
  return Boolean(masterUserId) && userId === masterUserId;
}

export function getMasterUser() {
  if (!masterUserId) throw new Error("Access control is not initialized");
  return db.prepare(
    `SELECT uuid, username, pfp, bio, auth_version FROM users WHERE uuid = ?`,
  ).get(masterUserId);
}

export async function verifyMasterCode(code) {
  if (typeof code !== "string" || !masterCodeDigest) return false;
  return constantTimeEqual(await digest(code.trim()), masterCodeDigest);
}

export function getUserByIdentifier(identifier) {
  if (typeof identifier !== "string" || !identifier.trim()) return null;
  return db.prepare(
    `SELECT uuid, username, pfp, bio, auth_version
     FROM users WHERE uuid = ? OR username = ?`,
  ).get(identifier.trim(), identifier.trim()) ?? null;
}

export function getActiveBan(userId) {
  const row = db.prepare(
    `SELECT userID, reason, CAST(untilTs AS TEXT) as untilTsText,
            createdBy, CAST(ts AS TEXT) as tsText
     FROM global_bans WHERE userID = ?`,
  ).get(userId);
  if (!row) return null;
  const ban = {
    userID: row.userID,
    reason: row.reason,
    untilTs: row.untilTsText === null ? null : Number(row.untilTsText),
    createdBy: row.createdBy,
    ts: Number(row.tsText),
  };
  if (ban.untilTs !== null && Number(ban.untilTs) <= Date.now()) {
    db.prepare(`DELETE FROM global_bans WHERE userID = ?`).run(userId);
    return null;
  }
  return ban;
}

export function assertUserAllowed(userId) {
  const ban = getActiveBan(userId);
  if (ban) {
    throw new AccessError("This account is banned", 403, "ACCOUNT_BANNED", {
      reason: ban.reason,
      untilTs: ban.untilTs,
    });
  }
}

export function listPermissions(userId) {
  if (isMasterUser(userId)) return [...ALL_PERMISSIONS];
  return db.prepare(
    `SELECT permission FROM user_permissions WHERE userID = ? ORDER BY permission`,
  ).all(userId).map((row) => row.permission);
}

export async function authenticateToken(token, options = {}) {
  if (!token) {
    throw new AccessError("Authentication required", 401, "AUTH_REQUIRED");
  }

  let payload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new AccessError(
      "Invalid or expired token",
      401,
      "INVALID_TOKEN",
    );
  }

  if (options.requiredType && payload.type !== options.requiredType) {
    throw new AccessError("Wrong token type", 401, "INVALID_TOKEN_TYPE");
  }

  const user = db.prepare(
    `SELECT uuid, username, auth_version FROM users WHERE uuid = ?`,
  ).get(payload.uuid);
  if (!user) {
    throw new AccessError("Account no longer exists", 401, "ACCOUNT_MISSING");
  }

  assertUserAllowed(user.uuid);
  const tokenVersion = Number(payload.authVersion ?? 0);
  if (tokenVersion !== Number(user.auth_version ?? 0)) {
    throw new AccessError(
      "Session has been revoked; log in again",
      401,
      "SESSION_REVOKED",
    );
  }

  return {
    ...payload,
    uuid: user.uuid,
    username: user.username,
    isMaster: isMasterUser(user.uuid),
    permissions: listPermissions(user.uuid),
  };
}

export async function requirePermission(token, permission) {
  const principal = await authenticateToken(token, { requiredType: "access" });
  if (!principal.isMaster && !principal.permissions.includes(permission)) {
    throw new AccessError(
      `Missing permission: ${permission}`,
      403,
      "MISSING_PERMISSION",
      { permission },
    );
  }
  return principal;
}

export function revokeSessions(userId) {
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).get(userId);
  if (!user) return false;
  db.prepare(
    `UPDATE users SET auth_version = COALESCE(auth_version, 0) + 1 WHERE uuid = ?`,
  ).run(userId);
  return true;
}
