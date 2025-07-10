import { Sequelize, DataTypes, Model } from 'sequelize';
import chalk from "chalk";
import { hash, verify } from "@felix/bcrypt";

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
  }
}, {
  sequelize,
  modelName: 'post'
});

User.hasMany(Post);
Post.belongsTo(User);

await sequelize.sync();

const connectedUsers = new Map();

console.log(chalk.red(`maelink - server [rewrite v4]`));

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

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("close", () => {
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
    });

    expiredUsers.forEach(userRecord => {
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
      cmd: "welcome"
    }));
  });

  socket.addEventListener("message", async (event) => {
      const startTime = Date.now();
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        socket.send(JSON.stringify({ error: true, code: 400, reason: "badJSON" }));
        console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
        return;
      }

      switch (data.cmd) {
        case "client_info": {
          if (!data.client) {
            socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
          }

          connectedUsers.get(socket).client = data.client;
          socket.send(JSON.stringify({ error: false, code: 200, reason: "clientInfoUpdated" }));
          break;
        }

        case "reg": {
          if (!data.pswd || !data.user) {
            socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
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
              registered_at: new Date()
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

          } catch (error) {
            if (error.name === 'SequelizeUniqueConstraintError') {
              socket.send(JSON.stringify({ error: true, code: 409, reason: "userExists" }));
            } else {
              socket.send(JSON.stringify({ error: true, code: 500, reason: "serverError" }));
            }
          }
          break;
        }

        case "login_pswd": {
          if (!data.pswd || !data.user) {
            socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
            break;
          }

          const foundUser = await User.findOne({ where: { name: data.user } });

          if (!foundUser) {
            socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" }));
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
            break;
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
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
          } else {
            socket.send(JSON.stringify({ error: true, code: 400, reason: "badPswd" }));
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
          }
          break;
        }

        case "login_token": {
          if (!data.token) {
            socket.send(JSON.stringify({ error: true, code: 400, reason: "badRequest" }));
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
            break;
          }

          const foundUser = await User.findOne({ where: { token: data.token } });

          if (!foundUser) {
            socket.send(JSON.stringify({ error: true, code: 404, reason: "userNotFound" }));
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
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
          console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
          break;
        }

        default:
          socket.send(JSON.stringify({ error: true, code: 404, reason: "notFound" }));
          console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
      }
    });

  return response;
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
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const url = new URL(req.url);
  if (url.pathname !== "/home" && url.pathname !== "/api/posts") {
    return new Response("Not Found", { status: 404 });
  }

  if (url.pathname === "/home") {
    const token = req.headers.get("token");
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const foundUser = await User.findOne({ where: { token } });
    if (!foundUser) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const body = await req.json();
      if (!body.content) {
        return new Response("Bad Request", { status: 400 });
      }

      await Post.create({
        content: body.content,
        userId: foundUser.id
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }

  } else if (url.pathname === "/api/posts" && req.method === "GET") {
    const posts = await Post.findAll({
      include: [{
        model: User,
        attributes: ['name']
      }],
      order: [['timestamp', 'DESC']]
    });

    return new Response(JSON.stringify({
      posts: posts.map(post => ({
        user: post.user.name,
        content: post.content,
        timestamp: post.timestamp
      }))
    }), {
      headers: { "Content-Type": "application/json" }
    });
  }
});