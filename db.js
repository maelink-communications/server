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
  db.exec(`CREATE TABLE IF NOT EXISTS _synced_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_id TEXT NOT NULL,
  change_data TEXT,
  timestamp INTEGER NOT NULL,
  origin_server_id TEXT,
  synced_to_peers TEXT DEFAULT '[]',
  created_at INTEGER DEFAULT (cast(unixepoch('subsec')*1000 as integer))
);
`);
  db.exec(`CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  ownerID TEXT
);
`);

// indexes
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_synced_changes_dedup ON _synced_changes(record_id, operation, timestamp, origin_server_id)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_synced_changes_timestamp ON _synced_changes(timestamp)
`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_synced_changes_record ON _synced_changes(record_id)
`,
  );
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

/**
 * Log a change for replication tracking
 * @param {string} tableName - Name of the table (e.g., 'posts', 'users')
 * @param {string} operation - Operation type: 'INSERT', 'UPDATE', or 'DELETE'
 * @param {string} recordId - Record identifier (typically UUID or ID)
 * @param {object} changeData - Before/after data object or change payload
 * @param {string} originServerId - Optional: which server originated this change (for replication)
 */
export function logChange(
  tableName,
  operation,
  recordId,
  changeData,
  originServerId = null,
) {
  try {
    const timestamp = Date.now();
    const changeJson =
      typeof changeData === "string" ? changeData : JSON.stringify(changeData);
    const serverId = originServerId || globalThis.SERVER_ID || "local";

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO _synced_changes (table_name, operation, record_id, change_data, timestamp, origin_server_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(tableName, operation, recordId, changeJson, timestamp, serverId);
  } catch (error) {
    log(`Error logging change: ${error.message}`, "red");
  }
}

/**
 * Get unsynced changes since a given timestamp
 * @param {number} sinceTimestamp - Get changes after this timestamp (milliseconds)
 * @param {string} limit - Optional: max number of results (default 1000)
 */
export function getUnsyncedChanges(sinceTimestamp = 0, limit = 1000) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM _synced_changes 
      WHERE CAST(timestamp AS INTEGER) > CAST(? AS INTEGER)
      ORDER BY timestamp ASC 
      LIMIT ?
    `);
    const results = stmt.all(sinceTimestamp, limit);
    if (Deno.env.get("VERBOSE_SYNC") === "1") {
      log(
        `[getUnsyncedChanges] since=${sinceTimestamp} limit=${limit} -> ${results.length} rows`,
        "gray",
      );
      if (results.length > 0 && results.length <= 10) {
        for (const r of results) {
          log(
            `  [row] ts=${r.timestamp} (${r.timestamp > sinceTimestamp ? "PASS" : "FAIL"}) ${r.table_name}/${r.operation} record=${r.record_id}`,
            "gray",
          );
        }
      }
    }
    return results;
  } catch (error) {
    log(`Error fetching unsynced changes: ${error.message}`, "red");
    return [];
  }
}

/**
 * Get changes for a specific peer (unsynced to that peer)
 * @param {string} peerId - Peer server ID
 * @param {number} sinceTimestamp - Get changes after this timestamp
 */
export function getChangesForPeer(peerId, sinceTimestamp = 0, limit = 1000) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM _synced_changes 
      WHERE timestamp > ? 
        AND (synced_to_peers IS NULL OR synced_to_peers NOT LIKE ?)
      ORDER BY timestamp ASC 
      LIMIT ?
    `);
    const searchPattern = `%"${peerId}"%`;
    return stmt.all(sinceTimestamp, searchPattern, limit);
  } catch (error) {
    log(`Error fetching changes for peer: ${error.message}`, "red");
    return [];
  }
}

/**
 * Mark changes as synced to a specific peer
 * @param {number[]} changeIds - Array of change log IDs
 * @param {string} peerId - Peer server ID
 */
export function markChangesSyncedToPeer(changeIds, peerId) {
  try {
    if (!changeIds || changeIds.length === 0) return;

    const stmt = db.prepare(`
      UPDATE _synced_changes 
      SET synced_to_peers = json_insert(
        COALESCE(synced_to_peers, '[]'),
        '$[#]',
        ?
      )
      WHERE id = ?
    `);

    for (const changeId of changeIds) {
      stmt.run(peerId, changeId);
    }
  } catch (error) {
    log(`Error marking changes synced: ${error.message}`, "red");
  }
}

/**
 * Get all changes for a record (useful for seeing full history)
 * @param {string} recordId - Record identifier
 */
export function getRecordChanges(recordId) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM _synced_changes 
      WHERE record_id = ? 
      ORDER BY timestamp ASC
    `);
    return stmt.all(recordId);
  } catch (error) {
    log(`Error fetching record changes: ${error.message}`, "red");
    return [];
  }
}

/**
 * Clear old change log entries (for maintenance)
 * @param {number} olderThanDays - Delete entries older than N days
 */
export function pruneChangeLog(olderThanDays = 7) {
  try {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    // Only prune entries that have been synced to at least one peer
    // synced_to_peers defaults to '[]' (not null), so checking IS NOT NULL
    // alone would delete unsynced rows. Use COALESCE(...) != '[]' to ensure
    // only removal of entries that have non-empty synced_to_peers.
    const stmt = db.prepare(`
      DELETE FROM _synced_changes 
      WHERE timestamp < ? AND COALESCE(synced_to_peers, '[]') != '[]'
    `);
    const result = stmt.run(cutoffTime);
    log(`Pruned ${result.changes} old change log entries (synced only)`, "gray");
  } catch (error) {
    log(`Error pruning change log: ${error.message}`, "red");
  }
}
