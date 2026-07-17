// Main logic.
const SERVER_PORT = Deno.env.get("PORT") || 7000;
const WS_PORT = Deno.env.get("WS_PORT") || 7001;
const UPLOADS_PORT = Deno.env.get("UPLOADS_PORT") || 7002;
const EXPOSE_ERROR_STACK =
  Deno.env.get("EXPOSE_ERROR_STACK")?.toLowerCase() === "true";
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
import * as rate from "./ratelimit.js";
import * as access from "./access.js";
import * as moderation from "./moderation.js";
import * as uploads from "./uploads.js";
import { getCookies } from "@std/http/cookie";
import { encodeHex } from "@std/encoding";

if (
  Deno.env.get("LOG_LEVEL") != "trace" &&
  Deno.env.get("LOG_LEVEL") != "error" &&
  Deno.env.get("LOG_LEVEL") != null
) {
  log("/!\\ Unknown log level was set! Defaulting to 'error'.", "yellow");
}

await db.initDB();
await keys.initKeys();
if (!uploads.uploadsOnlyMode()) {
  await access.initAccessControl();
}

// Some helpers

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "content-type, Authorization, p, x-server-id, x-file-name",
  "Access-Control-Allow-Credentials": true,
};

function json(data, status = 200, cookies = []) {
  if (data?.error === true) {
    const message =
      data.message ??
      data.msg ??
      (status === 401
        ? "Unauthorized"
        : status === 404
          ? "Route not found"
          : `Request failed with status ${status}`);
    data = { ...data, message, msg: data.msg ?? message };
  }
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

function errorJson(
  error,
  status = error instanceof access.AccessError ||
  error instanceof me.UserError ||
  error instanceof uploads.UploadError
    ? error.status
    : 500,
) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const data = {
    error: true,
    message: normalized.message || normalized.name || "Unknown error",
  };
  if (
    error instanceof access.AccessError ||
    error instanceof me.UserError ||
    error instanceof uploads.UploadError
  ) {
    data.code = error.code;
    if (error.details !== undefined) data.details = error.details;
  } else if (EXPOSE_ERROR_STACK) {
    data.stack = normalized.stack ?? String(error);
  }
  return json(data, status);
}

function buildCookie(name, value, maxAge) {
  return `__Host-${name}=${encodeURIComponent(
    value,
  )}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAge}; Partitioned`;
}

function buildAuthCookies(accessToken, refreshToken) {
  return [
    buildCookie("accessToken", accessToken, 60 * 15),
    buildCookie("refreshToken", refreshToken, 60 * 60 * 24 * 30),
  ];
}

function clearAuthCookies() {
  return [
    buildCookie("accessToken", "", 0),
    buildCookie("refreshToken", "", 0),
  ];
}

function withCors(response, origin) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  if (origin) {
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
  if (req.headers.get("Authorization")) {
    return req.headers.get("Authorization").split(" ")[1];
  }
  if (req.headers.get("Cookie")) {
    return (
      getCookies(req.headers)["__Host-accessToken"] ||
      getCookies(req.headers)["__Host-refreshToken"]
    );
  }
  return null;
}

