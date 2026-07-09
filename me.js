import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
const db = connectDB();
log("User module loaded", "gray");
export async function fetchUser(token, userId) {
  if (!userId || !token) return false;
  try {
    const payload = await verifyToken(token);
    if (!payload) return false;
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
    console.log(e);
  }
}
export async function fetchUserPosts(token, userId, p) {
  const offset = (p - 1) * 25;
  if (!userId || !token) return false;
  try {
    const payload = await verifyToken(token);
    const uuid = db
      .prepare(
        `SELECT uuid FROM users WHERE id = ?`,
      )
      .all(userId);
    if (!payload) return false;
    const posts = db
      .prepare(
        `SELECT *, CAST(ts AS REAL) as ts FROM posts WHERE user_id = ? ORDER BY id DESC LIMIT 25 OFFSET ?`,
      )
      .all(uuid, offset);
    return posts;
  } catch (e) {
    console.log(e);
  }
}
export async function editUser(token, username, pfp, bio) {
  if (!token) return false;

  const payload = await verifyToken(token);

  const user = db
    .prepare("SELECT uuid FROM users WHERE uuid = ?")
    .value(payload.uuid);

  // user is actually something like [ "uuid" ]
  if (payload.uuid !== user[0]) return false;
  // make a single update instead of 3 updates
  const updates = [];
  const values = [];

  if (username?.trim().length > 2) {
    updates.push("username = ?");
    values.push(username.trim());
  }

  if (pfp?.trim().length > 7) {
    updates.push("pfp = ?");
    values.push(pfp.trim());
  }

  if (bio?.trim().length > 0) {
    updates.push("bio = ?");
    values.push(bio.trim());
  }

  if (updates.length === 0) return false;

  values.push(payload.uuid);

  db.exec(`UPDATE users SET ${updates.join(", ")} WHERE uuid = ?`, ...values);

  return true;
}

export function followUser(token, followID) { // yes i know these db operations should be condensed... i'll do it later, kay?
  if (!token || !followID) return false;
  // this is a mess
  verifyToken(token).then(async (payload) => {
    const user = await db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const follow = await db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(followID);
    if (!follow) return false;
    const check = await db.prepare(`SELECT * FROM followers WHERE followerID = ? AND followedID = ?`).get(payload.uuid, followID);
    if (check) return false;
    db.prepare(`INSERT INTO followers (followerID, followedID) VALUES (?, ?)`).run(payload.uuid, followID);
    return true;
  });
}