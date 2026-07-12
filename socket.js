// WebSocket handler
const WS_PORT = Deno.env.get("WS_PORT") || 7001;
import { verifyToken } from "./keys.js";
import { connectDB } from "./db.js";
import { log } from "./logging.js";

const db = connectDB();
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("Socket module loaded", "gray");
}

const userSockets = new Map(); // userId -> WebSocket
const guildRooms = new Map(); // guildId -> Set<userId>

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of userSockets.values()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastToGuild(guildId, data) {
  const msg = JSON.stringify(data);
  const members = guildRooms.get(guildId) ?? new Set();
  for (const userId of members) {
    const ws = userSockets.get(userId);
    if (ws?.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

export function initSocket() {
  Deno.serve({ port: WS_PORT, onListen() {} }, (req) => {
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

      if (msg.type === "auth") {
        try {
          const payload = await verifyToken(msg.token);
          if (!payload) {
            ws.send(
              JSON.stringify({ type: "error", message: "Invalid token" }),
            );
            return;
          }

          ws.userId = payload.uuid;
          ws.username = payload.username;
          userSockets.set(payload.uuid, ws);

          const guilds = db
            .prepare(`SELECT uuid FROM guilds WHERE memberIDs LIKE ?`)
            .all(`%${payload.uuid}%`);
          for (const guild of guilds) joinGuildRoom(payload.uuid, guild.uuid);

          ws.send(
            JSON.stringify({
              type: "authenticated",
              username: payload.username,
            }),
          );
          if (Deno.env.get("LOG_LEVEL") === "trace") {
            log(`User authenticated: ${payload.username}`, "gray");
          }
        } catch (err) {
          ws.send(
            JSON.stringify({ type: "error", message: "Authentication failed" }),
          );
          log(`Auth failed: ${err}`, "red");
        }
      }
    };

    ws.onclose = () => {
      if (ws.userId) {
        userSockets.delete(ws.userId);
        for (const members of guildRooms.values()) members.delete(ws.userId);
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
  const ws = userSockets.get(userId);
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "inbox:message", ...message }));
}

export function joinGuildRoom(userId, guildId) {
  if (!guildRooms.has(guildId)) guildRooms.set(guildId, new Set());
  guildRooms.get(guildId).add(userId);
}

export function leaveGuildRoom(userId, guildId) {
  guildRooms.get(guildId)?.delete(userId);
}

export function getConnectedSockets() {
  return userSockets.size;
}
