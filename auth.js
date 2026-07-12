// User handling
import { connectDB } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { sendMessage } from "./inbox.js";
import { log } from "./logging.js";
import * as keys from "./keys.js";
import { getPrivateKey } from "./keys.js";

const db = connectDB();
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Auth module loaded", "gray");
}

async function signToken(uuid, username, expiresIn, type) {
  return new jose.SignJWT({ uuid, username, type })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getPrivateKey());
}

async function signAccessToken(uuid, username) {
  return signToken(uuid, username, "2h", "access");
}

async function signRefreshToken(uuid, username) {
  return signToken(uuid, username, "30d", "refresh");
}

function buildAuthResponse(userRow, accessToken, refreshToken) {
  return {
    uuid: userRow.uuid,
    username: userRow.username,
    pfp: userRow.pfp,
    bio: userRow.bio,
    token: accessToken,
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
  if (username.trim().length < 3) {
    throw new Error("username is too short, must be 3+ characters");
  }
  if (username.trim().length > 24) {
    throw new Error("username is too long, must be 24 characters or less");
  }
  if (password.trim().length < 6) {
    throw new Error("password is too short, must be 6+ characters");
  }
  try {
    const accessToken = await signAccessToken(uuid, username);
    const refreshToken = await signRefreshToken(uuid, username);
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
        `Welcome, ${username}.\nThis is a work-in-progress version of the server, so things may be unstable.`,
        "System",
      );
    }
    return { error: false, username, token: accessToken, accessToken, refreshToken, uuid };
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  if (!username || !password) return false;
  const result = db
    .prepare(
      `SELECT password, username, uuid, pfp, bio FROM users WHERE username = ?`,
    )
    .all(username);
  if (result.length === 0) return false;
  try {
    const isValid = await verify(result[0].password, password);
    if (!isValid) return false;

    const accessToken = await signAccessToken(result[0].uuid, result[0].username);
    const refreshToken = await signRefreshToken(result[0].uuid, result[0].username);

    return buildAuthResponse(result[0], accessToken, refreshToken);
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function loginToken(token) {
  if (!token) return false;
  const isValid = await keys.verifyToken(token);
  const result = db
    .prepare(
      `SELECT username, uuid, pfp, bio FROM users WHERE username = ?`,
    )
    .all(isValid.username);
  if (result.length === 0) return false;
  if (!isValid) return false;
  if (isValid.type !== "refresh") return false;
  try {
    const accessToken = await signAccessToken(result[0].uuid, result[0].username);
    const refreshToken = await signRefreshToken(result[0].uuid, result[0].username);
    return buildAuthResponse(result[0], accessToken, refreshToken);
  } catch (e) {
    console.error(e);
    return false;
  }
}