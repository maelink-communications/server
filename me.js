import * as jose from "@panva/jose";
import { connectDB, logChange } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
const db = connectDB();
log("User module loaded", "gray");
export async function fetchUser(token, userId) {
  if (!userId || !token) return false;
  try {
    const payload = await verifyToken(token);
    if (payload.uuid !== userId) return false;
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
export async function editUser(token, username, pfp, bio) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    if (username && username.trim().length > 2) {
      db.exec(`UPDATE users SET username = ? WHERE uuid = ?`, username, id);
      logChange('users', 'UPDATE', id, { field: 'username', newValue: username });
    }
    if (pfp && pfp.trim().length > 7) {
      db.exec(`UPDATE users SET pfp = ? WHERE uuid = ?`, pfp, id);
      logChange('users', 'UPDATE', id, { field: 'pfp', newValue: pfp });
    }
    if (bio && bio.trim().length > 0) {
      db.exec(`UPDATE users SET bio = ? WHERE uuid = ?`, bio, id);
      logChange('users', 'UPDATE', id, { field: 'bio', newValue: bio });
    }
    return true;
  } catch (e) {
    throw e;
  }
}