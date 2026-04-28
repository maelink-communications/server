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
    ts INTEGER,
    likes INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(uuid) ON DELETE SET NULL
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  post_id TEXT REFERENCES posts(uuid) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(uuid) ON DELETE CASCADE,
  parent_reply_id TEXT REFERENCES replies(uuid) ON DELETE CASCADE,
  content TEXT NOT NULL,
  ts INTEGER,
  likes INTEGER DEFAULT 0
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  post_id TEXT REFERENCES posts(uuid),
  user_id TEXT,
  content TEXT,
  ts INTEGER
);
`);
}

export function connectDB() {
  return new Database("prealpha.db");
}
