// Guilds service
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { verifyToken } from "./keys.js";
import { normalizeAttachments, normalizeMediaUrl } from "./uploads.js";
import { emitGuildEmoji, emitGuildPost, emitGuildReaction, emitGuildUpdate, emitGuildChannelCreate, emitGuildChannelDelete, joinGuildRoom, leaveGuildRoom } from "./socket.js";
const db = connectDB();
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Guilds module loaded", "gray");
}

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

function publicGuild(guild) {
  return {
    id: guild.id,
    uuid: guild.uuid,
    name: guild.name,
    description: guild.description,
    ownerId: guild.ownerID,
    memberIds: guild.memberIDs,
    channels: guild.channels,
    ts: guild.ts,
    icon: guild.icon,
    banner: guild.banner,
  };
}

function guildPostById(guildId, postId) {
  if (postId === undefined || postId === null) return null;
  return db.prepare(
    `SELECT * FROM guild_posts
     WHERE guildID = ? AND CAST(id AS TEXT) = ?`,
  ).get(guildId, String(postId));
}

function reactionDetails(postId, viewerId) {
  return db.prepare(
    `SELECT emojiKey, COUNT(*) AS count,
       MAX(CASE WHEN userID = ? THEN 1 ELSE 0 END) AS reactedByMe
     FROM guild_post_reactions WHERE postID = ?
     GROUP BY emojiKey ORDER BY MIN(ts) ASC`,
  ).all(viewerId, postId).map((row) => {
    const customId = row.emojiKey.startsWith("custom:")
      ? row.emojiKey.slice(7)
      : null;
    const custom = customId
      ? db.prepare(`SELECT uuid, name, url FROM guild_emojis WHERE uuid = ?`).get(customId)
      : null;
    return {
      key: row.emojiKey,
      emoji: custom
        ? { type: "custom", id: custom.uuid, name: custom.name, url: custom.url }
        : { type: "unicode", value: row.emojiKey.slice(8) },
      count: Number(row.count),
      reactedByMe: Boolean(row.reactedByMe),
    };
  });
}

function withGuildState(post, viewerId) {
  return {
    id: post.id,
    guildId: post.guildID,
    userId: post.userID,
    ts: post.ts,
    content: post.content,
    channelId: post.channelId,
    author: post.author,
    replyTo: typeof post.reply_to === "string" && /^\d+$/.test(post.reply_to)
      ? Number(post.reply_to)
      : post.reply_to,
    attachments: parseJsonArray(post.attachments),
    reactions: reactionDetails(post.id, viewerId),
  };
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
  const relevantPermissions = db.prepare(
    `SELECT * FROM guild_channel_permissions WHERE guildID = ? AND channelId = ?`,
  ).all(guildId, channelId);
  const permissionField = {
    view: "viewPermission",
    send: "sendPermission",
    history: "historyPermission",
  }[accessType];
  if (!permissionField) return false;
  if (relevantPermissions.length === 0) return true;

  const roleIds = new Set(getMemberRoleIds(guildId, userId));
  return relevantPermissions.some((permission) =>
    roleIds.has(permission.roleID) && Boolean(permission[permissionField])
  );
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

export async function createGuild(token, name, description, iconValue, bannerValue) {
  if (!token) return false;
  if (typeof name !== "string" || !name.trim()) return false;
  let id;
  try {
    const payload = await verifyToken(token);
    const user = db
      .prepare(`SELECT uuid FROM users WHERE uuid = ?`)
      .value(payload.uuid);
    if (!user) return false;
    id = crypto.randomUUID();
    const icon = normalizeMediaUrl(iconValue, "icon") ?? null;
    const banner = normalizeMediaUrl(bannerValue, "banner") ?? null;
    db.prepare(
      `INSERT INTO guilds (uuid, name, description, ownerID, memberIDs, channels, ts, icon, banner) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, description, payload.uuid, JSON.stringify([payload.uuid]), JSON.stringify([]), Date.now(), icon, banner);
    await createChannel(token, id, "general", "general");
    return { id, name, description, icon, banner };
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
    const posts = stmt.all(offset).map(publicGuild);
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
    }).map(publicGuild);
    return subscribedGuilds;
  } catch (e) {
    throw e;
  }
}

export async function editGuild(token, guildId, name, description, iconValue, bannerValue) {
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
    const media = {};
    if (iconValue !== undefined) {
      media.icon = normalizeMediaUrl(iconValue, "icon");
      db.prepare(`UPDATE guilds SET icon = ? WHERE uuid = ?`).run(media.icon, guildId);
    }
    if (bannerValue !== undefined) {
      media.banner = normalizeMediaUrl(bannerValue, "banner");
      db.prepare(`UPDATE guilds SET banner = ? WHERE uuid = ?`).run(media.banner, guildId);
    }
    emitGuildUpdate(guildId, { name, description, ...media });
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

export async function postToGuild(token, guildId, content, channelId, replyTo, attachmentsValue) {
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
    let replyTarget = null;
    if (replyTo !== undefined && replyTo !== null) {
      replyTarget = guildPostById(guildId, replyTo);
      if (!replyTarget || replyTarget.channelId !== channelId) return false;
    }
    const attachments = normalizeAttachments(attachmentsValue);
    if ((!content || !String(content).trim()) && attachments.length === 0) return false;
    const stmt = db.prepare(`SELECT username FROM users WHERE uuid = ?`).value(id) ?? null;
    const author = stmt[0];
    const ts = Date.now();
    db.exec(`INSERT INTO guild_posts (guildID, userID, content, channelId, ts, author, reply_to, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, guildId, id, content || "", channelId, ts, author, replyTarget?.id ?? null, JSON.stringify(attachments));
    const created = db.prepare(
      `SELECT * FROM guild_posts WHERE guildID = ? AND userID = ? AND ts = ?
       ORDER BY id DESC LIMIT 1`,
    ).get(guildId, id, ts);
    const post = withGuildState(created, id);
    emitGuildPost(guildId, post);
    return post;
  } catch (e) {
    throw e;
  }
}

export async function replyToGuildPost(token, guildId, postId, content, attachments) {
  const target = guildPostById(guildId, postId);
  if (!target) return false;
  return await postToGuild(
    token,
    guildId,
    content,
    target.channelId,
    target.id,
    attachments,
  );
}

export async function fetchGuildReplies(token, guildId, postId) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  const target = guildPostById(guildId, postId);
  if (!target || !isGuildMember(guild, payload.uuid) ||
    !canAccessChannel(guildId, payload.uuid, target.channelId, "history")) {
    return false;
  }
  return db.prepare(
    `SELECT * FROM guild_posts WHERE guildID = ? AND reply_to = ?
     ORDER BY id ASC`,
  ).all(guildId, target.id).map((post) => withGuildState(post, payload.uuid));
}

export async function fetchGuildPost(token, guildId, postId) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  const post = guildPostById(guildId, postId);
  if (!post || !isGuildMember(guild, payload.uuid) ||
    !canAccessChannel(guildId, payload.uuid, post.channelId, "view")) {
    return false;
  }
  return withGuildState(post, payload.uuid);
}

