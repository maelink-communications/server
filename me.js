import * as jose from "@panva/jose";
import { connectDB } from "./db.js";
import { log } from "./logging.js";
const db = connectDB();
log("User module loaded", "gray");
export async function fetchUser(token, userId) {
  if (!userId) return false;
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    const user = db
      .prepare(
        `SELECT u.username, u.pfp, u.bio,
         (SELECT COUNT(*) FROM followers WHERE followedID = u.uuid) as follower_count
         FROM users u WHERE u.uuid = ?`,
      )
      .value(userId);

    if (!user) return false;

    const followers = db
      .prepare(
        `SELECT u.username FROM followers f JOIN users u ON u.uuid = f.followerID WHERE f.followedID = ?`,
      )
      .all(userId);

    return { username: user[0], pfp: user[1], bio: user[2], followers };
  } catch (e) {
    throw e;
  }
}
export async function editUser(token, userId, username, pfp, bio) {
  if (!userId) return false;
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      return false;
    }
    if (payload.exp < Date.now() / 1000) {
      return false;
    }
    if (username && username.trim().length > 2) {
      db.exec(`UPDATE users SET username = ? WHERE uuid = ?`, username, userId);
    }
    if (pfp && pfp.trim().length > 7) {
      db.exec(`UPDATE users SET pfp = ? WHERE uuid = ?`, pfp, userId);
    }
    if (bio && bio.trim().length > 0) {
      db.exec(`UPDATE users SET bio = ? WHERE uuid = ?`, bio, userId);
    }
    return true;
  } catch (e) {
    throw e;
  }
}