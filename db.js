// Database init
import { Database } from "@db/sqlite";
import { log } from "./logging.js";
if (Deno.env.get("LOG_LEVEL") === "trace") {
  log("DB module loaded", "gray");
  log("Initiating DB...", "gray");
}
const db = new Database("main.db");

// SINGLE SOURCE OF TRUTH FOR DATABASE SCHEMA
const TABLE_PRESETS = {
  users: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      uuid: "TEXT UNIQUE",
      username: "TEXT UNIQUE NOT NULL",
      password: "TEXT NOT NULL",
      pfp: "TEXT",
      bio: "TEXT",
      auth_version: "INTEGER DEFAULT 0",
    },
  },
  posts: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      user_id: "TEXT",
      author: "TEXT",
      uuid: "TEXT UNIQUE",
      content: "TEXT NOT NULL",
      ts: "INTEGER",
      client: "TEXT NOT NULL",
      likes: "INTEGER DEFAULT 0",
      users_liked: "TEXT DEFAULT '[]'",
      reply_count: "INTEGER DEFAULT 0",
      comment_count: "INTEGER DEFAULT 0",
      attachments: "TEXT DEFAULT '[]'",
    },
  },
  replies: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      uuid: "TEXT UNIQUE",
      post_id: "TEXT",
      user_id: "TEXT",
      parent_reply_id: "TEXT",
      content: "TEXT NOT NULL",
      ts: "INTEGER",
      likes: "INTEGER DEFAULT 0",
    },
  },
  comments: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      uuid: "TEXT UNIQUE",
      post_id: "TEXT",
      user_id: "TEXT",
      content: "TEXT NOT NULL",
      ts: "INTEGER",
    },
  },
  followers: {
    columns: {
      followerID: "TEXT",
      followedID: "TEXT",
    },
  },
  inbox: {
    columns: {
      id: "TEXT PRIMARY KEY",
      user_id: "TEXT",
      sender_id: "TEXT",
      content: "TEXT",
      ts: "INTEGER",
      read: "INTEGER DEFAULT 0",
    },
  },
  guilds: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      uuid: "TEXT UNIQUE",
      name: "TEXT NOT NULL",
      description: "TEXT",
      ownerID: "TEXT",
      memberIDs: "TEXT DEFAULT '[]'",
      channels: "TEXT DEFAULT '[]'",
      ts: "INTEGER",
      icon: "TEXT",
      banner: "TEXT",
    },
  },
  guild_posts: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      guildID: "TEXT",
      userID: "TEXT",
      ts: "INTEGER",
      content: "TEXT",
      channelId: "TEXT",
      author: "TEXT",
      reply_to: "TEXT",
      attachments: "TEXT DEFAULT '[]'",
    },
  },
  guild_roles: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      uuid: "TEXT UNIQUE",
      guildID: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      color: "TEXT",
      permissions: "TEXT DEFAULT '{}'",
      createdBy: "TEXT",
      ts: "INTEGER",
    },
  },
  guild_role_members: {
    columns: {
      guildID: "TEXT NOT NULL",
      roleID: "TEXT NOT NULL",
      userID: "TEXT NOT NULL",
    },
  },
  guild_channel_permissions: {
    columns: {
      guildID: "TEXT NOT NULL",
      channelId: "TEXT NOT NULL",
      roleID: "TEXT NOT NULL",
      viewPermission: "INTEGER DEFAULT 0",
      sendPermission: "INTEGER DEFAULT 0",
      historyPermission: "INTEGER DEFAULT 0",
    },
  },
  guild_bans: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      guildID: "TEXT NOT NULL",
      userID: "TEXT NOT NULL",
      reason: "TEXT",
      untilTs: "INTEGER",
      createdBy: "TEXT",
      ts: "INTEGER",
    },
  },
  guild_emojis: {
    columns: {
      uuid: "TEXT PRIMARY KEY",
      guildID: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      url: "TEXT NOT NULL",
      createdBy: "TEXT NOT NULL",
      ts: "INTEGER NOT NULL",
    },
  },
  guild_post_reactions: {
    columns: {
      postID: "INTEGER NOT NULL",
      userID: "TEXT NOT NULL",
      emojiKey: "TEXT NOT NULL",
      ts: "INTEGER NOT NULL",
    },
  },
  global_bans: {
    columns: {
      userID: "TEXT PRIMARY KEY",
      reason: "TEXT",
      untilTs: "INTEGER",
      createdBy: "TEXT NOT NULL",
      ts: "INTEGER NOT NULL",
    },
  },
  user_permissions: {
    columns: {
      userID: "TEXT NOT NULL",
      permission: "TEXT NOT NULL",
      grantedBy: "TEXT NOT NULL",
      ts: "INTEGER NOT NULL",
    },
  },
  moderation_audit: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      actorID: "TEXT NOT NULL",
      action: "TEXT NOT NULL",
      targetType: "TEXT NOT NULL",
      targetID: "TEXT NOT NULL",
      details: "TEXT DEFAULT '{}'",
      ts: "INTEGER NOT NULL",
    },
  },
  server_settings: {
    columns: {
      setting_key: "TEXT PRIMARY KEY",
      setting_value: "TEXT NOT NULL",
    },
  },
  keys: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      private_jwk: "TEXT NOT NULL",
      public_jwk: "TEXT NOT NULL",
    },
  },
};

