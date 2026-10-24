// Tiny JSON-file store. Good enough for a hackathon demo; swap for Postgres in production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const defaultDataDir = process.env.VERCEL ? path.join(os.tmpdir(), "proofpay-data") : "data";
export const DATA_DIR = path.resolve(process.env.DATA_DIR || defaultDataDir);
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const FILE = path.join(DATA_DIR, "db.json");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let state = { projects: {}, evidenceHashes: {} };
if (fs.existsSync(FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    state = { projects: {}, evidenceHashes: {} };
  }
}

export function getState() {
  return state;
}

export function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

// Serialises work per key so a double-click can never release the same milestone twice.
const locks = new Map();
export async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((r) => (release = r));
  const chained = prev.then(() => next);
  locks.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chained) locks.delete(key);
  }
}
