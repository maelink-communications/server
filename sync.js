import {
  connectDB,
  getUnsyncedChanges,
  getChangesForPeer,
  markChangesSyncedToPeer,
  logChange,
  pruneChangeLog,
} from "./db.js";
import { getPeers, SERVER_ID } from "./peer.js";
import { log } from "./logging.js";

const db = connectDB();
const SYNC_INTERVAL = 3000;
const VERBOSE_SYNC = Deno.env.get("VERBOSE_SYNC") === "1";

function syncLog(msg, color = "gray") {
  if (VERBOSE_SYNC) log(msg, color);
}

db.exec(`CREATE TABLE IF NOT EXISTS _peer_sync_state (
  peer_id TEXT PRIMARY KEY,
  last_ts INTEGER NOT NULL DEFAULT 0
)`);

function getPeerSince(peerId) {
  const row = db.prepare(`SELECT last_ts FROM _peer_sync_state WHERE peer_id = ?`).value(peerId);
  const val = row?.[0] ?? 0;
  syncLog(`[peerstate] getPeerSince(${peerId}) = ${val}`);
  return val;
}

function setPeerSince(peerId, ts) {
  try {
    db.prepare(`INSERT OR REPLACE INTO _peer_sync_state (peer_id, last_ts) VALUES (?, ?)`)
      .run(peerId, ts);
    const verify = db.prepare(`SELECT last_ts FROM _peer_sync_state WHERE peer_id = ?`).value(peerId);
    syncLog(`[peerstate] setPeerSince(${peerId}, ${ts}) -> verified=${verify?.[0]}`);
  } catch (e) {
    log(`[peerstate] setPeerSince FAILED: ${e.message}`, "red");
  }
}

// LWW implementation: returns true if incoming change should overwrite local
function lwwWins(incomingTs, incomingServerId, localTs, localServerId) {
  if (incomingTs !== localTs) return incomingTs > localTs;
  return incomingServerId > localServerId;
}