function emojiKey(guildId, emoji) {
  if (typeof emoji !== "string" || !emoji.trim()) return null;
  const value = emoji.trim();
  const customIdentifier = value.replace(/^:|:$/g, "");
  const custom = db.prepare(
    `SELECT uuid, name, url FROM guild_emojis
     WHERE guildID = ? AND (uuid = ? OR name = ?)`,
  ).get(guildId, customIdentifier, customIdentifier);
  if (custom) return { key: `custom:${custom.uuid}`, custom };
  const unicodeEmoji = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u;
  if (value.length > 32 || !unicodeEmoji.test(value)) return null;
  return { key: `unicode:${value}`, unicode: value };
}

export async function registerGuildEmoji(token, guildId, name, urlValue) {
  if (!token || typeof name !== "string" || !/^[a-zA-Z0-9_]{2,32}$/.test(name)) {
    return false;
  }
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  if (!guild || (guild.ownerID !== payload.uuid &&
    !hasPermission(guildId, payload.uuid, "manageEmojis"))) return false;
  const url = normalizeMediaUrl(urlValue, "emoji");
  const uuid = crypto.randomUUID();
  try {
    db.prepare(
      `INSERT INTO guild_emojis (uuid, guildID, name, url, createdBy, ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(uuid, guildId, name, url, payload.uuid, Date.now());
  } catch {
    return false;
  }
  const emoji = { id: uuid, name, url };
  emitGuildEmoji(guildId, "create", emoji);
  return emoji;
}

export async function listGuildEmojis(token, guildId) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  if (!isGuildMember(guild, payload.uuid)) return false;
  return db.prepare(
    `SELECT uuid AS id, name, url FROM guild_emojis
     WHERE guildID = ? ORDER BY name ASC`,
  ).all(guildId);
}

export async function deleteGuildEmoji(token, guildId, emojiId) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  if (!guild || (guild.ownerID !== payload.uuid &&
    !hasPermission(guildId, payload.uuid, "manageEmojis"))) return false;
  const emoji = db.prepare(
    `SELECT uuid AS id, name, url FROM guild_emojis
     WHERE guildID = ? AND uuid = ?`,
  ).get(guildId, emojiId);
  if (!emoji) return false;
  db.prepare(`DELETE FROM guild_post_reactions WHERE emojiKey = ?`)
    .run(`custom:${emoji.id}`);
  db.prepare(`DELETE FROM guild_emojis WHERE uuid = ?`).run(emoji.id);
  emitGuildEmoji(guildId, "delete", emoji);
  return true;
}

export async function setGuildReaction(token, guildId, postId, emoji, active) {
  if (!token) return false;
  const payload = await verifyToken(token);
  const guild = getGuildById(guildId);
  const post = guildPostById(guildId, postId);
  if (!post || !isGuildMember(guild, payload.uuid) || isUserBanned(guildId, payload.uuid) ||
    !canAccessChannel(guildId, payload.uuid, post.channelId, "view")) return false;
  const resolved = emojiKey(guildId, emoji);
  if (!resolved) return false;
  if (active) {
    db.prepare(
      `INSERT OR IGNORE INTO guild_post_reactions (postID, userID, emojiKey, ts)
       VALUES (?, ?, ?, ?)`,
    ).run(post.id, payload.uuid, resolved.key, Date.now());
  } else {
    db.prepare(
      `DELETE FROM guild_post_reactions
       WHERE postID = ? AND userID = ? AND emojiKey = ?`,
    ).run(post.id, payload.uuid, resolved.key);
  }
  const reaction = reactionDetails(post.id, payload.uuid)
    .find((item) => item.key === resolved.key) ?? {
      key: resolved.key,
      emoji: resolved.custom
        ? { type: "custom", id: resolved.custom.uuid, name: resolved.custom.name, url: resolved.custom.url }
        : { type: "unicode", value: resolved.unicode },
      count: 0,
      reactedByMe: false,
    };
  emitGuildReaction(guildId, post.id, reaction);
  return reaction;
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
  ).all(guildId).map((post) => withGuildState(post, payload.uuid));
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
  ).all(guildId, targetChannel, (page - 1) * 25)
    .map((post) => withGuildState(post, payload.uuid));
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
