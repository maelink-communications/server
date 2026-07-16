// WebSocket handler
const WS_PORT = Deno.env.get("WS_PORT") || 7001;
import { connectDB } from "./db.js";
import { log } from "./logging.js";
import { AccessError, authenticateToken } from "./access.js";

const db = connectDB();
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Socket module loaded", "gray");
}

const userSockets = new Map(); // userId -> Set<WebSocket>
const guildRooms = new Map(); // guildId -> Set<userId>

function addUserSocket(userId, ws) {
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(ws);
}

function removeUserSocket(userId, ws) {
  const sockets = userSockets.get(userId);
  sockets?.delete(ws);
  if (sockets?.size === 0) userSockets.delete(userId);
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const sockets of userSockets.values()) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

function broadcastToGuild(guildId, data) {
  const msg = JSON.stringify(data);
  const members = guildRooms.get(guildId) ?? new Set();
  for (const userId of members) {
    for (const ws of userSockets.get(userId) ?? []) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
}

export function initSocket() {
  return Deno.serve({ port: WS_PORT, onListen() {} }, (req) => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 426 });
    }

    const { socket: ws, response } = Deno.upgradeWebSocket(req);

    ws.onopen = () => log(`WebSocket connected`, "blue");

    ws.onmessage = async (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (ws.userId && msg.type !== "auth") {
        try {
          await authenticateToken(ws.authToken, { requiredType: "access" });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : "Access revoked";
          ws.send(JSON.stringify({ type: "error", message }));
          ws.close(4003, "Access revoked");
          return;
        }
      }

      if (msg.type === "auth") {
        try {
          const payload = await authenticateToken(msg.token, {
            requiredType: "access",
          });

          if (ws.userId) removeUserSocket(ws.userId, ws);
          ws.userId = payload.uuid;
          ws.username = payload.username;
          ws.authToken = msg.token;
          addUserSocket(payload.uuid, ws);

          const guilds = db
            .prepare(`SELECT uuid FROM guilds WHERE memberIDs LIKE ?`)
            .all(`%${payload.uuid}%`);
          for (const guild of guilds) joinGuildRoom(payload.uuid, guild.uuid);

          ws.send(
            JSON.stringify({
              type: "authenticated",
              username: payload.username,
              permissions: payload.permissions,
              isMaster: payload.isMaster,
            }),
          );
          if (Deno.env.get("LOG_LEVEL") === "trace") {
            log(`User authenticated: ${payload.username}`, "gray");
          }
        } catch (err) {
          const accessError = err instanceof AccessError ? err : null;
          ws.send(
            JSON.stringify({
              type: "error",
              code: accessError?.code ?? "AUTHENTICATION_FAILED",
              message: accessError?.message ?? "Authentication failed",
              details: accessError?.details,
            }),
          );
          if (accessError?.code === "ACCOUNT_BANNED") {
            ws.close(4003, "Account banned");
          }
          log(`Auth failed: ${err}`, "red");
        }
      }
    };

    ws.onclose = () => {
      if (ws.userId) {
        removeUserSocket(ws.userId, ws);
        if (!userSockets.has(ws.userId)) {
          for (const members of guildRooms.values()) members.delete(ws.userId);
        }
        if (Deno.env.get("LOG_LEVEL") === "trace") {
          log(`User disconnected: ${ws.username}`, "grey");
        }
      }
    };

    return response;
  });
}

export function emitHomePost(post) {
  broadcast({ type: "home:post", ...post });
}
export function emitHomePostEdit(postId, content) {
  broadcast({ type: "home:post:edit", postId, content });
}
export function emitHomePostDelete(postId) {
  broadcast({ type: "home:post:delete", postId });
}
export function emitHomePostLike(postId, users_liked) {
  broadcast({ type: "home:post:like", postId, users_liked });
}
export function emitHomeDiscussion(type, postId, item) {
  broadcast({ type: `home:${type}`, postId, item });
}

export function emitGuildPost(guildId, post) {
  broadcastToGuild(guildId, { type: "guild:post", guildId, ...post });
}
export function emitGuildUpdate(guildId, data) {
  broadcastToGuild(guildId, { type: "guild:update", guildId, ...data });
}
export function emitGuildChannelCreate(guildId, channel) {
  broadcastToGuild(guildId, { type: "guild:channel:create", guildId, channel });
}
export function emitGuildChannelDelete(guildId, channelId) {
  broadcastToGuild(guildId, {
    type: "guild:channel:delete",
    guildId,
    channelId,
  });
}

export function emitInboxMessage(userId, message) {
  for (const ws of userSockets.get(userId) ?? []) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "inbox:message", ...message }));
    }
  }
}
export function emitGuildReaction(guildId, postId, reaction) {
  broadcastToGuild(guildId, {
    type: "guild:post:reaction",
    guildId,
    postId,
    reaction,
  });
}
export function emitGuildEmoji(guildId, action, emoji) {
  broadcastToGuild(guildId, {
    type: `guild:emoji:${action}`,
    guildId,
    emoji,
  });
}

export function disconnectUser(userId, action = "kicked", reason = null) {
  const sockets = [...(userSockets.get(userId) ?? [])];
  const type = action === "logged_out"
    ? "auth:revoked"
    : `moderation:${action}`;
  const message = JSON.stringify({
    type,
    reason,
  });
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(message);
    ws.close(action === "banned" ? 4003 : 4001, `Account ${action}`);
  }
  userSockets.delete(userId);
  for (const members of guildRooms.values()) members.delete(userId);
  return sockets.length;
}

export function joinGuildRoom(userId, guildId) {
  if (!guildRooms.has(guildId)) guildRooms.set(guildId, new Set());
  guildRooms.get(guildId).add(userId);
}

export function leaveGuildRoom(userId, guildId) {
  guildRooms.get(guildId)?.delete(userId);
}

export function getConnectedSockets() {
  let count = 0;
  for (const sockets of userSockets.values()) count += sockets.size;
  return count;
}
