import { User, Post, Code, ActionLog } from './database/tables.js';
import { hash, verify } from "jsr:@felix/bcrypt";
import chalk from "npm:chalk";
import instance_name from "./config.js";
import { gen } from "./codegen.js";
import { Sequelize } from 'sequelize';
const connectedUsers = new Map();
let backgroundTasksStarted = false;
export function startHttpServer({ port } = {}) {
  if (!backgroundTasksStarted) {
    // start background sweeps and hooks once
    backgroundTasksStarted = true;
    setInterval(async () => {
      const now = new Date();
      try {
        const expiredUsers = await User.findAll({ where: { expires_at: { [Sequelize.Op.lte]: now } } });
        expiredUsers.forEach(userRecord => {
          for (const [socket, userData] of connectedUsers.entries()) {
            if (userData.token === userRecord.token) {
              try { socket.close(); } catch { };
              connectedUsers.delete(socket);
            }
          }
        });
      } catch (e) {
        console.error('Error during expiration sweep:', e);
      }

      try {
        const toDelete = await User.findAll({ where: { deletion_scheduled_at: { [Sequelize.Op.lte]: now }, deleted_at: null } });
        for (const target of toDelete) {
          console.log(`Applying scheduled deletion for user ${target.name} (${target.uuid})`);
          target.deleted_at = new Date();
          target.deletion_scheduled_at = null;
          target.deletion_initiated_by = target.deletion_initiated_by || 'scheduled';
          try {
            target.token = null;
            target.pswd = null;
            target.display_name = 'Deleted User';
            target.name = `deleted_${target.uuid}`;
            await target.save();
            try {
              await ActionLog.create({ actorId: null, targetUserId: target.id, action: 'applied_deletion', details: JSON.stringify({ when: new Date() }) });
            } catch (logErr) {
              console.error('Failed to write action log for applied deletion:', logErr);
            }
          } catch (e) {
            console.error('Failed to sanitize deleted user:', e);
          }
          for (const [socket, userData] of connectedUsers.entries()) {
            if (userData.token === target.token || userData.uuid === target.uuid) {
              try { socket.send(JSON.stringify({ cmd: 'account_deleted' })); } catch (err) { console.warn('socket send error while deleting account:', err); }
              try { socket.close(); } catch (err) { console.warn('socket close error while deleting account:', err); }
              connectedUsers.delete(socket);
            }
          }
        }
      } catch (e) {
        console.error('Error during scheduled-deletion sweep:', e);
      }
    }, 5 * 60 * 1000);

    // generate key with gen() on startup and create new when used, and log it
    gen();
    Sequelize.afterDestroy(Code, async (codeInstance, options) => {
      console.log('Code used, generating a new one...');
      gen();
    });

    setInterval(() => {
      for (const [socket, userData] of connectedUsers.entries()) {
        if (!userData.token) {
          try { socket.send(JSON.stringify({ cmd: "request_token", error: true, code: 401, reason: "tokenRequired" })); } catch { }
        }
      }
    }, 30 * 1000);

    Post.addHook('afterCreate', async (post) => {
      const author = await User.findByPk(post.userId);
      for (const [socket, userData] of connectedUsers.entries()) {
        if (userData.uuid !== author.uuid) {
          try { socket.send(JSON.stringify({ cmd: "new_post" })); } catch { }
        }
      }
    });
  }

  Deno.serve(async (req) => {
    if (req.headers.get("upgrade") === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      socket.addEventListener("close", () => {
        connectedUsers.delete(socket);
      });

      socket.addEventListener("open", () => {
        connectedUsers.set(socket, { user: null, token: null, uuid: null, client: null });
        try { socket.send(JSON.stringify({ cmd: "welcome", instance_name: instance_name })); } catch { }
      });

      socket.addEventListener("message", async (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badJSON" })); } catch { }
          return;
        }
        switch (data.cmd) {
          case "client_info": {
            if (!data.client) {
              try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { }
            }
            const entry = connectedUsers.get(socket) || {};
            entry.client = data.client;
            entry.cver = data.version || "unknown";
            entry.token = data.token || "";
            connectedUsers.set(socket, entry);
            try { socket.send(JSON.stringify({ error: false, code: 200, reason: "clientInfoUpdated" })); } catch { }
            break;
          }
          case "reg": {
            if (!data.pswd || !data.user || !data.code) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { } break; }
            if (data.user.length > 16) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "usernameTooLong" })); } catch { } break; }
            if (data.user.length < 4) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "usernameTooShort" })); } catch { } break; }
            const codeEntry = await Code.findOne({ where: { value: data.code } });
            if (!codeEntry) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badCode" })); } catch { } break; }
            const usernameEncoded = Array.from(data.user).map((char) => char.charCodeAt(0)).join("");
            const tokenRaw = `${usernameEncoded}${Date.now()}`;
            const token = await hash(tokenRaw);
            try {
              const normalized = String(data.user).replace(/^@/, "");
              if (normalized === 'maelink') { try { socket.send(JSON.stringify({ error: true, code: 403, reason: 'reservedName' })); } catch { } break; }
              const newUser = await User.create({ name: data.user, display_name: data.display_name || data.user, pswd: await hash(data.pswd), token: token, registered_at: new Date(), expires_at: new Date(Date.now() + (60 * 60 * 24 * 3)), uuid: crypto.randomUUID(), role: 'user' });
              try { socket.send(JSON.stringify({ error: false, user: newUser.name, display: newUser.display_name, token: token, uuid: newUser.uuid })); } catch { }
              connectedUsers.set(socket, { user: newUser.name, token: token, uuid: newUser.uuid });
              try { await codeEntry.destroy(); } catch (delErr) { console.error('Failed to delete used code:', delErr); }
            } catch (error) {
              if (error.name === 'SequelizeUniqueConstraintError') { try { socket.send(JSON.stringify({ error: true, code: 409, reason: "userExists" })); } catch { } }
              else { try { socket.send(JSON.stringify({ error: true, code: 500, reason: "serverError" })); } catch { } console.error('Registration error:', error); }
            }
            break;
          }
          case "login_pswd": {
            if (!data.pswd || !data.user) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { } break; }
            const foundUser = await User.findOne({ where: { name: data.user } });
            if (!foundUser) { try { socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" })); } catch { } break; }
            if (foundUser.system_account) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: 'systemAccountUseKey' })); } catch { } break; }
            if (await verify(data.pswd, foundUser.pswd)) {
              if (foundUser.banned && foundUser.banned_until && new Date(foundUser.banned_until) > new Date()) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: "banned" })); } catch { } break; }
              if (foundUser.deletion_scheduled_at) { foundUser.deletion_scheduled_at = null; try { await foundUser.save(); } catch (e) { console.error('Failed to clear scheduled deletion on login:', e); } }
              try { socket.send(JSON.stringify({ error: false, user: foundUser.name, token: foundUser.token, uuid: foundUser.uuid })); } catch { }
              connectedUsers.set(socket, { user: foundUser.name, token: foundUser.token, uuid: foundUser.uuid });
              console.log(connectedUsers);
            } else { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badPswd" })); } catch { } }
            break;
          }
          case "login_token": {
            if (!data.token) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { } break; }
            const foundUser = await User.findOne({ where: { token: data.token } });
            if (!foundUser) { try { socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" })); } catch { } break; }
            if (foundUser.system_account) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: 'systemAccountUseKey' })); } catch { } break; }
            if (foundUser.banned && foundUser.banned_until && new Date(foundUser.banned_until) > new Date()) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: "banned" })); } catch { } break; }
            if (foundUser.deletion_scheduled_at) { foundUser.deletion_scheduled_at = null; try { await foundUser.save(); } catch (e) { console.error('Failed to clear scheduled deletion on token login:', e); } }
            try { socket.send(JSON.stringify({ error: false, user: foundUser.name, token: foundUser.token, uuid: foundUser.uuid })); } catch { }
            connectedUsers.set(socket, { user: foundUser.name, token: foundUser.token, uuid: foundUser.uuid });
            console.log(connectedUsers);
            break;
          }
          case "set_avatar": {
            if (!data.url) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { } break; }
            const cu = connectedUsers.get(socket) || {};
            if (!cu.token) { try { socket.send(JSON.stringify({ error: true, code: 401, reason: "Unauthorized" })); } catch { } break; }
            if (data.url.length > 512) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "urlTooLong" })); } catch { } break; }
            const foundUser = await User.findOne({ where: { token: cu.token } });
            if (!foundUser) { try { socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" })); } catch { } break; }
            if (!/^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(data.url)) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "invalidUrl" })); } catch { } break; }
            foundUser.avatar = data.url;
            cu.avatar = data.url;
            connectedUsers.set(socket, cu);
            try { await foundUser.save(); try { socket.send(JSON.stringify({ error: false, code: 200, reason: "avatarUpdated", url: data.url })); } catch { } } catch (saveErr) { console.error('Failed to save avatar URL:', saveErr); try { socket.send(JSON.stringify({ error: true, code: 500, reason: "serverError" })); } catch { } }
            break;
          }
          case "provide_token": {
            if (!data.token) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); } catch { } break; }
            const foundUser = await User.findOne({ where: { token: data.token } });
            if (!foundUser) { try { socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" })); } catch { } break; }
            if (foundUser.system_account) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: 'systemAccountUseKey' })); } catch { } break; }
            if (foundUser.banned && foundUser.banned_until && new Date(foundUser.banned_until) > new Date()) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: "banned" })); } catch { } break; }
            if (foundUser.deletion_scheduled_at) { foundUser.deletion_scheduled_at = null; try { await foundUser.save(); } catch (e) { console.error('Failed to clear scheduled deletion on token provide:', e); } }
            connectedUsers.set(socket, { user: foundUser.name, token: foundUser.token, uuid: foundUser.uuid });
            break;
          }
          case "login_syskey": {
            if (!data.user || !data.key) { try { socket.send(JSON.stringify({ error: true, code: 400, reason: 'badRequest' })); } catch { } break; }
            const candidate = await User.findOne({ where: { name: data.user } }) || await User.findOne({ where: { name: data.user.replace(/^@/, '') } });
            if (!candidate || !candidate.system_account) { try { socket.send(JSON.stringify({ error: true, code: 404, reason: 'userNotFoundOrNotSystem' })); } catch { } break; }
            if (!candidate.system_key) { try { socket.send(JSON.stringify({ error: true, code: 500, reason: 'noSystemKey' })); } catch { } break; }
            try { if (!(await verify(data.key, candidate.system_key))) { try { socket.send(JSON.stringify({ error: true, code: 403, reason: 'badKey' })); } catch { } break; } } catch (verifyErr) { console.error('Error verifying system key:', verifyErr); try { socket.send(JSON.stringify({ error: true, code: 500, reason: 'serverError' })); } catch { } break; }
            const newTokenRaw = `${candidate.uuid}${Date.now()}`;
            const newToken = await hash(newTokenRaw);
            candidate.token = newToken;
            try { await candidate.save(); } catch (saveErr) { console.error('Failed to save system login token:', saveErr); }
            try { await ActionLog.create({ actorId: candidate.id, targetUserId: candidate.id, action: 'login_syskey', details: JSON.stringify({ method: 'syskey', timestamp: new Date() }) }); } catch (logErr) { console.error('Failed to write action log:', logErr); }
            try { socket.send(JSON.stringify({ error: false, user: candidate.name, token: candidate.token, uuid: candidate.uuid })); } catch { }
            connectedUsers.set(socket, { user: candidate.name, token: candidate.token, uuid: candidate.uuid });
            break;
          }
          default:
            try { socket.send(JSON.stringify({ error: true, code: 404, reason: "notFound" })); } catch { }
        }
      });

      return response;
    }

    const url = new URL(req.url);

    const CORS_HEADERS = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, token",
    };

    const endpoints = { home: "/api/feed" };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (req.method === "POST" && url.pathname === endpoints.home) {
      const token = req.headers.get("token");
      if (!token) {
        return new Response("Unauthorized", { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }
      const foundUser = await User.findOne({ where: { token } });
      if (!foundUser) {
        return new Response("Unauthorized", { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }
      if (foundUser.banned && foundUser.banned_until && new Date(foundUser.banned_until) > new Date()) {
        return new Response("Forbidden", { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }
      try {
        const body = await req.json();
        console.log(body);
        const rawContent = (body && (body.content ?? body.p ?? body.text));
        const content = (rawContent == null) ? '' : String(rawContent).trim();
        if (content.length === 0) { console.warn('Invalid post content', { rawContent, type: typeof rawContent }); return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
        if (content.length > 256) { console.warn('Post is too long', { rawContent, type: typeof rawContent }); return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
        await Post.create({ content: content, userId: foundUser.id, timestamp: Date.now() });
        return new Response(JSON.stringify({ success: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch {
        return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }
    } else if (req.method === "GET" && url.pathname === endpoints.home) {
      const posts = await Post.findAll({ include: [{ model: User, as: 'author', attributes: ['name'] }], order: [['timestamp', 'DESC']] });
      return new Response(JSON.stringify({ posts: posts.map(post => ({ user: post.author.name, content: post.content, timestamp: post.timestamp || post.createdAt, id: post.id })) }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
    } else if (req.method === "DELETE" && url.pathname === "/api/post") {
      const postId = url.searchParams.get("id");
      if (!postId) { return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
      const token = req.headers.get("token");
      if (!token) { return new Response("Unauthorized", { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
      const foundUser = await User.findOne({ where: { token } });
      if (!foundUser) { return new Response("Unauthorized", { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
      const postToDelete = await Post.findOne({ where: { id: postId } });
      if (!postToDelete) { return new Response("Not Found", { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
      const isModerator = ['mod', 'admin', 'sysadmin'].includes(foundUser.role);
      if (postToDelete.userId !== foundUser.id && !isModerator) { return new Response("Forbidden", { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }); }
      try {
        const postDetails = { id: postToDelete.id, content: postToDelete.content, authorId: postToDelete.userId };
        await postToDelete.destroy();
        try { await ActionLog.create({ actorId: foundUser.id, targetUserId: postDetails.authorId, action: 'delete_post', details: JSON.stringify(postDetails) }); } catch (logErr) { console.error('Failed to write action log for post deletion:', logErr); }
        return new Response(JSON.stringify({ success: true }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
      } catch {
        return new Response("Internal Server Error", { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }
    }
    else if (req.method === "POST" && url.pathname === "/api/ban") {
      const token = req.headers.get('token');
      if (!token) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const actor = await User.findOne({ where: { token } });
      if (!actor) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (!['mod', 'admin', 'sysadmin'].includes(actor.role)) return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      try {
        const body = await req.json();
        const targetName = body.user || body.name || body.uuid;
        if (!targetName) return new Response('Bad Request', { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        const until = body.until || null;
        const days = body.days || null;
        const where = (body.uuid) ? { uuid: body.uuid } : { name: targetName };
        const target = await User.findOne({ where });
        if (!target) return new Response('Not Found', { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        if (target.role === 'sysadmin' && actor.role !== 'sysadmin') return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        target.banned = true;
        if (until) target.banned_until = new Date(until);
        else if (days) target.banned_until = new Date(Date.now() + (Number(days) * 24 * 3600 * 1000));
        else target.banned_until = null;
        await target.save();
        console.log(`${actor.name} banned ${target.name} until ${target.banned_until}`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch {
        return new Response('Bad Request', { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      }
    }
    else if (req.method === "POST" && url.pathname === "/api/permissions") {
      const token = req.headers.get('token');
      if (!token) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const actor = await User.findOne({ where: { token } });
      if (!actor) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (!['admin', 'sysadmin'].includes(actor.role)) return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      try {
        const body = await req.json();
        const targetName = body.user || body.name || body.uuid;
        const role = body.role;
        if (!targetName || !role) return new Response('Bad Request', { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        if (!['user', 'mod', 'admin', 'sysadmin'].includes(role)) return new Response('Bad Request', { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        const where = (body.uuid) ? { uuid: body.uuid } : { name: targetName };
        const target = await User.findOne({ where });
        if (!target) return new Response('Not Found', { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        if (target.role === 'sysadmin' && actor.role !== 'sysadmin') return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        if (role === 'sysadmin' && actor.role !== 'sysadmin') return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
        target.role = role;
        await target.save();
        console.log(`${actor.name} set role ${role} for ${target.name}`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch {
        return new Response('Bad Request', { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      }
    }
    else if (req.method === "GET" && url.pathname === "/api/me") {
      const token = req.headers.get('token');
      if (!token) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const user = await User.findOne({ where: { token } });
      if (!user) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      return new Response(JSON.stringify({ name: user.name, display_name: user.display_name, role: user.role, uuid: user.uuid }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    else if (req.method === "GET" && url.pathname === "/api/actionlogs") {
      const token = req.headers.get('token');
      if (!token) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const actor = await User.findOne({ where: { token } });
      if (!actor) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (!['mod', 'admin', 'sysadmin'].includes(actor.role)) return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });

      const actionFilter = url.searchParams.get('action') || null;
      const actorFilter = url.searchParams.get('actor') || null;
      const targetFilter = url.searchParams.get('target') || null;
      const since = url.searchParams.get('since') || null;
      const until = url.searchParams.get('until') || null;
      const limit = Math.min(500, Number(url.searchParams.get('limit') || 100));
      const page = Math.max(0, Number(url.searchParams.get('page') || 0));
      const offset = page * limit;

      try {
        const where = {};
        const { Op } = Sequelize;
        if (actionFilter) where.action = actionFilter;
        if (since || until) where.created_at = {};
        if (since) where.created_at[Op.gte] = new Date(since);
        if (until) where.created_at[Op.lte] = new Date(until);

        if (actorFilter) {
          const aUser = await User.findOne({ where: { name: actorFilter } }) || await User.findOne({ where: { name: actorFilter.replace(/^@/, '') } });
          if (!aUser) return new Response(JSON.stringify({ logs: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
          where.actorId = aUser.id;
        }
        if (targetFilter) {
          const tUser = await User.findOne({ where: { name: targetFilter } }) || await User.findOne({ where: { name: targetFilter.replace(/^@/, '') } });
          if (!tUser) return new Response(JSON.stringify({ logs: [] }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
          where.targetUserId = tUser.id;
        }

        const logs = await ActionLog.findAll({ where, order: [['created_at', 'DESC']], limit, offset });
        const mapped = [];
        for (const l of logs) {
          const a = l.actorId ? await User.findByPk(l.actorId) : null;
          const t = l.targetUserId ? await User.findByPk(l.targetUserId) : null;
          mapped.push({ id: l.id, actor: a ? a.name : null, target: t ? t.name : null, action: l.action, details: l.details, created_at: l.created_at });
        }
        return new Response(JSON.stringify({ logs: mapped }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } catch (e) {
        console.error('Failed to fetch action logs:', e);
        return new Response('Internal Server Error', { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      }
    }
    else if (req.method === 'DELETE' && url.pathname === '/api/account') {
      const token = req.headers.get('token');
      if (!token) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const actor = await User.findOne({ where: { token } });
      if (!actor) return new Response('Unauthorized', { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      const targetParam = url.searchParams.get('user') || url.searchParams.get('uuid') || null;
      const instant = url.searchParams.get('instant') === 'true';
      if (!targetParam || targetParam === actor.name || targetParam === actor.uuid) {
        actor.deletion_scheduled_at = new Date(Date.now() + (7 * 24 * 3600 * 1000));
        actor.deletion_initiated_by = actor.name;
        await actor.save();
        return new Response(JSON.stringify({ success: true, scheduled: actor.deletion_scheduled_at }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
      const target = await User.findOne({ where: { name: targetParam } }) || await User.findOne({ where: { uuid: targetParam } });
      if (!target) return new Response('Not Found', { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (!['mod', 'admin', 'sysadmin'].includes(actor.role)) return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (target.role === 'sysadmin' && actor.role !== 'sysadmin') return new Response('Forbidden', { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } });
      if (instant) {
        target.deleted_at = new Date();
        target.deletion_scheduled_at = null;
        target.deletion_initiated_by = actor.name;
        target.token = null;
        target.pswd = null;
        target.display_name = 'Deleted User';
        target.name = `deleted_${target.uuid}`;
        await target.save();
        try { await ActionLog.create({ actorId: actor.id, targetUserId: target.id, action: 'delete_account', details: JSON.stringify({ instant: true }) }); } catch (logErr) { console.error('Failed to write action log for instant deletion:', logErr); }
        console.log(`${actor.name} instantly deleted account ${target.uuid}`);
        return new Response(JSON.stringify({ success: true, deleted: true }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      } else {
        target.deletion_scheduled_at = new Date(Date.now() + (7 * 24 * 3600 * 1000));
        target.deletion_initiated_by = actor.name;
        await target.save();
        console.log(`${actor.name} scheduled deletion for ${target.name}`);
        return new Response(JSON.stringify({ success: true, scheduled: target.deletion_scheduled_at }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
      }
    }
  });
}