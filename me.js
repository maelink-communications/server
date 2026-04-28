import { connectDB } from './db.js';
const db = connectDB();
export async function fetchUser(token, userId) {
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      throw new Error("Unauthorized");
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }
    const username = db.exec(
      `SELECT users.username FROM users WHERE id = ?`,
      [userId]
    )
    const pfp = db.exec(
      `SELECT users.pfp FROM users WHERE id = ?`,
      [userId]
    )
    const bio = db.exec(
      `SELECT users.bio FROM users WHERE id = ?`,
      [userId]
    )
    const followers = db.exec(
      `SELECT users.username FROM followers JOIN users ON users.id=followers.followerID WHERE followedID = ?`,
      [userId]
    );
    return JSON.stringify({ success: true, username: username, pfp: pfp, bio: bio, followers: followers });
  } catch (e) {
    throw e;
  }
}
export async function editUser(token, userId, username, pfp, bio) { // allow changing username?
  const secret = new TextEncoder().encode(Deno.env.get("JWT_SECRET"));
  try {
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.uuid !== userId) {
      throw new Error("Unauthorized");
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }
    if (username.trim().length > 2) { // allow changing username?
      db.exec(
        `UPDATE users SET username WHERE id = ?`,
        [userId],
      );
    } else if (pfp.trim()) {
      db.exec(
        `UPDATE users SET pfp WHERE id = ?`,
        [userId],
      );
    } else if (bio.trim()) {
      db.exec(
        `UPDATE users SET bio WHERE id = ?`,
        [userId],
      );
    }
    return true;
  } catch (e) {
    throw e;
  }
}