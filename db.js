// Database init
import { Database } from "@db/sqlite";
const db = new Database("prealpha.db");
import { log } from "./logging.js";
log("DB module loaded", "gray");
export function initDB() {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    username TEXT UNIQUE,
    password TEXT
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    uuid TEXT UNIQUE,
    content TEXT,
    ts INTEGER
);
`);
}

export function connectDB() {
  return new Database("prealpha.db");
}
