// Database init
import { Database } from "@db/sqlite";
const db = new Database("prealpha.db");
import { log } from "./logging.js";
log("DB module loaded", "gray");
export function initDB() {
  log("Initiating DB...", "gray");
  const startTime = performance.now();
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pfp TEXT, -- url to image
    bio TEXT
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    uuid TEXT UNIQUE,
    content TEXT,
    ts INTEGER,
    likes INTEGER DEFAULT 0,
    users_liked TEXT DEFAULT '[]',
    reply_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(uuid) ON DELETE SET NULL
);
`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_posts_uuid ON posts(uuid)
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
  db.exec(`CREATE TABLE IF NOT EXISTS followers (
  followerID INTEGER,
  followedID INTEGER,
  PRIMARY KEY (followerID, followedID),
  FOREIGN KEY (followerID) REFERENCES users(id),
  FOREIGN KEY (followedID) REFERENCES users(id)
);
`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_users_id ON users(uuid)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_followers_flID ON followers(followedID)
`,
  );
  const endTime = performance.now();
  log(`Done. Took ${((endTime - startTime) / 1000).toFixed(3)}s.`, "gray");
}

export function connectDB() {
  return db;
}
