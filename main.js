// Main logic.
const SERVER_PORT = Deno.env.get("PORT") || 7000;
import { register, login } from "./auth.js";
import {
  createPost,
  editPost,
  fetchPosts,
  destroyPost,
  postLikeSet,
} from "./home.js";
import { fetchUser, editUser } from "./me.js";
import {
  sendMessage,
  fetchMessages,
  deleteMessage,
  checkNewMessages,
  setRead,
} from "./inbox.js";
import { initDB } from "./db.js";
import { log } from "./logging.js";
import { initKeys, getPublicJwk } from "./keys.js";

initDB();
await initKeys();

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

// Handler

async function handler(req) {
  const url = new URL(req.url);
  const { pathname, method } = { pathname: url.pathname, method: req.method };

  if (method === "OPTIONS") {
    return new Response(null);
  }

  if (
    (pathname === "/register" || pathname === "//register") &&
    method === "POST"
  ) {
    const { username, password } = await req.json();
    const reg = await register(username, password);
    if (!reg) return json({ error: true }, 400);
    return json({ error: false, user: reg });
  }

  if ((pathname === "/login" || pathname === "//login") && method === "POST") {
    const { username, password } = await req.json();
    const user = await login(username, password);
    if (!user) return json({ error: true }, 401);
    return json({ error: false, user });
  }

  if ((pathname === "/post" || pathname === "//post") && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { content } = await req.json();
    try {
      const post = await createPost(token, content);
      if (!post) return json({ error: true }, 400);
      return json(post);
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/home" || pathname === "//home") && method === "GET") {
    const page = parseInt(req.headers.get("p") ?? "1");
    try {
      const posts = await fetchPosts(page);
      return json({ error: false, page, posts });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/post" || pathname === "//post") && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId, content, like } = await req.json();
    try {
      if (like) {
        const post = await postLikeSet(token, postId);
        if (!post) return json({ error: true }, 400);
        return json({ error: false });
      } else {
        const post = await editPost(token, postId, content);
        if (!post) return json({ error: true }, 400);
        return json({ error: false });
      }
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/post" || pathname === "//post") && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId } = await req.json();
    try {
      const post = await destroyPost(token, postId);
      if (!post) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if (
    (pathname.startsWith("/user/") || pathname.startsWith("//user/")) &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const userId = pathname.split("/")[2];
    try {
      const user = await fetchUser(token, userId);
      if (!user) return json({ error: true }, 400);
      return json({ error: false, user });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/user" || pathname === "//user") && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { username, pfp, bio } = await req.json();
    try {
      const user = await editUser(token, username, pfp, bio);
      if (!user) return json({ error: true }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/inbox" || pathname === "//inbox") && method === "GET") {
    const page = parseInt(req.headers.get("p") ?? "1");
    const token = getToken(req).toString();
    log(`Fetch messages called with page: ${page}, token: ${token}`, "blue");
    if (!token) return json({ error: true }, 401);
    try {
      const user = await fetchMessages(token.toString(), page);
      const hasNew = await checkNewMessages(token);
      if (!user) return json({ error: true }, 400);
      return json({ error: false, messages: user, unread: hasNew });
    } catch (e) {
      log(e, "red");
      return json({ error: true }, 400);
    }
  }

  if ((pathname === "/inbox" || pathname === "//inbox") && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { message_id } = await req.json();
    try {
      const message = await setRead(message_id, token);
      if (!message) return json({ error: true }, 400);
      return json({ error: false, messages: message });
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
