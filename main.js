// Main logic.
const SERVER_PORT = Deno.env.get("PORT") || 7000;
import * as auth from "./auth.js";
import * as home from "./home.js";
import * as me from "./me.js";
import * as inbox from "./inbox.js";
import * as guilds from "./guilds.js";
import * as db from "./db.js";
import { log } from "./logging.js";
import * as keys from "./keys.js";
import * as socket from "./socket.js";
import * as version from "./version.js";

await db.initDB();
await keys.initKeys();

// Some helpers

const ALLOWED_URLS = [
  "https://solstice52.github.io",
  "https://notfenixio.is-a.dev",
  "https://zag.lunarsphere.net",
  "https://kabezz.github.io",
  "https://turbowarp.org",
  "https://localhost",
  "https://127.0.0.1",
]

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, Authorization, p, x-server-id",
  "Access-Control-Allow-Credentials": true,
};

function json(data, status = 200, cookies = []) {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function buildCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}`;
}

function buildAuthCookies(accessToken, refreshToken) {
  return [
    buildCookie("accessToken", accessToken, 60 * 60 * 2),
    buildCookie("refreshToken", refreshToken, 60 * 60 * 24 * 30),
  ];
}

function withCors(response, origin) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  if (origin && ALLOWED_URLS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  for (const [k, v] of response.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") {
      headers.append(k, v);
    } else {
      headers.set(k, v);
    }
  }
  return new Response(response.body, { status: response.status, headers });
}

function getToken(req) {
  return req.headers.get("Authorization")?.split(" ")[1] ?? null;
}

async function readJsonBody(req) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return {};

  const text = await req.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Handler

async function handler(req) {
  const url = new URL(req.url);
  const { pathname, method } = { pathname: url.pathname, method: req.method };
  const pathParts = pathname.split("/").filter(Boolean);
  log(`Incoming request: ${method} ${pathname}`, "blue");
  log(`Path parts: ${pathParts.join(", ")}`, "blue");
  if (method === "OPTIONS") {
    return new Response(null);
  }

  if (pathParts[0] === "register" && method === "POST") {
    const body = await readJsonBody(req);
    const { username, password, setCookie = false } = body;
    const reg = await auth.register(username, password);
    if (!reg) return json({ error: true }, 400);
    return json(
      {
        error: false,
        user: reg,
        token: reg.accessToken,
        accessToken: reg.accessToken,
        refreshToken: reg.refreshToken,
      },
      200,
      setCookie ? buildAuthCookies(reg.accessToken, reg.refreshToken) : [],
    );
  }

  if (pathParts[0] === "login" && method === "POST") {
    const body = await readJsonBody(req);
    const { username, password, token, setCookie = false } = body;
    let user;
    if (token) {
      user = await auth.loginToken(token);
    } else {
      user = await auth.login(username, password);
    }
    if (!user) return json({ error: true }, 401);
    return json(
      {
        error: false,
        user: {
          ...user,
          token: user.accessToken,
        },
        token: user.accessToken,
        accessToken: user.accessToken,
        refreshToken: user.refreshToken,
      },
      200,
      setCookie ? buildAuthCookies(user.accessToken, user.refreshToken) : [],
    );
  }

  if (pathParts[0] === "home" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { content, clientId } = await req.json();
    try {
      const post = await home.createPost(token, content, clientId);
      if (!post) return json({ error: true }, 400);
      return json(post);
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "home" && method === "GET") {
    const page = parseInt(url.searchParams.get("page") || "1");
    try {
      const posts = await home.fetchPosts(page);
      return json({ error: false, page, posts });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "home" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId, content, like } = await req.json();
    try {
      if (like) {
        const post = await home.postLikeSet(token, postId);
        if (!post) return json({ error: true }, 400);
        return json({ error: false });
      } else {
        const post = await home.editPost(token, postId, content);
        if (!post) return json({ error: true }, 400);
        return json({ error: false });
      }
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "home" && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId } = await req.json();
    try {
      const post = await home.destroyPost(token, postId);
      if (!post) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "user" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const userId = pathParts[1];
    const p = parseInt(url.searchParams.get("page") || "1");
    let userPosts = [];
    try {
      const user = await me.fetchUser(token, userId);
      if (!user) {
        return json({ error: true }, 400);
      } else {
        userPosts = await me.fetchUserPosts(token, userId, p);
      }
      return json({ error: false, user, userPosts });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "user" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { username, pfp, bio } = await req.json();
    try {
      const user = await me.editUser(token, username, pfp, bio);
      if (!user) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "inbox" && method === "GET") {
    const page = parseInt(url.searchParams.get("page") || "1");
    const token = getToken(req).toString();
    log(`Fetch messages called with page: ${page}, token: ${token}`, "blue");
    if (!token) return json({ error: true }, 401);
    try {
      const user = await inbox.fetchMessages(token.toString(), page);
      const hasNew = await inbox.checkNewMessages(token);
      if (!user) return json({ error: true }, 400);
      return json({ error: false, messages: user, unread: hasNew });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "inbox" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { message_id } = await req.json();
    try {
      const message = await inbox.setRead(message_id, token);
      if (!message) return json({ error: true }, 400);
      return json({ error: false, messages: message });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guilds" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { page } = parseInt(url.searchParams.get("page") || "1");
    try {
      const fetchedGuilds = await guilds.fetchGuilds(token, page);
      if (!fetchedGuilds) return json({ error: true }, 400);
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (
    pathParts[0] === "guilds" &&
    pathParts[1] === "subscribed" &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const fetchedGuilds = await guilds.fetchSubscribedGuilds(token);
      if (!fetchedGuilds) return json({ error: true }, 400);
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guilds" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { name, description } = await readJsonBody(req);
    try {
      const fetchedGuilds = await guilds.createGuild(token, name, description);
      if (!fetchedGuilds) return json({ error: true }, 400);
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  const isGuildChannelsRoute =
    pathParts[0] === "guild" && pathParts[1] === "channels";

  if (isGuildChannelsRoute && method === "GET") {
    const token = getToken(req);
    const page = parseInt(url.searchParams.get("page") || "1");
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[2];
    try {
      const channels = await guilds.fetchGuildChannels(token, guildId, page);
      if (!channels) return json({ error: true }, 400);
      return json({ error: false, channels });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (isGuildChannelsRoute && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[2];
    const { channelId, name } = await readJsonBody(req);
    try {
      const channel = await guilds.editChannel(token, guildId, channelId, name);
      if (!channel) return json({ error: true }, 400);
      return json({ error: false, channel });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (isGuildChannelsRoute && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { guildId, name } = await readJsonBody(req);
    try {
      const channel = await guilds.createChannel(token, guildId, name);
      if (!channel) return json({ error: true }, 500);
      return json({ error: false, channel });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (isGuildChannelsRoute && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { guildId, channelId } = await readJsonBody(req);
    try {
      const channel = await guilds.deleteChannel(token, guildId, channelId);
      if (!channel) return json({ error: true }, 500);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "roles" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const roles = await guilds.listGuildRoles(token, guildId);
      if (!roles) return json({ error: true }, 400);
      return json({ error: false, roles });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "roles" && method === "POST" && !pathParts[3]) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { name, color, permissions } = await readJsonBody(req);
    try {
      const role = await guilds.createGuildRole(token, guildId, name, color, permissions);
      if (!role) return json({ error: true }, 400);
      return json({ error: false, role });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "members" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const members = await guilds.fetchGuildMembers(token, guildId);
      if (!members) return json({ error: true }, 400);
      return json({ error: false, members });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "roles" && pathParts[4] === "members" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const roleId = pathParts[3];
    const { userId } = await readJsonBody(req);
    try {
      const assigned = await guilds.assignGuildRole(token, guildId, roleId, userId);
      if (!assigned) return json({ error: true }, 400);
      return json({ error: false, assigned: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "channel-permissions" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { channelId, roleId, view, send, history } = await readJsonBody(req);
    try {
      const updated = await guilds.setChannelPermissions(token, guildId, channelId, roleId, { view, send, history });
      if (!updated) return json({ error: true }, 400);
      return json({ error: false, updated: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "moderation" && pathParts[3] === "delete-post" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { postId } = await readJsonBody(req);
    try {
      const deleted = await guilds.deleteGuildPost(token, guildId, postId);
      if (!deleted) return json({ error: true }, 400);
      return json({ error: false, deleted: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "moderation" && pathParts[3] === "kick" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { userId, reason } = await readJsonBody(req);
    try {
      const kicked = await guilds.moderateKick(token, guildId, userId, reason);
      if (!kicked) return json({ error: true }, 400);
      return json({ error: false, kicked: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && pathParts[2] === "moderation" && pathParts[3] === "ban" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { userId, durationSeconds, reason } = await readJsonBody(req);
    try {
      const banned = await guilds.moderateBan(token, guildId, userId, durationSeconds, reason);
      if (!banned) return json({ error: true }, 400);
      return json({ error: false, banned: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "join" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const joined = await guilds.joinGuild(token, guildId);
      if (!joined) return json({ error: true }, 400);
      return json({ error: false, joined: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "leave" &&
    method === "DELETE"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const left = await guilds.leaveGuild(token, guildId);
      if (!left) return json({ error: true }, 400);
      return json({ error: false, left: true });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const page = parseInt(url.searchParams.get("page") || "1");
    try {
      const guildposts = await guilds.fetchGuildPosts(token, guildId, page);
      if (!guildposts) return json({ error: true }, 400);
      return json({ error: false, posts: guildposts });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { name, description } = await readJsonBody(req);
    try {
      const guild = await guilds.editGuild(token, guildId, name, description);
      if (!guild) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const channelId = pathParts[2];
    const { content } = await readJsonBody(req);
    try {
      const guild = await guilds.postToGuild(
        token,
        guildId,
        content,
        channelId,
      );
      if (!guild) return json({ error: true }, 400);
      return json({ error: false, post: guild });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "guild" && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const guild = await guilds.deleteGuild(token, guildId);
      if (!guild) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts[0] === "version" && method === "GET") {
    try {
      const versioning = await version.getVersion();
      return json({ error: false, apiVersion: versioning });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (pathParts.length === 0 && method === "GET") {
    const serverName = Deno.env.get("SERVER_NAME") || "maelink server";
    const serverDescription =
      Deno.env.get("SERVER_DESCRIPTION") ||
      "No description given for this server.";
    const escapedDescription = serverDescription
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
    const versioning = await version.getVersion();
    const connected = socket.getConnectedSockets();
    const db2 = db.connectDB();
    const registered =
      db2.prepare("SELECT COUNT(*) as count FROM users").get()?.count ?? 0;
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${serverName}</title>
      <meta property="og:title" content="${serverName}">
      <meta property="og:description" content="${escapedDescription}">
      <meta property="og:image" content="https://github.com/maelink-communications/maelink-communications.github.io/blob/main/biglogo.png?raw=true">
      <meta property="og:type" content="website">
      <meta name="theme-color" content="#ff5757">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:ital,wght@0,100..900;1,100..900&family=Rethink+Sans:ital,wght@0,400..800;1,400..800&display=swap" rel="stylesheet">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Rethink Sans';
          background: #181818;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          width: 100%;
          padding: 40px;
          text-align: center;
        }
        h1 {
          color: #ffffff;
          font-size: 2.5em;
          margin-bottom: 10px;
        }
        .description {
          color: #c0c0c0;
          font-size: 1.1em;
          margin-bottom: 30px;
          line-height: 1.6;
        }
        .info-box {
          background: #3b3b3b;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }
        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid #e0e0e0;
        }
        .info-item:last-child {
          border-bottom: none;
        }
        .info-label {
          font-weight: 600;
          color: #ffffff;
        }
        .info-value {
          color: #ea6666;
          font-family: 'Geist Mono', monospace;
        }
        .button {
          display: inline-block;
          background: #444444;
          color: white;
          text-decoration: none;
          padding: 15px 30px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 1.1em;
          margin-top: 20px;
        }
        .button:hover {
          background: #555555;
        }
        .footer {
          margin-top: 30px;
          color: #999;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
    <img src="https://github.com/maelink-communications/maelink-communications.github.io/blob/main/biglogo.png?raw=true" alt="maelink" style="width:360px;height:auto;margin-bottom:24px;">
      <div class="container">
        <h1>${serverName}</h1>
        <p class="description">${escapedDescription}</p>
        
        <div class="info-box">
          <div class="info-item">
            <span class="info-label">Server version: </span>
            <span class="info-value">${versioning}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Status: </span>
            <span class="info-value">Online</span>
          </div>
          <div class="info-item">
            <span class="info-label">Connected users: </span>
            <span class="info-value">${connected}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Registered users: </span>
            <span class="info-value">${registered}</span>
          </div>
        </div>
        
        <a href="https://github.com/maelink-communications/server/blob/protokol/CLIENTS.md" class="button" target="_blank">
          View compatible clients here.
        </a>
        
        <p class="footer">
          This is a maelink server. You need a compatible client to connect.
        </p>
      </div>
    </body>
    </html>
  `;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html",
        ...CORS_HEADERS,
      },
    });
  }

  return json({ error: true }, 404);
}

Deno.serve({ port: SERVER_PORT, onListen: () => {} }, async (req) => {
  try {
    return withCors(await handler(req), req.headers.get("origin"));
  } catch (e) {
    console.error("Unhandled server error:", e);
    return new Response(String(e), { status: 500 });
  }
});

log("PROTOKOL | Server is running on http://localhost:7000", "magenta");

// Initialize WS on separate port
socket.initSocket();
