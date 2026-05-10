import { log } from "./logging.js";
import * as jose from "@panva/jose";
import { cachePeerKey } from "./keys.js";
import { connectDB } from "./db.js";

const db = connectDB();
db.exec(`CREATE TABLE IF NOT EXISTS _known_peers (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  port INTEGER NOT NULL
)`);

const REGISTRY_URL = Deno.env.get("REGISTRY_URL") || "http://localhost:8000";
const HEARTBEAT_INTERVAL = 5000;

export const SERVER_ID = Deno.env.get("SERVER_ID") || crypto.randomUUID();
export const SERVER_ADDRESS = Deno.env.get("SERVER_ADDRESS") || "localhost";
export const SERVER_PORT = parseInt(Deno.env.get("PORT") || "7000");

function isIPAddress(address) {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(address)) {
    const parts = address.split('.');
    return parts.every(part => parseInt(part) <= 255);
  }
  if (address.includes(':')) {
    return true;
  }
  return false;
}

globalThis.SERVER_ID = SERVER_ID;

let peers = db.prepare(`SELECT id, address, port FROM _known_peers`).all();

export function getPeers() {
  return peers;
}

async function fetchAndCachePeerKey(peer) {
  try {
    // Always use HTTP for peer communication (not HTTPS)
    // peer.address should be hostname/IP only, peer.port is the port
    const url = `http://${peer.address.replace(/^https?:\/\//, "")}:${peer.port}`;
    const res = await fetch(`${url}/sync/pubkey`);
    if (!res.ok) return;
    const { kid, ...jwk } = await res.json();
    const key = await jose.importJWK(jwk, "ES256");
    cachePeerKey(kid, key);
  } catch {
    // peer unreachable
  }
}

async function registryPost(path, body) {
  const res = await fetch(`${REGISTRY_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Registry error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function registerWithRegistry() {
  try {
    const body = {
      id: SERVER_ID,
      address: SERVER_ADDRESS,
    };
    // Send port if the address is an IP or localhost
    if (isIPAddress(SERVER_ADDRESS) || SERVER_ADDRESS === "localhost") {
      body.port = SERVER_PORT;
    }
    await registryPost("/register", body);
    log(`Registered with registry as ${SERVER_ID}`, "green");
  } catch (e) {
    log(`Registry registration failed: ${e.message}`, "yellow");
  }
}

async function refreshPeers() {
  try {
    const res = await fetch(`${REGISTRY_URL}/peers`);
    const data = await res.json();
    const newPeers = (data.peers || []).filter((p) => p.id !== SERVER_ID);
    for (const peer of newPeers) {
      peer.address = peer.address.replace(/^https?:\/\//, "");
      const isNew = !peers.find((p) => p.id === peer.id);
      db.exec(
        `INSERT OR REPLACE INTO _known_peers (id, address, port) VALUES (?, ?, ?)`,
        [peer.id, peer.address, peer.port],
      );
      if (isNew) await fetchAndCachePeerKey(peer);
    }
    peers = newPeers;
  } catch {
    // registry unreachable — peers already loaded from DB at startup
    log("Registry unreachable, using last known peers", "yellow");
  }
}

async function heartbeat() {
  try {
    await registryPost("/heartbeat", { id: SERVER_ID });
    await refreshPeers();
  } catch {
    // silent — offline tolerance
  }
}

export function startRegistryClient() {
  // Re-fetch public keys for all persisted peers on startup
  for (const peer of peers) fetchAndCachePeerKey(peer);
  registerWithRegistry();
  setInterval(heartbeat, HEARTBEAT_INTERVAL);
}
