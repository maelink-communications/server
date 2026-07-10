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
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return value;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

function isGuildMember(guild, userId) {
  if (!guild || !userId) return false;
  const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
  return memberIDs.includes(userId);
}

function getGuildById(guildId) {
  return db.prepare(`SELECT * FROM guilds WHERE uuid = ?`).get(guildId);
}

function getGuildRoles(guildId) {
  return db.prepare(`SELECT * FROM guild_roles WHERE guildID = ? ORDER BY id ASC`).all(guildId);
}

function getMemberRoleIds(guildId, userId) {
  return db.prepare(`SELECT roleID FROM guild_role_members WHERE guildID = ? AND userID = ?`).all(guildId, userId).map((row) => row.roleID);
}

function getRolePermissions(guildId, roleId) {
  const role = db.prepare(`SELECT permissions FROM guild_roles WHERE guildID = ? AND uuid = ?`).get(guildId, roleId);
  return parseJsonObject(role?.permissions ?? "{}");
}

function hasPermission(guildId, userId, permission) {
  const guild = getGuildById(guildId);
  if (!guild) return false;
  const owner = guild.ownerID === userId;
  if (owner) return true;
  const roleIds = getMemberRoleIds(guildId, userId);
  if (!roleIds.length) return false;
  return roleIds.some((roleId) => {
    const permissions = getRolePermissions(guildId, roleId);
    return Boolean(permissions?.[permission]);
  });
}

function canAccessChannel(guildId, userId, channelId, accessType = "view") {
  const guild = getGuildById(guildId);
  if (!guild) return false;
  if (guild.ownerID === userId) return true;
  if (!isGuildMember(guild, userId)) return false;
  const roleIds = getMemberRoleIds(guildId, userId);
  if (!roleIds.length) return false;
  const relevantPermissions = db.prepare(`SELECT * FROM guild_channel_permissions WHERE guildID = ? AND channelId = ?`).all(guildId, channelId);
  const rolePermissionMap = new Map(relevantPermissions.map((row) => [row.roleID, row]));
  return roleIds.some((roleId) => {
    const row = rolePermissionMap.get(roleId);
    if (!row) return false;
    if (accessType === "view") return Boolean(row.viewPermission);
    if (accessType === "send") return Boolean(row.sendPermission);
    if (accessType === "history") return Boolean(row.historyPermission);
    return false;
  });
}

function isUserBanned(guildId, userId) {
  const now = Date.now();
  const ban = db.prepare(`SELECT * FROM guild_bans WHERE guildID = ? AND userID = ? ORDER BY id DESC LIMIT 1`).get(guildId, userId);
  if (!ban) return false;
  if (ban.untilTs && Number(ban.untilTs) <= now) {
    db.prepare(`DELETE FROM guild_bans WHERE id = ?`).run(ban.id);
    return false;
  }
  return true;
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
    await createChannel(token, id, "general", "general");
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
    const guild = getGuildById(guildId);
    if (!guild) return false;
    if (isUserBanned(guildId, payload.uuid)) return false;
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

export async function postToGuild(token, guildId, content, channelId, replyTo) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = getGuildById(guildId);
    if (!isGuildMember(guild, id)) return false;
    if (isUserBanned(guildId, id)) return false;
    if (channelId && !canAccessChannel(guildId, id, channelId, "send")) return false;
    const author = db.prepare(`SELECT username FROM users WHERE uuid = ?`).value(id) ?? null;
    db.exec(`INSERT INTO guild_posts (guildID, userID, content, channelId, ts, author, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)`, guildId, id, content, channelId, Date.now(), author, replyTo);
    const post = { guildId, id, content, channelId, ts: Date.now(), author, reply_to: replyTo };
    emitGuildPost(guildId, post);
    return post;
  } catch (e) {
    throw e;
  }
}

