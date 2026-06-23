// Database init
import { Database } from "@db/sqlite";
log("DB module loaded", "gray");
log("Initiating DB...", "gray");
const startTime = performance.now();
const db = new Database("main.db");
import { log } from "./logging.js";
export function initDB() {
// tables (mostly)
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pfp TEXT, -- url to image
    bio TEXT,
    token TEXT
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    author TEXT,
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
  db.exec(`CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  sender_id TEXT,
  content TEXT,
  ts INTEGER,
  read INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(uuid) ON DELETE CASCADE
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  ownerID TEXT,
  memberIDs TEXT DEFAULT '[]',
  channels TEXT DEFAULT '[]',
  ts INTEGER
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildID TEXT,
  userID TEXT,
  ts INTEGER,
  content TEXT,
  channelId TEXT
);
`);

db.exec(`CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  private_jwk TEXT NOT NULL,
  public_jwk TEXT NOT NULL
)`);

// indexes
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
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guilds ON guilds(uuid)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_posts ON guild_posts(guildID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_posts_channel ON guild_posts(channelId)
`,
  );

  const endTime = performance.now();
  log(`Done initializing DB.`, "gray");
  if (((endTime - startTime) / 1000).toFixed(3) > 1) {
      log(
        `/!\\ | DB initialization took ${((endTime - startTime) / 1000).toFixed(3)}s. If this is not first-time initialization, consider optimizing.`,
        "yellow",
      );
  }
}

export function connectDB() {
  return db;
}