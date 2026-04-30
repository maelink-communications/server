import * as jose from "@panva/jose";
import { connectDB } from './db.js';
const db = connectDB();
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
    const username = db.exec(
      `SELECT users.username FROM users WHERE id = ?`,
      [userId]
    );
    const pfp = db.exec(
      `SELECT users.pfp FROM users WHERE id = ?`,
      [userId]
    );
    const bio = db.exec(
      `SELECT users.bio FROM users WHERE id = ?`,
      [userId]
    );
    const followers = db.exec(
      `SELECT users.username FROM followers JOIN users ON users.id=followers.followerID WHERE followedID = ?`,
      [userId]
    );
    return { username: username, pfp: pfp, bio: bio, followers: followers };
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
      db.exec(
        `UPDATE users SET username = ? WHERE id = ?`,
        [username, userId],
      );
    }
    if (pfp && pfp.trim().length > 7) {
      db.exec(
        `UPDATE users SET pfp = ? WHERE id = ?`,
        [pfp, userId],
      );
    }
    if (bio && bio.trim().length > 0) {
      db.exec(
        `UPDATE users SET bio = ? WHERE id = ?`,
        [bio, userId],
      );
    }
    return true;
  } catch (e) {
    throw e;
  }
}