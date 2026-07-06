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

await db.initDB();
await keys.initKeys();

// Some helpers

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, Authorization, p, x-server-id",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
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
    const { username, password } = await req.json();
    const reg = await auth.register(username, password);
    if (!reg) return json({ error: true }, 400);
    return json({ error: false, user: reg });
  }

  if (pathParts[0] === "login" && method === "POST") {
    const { username, password, token } = await req.json();
    let user;
    if (token) {
      user = await auth.loginToken(token);
    } else {
      user = await auth.login(username, password);
    }
    if (!user) return json({ error: true }, 401);
    return json({ error: false, user });
  }

  if (pathParts[0] === "home" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { content } = await req.json();
    try {
      const post = await home.createPost(token, content);
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
      if (!user) { return json({ error: true }, 400) } else {
        userPosts = await me.fetchUserPosts(token, userId, p);
      };
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
    const page = parseInt(req.headers.get("p") ?? "1");
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
    const { page } = await readJsonBody(req);
    try {
      const fetchedGuilds = await guilds.fetchGuilds(token, page);
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
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[2];
    try {
      const channels = await guilds.fetchGuildChannels(token, guildId);
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

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "members" &&
    method === "GET"
  ) {
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
    const { page } = await readJsonBody(req);
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

  return json({ error: true }, 404);
}

Deno.serve({ port: SERVER_PORT, onListen: () => {} }, async (req) => {
  return withCors(await handler(req));
});

log("PROTOKOL | Server is running on http://localhost:7000", "magenta");

// Initialize Socket.IO on separate port
socket.initSocket();
