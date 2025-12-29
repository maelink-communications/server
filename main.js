// deno-lint-ignore-file
import gradient from 'https://esm.sh/gradient-string@2.0.1';
import { startHttpServer, startWebSocketServer } from "./utils.js";
import instance_name from "./config.js";
const custom = gradient(["#ff5f6d", "#ff71a0ff"]);
console.log(custom(`maelink gen2 server [ ${instance_name} ] | Closed beta official (stable) build`));
startWebSocketServer({ port: 8080 });
startHttpServer({ port: 6060 });