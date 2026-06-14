import * as jose from "@panva/jose";
import { connectDB } from "./db.js";
import { log } from "./logging.js";

const db = connectDB();

db.exec(`CREATE TABLE IF NOT EXISTS _node_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  private_jwk TEXT NOT NULL,
  public_jwk TEXT NOT NULL
)`);

let _privateKey, _publicKey, _publicJwk;

export async function initKeys() {
  const row = db
    .prepare(`SELECT private_jwk, public_jwk FROM _node_keys WHERE id = 1`)
    .value();
  if (row) {
    _privateKey = await jose.importJWK(JSON.parse(row[0]), "ES256");
    _publicKey = await jose.importJWK(JSON.parse(row[1]), "ES256");
    _publicJwk = JSON.parse(row[1]);
  } else {
    const { privateKey, publicKey } = await jose.generateKeyPair("ES256", {
      extractable: true,
    });
    const privateJwk = await jose.exportJWK(privateKey);
    const publicJwk = await jose.exportJWK(publicKey);
    db.exec(
      `INSERT INTO _node_keys (id, private_jwk, public_jwk) VALUES (1, ?, ?)`,
      [JSON.stringify(privateJwk), JSON.stringify(publicJwk)],
    );
    _privateKey = privateKey;
    _publicKey = publicKey;
    _publicJwk = publicJwk;
  }
  log("Node keypair ready", "gray");
}

export function getPrivateKey() {
  return _privateKey;
}
export function getPublicKey() {
  return _publicKey;
}
export function getPublicJwk() {
  return _publicJwk;
}

// Verify a token using local key
export async function verifyToken(token) {
  const key = getPublicKey();
  const { payload } = await jose.jwtVerify(token, key);
  if (payload.exp < Date.now() / 1000) throw new Error("Token expired");
  return payload;
}
