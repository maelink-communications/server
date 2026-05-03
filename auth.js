// User handling
import { connectDB } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { sendMessage } from "./inbox.js";
import { log } from "./logging.js";
const db = connectDB();
log("Auth module loaded", "gray");
export async function register(username, password) {
  const hashedPassword = await hash(password);
  try {
    (await hash(password)) === hashedPassword;
  } catch (e) {
    log("Error verifying hash: " + e.message, "red");
    false;
  }
  const hashString =
    typeof hashedPassword === "string"
      ? hashedPassword
      : new TextDecoder().decode(hashedPassword);
  const uuid = crypto.randomUUID();
  if (username.trim().length < 3) {
    throw new Error("username is too short, must be 3+ characters");
  }
  try {
    const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
    const alg = "HS256";
    const token = await new jose.SignJWT({
      uuid: uuid,
      username: username,
      exp: Math.floor(Date.now() / 1000) + 3600 * 2, // 2 hours
    })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .sign(secret);
    db.exec(
      `INSERT INTO users (uuid, username, password, pfp, bio, token) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, username, hashString, null, null, token],
    );
    if (Deno.env.get("SYSTEM_MESSAGE")) {
    await sendMessage(username, `${Deno.env.get("SYSTEM_MESSAGE")}`, "System");
    } else {
    await sendMessage(username, `Welcome, ${username}.\nThis is a work-in-progress version of the server, so things may be unstable.`, "System");
    }
    return { error: false, username: username, token: token, uuid: uuid };
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_urn ON users(username)`);
  const user = db.prepare(
    `SELECT password, username, uuid, pfp, bio, token FROM users WHERE username = ?`,
  );
  const result = user.all(username);
  if (result.length === 0) return false;
  try {
    const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
    const alg = "HS256";
    const storedHash = result[0].password;
    const passwordHash = storedHash;
    const isValid = await verify(passwordHash, password);
    if (!isValid) return false;
    const token = await new jose.SignJWT({
      uuid: result[0].uuid,
      username: result[0].username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .sign(secret);
    db.exec(`UPDATE users SET token = ? WHERE username = ?`, [token, username]);
    const userObject = {
      uuid: result[0].uuid,
      username: result[0].username,
      pfp: result[0].pfp,
      bio: result[0].bio,
      token: token,
    };
    return userObject;
  } catch (e) {
    console.error(e);
    return false;
  }
}
