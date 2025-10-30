// deno-lint-ignore-file
import gradient from 'https://esm.sh/gradient-string@2.0.1';
import { startHttpServer, startWebSocketServer } from "./utils.js";

const instance_name = "reformaelink_rv4_051025";
const custom = gradient(["#ff5f6d", "#ff71a0ff"]);
console.log(custom(`maelink gen2 [POST-DEV RESET] server [ ${instance_name} ] | Development build, do not use in production.`));
startWebSocketServer({ port: 8080 });
startHttpServer({ port: 6060 });