// User handling
import { connectDB } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { sendMessage } from "./inbox.js";
import { log } from "./logging.js";
import { getPrivateKey } from "./keys.js";
import {
  AccessError,
  assertUserAllowed,
  authenticateToken,
  getMasterUser,
  isMasterUser,
  listPermissions,
  revokeSessions,
  verifyMasterCode,
} from "./access.js";

const db = connectDB();
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Auth module loaded", "gray");
}

function signToken(uuid, username, authVersion, expiresIn, type) {
  return new jose.SignJWT({ uuid, username, authVersion, type })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getPrivateKey());
}

function signAccessToken(uuid, username, authVersion) {
  return signToken(uuid, username, authVersion, "15m", "access");
}

function signRefreshToken(uuid, username, authVersion) {
  return signToken(uuid, username, authVersion, "30d", "refresh");
}

function buildAuthResponse(userRow, accessToken, refreshToken) {
  return {
    uuid: userRow.uuid,
    username: userRow.username,
    pfp: userRow.pfp,
    bio: userRow.bio,
    isMaster: isMasterUser(userRow.uuid),
    permissions: listPermissions(userRow.uuid),
    accessToken,
    refreshToken,
  };
}

export async function register(username, password) {
  const hashedPassword = await hash(password);
  const hashString =
    typeof hashedPassword === "string"
      ? hashedPassword
      : new TextDecoder().decode(hashedPassword);
  const uuid = crypto.randomUUID();
  if (username.length < 3) {
    throw new Error("username is too short, must be 3+ characters");
  }
  if (username.length > 24) {
    throw new Error("username is too long, must be 24 characters or less");
  }
  if (password.length < 6) {
    throw new Error("password is too short, must be 6+ characters");
  }
  if (password.length > 64) {
    throw new Error("password is too long, must be 64 characters or less");
  }
  try {
    const accessToken = await signAccessToken(uuid, username, 0);
    const refreshToken = await signRefreshToken(uuid, username, 0);
    db.exec(
      `INSERT INTO users (uuid, username, password, pfp, bio) VALUES (?, ?, ?, ?, ?)`,
      [uuid, username, hashString, null, null],
    );
    if (Deno.env.get("SYSTEM_MESSAGE")) {
      await sendMessage(
        username,
        `${Deno.env.get("SYSTEM_MESSAGE")}`,
        "System",
      );
    } else {
      await sendMessage(
        username,
        `Hello, ${username}!\nWe welcome you with open arms. We hope you enjoy your stay here and have a great time!`,
        "System",
      );
    }
    return {
      error: false,
      username,
      token: accessToken,
      accessToken,
      refreshToken,
      uuid,
      isMaster: false,
      permissions: [],
    };
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  if (!username || !password) return false;
  const result = db
    .prepare(
      `SELECT password, username, uuid, pfp, bio, auth_version
       FROM users WHERE username = ?`,
    )
    .all(username);
  if (result.length === 0) return false;
  try {
    const isValid = await verify(result[0].password, password);
    if (!isValid) return false;
    assertUserAllowed(result[0].uuid);

    const accessToken = await signAccessToken(
      result[0].uuid,
      result[0].username,
      Number(result[0].auth_version ?? 0),
    );
    const refreshToken = await signRefreshToken(
      result[0].uuid,
      result[0].username,
      Number(result[0].auth_version ?? 0),
    );

    return buildAuthResponse(result[0], accessToken, refreshToken);
  } catch (e) {
    if (e instanceof AccessError) throw e;
    console.error(e);
    return false;
  }
}

export async function loginToken(token) {
  if (!token) return false;
  try {
    const principal = await authenticateToken(token);
    if (!["access", "refresh"].includes(principal.type)) {
      throw new AccessError("Wrong token type", 401, "INVALID_TOKEN_TYPE");
    }
    revokeSessions(principal.uuid);
    const user = db.prepare(
      `SELECT username, uuid, pfp, bio, auth_version
       FROM users WHERE uuid = ?`,
    ).get(principal.uuid);
    if (!user) return false;
    const authVersion = Number(user.auth_version ?? 0);
    const accessToken = await signAccessToken(
      user.uuid,
      user.username,
      authVersion,
    );
    const refreshToken = await signRefreshToken(
      user.uuid,
      user.username,
      authVersion,
    );
    return buildAuthResponse(user, accessToken, refreshToken);
  } catch (e) {
    if (e instanceof AccessError) throw e;
    console.error(e);
    return false;
  }
}

export async function loginMaster(code) {
  if (!(await verifyMasterCode(code))) return false;
  const user = getMasterUser();
  const authVersion = Number(user.auth_version ?? 0);
  const accessToken = await signAccessToken(
    user.uuid,
    user.username,
    authVersion,
  );
  const refreshToken = await signRefreshToken(
    user.uuid,
    user.username,
    authVersion,
  );
  return buildAuthResponse(user, accessToken, refreshToken);
}

export async function revokeTokens(token) {
  const principal = await authenticateToken(token);
  revokeSessions(principal.uuid);
  return { userId: principal.uuid, username: principal.username };
}
