// User handling
import { connectDB, logChange } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { sendMessage } from "./inbox.js";
import { log } from "./logging.js";
import { getPrivateKey, verifyToken } from "./keys.js";
import { SERVER_ID } from "./peer.js";
const db = connectDB();
log("Auth module loaded", "gray");

async function signToken(uuid, username) {
  return new jose.SignJWT({ uuid, username })
    .setProtectedHeader({ alg: "ES256", kid: SERVER_ID })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(getPrivateKey());
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
  try {
    const token = await signToken(uuid, username);
    db.exec(
      `INSERT INTO users (uuid, username, password, pfp, bio, token) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, username, hashString, null, null, token],
    );
    logChange("users", "INSERT", uuid, { uuid, username, password: hashString, pfp: null, bio: null });
    if (Deno.env.get("SYSTEM_MESSAGE")) {
      await sendMessage(username, `${Deno.env.get("SYSTEM_MESSAGE")}`, "System");
    } else {
      await sendMessage(
        username,
        `Welcome, ${username}.\nThis is a work-in-progress version of the server, so things may be unstable.`,
        "System",
      );
    }
    return { error: false, username, token, uuid };
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_urn ON users(username)`);
  const result = db.prepare(
    `SELECT password, username, uuid, pfp, bio, token FROM users WHERE username = ?`,
  ).all(username);
  if (result.length === 0) return false;
  try {
    const isValid = await verify(result[0].password, password);
    if (!isValid) return false;

    // Always issue a fresh token on login (node-local, signed with this node's key)
    const tokenNew = await signToken(result[0].uuid, result[0].username);
    db.exec(`UPDATE users SET token = ? WHERE username = ?`, [tokenNew, username]);

    return {
      uuid: result[0].uuid,
      username: result[0].username,
      pfp: result[0].pfp,
      bio: result[0].bio,
      token: tokenNew,
    };
  } catch (e) {
    console.error(e);
    return false;
  }
}