// sanitize for sqlite's alteration constraints
function sanitizeForAddColumn(defString) {
  return defString
    .replace(/PRIMARY KEY\s*(\([^)]*\))?/gi, "")
    .replace(/AUTOINCREMENT/gi, "")
    .replace(/UNIQUE/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getExistingColumns(tableName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all
    ? db.prepare(`PRAGMA table_info(${tableName})`).all()
    : db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.map((r) => r.name);
}

function tableExists(tableName) {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName);
  return !!row;
}

function reconcileTable(tableName, preset) {
  if (!tableExists(tableName)) {
    if (Deno.env.get("LOG_LEVEL") === "trace") {
      log(
        `Table "${tableName}" does not exist yet; skipping reconciliation (will be created by CREATE TABLE IF NOT EXISTS).`,
        "gray",
      );
    }
    return;
  }

  const existingColumns = getExistingColumns(tableName);
  const presetColumns = Object.keys(preset.columns);

  const toAdd = presetColumns.filter((col) => !existingColumns.includes(col));

  const toDrop = existingColumns.filter((col) => !presetColumns.includes(col));

  for (const col of toAdd) {
    const rawDef = preset.columns[col];
    const safeDef = sanitizeForAddColumn(rawDef);
    try {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${safeDef}`);
      if (Deno.env.get("LOG_LEVEL") === "trace") {
        log(`+ Added column "${col}" to "${tableName}"`, "green");
      }
    } catch (err) {
      log(
        `⚠︎ Failed to add column "${col}" to "${tableName}": ${err.message}`,
        "yellow",
      );
    }
  }

  for (const col of toDrop) {
    const existingRows = db.prepare(`PRAGMA table_info(${tableName})`).all
      ? db.prepare(`PRAGMA table_info(${tableName})`).all()
      : db.prepare(`PRAGMA table_info(${tableName})`).all();
    const colInfo = existingRows.find((r) => r.name === col);
    if (colInfo && colInfo.pk) {
      log(
        `⚠︎ Skipping drop of "${col}" on "${tableName}": part of PRIMARY KEY.`,
        "yellow",
      );
      continue;
    }

    try {
      db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${col}`);
      log(`- Dropped column "${col}" from "${tableName}"`, "yellow");
    } catch (err) {
      log(
        `⚠︎ Failed to drop column "${col}" from "${tableName}" (your SQLite build may not support DROP COLUMN): ${err.message}`,
        "yellow",
      );
    }
  }

  if (toAdd.length === 0 && toDrop.length === 0) {
    if (Deno.env.get("LOG_LEVEL") === "trace") {
      log(`"${tableName}" schema already up to date.`, "gray");
    }
  }
}

function reconcileAllTables() {
  for (const [tableName, preset] of Object.entries(TABLE_PRESETS)) {
    reconcileTable(tableName, preset);
  }
}

