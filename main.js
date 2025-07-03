import * as helldb from "./helldb.js";
import chalk from "chalk";
import { hash, verify } from "@felix/bcrypt";
import { Select } from "https://deno.land/x/cliffy@v1.0.0-rc.4/prompt/select.ts";
import fs from "node:fs";

const dbPath = "db.json";
const tables = ["users", "posts"];

let env = {};
if (fs.existsSync(".env.json")) {
  try {
    env = JSON.parse(fs.readFileSync(".env.json", "utf8"));
  } catch {
    env = {};
  }
}
if (!env.dbPres) env.dbPres = 0;

// deno-lint-ignore prefer-const
let db = helldb.getDB(dbPath); // keep this as let, we WILL need it later
let dbChanged = false;
for (const table of tables) {
  if (!Object.prototype.hasOwnProperty.call(db, table)) {
    db[table] = {};
    dbChanged = true;
    console.log(chalk.green(`Initialized table: ${table}`));
  }
}
if (dbChanged) {
  helldb.writeDB(dbPath, JSON.stringify(db, null, 2));
}

const dbTables = Object.keys(db);

for (const table of dbTables) {
  if (!tables.includes(table)) {
    if (env.dbPres === 1) {
      continue;
    } else if (env.dbPres === 2) {
      helldb.dropTable(dbPath, table);
      console.log(chalk.yellow(`Deleted extra table: ${table}`));
      continue;
    }
    const answer = await Select.prompt({
      message: `Table "${table}" is not in initial tables. Delete?`,
      options: [
        { name: "Yes (delete this table)", value: "delete" },
        { name: "No (preserve this table)", value: "preserve" },
        { name: "Always preserve extra tables", value: "always_preserve" },
        { name: "Always delete extra tables", value: "always_delete" },
      ],
    });
    if (answer === "delete") {
      helldb.dropTable(dbPath, table);
      console.log(chalk.yellow(`Deleted extra table: ${table}`));
    } else if (answer === "always_preserve") {
      env.dbPres = 1;
      fs.writeFileSync(".env.json", JSON.stringify(env, null, 2));
    } else if (answer === "always_delete") {
      env.dbPres = 2;
      fs.writeFileSync(".env.json", JSON.stringify(env, null, 2));
      helldb.dropTable(dbPath, table);
      console.log(chalk.yellow(`Deleted extra table: ${table}`));
    }
  }
}

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
          helldb.addValue(dbPath, "users", userFields);
          socket.send(
            JSON.stringify({
              success: true,
              user: userFields.name,
              display: userFields.display_name,
              uuid: userFields.uuid,
            })
          );
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