function getPresentedTokens(req) {
  const tokens = [];
  const authorization = req.headers.get("Authorization");
  if (authorization) tokens.push(authorization.split(" ")[1]);
  if (req.headers.get("Cookie")) {
    const cookies = getCookies(req.headers);
    tokens.push(cookies["__Host-accessToken"], cookies["__Host-refreshToken"]);
  }
  return [...new Set(tokens.filter(Boolean))];
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

// Source - https://stackoverflow.com/a/71011282
// Posted by jsejcksn
// Retrieved 2026-07-11, License - CC BY-SA 4.0

function assertIsNetAddr(addr) {
  if (!["tcp", "udp"].includes(addr.transport)) {
    throw new Error("Not a network address");
  }
}

function getRemoteAddress(connInfo) {
  assertIsNetAddr(connInfo.remoteAddr);
  return connInfo.remoteAddr;
}

const SET_ENDPOINTS = [
  { methods: ["GET"], path: [] },
  { methods: ["POST"], path: ["register"] },
  { methods: ["POST"], path: ["login"] },
  { methods: ["POST"], path: ["logout"] },
  { methods: ["POST"], path: ["upload"] },
  { methods: ["GET", "HEAD"], path: ["files", ":fileId"] },
  { methods: ["GET", "POST", "PATCH", "DELETE"], path: ["home"] },
  { methods: ["GET", "POST"], path: ["home", ":postId", "comments"] },
  { methods: ["DELETE"], path: ["home", ":postId", "comments", ":commentId"] },
  { methods: ["GET", "POST"], path: ["home", ":postId", "replies"] },
  { methods: ["DELETE"], path: ["home", ":postId", "replies", ":replyId"] },
  { methods: ["GET"], path: ["user", ":userId"] },
  { methods: ["PATCH"], path: ["user"] },
  { methods: ["POST", "DELETE"], path: ["user", ":userId", "follow"] },
  { methods: ["GET"], path: ["user", ":userId", "followers"] },
  { methods: ["GET"], path: ["user", ":userId", "following"] },
  { methods: ["GET"], path: ["user", ":userId", "relationship"] },
  { methods: ["GET", "PATCH"], path: ["inbox"] },
  { methods: ["GET"], path: ["moderation", "permissions"] },
  {
    methods: ["GET", "PATCH"],
    path: ["moderation", "users", ":userId", "permissions"],
  },
  { methods: ["GET", "POST"], path: ["moderation", "bans"] },
  { methods: ["DELETE"], path: ["moderation", "bans", ":userId"] },
  { methods: ["POST"], path: ["moderation", "kicks"] },
  {
    methods: ["DELETE"],
    path: ["moderation", "home", "posts", ":postId"],
  },
  { methods: ["POST"], path: ["moderation", "inbox"] },
  { methods: ["GET", "POST"], path: ["guilds"] },
  { methods: ["GET"], path: ["guilds", "subscribed"] },
  {
    methods: ["GET", "PATCH"],
    path: ["guild", "channels", ":guildId"],
  },
  { methods: ["POST", "DELETE"], path: ["guild", "channels"] },
  { methods: ["GET", "POST"], path: ["guild", ":guildId", "roles"] },
  { methods: ["GET", "POST"], path: ["guild", ":guildId", "emojis"] },
  { methods: ["DELETE"], path: ["guild", ":guildId", "emojis", ":emojiId"] },
  {
    methods: ["GET", "POST"],
    path: ["guild", ":guildId", "posts", ":postId", "replies"],
  },
  {
    methods: ["GET", "POST", "DELETE"],
    path: ["guild", ":guildId", "posts", ":postId", "reactions"],
  },
  { methods: ["GET"], path: ["guild", ":guildId", "members"] },
  {
    methods: ["POST"],
    path: ["guild", ":guildId", "roles", ":roleId", "members"],
  },
  {
    methods: ["PATCH"],
    path: ["guild", ":guildId", "channel-permissions"],
  },
  {
    methods: ["POST"],
    path: ["guild", ":guildId", "moderation", "delete-post"],
  },
  {
    methods: ["POST"],
    path: ["guild", ":guildId", "moderation", "kick"],
  },
  {
    methods: ["POST"],
    path: ["guild", ":guildId", "moderation", "ban"],
  },
  { methods: ["POST"], path: ["guild", ":guildId", "join"] },
  { methods: ["DELETE"], path: ["guild", ":guildId", "leave"] },
  {
    methods: ["GET", "PATCH", "DELETE"],
    path: ["guild", ":guildId"],
  },
  {
    methods: ["POST"],
    path: ["guild", ":guildId", ":channelId"],
  },
  { methods: ["GET"], path: ["version"] },
];

function matchesEndpointPath(endpoint, pathParts) {
  return (
    endpoint.path.length === pathParts.length &&
    endpoint.path.every(
      (part, index) => part.startsWith(":") || part === pathParts[index],
    )
  );
}

function isSetEndpoint(method, pathParts) {
  return SET_ENDPOINTS.some(
    (endpoint) =>
      endpoint.methods.includes(method) &&
      matchesEndpointPath(endpoint, pathParts),
  );
}

function isSetPathname(pathParts) {
  return SET_ENDPOINTS.some((endpoint) =>
    matchesEndpointPath(endpoint, pathParts),
  );
}

// Handler

export async function handler(req, ctx) {
  const url = new URL(req.url);
  // this is no longer an IP, it's more of a unique ID
  const ip = encodeHex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        req.headers.get("x-forwarded-for") || getRemoteAddress(ctx),
      ),
    ),
  );
  const { pathname, method } = { pathname: url.pathname, method: req.method };
  const pathParts = pathname.split("/").filter(Boolean);
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(`Incoming request: ${method} ${pathname}`, "gray");
    log(`Path parts: ${pathParts.join(", ")}`, "gray");
  }
  if (method === "OPTIONS") {
    if (!isSetPathname(pathParts)) return json({ error: true }, 404);
    if (rate.rateLimited(`options:${ip}`)) {
      return json({ error: true, message: "Rate limit exceeded" }, 429);
    }
    rate.rateLimit(`options:${ip}`, 60, 60);
    return json({ error: false });
  }

  if (!isSetEndpoint(method, pathParts)) {
    return json({ error: true }, 404);
  }

  const token = getToken(req);
  const isPublicAuthRoute =
    pathParts.length === 1 &&
    ["register", "login", "logout", "version"].includes(pathParts[0]);
  const isPublicPage = pathParts.length === 0;
  const isPublicUploadDownload =
    ["GET", "HEAD"].includes(method) &&
    pathParts[0] === "files" &&
    pathParts.length === 2;
  if (token && !isPublicAuthRoute && !isPublicPage && !isPublicUploadDownload) {
    try {
      await access.authenticateToken(token, { requiredType: "access" });
    } catch (error) {
      return errorJson(error);
    }
  }

  const isUploadsProxyRoute =
    pathname === "/upload" || /^\/files\/[^/]+$/.test(pathname);
  if (isUploadsProxyRoute) {
    if (!uploads.uploadsUpstreamUrl()) {
      return json({ error: true, message: "Route not found" }, 404);
    }
    try {
      let uploadedBy = null;
      if (method === "POST") {
        const principal = await access.authenticateToken(token, {
          requiredType: "access",
        });
        uploadedBy = principal.uuid;
      }
      return await uploads.proxyUploadsRequest(req, uploadedBy);
    } catch (error) {
      return errorJson(error);
    }
  }

  if (pathParts[0] === "register" && method === "POST") {
    if (rate.rateLimited(`register:${ip}`)) {
      return json({ error: true, message: "Rate limit exceeded" }, 429);
    }
    const body = await readJsonBody(req);
    const { username, password, setCookie = false } = body;
    const regex = /^[a-zA-Z0-9._-]+$/;
    if (!regex.test(username)) {
      if (Deno.env.get("LOG_LEVEL") === "trace") {
        log(
          "username contains invalid characters, must conform to [a-zA-Z0-9._-]",
          "gray",
        );
      }
      return json(
        {
          error: true,
          message:
            "Username contains invalid characters; only letters, numbers, periods, underscores, and hyphens are allowed",
        },
        400,
      );
    } else {
      const reg = await auth.register(username, password);
      if (!reg) {
        // failed, perhaps the username is taken, relaxed ratelimit
        rate.rateLimit(`register:${ip}-f`, 5, 30);
        return json(
          {
            error: true,
            message: "Registration failed; the username may already be taken",
          },
          400,
        );
      }
      // success, apply a stricter ratelimit of 5 per 15 minutes
      rate.rateLimit(`register:${ip}-s`, 5, 15 * 60);
      return json(
        {
          error: false,
          user: reg,
        },
        200,
        setCookie ? buildAuthCookies(reg.accessToken, reg.refreshToken) : [],
      );
    }
  }

  if (pathParts[0] === "login" && method === "POST") {
    if (rate.rateLimited(`login:i:${ip}`)) {
      return json({ error: true, message: "Rate limit exceeded" }, 429);
    }
    rate.rateLimit(`login:i:${ip}`, 10, 60);
    const body = await readJsonBody(req);
    const {
      username,
      password,
      token,
      refreshToken,
      masterCode,
      setCookie = false,
    } = body;
    const cookies = getCookies(req.headers);
    let token2;
    if (cookies["__Host-refreshToken"]) token2 = cookies["__Host-refreshToken"];
    let user;
    try {
      if (masterCode) {
        user = await auth.loginMaster(masterCode);
      } else if (username && password) {
        user = await auth.login(username, password);
      } else if (token || refreshToken) {
        user = await auth.loginToken(token || refreshToken);
      } else if (token2) {
        user = await auth.loginToken(token2);
      }
    } catch (error) {
      return errorJson(error);
    }
    if (!user) {
      rate.rateLimit(`login:i:${ip}-f`, 30, 60 * 60);
      rate.rateLimit(`login:u:${username || "master"}-f`, 5, 5 * 60);
      return json(
        {
          error: true,
          msg: "Could not authenticate - check credentials",
        },
        401,
      );
    }
    rate.rateLimit(`login:u:${username || "master"}-s`, 5, 5 * 60);
    return json(
      {
        error: false,
        user: {
          ...user,
        },
      },
      200,
      setCookie ? buildAuthCookies(user.accessToken, user.refreshToken) : [],
    );
  }

  if (pathParts[0] === "logout" && method === "POST") {
    const tokens = getPresentedTokens(req);
    if (tokens.length === 0) return json({ error: true }, 401);
    let lastError;
    for (const token of tokens) {
      try {
        const revoked = await auth.revokeTokens(token);
        socket.disconnectUser(revoked.userId, "logged_out");
        return json({ error: false, revoked: true }, 200, clearAuthCookies());
      } catch (error) {
        lastError = error;
      }
    }
    return errorJson(lastError);
  }

  if (
    pathParts[0] === "home" &&
    pathParts.length === 3 &&
    ["comments", "replies"].includes(pathParts[2])
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const postId = pathParts[1];
    const resource = pathParts[2];
    try {
      if (method === "GET") {
        const items =
          resource === "comments"
            ? await home.fetchComments(token, postId)
            : await home.fetchReplies(token, postId);
        if (!items)
          return json({ error: true, msg: "Couldn't find post" }, 400);
        return json({ error: false, [resource]: items });
      }
      const { content, parentReplyId } = await readJsonBody(req);
      const singular = resource === "comments" ? "comment" : "reply";
      const item =
        resource === "comments"
          ? await home.createComment(token, postId, content)
          : await home.createReply(token, postId, content, parentReplyId);
      if (!item)
        return json({ error: true, msg: `Couldn't create ${singular}` }, 400);
      return json({ error: false, [singular]: item });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "home" &&
    pathParts.length === 4 &&
    ["comments", "replies"].includes(pathParts[2]) &&
    method === "DELETE"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const removed =
        pathParts[2] === "comments"
          ? await home.deleteComment(token, pathParts[1], pathParts[3])
          : await home.deleteReply(token, pathParts[1], pathParts[3]);
      if (!removed)
        return json({ error: true, msg: "Couldn't delete item" }, 400);
      return json({ error: false, deleted: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "home" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { content, clientId, attachments } = await req.json();
    try {
      const post = await home.createPost(token, content, clientId, attachments);
      if (!post) return json({ error: true, msg: "Couldn't find post" }, 400);
      if (post.error === true) {
        return json({ error: true, msg: post.message }, 400);
      }
      return json(post);
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "home" && method === "GET") {
    const page = parseInt(url.searchParams.get("page") || "1");
    const token = getToken(req);
    if (!token && page > 1) {
      return json({ error: true, msg: "Unauthorized, token required" }, 401);
    }
    try {
      const posts = await home.fetchPosts(page, token);
      return json({ error: false, page, posts });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "home" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId, content, like } = await req.json();
    try {
      if (like) {
        const post = await home.postLikeSet(token, postId);
        if (!post) return json({ error: true, msg: "Couldn't find post" }, 400);
        return json({ error: false });
      } else {
        const post = await home.editPost(token, postId, content);
        if (!post) return json({ error: true, msg: "Couldn't find post" }, 400);
        return json({ error: false });
      }
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "home" && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { postId } = await req.json();
    try {
      const post = await home.destroyPost(token, postId);
      if (!post) return json({ error: true, msg: "Couldn't find post" }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "user" && pathParts.length === 3) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const target = pathParts[1];
    const socialAction = pathParts[2];
    const page = parseInt(url.searchParams.get("page") || "1");
    try {
      let result;
      if (socialAction === "follow" && method === "POST") {
        result = await me.followUser(token, target);
      } else if (socialAction === "follow" && method === "DELETE") {
        result = await me.unfollowUser(token, target);
      } else if (socialAction === "followers") {
        result = await me.listFollowers(token, target, page);
      } else if (socialAction === "following") {
        result = await me.listFollowing(token, target, page);
      } else {
        result = await me.getRelationship(token, target);
      }
      return json({ error: false, ...result });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (pathParts[0] === "user" && pathParts.length === 2 && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const userId = pathParts[1];
    try {
      const user = await me.fetchUser(token, userId);
      if (!user) {
        return json({ error: true, msg: "Couldn't find user" }, 400);
      }
      return json({ error: false, user });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "user" && pathParts[2] === "posts" && pathParts.length === 3 && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const userId = pathParts[1];
    const p = parseInt(url.searchParams.get("page") || "1");
    let userPosts = [];
    try {
      userPosts = await me.fetchUserPosts(token, userId, p);
      return json({ error: false, userPosts });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "user" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { username, pfp, bio } = await req.json();
    try {
      const user = await me.editUser(token, username, pfp, bio);
      if (!user) return json({ error: true, msg: "Couldn't find user" }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "inbox" && method === "GET") {
    const page = parseInt(url.searchParams.get("page") || "1");
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    if (Deno.env.get("LOG_LEVEL") === "trace") {
      log(`Fetch messages called with page: ${page}, token: ${token}`, "blue");
    }
    try {
      const user = await inbox.fetchMessages(token, page);
      const hasNew = await inbox.checkNewMessages(token);
      if (!user) return json({ error: true, msg: "Couldn't find user" }, 400);
      return json({ error: false, messages: user, unread: hasNew });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "inbox" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { message_id } = await req.json();
    try {
      const message = await inbox.setRead(message_id, token);
      if (!message) {
        return json({ error: true, msg: "Couldn't find message" }, 400);
      }
      return json({ error: false, messages: message });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "permissions" &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const permissions = await moderation.getOwnPermissions(token);
      return json({ error: false, ...permissions });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "users" &&
    pathParts[3] === "permissions" &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const permissions = await moderation.getUserPermissions(
        token,
        pathParts[2],
      );
      return json({ error: false, ...permissions });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "users" &&
    pathParts[3] === "permissions" &&
    method === "PATCH"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { grant = [], revoke = [] } = await readJsonBody(req);
    try {
      const permissions = await moderation.changeUserPermissions(
        token,
        pathParts[2],
        grant,
        revoke,
      );
      return json({ error: false, ...permissions });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "bans" &&
    !pathParts[2] &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      return json({ error: false, bans: await moderation.listBans(token) });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "bans" &&
    !pathParts[2] &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { userId, username, reason, durationSeconds } =
      await readJsonBody(req);
    try {
      const ban = await moderation.banUser(
        token,
        userId || username,
        reason,
        durationSeconds,
      );
      return json({ error: false, ban });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "bans" &&
    pathParts[2] &&
    method === "DELETE"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const result = await moderation.unbanUser(token, pathParts[2]);
      return json({ error: false, ...result });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "kicks" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { userId, username, reason } = await readJsonBody(req);
    try {
      const result = await moderation.kickUser(
        token,
        userId || username,
        reason,
      );
      return json({ error: false, ...result });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "home" &&
    pathParts[2] === "posts" &&
    method === "DELETE"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { reason } = await readJsonBody(req);
    try {
      const result = await moderation.deleteHomePost(
        token,
        pathParts[3],
        reason,
      );
      return json({ error: false, ...result });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (
    pathParts[0] === "moderation" &&
    pathParts[1] === "inbox" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { userId, username, content } = await readJsonBody(req);
    try {
      const result = await moderation.sendInboxMessage(
        token,
        userId || username,
        content,
      );
      return json({ error: false, ...result });
    } catch (error) {
      return errorJson(error);
    }
  }

  if (pathParts[0] === "guilds" && method === "GET" && !pathParts[1]) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { page } = parseInt(url.searchParams.get("page") || "1");
    try {
      const fetchedGuilds = await guilds.fetchGuilds(token, page);
      if (!fetchedGuilds) {
        return json({ error: true, msg: "Couldn't fetch guilds" }, 400);
      }
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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
      if (!fetchedGuilds) {
        return json(
          { error: true, msg: "Couldn't fetch subscribed guilds" },
          400,
        );
      }
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "guilds" && !pathParts[1] && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { name, description, icon, banner } = await readJsonBody(req);
    try {
      const fetchedGuilds = await guilds.createGuild(
        token,
        name,
        description,
        icon,
        banner,
      );
      if (!fetchedGuilds) {
        return json({ error: true, msg: "Couldn't create guild" }, 400);
      }
      return json({ error: false, guilds: fetchedGuilds });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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
      if (!channels) {
        return json({ error: true, msg: "Couldn't fetch channels" }, 400);
      }
      return json({ error: false, channels });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (isGuildChannelsRoute && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[2];
    const { channelId, name } = await readJsonBody(req);
    try {
      const channel = await guilds.editChannel(token, guildId, channelId, name);
      if (!channel) {
        return json({ error: true, msg: "Couldn't edit channel" }, 400);
      }
      return json({ error: false, channel });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (isGuildChannelsRoute && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { guildId, name } = await readJsonBody(req);
    try {
      const channel = await guilds.createChannel(token, guildId, name);
      if (!channel) {
        return json({ error: true, msg: "Couldn't create channel" }, 500);
      }
      return json({ error: false, channel });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (isGuildChannelsRoute && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const { guildId, channelId } = await readJsonBody(req);
    try {
      const channel = await guilds.deleteChannel(token, guildId, channelId);
      if (!channel) {
        return json({ error: true, msg: "Couldn't delete channel" }, 500);
      }
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "roles" &&
    method === "GET"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const roles = await guilds.listGuildRoles(token, guildId);
      if (!roles) {
        return json({ error: true, msg: "Couldn't fetch roles" }, 400);
      }
      return json({ error: false, roles });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "roles" &&
    method === "POST" &&
    !pathParts[3]
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { name, color, permissions } = await readJsonBody(req);
    try {
      const role = await guilds.createGuildRole(
        token,
        guildId,
        name,
        color,
        permissions,
      );
      if (!role) return json({ error: true, msg: "Couldn't create role" }, 400);
      return json({ error: false, role });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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
      if (!members) {
        return json({ error: true, msg: "Couldn't fetch members" }, 400);
      }
      return json({ error: false, members });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "roles" &&
    pathParts[4] === "members" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const roleId = pathParts[3];
    const { userId } = await readJsonBody(req);
    try {
      const assigned = await guilds.assignGuildRole(
        token,
        guildId,
        roleId,
        userId,
      );
      if (!assigned) {
        return json({ error: true, msg: "Couldn't assign role" }, 400);
      }
      return json({ error: false, assigned: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "channel-permissions" &&
    method === "PATCH"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { channelId, roleId, view, send, history } = await readJsonBody(req);
    try {
      const updated = await guilds.setChannelPermissions(
        token,
        guildId,
        channelId,
        roleId,
        { view, send, history },
      );
      if (!updated) {
        return json({ error: true, msg: "Couldn't set permissions" }, 400);
      }
      return json({ error: false, updated: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "moderation" &&
    pathParts[3] === "delete-post" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { postId } = await readJsonBody(req);
    try {
      const deleted = await guilds.deleteGuildPost(token, guildId, postId);
      if (!deleted) {
        return json({ error: true, msg: "Couldn't delete post" }, 400);
      }
      return json({ error: false, deleted: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "moderation" &&
    pathParts[3] === "kick" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { userId, reason } = await readJsonBody(req);
    try {
      const kicked = await guilds.moderateKick(token, guildId, userId, reason);
      if (!kicked) return json({ error: true, msg: "Couldn't kick user" }, 400);
      return json({ error: false, kicked: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "moderation" &&
    pathParts[3] === "ban" &&
    method === "POST"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { userId, durationSeconds, reason } = await readJsonBody(req);
    try {
      const banned = await guilds.moderateBan(
        token,
        guildId,
        userId,
        durationSeconds,
        reason,
      );
      if (!banned) return json({ error: true, msg: "Couldn't ban user" }, 400);
      return json({ error: false, banned: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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
      if (!joined) {
        return json({ error: true, msg: "Couldn't join guild" }, 400);
      }
      return json({ error: false, joined: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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
      if (!left) return json({ error: true, msg: "Couldn't leave guild" }, 400);
      return json({ error: false, left: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "emojis" &&
    pathParts.length === 3
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      if (method === "GET") {
        const emojis = await guilds.listGuildEmojis(token, pathParts[1]);
        if (!emojis)
          return json({ error: true, msg: "Couldn't fetch emojis" }, 400);
        return json({ error: false, emojis });
      }
      const { name, url: emojiUrl } = await readJsonBody(req);
      const emoji = await guilds.registerGuildEmoji(
        token,
        pathParts[1],
        name,
        emojiUrl,
      );
      if (!emoji)
        return json({ error: true, msg: "Couldn't create emoji" }, 400);
      return json({ error: false, emoji });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "emojis" &&
    pathParts.length === 4 &&
    method === "DELETE"
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      const deleted = await guilds.deleteGuildEmoji(
        token,
        pathParts[1],
        pathParts[3],
      );
      if (!deleted)
        return json({ error: true, msg: "Couldn't delete emoji" }, 400);
      return json({ error: false, deleted: true });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "posts" &&
    pathParts[4] === "replies" &&
    pathParts.length === 5
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      if (method === "GET") {
        const replies = await guilds.fetchGuildReplies(
          token,
          pathParts[1],
          pathParts[3],
        );
        if (!replies)
          return json({ error: true, msg: "Couldn't fetch replies" }, 400);
        return json({ error: false, replies });
      }
      const { content, attachments } = await readJsonBody(req);
      const reply = await guilds.replyToGuildPost(
        token,
        pathParts[1],
        pathParts[3],
        content,
        attachments,
      );
      if (!reply)
        return json({ error: true, msg: "Couldn't create reply" }, 400);
      return json({ error: false, reply });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (
    pathParts[0] === "guild" &&
    pathParts[2] === "posts" &&
    pathParts[4] === "reactions" &&
    pathParts.length === 5
  ) {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    try {
      if (method === "GET") {
        const target = await guilds.fetchGuildPost(
          token,
          pathParts[1],
          pathParts[3],
        );
        if (!target)
          return json({ error: true, msg: "Couldn't fetch reactions" }, 400);
        return json({ error: false, reactions: target?.reactions ?? [] });
      }
      const { emoji } = await readJsonBody(req);
      const reaction = await guilds.setGuildReaction(
        token,
        pathParts[1],
        pathParts[3],
        emoji,
        method === "POST",
      );
      if (!reaction)
        return json({ error: true, msg: "Couldn't update reaction" }, 400);
      return json({ error: false, reaction });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "guild" && method === "GET") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const page = parseInt(url.searchParams.get("page") || "1");
    const channelId = pathParts[2];
    try {
      const guildposts = await guilds.fetchGuildPosts(
        token,
        guildId,
        page,
        channelId,
      );
      if (!guildposts) {
        return json({ error: true, msg: "Couldn't fetch posts" }, 400);
      }
      return json({ error: false, posts: guildposts });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "guild" && method === "PATCH") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const { name, description, icon, banner } = await readJsonBody(req);
    try {
      const guild = await guilds.editGuild(
        token,
        guildId,
        name,
        description,
        icon,
        banner,
      );
      if (!guild) return json({ error: true, msg: "Couldn't edit guild" }, 400);
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "guild" && method === "POST") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    const channelId = pathParts[2];
    const { content, replyTo, attachments } = await readJsonBody(req);
    try {
      const guild = await guilds.postToGuild(
        token,
        guildId,
        content,
        channelId,
        replyTo,
        attachments,
      );
      if (!guild) return json({ error: true, msg: "Couldn't post" }, 400);
      return json({ error: false, post: guild });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "guild" && method === "DELETE") {
    const token = getToken(req);
    if (!token) return json({ error: true }, 401);
    const guildId = pathParts[1];
    try {
      const guild = await guilds.deleteGuild(token, guildId);
      if (!guild) {
        return json({ error: true, msg: "Couldn't delete guild" }, 400);
      }
      return json({ error: false });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
    }
  }

  if (pathParts[0] === "version" && method === "GET") {
    try {
      const versioning = await version.getVersion();
      return json({
        error: false,
        apiVersion: versioning,
        uploads: {
          enabled: uploads.uploadsEnabled(),
          url: uploads.uploadsEnabled() ? uploads.uploadsPublicUrl() : null,
          maxFileSize: uploads.MAX_UPLOAD_BYTES,
          expiryDays: uploads.uploadsExpiryDays(),
        },
      });
    } catch (e) {
      log(e, "red");
      return errorJson(e);
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

export function startHttpServer() {
  return Deno.serve({ port: SERVER_PORT, onListen() {} }, async (req, ctx) => {
    try {
      return withCors(await handler(req, ctx), req.headers.get("origin"));
    } catch (e) {
      console.error("Unhandled server error:", e);
      return withCors(errorJson(e), req.headers.get("origin"));
    }
  });
}

log(`maelink - gen2 server [${await version.getVersion()}]`, "#ff5757", 1, 1);
log(
  `By maelink communications (and outside contributors!) - made with love from all over the world <3`,
  "#ff9999",
  1,
  1,
);

if (uploads.uploadsOnlyMode()) {
  uploads.startUploadsServer();
  log(
    `Uploads-only server running at http://localhost:${UPLOADS_PORT} (Limit at ${uploads.MAX_UPLOAD_MB}MB)`,
    "#ffffff",
    1,
    1,
  );
} else {
  startHttpServer();
  uploads.startUploadsServer();
  socket.initSocket();
  const uploadsStatus = uploads.uploadsUpstreamUrl()
    ? ` | Uploads upstream: ${uploads.uploadsUpstreamUrl()}`
    : uploads.uploadsEnabled()
      ? ` | Uploads running at http://localhost:${UPLOADS_PORT} (Limit at ${uploads.MAX_UPLOAD_MB}MB)`
      : "";
  log(
    `HTTP server running at http://localhost:${SERVER_PORT} | WS server running at ws://localhost:${WS_PORT}${uploadsStatus}`,
    "#ffffff",
    1,
    1,
  );
}