// Apply a single change from a remote peer
function applyChange(change) {
  const data =
    typeof change.change_data === "string"
      ? JSON.parse(change.change_data)
      : change.change_data;

  db.exec(`PRAGMA foreign_keys = OFF`);
  try {
    if (change.table_name === "posts") {
      if (change.operation === "INSERT") {
        const existing = db
          .prepare(`SELECT ts FROM posts WHERE uuid = ?`)
          .value(change.record_id);
        if (existing) {
          if (
            !lwwWins(
              change.timestamp,
              change.origin_server_id,
              existing[0],
              SERVER_ID,
            )
          )
            return;
          db.exec(
            `UPDATE posts SET content = ?, ts = ?, user_id = ? WHERE uuid = ?`,
            [data.content, data.ts, data.user_id, change.record_id],
          );
        } else {
          db.exec(
            `INSERT OR IGNORE INTO posts (uuid, user_id, content, ts) VALUES (?, ?, ?, ?)`,
            [change.record_id, data.user_id, data.content, data.ts],
          );
        }
      } else if (change.operation === "UPDATE") {
        const existing = db
          .prepare(`SELECT ts FROM posts WHERE uuid = ? OR id = ?`)
          .value(change.record_id, change.record_id);
        if (!existing) return;
        if (
          !lwwWins(
            change.timestamp,
            change.origin_server_id,
            existing[0],
            SERVER_ID,
          )
        )
          return;
        if (data.field === "content") {
          db.exec(
            `UPDATE posts SET content = ?, ts = ? WHERE uuid = ? OR id = ?`,
            [data.content, data.ts, change.record_id, change.record_id],
          );
        } else if (data.action === "like") {
          db.exec(
            `UPDATE posts SET users_liked = json_insert(users_liked, '$[#]', ?), likes = likes + 1 WHERE (uuid = ? OR id = ?) AND users_liked NOT LIKE '%' || ? || '%'`,
            [data.user_id, change.record_id, change.record_id, data.user_id],
          );
        } else if (data.action === "unlike") {
          const post = db
            .prepare(`SELECT users_liked FROM posts WHERE uuid = ? OR id = ?`)
            .value(change.record_id, change.record_id);
          if (!post) return;
          const liked = JSON.parse(post[0]);
          const idx = liked.indexOf(data.user_id);
          if (idx > -1) {
            liked.splice(idx, 1);
            db.exec(
              `UPDATE posts SET users_liked = ?, likes = likes - 1 WHERE uuid = ? OR id = ?`,
              [JSON.stringify(liked), change.record_id, change.record_id],
            );
          }
        }
      } else if (change.operation === "DELETE") {
        db.exec(`DELETE FROM posts WHERE uuid = ? OR id = ?`, [
          change.record_id,
          change.record_id,
        ]);
      }
    } else if (change.table_name === "users") {
      if (change.operation === "INSERT") {
        db.exec(
          `INSERT OR IGNORE INTO users (uuid, username, password, pfp, bio) VALUES (?, ?, ?, ?, ?)`,
          [data.uuid, data.username, data.password, data.pfp ?? null, data.bio ?? null],
        );
      } else if (change.operation === "UPDATE") {
        const existing = db
          .prepare(`SELECT uuid FROM users WHERE uuid = ?`)
          .value(change.record_id);
        if (!existing) return;
        if (data.field === "username") {
          db.exec(`UPDATE users SET username = ? WHERE uuid = ?`, [
            data.newValue,
            change.record_id,
          ]);
        } else if (data.field === "pfp") {
          db.exec(`UPDATE users SET pfp = ? WHERE uuid = ?`, [
            data.newValue,
            change.record_id,
          ]);
        } else if (data.field === "bio") {
          db.exec(`UPDATE users SET bio = ? WHERE uuid = ?`, [
            data.newValue,
            change.record_id,
          ]);
        }
      }
    } else if (change.table_name === "inbox") {
      if (change.operation === "INSERT") {
        db.exec(
          `INSERT OR IGNORE INTO inbox (id, user_id, sender_id, content, ts, read) VALUES (?, ?, ?, ?, ?, 0)`,
          [
            change.record_id,
            data.user_id,
            data.sender_id,
            data.content,
            data.ts,
          ],
        );
      } else if (change.operation === "UPDATE" && data.field === "read") {
        db.exec(`UPDATE inbox SET read = 1 WHERE id = ?`, [change.record_id]);
      } else if (change.operation === "DELETE") {
        db.exec(`DELETE FROM inbox WHERE id = ?`, [change.record_id]);
      }
    }
    db.exec(`PRAGMA foreign_keys = ON`);
    db.prepare(
      `INSERT OR IGNORE INTO _synced_changes
      (table_name, operation, record_id, change_data, timestamp, origin_server_id, synced_to_peers)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      change.table_name,
      change.operation,
      change.record_id,
      typeof change.change_data === "string" ? change.change_data : JSON.stringify(change.change_data),
      change.timestamp,
      change.origin_server_id,
      JSON.stringify([SERVER_ID]),
    );
  } catch (e) {
    db.exec(`PRAGMA foreign_keys = ON`);
    log(
      `applyChange error [${change.table_name}/${change.operation}]: ${e.message}`,
      "red",
    );
  }
}

async function syncWithPeer(peer) {
  const since = getPeerSince(peer.id);
  const peerUrl = `http://${peer.address}:${peer.port}`;
  syncLog(`[sync] -> ${peer.id} | since=${since}`);

  try {
    const reqBody = { since, requesterId: SERVER_ID };
    syncLog(`[sync] -> ${peer.id} | sending body: ${JSON.stringify(reqBody)}`);
    const pullRes = await fetch(`${peerUrl}/sync/changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });
    if (!pullRes.ok) {
      log(`[sync] pull failed from ${peer.id}: HTTP ${pullRes.status}`, "red");
      return;
    }
    const { changes } = await pullRes.json();
    syncLog(`[sync] <- ${peer.id} | got ${changes?.length ?? 0} changes (since=${since})`);

    if (changes?.length) {
      const newMaxTs = Math.max(...changes.map((c) => c.timestamp));
      for (const change of changes) {
        if (change.origin_server_id === SERVER_ID) {
          syncLog(`[sync] skipping own change ${change.record_id} (${change.table_name}/${change.operation})`);
          continue;
        }
        syncLog(`[sync] applying ${change.table_name}/${change.operation} record=${change.record_id} ts=${change.timestamp} origin=${change.origin_server_id}`);
        applyChange(change);
      }
      syncLog(`[sync] setPeerSince(${peer.id}, ${newMaxTs}) [was ${since}]`);
      setPeerSince(peer.id, newMaxTs);
      syncLog(`Synced ${changes.length} changes from ${peer.id}`);
    }

    const toSend = getUnsyncedChanges(since).filter((c) => {
      const synced = JSON.parse(c.synced_to_peers || "[]");
      return !synced.includes(peer.id);
    });
    syncLog(`[sync] -> ${peer.id} | ${toSend.length} changes to push`);

    if (toSend.length) {
      const pushRes = await fetch(`${peerUrl}/sync/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: toSend, senderId: SERVER_ID }),
      });
      if (pushRes.ok) {
        markChangesSyncedToPeer(toSend.map((c) => c.id), peer.id);
        syncLog(`[sync] push to ${peer.id} ok`);
      } else {
        log(`[sync] push to ${peer.id} failed: HTTP ${pushRes.status}`, "red");
      }
    }
  } catch (e) {
    log(`[sync] error with peer ${peer.id}: ${e.message}`, "red");
  }
}

let syncing = false;
async function syncCycle() {
  if (syncing) return;
  syncing = true;
  try {
    const peers = getPeers();
    for (const peer of peers) {
      await syncWithPeer(peer);
    }
  } finally {
    syncing = false;
  }
}

export function startSyncEngine() {
  // Deduplicate any existing duplicate rows left from before the unique index
  db.exec(`DELETE FROM _synced_changes WHERE id NOT IN (
    SELECT MIN(id) FROM _synced_changes
    GROUP BY record_id, operation, timestamp, origin_server_id
  )`);
  setInterval(syncCycle, SYNC_INTERVAL);
  setInterval(() => pruneChangeLog(7), 60 * 60 * 1000);
  log("Sync engine started", "green");
}

export async function handleSyncChanges(req) {
  const { since = 0, requesterId } = await req.json();
  const all = requesterId ? getChangesForPeer(requesterId, since) : getUnsyncedChanges(since);
  syncLog(`[handleSyncChanges] requester=${requesterId} since=${since} total=${all.length}`);
  const changes = requesterId
    ? all.filter((c) => c.origin_server_id !== requesterId)
    : all;
  if (VERBOSE_SYNC && all.length > 0) {
    for (const c of all) {
      const kept = !requesterId || c.origin_server_id !== requesterId;
      syncLog(`[handleSyncChanges]   ${kept ? "SEND" : "SKIP"} ${c.table_name}/${c.operation} record=${c.record_id} ts=${c.timestamp} origin=${c.origin_server_id}`);
    }
  }
  return new Response(JSON.stringify({ changes }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleSyncApply(req) {
  const { changes = [] } = await req.json();
  for (const change of changes) {
    if (change.origin_server_id !== SERVER_ID) applyChange(change);
  }
  return new Response(JSON.stringify({ ok: true, applied: changes.length }), {
    headers: { "Content-Type": "application/json" },
  });
}
