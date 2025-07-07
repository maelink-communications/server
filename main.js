import * as helldb from "./helldb.js";
import chalk from "chalk";
import { hash, verify } from "@felix/bcrypt";
import fs from "node:fs";

const dbPath = "db.json";
const tables = [
  {
    name: "users",
    columns: [
      "name",
      "display_name",
      "pswd",
      "uuid",
      "token",
      "registered_at",
    ],
  },
  {
    name: "posts",
    columns: [
      "user",
      "content",
      "timestamp",
      "author",
    ],
  },
];

if (fs.existsSync(".env.json")) {
  try {
    env = JSON.parse(fs.readFileSync(".env.json", "utf8"));
  } catch {
    env = {};
  }
}

const validTableNames = new Set(tables.map(t => t.name));

let db = helldb.getDB(dbPath); // keep this as let, we WILL need it later
let dbChanged = false;
for (const table of tables) {
  if (!validTableNames.has(table)) {
    if (!Object.prototype.hasOwnProperty.call(db, table.name)) {
      helldb.createTable(dbPath, table.name, table.columns);
      dbChanged = true;
      console.log(chalk.green(`Initialized table: ${table.name}`));
    }
  }
}
if (dbChanged) {
  db = helldb.getDB(dbPath); // reload db after creation
}

// Add UNIQUE constraint to username
helldb.addConstraint(dbPath, "users", "name", "UNIQUE");

console.log(chalk.red(`maelink - server [rewrite v4]`));
Deno.serve(
  {
    port: 8080,
    onListen({ hostname, port }) {
      console.log(
        chalk.green(
          `[WebSocket server listening on ws://${hostname ?? "localhost"}:${port}]`
        )
      );
    },
  },
  (req) => {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response(null, { status: 501 });
    }
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => {
      console.log("a client connected!");
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
        case "reg": {
          if (!data.pswd || !data.user) {
            socket.send(
              JSON.stringify({ error: true, code: 400, reason: "badRequest" })
            );
            break;
          }
          const usernameEncoded = Array.from(data.user)
            .map((char) => char.charCodeAt(0))
            .join("");
          const regTimestamp = Date.now();
          const tokenRaw = `${usernameEncoded}${regTimestamp}`;
          const token = await hash(tokenRaw);

          const userFields = {
            name: data.user,
            display_name: data.display_name || data.user,
            pswd: await hash(data.pswd),
            uuid: crypto.randomUUID(),
            token: token,
            registered_at: regTimestamp,
          };
          try {
            helldb.addValue(dbPath, "users", userFields);
            socket.send(
              JSON.stringify({
                error: false,
                user: userFields.name,
                display: userFields.display_name,
                token: token,
                uuid: userFields.uuid,
              })
            );
          } catch (error) {
            if (error.message.includes('UNIQUE constraint violation')) {
              socket.send(
                JSON.stringify({ error: true, code: 409, reason: "userExists" })
              );
            } else {
              socket.send(
                JSON.stringify({ error: true, code: 500, reason: "serverError" })
              );
            }
          }
          break;
        }
        case "login_pswd": {
          if (!data.pswd || !data.user) {
            socket.send(
              JSON.stringify({ error: true, code: 400, reason: "badRequest" })
            );
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
            break;
          }
          const usersTable = helldb.getTable(dbPath, "users");
          const nameArr = usersTable.name || [];
          const pswdArr = usersTable.pswd || [];
          const idx = nameArr.indexOf(data.user);
          if (idx === -1) {
            socket.send(
              JSON.stringify({ error: true, code: 404, reason: "userNotFound" })
            );
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
            break;
          }
          const hashed = pswdArr[idx];
          if (await verify(data.pswd, hashed)) {
            socket.send(
              JSON.stringify({ error: false, user: data.user, token: usersTable.token ? usersTable.token[idx] : null, uuid: usersTable.uuid ? usersTable.uuid[idx] : null })
            );
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
          } else {
            socket.send(
              JSON.stringify({ error: true, code: 400, reason: "badPswd" })
            );
            console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
          }
          break;
        }
        default:
          socket.send(JSON.stringify({ error: true, code: 404, reason: "notFound" }));
          console.log(chalk.yellow(`Request handled in ${Date.now() - startTime}ms`));
      }
    });
    return response;
  }
);

Deno.serve(
  {
    port: 6060,
    onListen({ hostname, port }) {
      console.log(
        chalk.green(
          `[HTTP server listening on http://${hostname ?? "localhost"}:${port}]`
        )
      );
    },
  },
  async (req) => {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(req.url);
    if (url.pathname !== "/home") {
      return new Response("Not Found", { status: 404 }); 
    }

    const token = req.headers.get("token");
    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    const usersTable = helldb.getTable(dbPath, "users");
    const tokenArr = usersTable.token || [];
    const userIdx = tokenArr.indexOf(token);
    
    if (userIdx === -1) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const body = await req.json();
      if (!body.content) {
        return new Response("Bad Request", { status: 400 });
      }

      const postData = {
        user: usersTable.uuid[userIdx],
        content: body.content,
        timestamp: Date.now(),
        author: usersTable.name[userIdx]
      };

      helldb.addValue(dbPath, "posts", postData);

      return new Response(JSON.stringify({success: true}), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }
  }
);
