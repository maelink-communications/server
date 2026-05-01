// User handling
import { connectDB } from "./db.js";
import * as jose from "@panva/jose";
import { hash, verify } from "@felix/argon2";
import { log } from "./logging.js";
const db = connectDB();
log("Auth module loaded", "gray");
export async function register(username, password) {
  console.log("jwt_secret: ", Deno.env.get("JWT_SECRET"))
  const hashedPassword = await hash(password);
  try {
    await hash(password) === hashedPassword;
  } catch (e) {
    log("Error verifying hash: " + e.message, "red");
    false;
  }
  const hashString = typeof hashedPassword === 'string' ? hashedPassword : new TextDecoder().decode(hashedPassword);
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
    db.exec(`INSERT INTO users (uuid, username, password, pfp, bio) VALUES (?, ?, ?, ?, ?)`, [
      uuid,
      username,
      hashString,
      null,
      null
    ]);
    return { error: false, username: username, token: token, uuid: uuid };
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function login(username, password) {
  const user = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const result = user.all(username);
  console.log("result: ", result);
  if (result.length === 0) return false;
  try {
    const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
    console.log("jwt_secret: ", Deno.env.get("JWT_SECRET"))
    const alg = "HS256";
    const storedHash = result[0].password;
    console.log("Stored hash: ", storedHash);
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
    const userObject = {
      uuid: result[0].uuid,
      username: result[0].username,
      pfp: result[0].pfp,
      bio: result[0].bio,
      token: token
    };
    return userObject;
  } catch (e) {
    console.error(e);
    return false;
  }
}
