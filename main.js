import { Sequelize, DataTypes, Model } from 'sequelize';
import chalk from "chalk";
import { hash, verify } from "@felix/bcrypt";
import gradient from 'https://esm.sh/gradient-string@2.0.1';
const sequelize = new Sequelize('database', 'username', 'password', {
  dialect: 'sqlite',
  storage: 'db.sqlite',
  logging: false
});
class User extends Model { }
User.init({
  name: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  display_name: DataTypes.STRING,
  pswd: {
    type: DataTypes.STRING,
    allowNull: false
  },
  uuid: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4
  },
  token: DataTypes.STRING,
  registered_at: DataTypes.DATE,
  expires_at: DataTypes.DATE
}, {
  sequelize,
  modelName: 'user'
});
class Post extends Model { }
Post.init({
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'post'
});
class VeriToken extends Model { }
VeriToken.init({
  value: {
    type: DataTypes.STRING,
    allowNull: false
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  sequelize,
  modelName: 'veriToken'
});
class Code extends Model { }
Code.init({
  value: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  expires_at: DataTypes.DATE
}, {
  sequelize,
  modelName: 'code'
});
User.hasMany(Post, { foreignKey: 'userId', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'userId', as: 'author' });
await sequelize.sync();
const connectedUsers = new Map();
const instance_name = "reformaelink_rv4_051025";
const custom = gradient(["#ff5f6d", "#ff71a0ff"]);
console.log(custom(`maelink gen2 [POST-DEV RESET] server [ ${instance_name} ] | Development build, do not use in production.`));
Deno.serve({
  port: 8080,
  onListen({ hostname, port }) {
    console.log(
      chalk.green(
        `[WebSocket server listening on ws://${hostname ?? "localhost"}:${port}]`
      )
    );
  }
}, (req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response(null, { status: 501 });
  }
  const { socket, response } = Deno.upgradeWebSocket(req); socket.addEventListener("close", () => {
    connectedUsers.delete(socket);
  });
  setInterval(async () => {
    const now = new Date();
    const expiredUsers = await User.findAll({
      where: {
        expires_at: {
          [Sequelize.Op.lt]: now
        }
      }
    }); expiredUsers.forEach(userRecord => {
      for (const [socket, userData] of connectedUsers.entries()) {
        if (userData.token === userRecord.token) {
          socket.close();
          connectedUsers.delete(socket);
        }
      }
    });
  }, 5 * 60 * 1000);
  socket.addEventListener("open", () => {
    connectedUsers.set(socket, {
      user: null,
      token: null,
      uuid: null,
      client: null,
    });
    socket.send(JSON.stringify({
      cmd: "welcome",
      instance_name: instance_name
    }));
  });
  socket.addEventListener("message", async (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      socket.send(JSON.stringify({ error: true, code: 400, reason: "badJSON" }));
      return;
    } switch (data.cmd) {
      case "client_info": {
        if (!data.client) {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
        }
        connectedUsers.get(socket).client = data.client;
        connectedUsers.get(socket).cver = data.version || "unknown";
        socket.send(JSON.stringify({ error: false, code: 200, reason: "clientInfoUpdated" }));
        break;
      }
      case "reg": {
        if (!data.pswd || !data.user || !data.code) {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
          break;
        }
        const codeEntry = await Code.findOne({ where: { value: data.code } });
        if (!codeEntry) {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badCode" }));
          break;
        }
        const usernameEncoded = Array.from(data.user)
          .map((char) => char.charCodeAt(0))
          .join("");
        const tokenRaw = `${usernameEncoded}${Date.now()}`;
        const token = await hash(tokenRaw);
        try {
          const newUser = await User.create({
            name: data.user,
            display_name: data.display_name || data.user,
            pswd: await hash(data.pswd),
            token: token,
            registered_at: new Date(),
            expires_at: new Date(Date.now() + (60 * 60 * 24 * 3)),
            uuid: crypto.randomUUID()
          });
          socket.send(JSON.stringify({
            error: false,
            user: newUser.name,
            display: newUser.display_name,
            token: token,
            uuid: newUser.uuid
          }));
          connectedUsers.set(socket, {
            user: newUser.name,
            token: token,
            uuid: newUser.uuid
          });
          // delete the used registration code so it cannot be reused
          try {
            await codeEntry.destroy();
          } catch (delErr) {
            console.error('Failed to delete used code:', delErr);
          }
        } catch (error) {
          if (error.name === 'SequelizeUniqueConstraintError') {
            socket.send(JSON.stringify({ error: true, code: 409, reason: "userExists" }));
          } else {
            socket.send(JSON.stringify({ error: true, code: 500, reason: "serverError" }));
            console.error('Registration error:', error);
          }
        }
        break;
      } case "login_pswd": {
        if (!data.pswd || !data.user) {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" })); break;
        }
        const foundUser = await User.findOne({ where: { name: data.user } });
        if (!foundUser) {
          socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" })); break;
        }
        if (await verify(data.pswd, foundUser.pswd)) {
          socket.send(JSON.stringify({
            error: false,
            user: foundUser.name,
            token: foundUser.token,
            uuid: foundUser.uuid
          }));
          connectedUsers.set(socket, {
            user: foundUser.name,
            token: foundUser.token,
            uuid: foundUser.uuid
          });
          console.log(connectedUsers);
        } else {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badPswd" }));
        }
        break;
      } case "login_token": {
        if (!data.token) {
          socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
          break;
        }
        const foundUser = await User.findOne({ where: { token: data.token } });
        if (!foundUser) {
          socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" }));
          break;
        }
        socket.send(JSON.stringify({
          error: false,
          user: foundUser.name,
          token: foundUser.token,
          uuid: foundUser.uuid
        }));
        connectedUsers.set(socket, {
          user: foundUser.name,
          token: foundUser.token,
          uuid: foundUser.uuid
        });
        console.log(connectedUsers);
        break;
      } default:
        socket.send(JSON.stringify({ error: true, code: 404, reason: "notFound" }));
    }
  }); return response;
});
Deno.serve({
  port: 6060,
  onListen({ hostname, port }) {
    console.log(
      chalk.green(
        `[HTTP server listening on http://${hostname ?? "localhost"}:${port}]`
      )
    );
  }
}, async (req) => {
  const url = new URL(req.url);

  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, token",
  };

  const endpoints = {
    home: "/api/feed",
  };

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
    try {
      const body = await req.json();
      console.log(body);
      const rawContent = (body && (body.content ?? body.p ?? body.text));
      const content = (rawContent == null) ? '' : String(rawContent).trim();
      if (content.length === 0) {
        console.warn('Invalid post content', { rawContent, type: typeof rawContent });
        return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
      }

      await Post.create({
        content: content,
        userId: foundUser.id,
        timestamp: Date.now(),
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    } catch (e) {
      return new Response("Bad Request", { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
    }
  } else if (req.method === "GET" && url.pathname === endpoints.home) {
    const posts = await Post.findAll({
      include: [{
        model: User,
        as: 'author',
        attributes: ['name']
      }],
      order: [['timestamp', 'DESC']]
    });
    return new Response(JSON.stringify({
      posts: posts.map(post => ({
        user: post.author.name,
        content: post.content,
        timestamp: post.timestamp || post.createdAt,
        id: post.id
      }))
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } else {
    return new Response("Not Found", { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } });
  }
});