// Guilds service
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { emitGuildPost, emitGuildUpdate, emitGuildChannelCreate, emitGuildChannelDelete, joinGuildRoom, leaveGuildRoom } from "./socket.js";
const db = connectDB();
log("Guilds module loaded", "gray");

function parseJsonArray(value) {
  if (!value) return [];
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function isGuildMember(guild, userId) {
  if (!guild || !userId) return false;
  const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
  return memberIDs.includes(userId);
}

export async function createGuild(token, name, description) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db
      .prepare(`SELECT uuid FROM users WHERE uuid = ?`)
      .value(payload.uuid);
    if (!user) return false;
    id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO guilds (uuid, name, description, ownerID, memberIDs, channels, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, payload.uuid, JSON.stringify([payload.uuid]), JSON.stringify([]), Date.now());
    await createChannel(token, id, "general");
    return { id, name, description };
  } catch (e) {
    throw e;
  }
}

export async function fetchGuilds(token, page = 1) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    if (!payload) return false;
    const offset = (Math.floor(page) - 1) * 25;
    const stmt = db.prepare(
      `SELECT * FROM guilds ORDER BY id DESC LIMIT 25 OFFSET ?`,
    );
    const posts = stmt.all(offset);
    return posts;
  } catch (e) {
    throw e;
  }
}

export async function fetchSubscribedGuilds(token) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    if (!payload) return false;
    const stmt = db.prepare(
      `SELECT * FROM guilds ORDER BY id`
    );
    const guilds = stmt.all();
    const subscribedGuilds = guilds.filter(guild => {
      const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
      return memberIDs.includes(payload.uuid);
    });
    return subscribedGuilds;
  } catch (e) {
    throw e;
  }
}

export async function editGuild(token, guildId, name, description) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT ownerID FROM guilds WHERE uuid = ?`).get(guildId);
    if (!guild || guild.ownerID !== id) return false;
    if (name && name.trim().length > 2) {
      db.exec(`UPDATE guilds SET name = ? WHERE uuid = ?`, [name, guildId]);
    }
    if (description && description.trim().length > 2) {
      db.exec(`UPDATE guilds SET description = ? WHERE uuid = ?`, [description, guildId]);
    }
    emitGuildUpdate(guildId, { name, description });
    return true;
  } catch (e) {
    throw e;
  }
}

export async function deleteGuild(token, guildId) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT ownerID FROM guilds WHERE uuid = ?`).get(guildId);
    if (!guild || guild.ownerID !== id) return false;
    db.exec(`DELETE FROM guilds WHERE uuid = ?`, [guildId]);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function joinGuild(token, guildId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = db.prepare(`SELECT memberIDs FROM guilds WHERE uuid = ?`).get(guildId);
    if (!guild) return false;
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (memberIDs.includes(payload.uuid)) return true;
    memberIDs.push(payload.uuid);
    db.prepare(`UPDATE guilds SET memberIDs = ? WHERE uuid = ?`).run(JSON.stringify(memberIDs), guildId);
    joinGuildRoom(payload.uuid, guildId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function leaveGuild(token, guildId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = db.prepare(`SELECT ownerID, memberIDs FROM guilds WHERE uuid = ?`).get(guildId);
    if (!guild) return false;
    if (guild.ownerID === payload.uuid) return false;
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    const nextMembers = memberIDs.filter((memberId) => memberId !== payload.uuid);
    db.prepare(`UPDATE guilds SET memberIDs = ? WHERE uuid = ?`).run(JSON.stringify(nextMembers), guildId);
    leaveGuildRoom(payload.uuid, guildId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function postToGuild(token, guildId, content, channelId) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT memberIDs FROM guilds WHERE uuid = ?`).get(guildId);
    if (!isGuildMember(guild, id)) return false;
    const author = db.prepare(`SELECT username FROM users WHERE uuid = ?`).value(id)?.[0] ?? null;
    db.exec(`INSERT INTO guild_posts (guildID, userID, content, channelId, ts, author) VALUES (?, ?, ?, ?, ?, ?)`, guildId, id, content, channelId, Date.now(), author);
    const post = { guildId, id, content, channelId, ts: Date.now(), author };
    emitGuildPost(guildId, post);
    return post;
  } catch (e) {
    throw e;
  }
}

export async function createChannel(token, guildId, name) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT memberIDs, channels FROM guilds WHERE uuid = ?`).get(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    const channels = parseJsonArray(guild?.channels ?? "[]");
    const channelId = crypto.randomUUID();
    channels.push({ id: channelId, name });
    db.exec(`UPDATE guilds SET channels = ? WHERE uuid = ?`, JSON.stringify(channels), guildId);
    const channel = { id: channelId, name };
    emitGuildChannelCreate(guildId, channel);
    return channel;
  } catch (e) {
    throw e;
  }
}

export async function deleteChannel(token, guildId, channelId) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT memberIDs, channels FROM guilds WHERE uuid = ?`).get(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    const channels = parseJsonArray(guild?.channels ?? "[]");
    const channelIndex = channels.findIndex((channel) => channel.id === channelId);
    if (channelIndex === -1) return false;
    channels.splice(channelIndex, 1);
    db.exec(`UPDATE guilds SET channels = ? WHERE uuid = ?`, JSON.stringify(channels), guildId);
    emitGuildChannelDelete(guildId, channelId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function editChannel(token, guildId, channelId, name) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = db.prepare(`SELECT memberIDs, channels FROM guilds WHERE uuid = ?`).get(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    const channels = parseJsonArray(guild?.channels ?? "[]");
    const channelIndex = channels.findIndex((channel) => channel.id === channelId);
    if (channelIndex === -1) return false;
    channels[channelIndex].name = name;
    db.exec(`UPDATE guilds SET channels = ? WHERE uuid = ?`, JSON.stringify(channels), guildId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function fetchGuildChannels(token, guildId) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) return false;
  const guild = db.prepare(`SELECT memberIDs, channels FROM guilds WHERE uuid = ?`).get(guildId);
  if (!isGuildMember(guild, payload.uuid)) return false;
  const channels = parseJsonArray(guild?.channels ?? "[]");
  const offset = 0;
  const posts = db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM guild_posts WHERE guildID = ? ORDER BY id DESC LIMIT 25 OFFSET ?`
  ).all(guildId, offset);
  return channels.map(ch => ({
    ...ch,
    posts: posts.filter(p => p.channelId === ch.id)
  }));
}

export async function fetchGuildPosts(token, channel, guildId, page) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) return false;
  const guild = db.prepare(`SELECT memberIDs FROM guilds WHERE uuid = ?`).get(guildId);
  if (!isGuildMember(guild, payload.uuid)) return false;
  return db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM guild_posts WHERE guildID = ? AND channelId = ? ORDER BY id DESC LIMIT 25 OFFSET ?`
  ).all(guildId, channel, (page - 1) * 25);
}

export async function fetchGuildMembers(token, guildId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = db.prepare(`SELECT memberIDs FROM guilds WHERE uuid = ?`).get(guildId);
    if (!isGuildMember(guild, payload.uuid)) return false;
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    const members = memberIDs.map(uid => {
      const userData = db.prepare(`SELECT uuid, username, pfp FROM users WHERE uuid = ?`).get(uid);
      return userData || { uuid: uid, username: "Unknown", pfp: null };
    });
    return members;
  } catch (e) {
    throw e;
  }
}