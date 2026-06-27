// Socket.IO handler
import { Server } from "socket.io";
import { verifyToken } from "./keys.js";
import { connectDB } from "./db.js";
import { log } from "./logging.js";

const db = connectDB();
log("Socket module loaded", "gray");

let io;
const userSockets = new Map();

export function initSocket(httpServer) {
  io = new Server({
    cors: { origin: "*" },
    transports: ['websocket', 'polling']
  });

  io.listen(7001);

  io.on("connection", (socket) => {
    log(`Socket connected: ${socket.id}`, "blue");

    socket.on("auth", async (token) => {
      try {
        const payload = await verifyToken(token);
        if (!payload) {
          socket.emit("error", { message: "Invalid token" });
          return;
        }

        socket.userId = payload.uuid;
        socket.username = payload.username;
        userSockets.set(payload.uuid, socket);

        const guilds = db.prepare(
          `SELECT uuid FROM guilds WHERE memberIDs LIKE ?`
        ).all(`%${payload.uuid}%`);

        guilds.forEach(guild => {
          socket.join(`guild:${guild.uuid}`);
        });

        socket.emit("authenticated", { username: payload.username });
        log(`User authenticated: ${payload.username}`, "green");
      } catch (e) {
        socket.emit("error", { message: "Authentication failed" });
        log(`Auth failed: ${e}`, "red");
      }
    });

    socket.on("disconnect", () => {
      if (socket.userId) {
        userSockets.delete(socket.userId);
        log(`User disconnected: ${socket.username}`, "yellow");
      }
    });
  });

  log("Socket.IO server running on port 7001", "magenta");
  return io;
}

export function emitHomePost(post) {
  if (!io) return;
  io.emit("home:post", post);
}

export function emitHomePostEdit(postId, content) {
  if (!io) return;
  io.emit("home:post:edit", { postId, content });
}

export function emitHomePostDelete(postId) {
  if (!io) return;
  io.emit("home:post:delete", { postId });
}

export function emitGuildPost(guildId, post) {
  if (!io) return;
  io.to(`guild:${guildId}`).emit("guild:post", { guildId, ...post });
}

export function emitGuildUpdate(guildId, data) {
  if (!io) return;
  io.to(`guild:${guildId}`).emit("guild:update", { guildId, ...data });
}

export function emitGuildChannelCreate(guildId, channel) {
  if (!io) return;
  io.to(`guild:${guildId}`).emit("guild:channel:create", { guildId, channel });
}

export function emitGuildChannelDelete(guildId, channelId) {
  if (!io) return;
  io.to(`guild:${guildId}`).emit("guild:channel:delete", { guildId, channelId });
}

export function emitInboxMessage(userId, message) {
  if (!io) return;
  const socket = userSockets.get(userId);
  if (socket) {
    socket.emit("inbox:message", message);
  }
}

export function joinGuildRoom(userId, guildId) {
  const socket = userSockets.get(userId);
  if (socket) {
    socket.join(`guild:${guildId}`);
  }
}

export function leaveGuildRoom(userId, guildId) {
  const socket = userSockets.get(userId);
  if (socket) {
    socket.leave(`guild:${guildId}`);
  }
}
