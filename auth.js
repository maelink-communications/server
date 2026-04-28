// User handling
import { connectDB } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { log } from "./logging.js";
const db = connectDB();
log("Auth module loaded", "gray");
export async function register(username, password) {
  const hashedPassword = await hash(password);
  const hashString = typeof hashedPassword === 'string' ? hashedPassword : new TextDecoder().decode(hashedPassword);
  const uuid = crypto.randomUUID();
  if (username.trim().length < 3) {
    return JSON.stringify({ success: false, error: "username is too short, must be 3+ characters" });
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
    db.exec(`INSERT INTO users (uuid, username, password) VALUES (?, ?, ?)`, [
      uuid,
      username,
      hashString,
    ]);
    return JSON.stringify({ success: true, username: username, token: token });
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  const stmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const user = stmt.get(username);
  if (!user) return false;
  try {
    const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
    const alg = "HS256";
    const passwordHash = typeof user.password === 'string' ? user.password : new TextDecoder().decode(user.password);
    const isValid = await verify(passwordHash, password);
    if (!isValid) return false;
    const token = await new jose.SignJWT({
      uuid: user.uuid,
      username: user.username,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
    })
      .setProtectedHeader({ alg })
      .setIssuedAt()
      .sign(secret);
    return { ...user, token };
  } catch (e) {
    console.error(e);
    return false;
  }
}