function migrateFollowersTable() {
  const columns = db.prepare(`PRAGMA table_info(followers)`).all();
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(followers)`).all();
  const textIds = ["followerID", "followedID"].every((name) =>
    columns.find((column) => column.name === name)?.type?.toUpperCase() ===
      "TEXT"
  );
  const uuidReferences = ["followerID", "followedID"].every((name) =>
    foreignKeys.some((key) => key.from === name && key.to === "uuid")
  );
  if (textIds && uuidReferences) return;

  db.exec(`CREATE TABLE followers_migration (
    followerID TEXT NOT NULL,
    followedID TEXT NOT NULL,
    PRIMARY KEY (followerID, followedID),
    FOREIGN KEY (followerID) REFERENCES users(uuid) ON DELETE CASCADE,
    FOREIGN KEY (followedID) REFERENCES users(uuid) ON DELETE CASCADE
  )`);
  db.exec(`INSERT OR IGNORE INTO followers_migration (followerID, followedID)
    SELECT follower.uuid, followed.uuid
    FROM followers relationship
    JOIN users follower
      ON follower.uuid = CAST(relationship.followerID AS TEXT)
      OR follower.id = relationship.followerID
    JOIN users followed
      ON followed.uuid = CAST(relationship.followedID AS TEXT)
      OR followed.id = relationship.followedID
    WHERE follower.uuid <> followed.uuid`);
  db.exec(`DROP TABLE followers`);
  db.exec(`ALTER TABLE followers_migration RENAME TO followers`);
}

function initializeSchema() {
  // tables (mostly)
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    pfp TEXT, -- url to image
    bio TEXT,
    auth_version INTEGER DEFAULT 0
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    author TEXT,
    uuid TEXT UNIQUE,
    content TEXT NOT NULL,
    ts INTEGER,
    client TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    users_liked TEXT DEFAULT '[]',
    reply_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    attachments TEXT DEFAULT '[]',
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  post_id TEXT REFERENCES posts(uuid),
  user_id TEXT,
  content TEXT NOT NULL,
  ts INTEGER
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS followers (
  followerID TEXT,
  followedID TEXT,
  PRIMARY KEY (followerID, followedID),
  FOREIGN KEY (followerID) REFERENCES users(uuid) ON DELETE CASCADE,
  FOREIGN KEY (followedID) REFERENCES users(uuid) ON DELETE CASCADE
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
  ts INTEGER,
  icon TEXT,
  banner TEXT
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildID TEXT,
  userID TEXT,
  ts INTEGER,
  content TEXT,
  channelId TEXT,
  author TEXT,
  reply_to TEXT,
  attachments TEXT DEFAULT '[]'
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  guildID TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  permissions TEXT DEFAULT '{}',
  createdBy TEXT,
  ts INTEGER
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_role_members (
  guildID TEXT NOT NULL,
  roleID TEXT NOT NULL,
  userID TEXT NOT NULL,
  PRIMARY KEY (guildID, roleID, userID)
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_channel_permissions (
  guildID TEXT NOT NULL,
  channelId TEXT NOT NULL,
  roleID TEXT NOT NULL,
  viewPermission INTEGER DEFAULT 0,
  sendPermission INTEGER DEFAULT 0,
  historyPermission INTEGER DEFAULT 0,
  PRIMARY KEY (guildID, channelId, roleID)
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_bans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildID TEXT NOT NULL,
  userID TEXT NOT NULL,
  reason TEXT,
  untilTs INTEGER,
  createdBy TEXT,
  ts INTEGER
);
`);

  db.exec(`CREATE TABLE IF NOT EXISTS guild_emojis (
  uuid TEXT PRIMARY KEY,
  guildID TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  createdBy TEXT NOT NULL,
  ts INTEGER NOT NULL,
  UNIQUE (guildID, name)
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guild_post_reactions (
  postID INTEGER NOT NULL,
  userID TEXT NOT NULL,
  emojiKey TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (postID, userID, emojiKey)
);
`);

  db.exec(`CREATE TABLE IF NOT EXISTS global_bans (
  userID TEXT PRIMARY KEY,
  reason TEXT,
  untilTs INTEGER,
  createdBy TEXT NOT NULL,
  ts INTEGER NOT NULL,
  FOREIGN KEY (userID) REFERENCES users(uuid) ON DELETE CASCADE
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS user_permissions (
  userID TEXT NOT NULL,
  permission TEXT NOT NULL,
  grantedBy TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (userID, permission),
  FOREIGN KEY (userID) REFERENCES users(uuid) ON DELETE CASCADE
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actorID TEXT NOT NULL,
  action TEXT NOT NULL,
  targetType TEXT NOT NULL,
  targetID TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  ts INTEGER NOT NULL
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS server_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL
);
`);

  db.exec(`CREATE TABLE IF NOT EXISTS keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  private_jwk TEXT NOT NULL,
  public_jwk TEXT NOT NULL
)`);

  migrateFollowersTable();

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
    `CREATE INDEX IF NOT EXISTS idx_followers_followerID ON followers(followerID)
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
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_roles_guild ON guild_roles(guildID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_role_members_user ON guild_role_members(userID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_channel_permissions_channel ON guild_channel_permissions(channelId)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_bans_user ON guild_bans(userID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_emojis_guild ON guild_emojis(guildID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_guild_reactions_post ON guild_post_reactions(postID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_global_bans_until ON global_bans(untilTs)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(userID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_moderation_audit_actor ON moderation_audit(actorID)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_users_urn ON users(username)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_posts_uuid ON posts(uuid)
`,
  );

  reconcileAllTables();
}

export function initDB() {
  const startTime = performance.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    initializeSchema();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the schema error if rollback itself fails.
    }
    throw error;
  }

  const endTime = performance.now();
  if (Deno.env.get("LOG_LEVEL") === "trace") {
    log(`Done initializing DB.`, "gray");
  }
  if (((endTime - startTime) / 1000).toFixed(3) > 1) {
    log(
      `⚠︎ DB initialization took ${((endTime - startTime) / 1000).toFixed(3)}s. If this is not first-time initialization, consider optimizing.`,
      "yellow",
    );
  }
}

export function connectDB() {
  return db;
}