export async function createGuildRole(token, guildId, name, color, permissions) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || guild.ownerID !== payload.uuid) return false;
    const roleId = crypto.randomUUID();
    db.prepare(`INSERT INTO guild_roles (uuid, guildID, name, color, permissions, createdBy, ts) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(roleId, guildId, name, color || null, JSON.stringify(permissions || {}), payload.uuid, Date.now());
    return { id: roleId, name, color: color || null, permissions: permissions || {} };
  } catch (e) {
    throw e;
  }
}

export async function assignGuildRole(token, guildId, roleId, userId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || guild.ownerID !== payload.uuid) return false;
    const role = db.prepare(`SELECT uuid FROM guild_roles WHERE guildID = ? AND uuid = ?`).get(guildId, roleId);
    if (!role) return false;
    db.prepare(`INSERT OR IGNORE INTO guild_role_members (guildID, roleID, userID) VALUES (?, ?, ?)`)
      .run(guildId, roleId, userId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function setChannelPermissions(token, guildId, channelId, roleId, permissions) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || guild.ownerID !== payload.uuid) return false;
    const role = db.prepare(`SELECT uuid FROM guild_roles WHERE guildID = ? AND uuid = ?`).get(guildId, roleId);
    if (!role) return false;
    db.prepare(`INSERT INTO guild_channel_permissions (guildID, channelId, roleID, viewPermission, sendPermission, historyPermission) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guildID, channelId, roleID) DO UPDATE SET viewPermission=excluded.viewPermission, sendPermission=excluded.sendPermission, historyPermission=excluded.historyPermission`)
      .run(guildId, channelId, roleId, permissions.view ? 1 : 0, permissions.send ? 1 : 0, permissions.history ? 1 : 0);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function createChannel(token, guildId, name, channelIdOverride = null) {
  if (!token) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    id = payload.uuid;
    const guild = getGuildById(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    if (guild.ownerID !== id && !hasPermission(guildId, id, "manageChannels")) return false;
    const channels = parseJsonArray(guild?.channels ?? "[]");
    const channelId = channelIdOverride || crypto.randomUUID();
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
    const guild = getGuildById(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    if (guild.ownerID !== id && !hasPermission(guildId, id, "manageChannels")) return false;
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
    const guild = getGuildById(guildId);
    const memberIDs = parseJsonArray(guild?.memberIDs ?? "[]");
    if (!guild || !memberIDs.includes(id)) return false;
    if (guild.ownerID !== id && !hasPermission(guildId, id, "manageChannels")) return false;
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
  const guild = getGuildById(guildId);
  if (!isGuildMember(guild, payload.uuid)) return false;
  if (isUserBanned(guildId, payload.uuid)) return false;
  const channels = parseJsonArray(guild?.channels ?? "[]");
  const posts = db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM guild_posts WHERE guildID = ? ORDER BY id DESC`
  ).all(guildId);
  return channels
    .filter((ch) => canAccessChannel(guildId, payload.uuid, ch.id, "view"))
    .map((ch) => ({
      ...ch,
      posts: posts.filter((p) => p.channelId === ch.id)
    }));
}

export async function fetchGuildPosts(token, guildId, page, channelId = null) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
  if (!user) return false;
  const guild = getGuildById(guildId);
  if (!isGuildMember(guild, payload.uuid)) return false;
  if (isUserBanned(guildId, payload.uuid)) return false;
  const targetChannel = channelId || "general";
  if (!canAccessChannel(guildId, payload.uuid, targetChannel, "history")) return false;
  return db.prepare(
    `SELECT *, CAST(ts AS REAL) as ts FROM guild_posts WHERE guildID = ? AND channelId = ? ORDER BY id DESC LIMIT 25 OFFSET ?`
  ).all(guildId, targetChannel, (page - 1) * 25);
}

export async function fetchGuildMembers(token, guildId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
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

export async function listGuildRoles(token, guildId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || !isGuildMember(guild, payload.uuid)) return false;
    return getGuildRoles(guildId).map((role) => ({
      id: role.uuid,
      name: role.name,
      color: role.color,
      permissions: parseJsonObject(role.permissions),
    }));
  } catch (e) {
    throw e;
  }
}

export async function deleteGuildPost(token, guildId, postId) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || !isGuildMember(guild, payload.uuid)) return false;
    const post = db.prepare(`SELECT * FROM guild_posts WHERE id = ? AND guildID = ?`).get(postId, guildId);
    if (!post) return false;
    if (payload.uuid !== post.userID && !hasPermission(guildId, payload.uuid, "moderatePosts")) return false;
    db.prepare(`DELETE FROM guild_posts WHERE id = ? AND guildID = ?`).run(postId, guildId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function moderateKick(token, guildId, userId, _reason) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || !hasPermission(guildId, payload.uuid, "kickMembers")) return false;
    const memberIDs = parseJsonArray(guild.memberIDs ?? "[]");
    if (!memberIDs.includes(userId)) return false;
    const nextMembers = memberIDs.filter((member) => member !== userId);
    db.prepare(`UPDATE guilds SET memberIDs = ? WHERE uuid = ?`).run(JSON.stringify(nextMembers), guildId);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function moderateBan(token, guildId, userId, durationSeconds, reason) {
  if (!token) return false;
  try {
    const payload = await verifyToken(token);
    const user = db.prepare(`SELECT uuid FROM users WHERE uuid = ?`).value(payload.uuid);
    if (!user) return false;
    const guild = getGuildById(guildId);
    if (!guild || !hasPermission(guildId, payload.uuid, "banMembers")) return false;
    const memberIDs = parseJsonArray(guild.memberIDs ?? "[]");
    if (!memberIDs.includes(userId)) return false;
    const untilTs = durationSeconds > 0 ? Date.now() + durationSeconds * 1000 : null;
    db.prepare(`INSERT INTO guild_bans (guildID, userID, reason, untilTs, createdBy, ts) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(guildId, userId, reason || null, untilTs, payload.uuid, Date.now());
    const nextMembers = memberIDs.filter((member) => member !== userId);
    db.prepare(`UPDATE guilds SET memberIDs = ? WHERE uuid = ?`).run(JSON.stringify(nextMembers), guildId);
    return true;
  } catch (e) {
    throw e;
  }
}