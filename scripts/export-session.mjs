#!/usr/bin/env node
/* export-session.mjs --------------------------------------------------------
 * Builds `daily-quote.env` — the single file you paste into the GitHub
 * repository secret DAILY_QUOTE_ENV. It contains:
 *
 *   TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_TARGET_GROUP
 *   TELEGRAM_SESSION  — base64 JSON of the 4 essential GramJS session values
 *                       (authKey, dcId, port, serverAddress). Entity caches are
 *                       deliberately excluded: they are rebuildable and would
 *                       blow past GitHub's 48 KB secret limit (full store is
 *                       1220 files / 108 KB; this export is ~3 KB).
 *
 * Usage:  npm run export          (values read from .env or the environment)
 * ------------------------------------------------------------------------- */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSION_NAME = [".mcp-telegram", "sessions", "1718604740"].join(path.sep);
const KEYS = ["authKey", "dcId", "port", "serverAddress"];
const OUT = "daily-quote.env";

// --- read config from env, falling back to .env -----------------------------
function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const fromFile = readDotEnv(".env");
const pick = (k) => process.env[k] || fromFile[k] || "";

const apiId = pick("TELEGRAM_API_ID");
const apiHash = pick("TELEGRAM_API_HASH");
const target = pick("TELEGRAM_TARGET_GROUP");

for (const [k, v] of [["TELEGRAM_API_ID", apiId], ["TELEGRAM_API_HASH", apiHash], ["TELEGRAM_TARGET_GROUP", target]]) {
  if (!v) console.warn(`WARN: ${k} is empty — fill it in ${OUT} before pasting.`);
}

// --- read the essential session values --------------------------------------
const sessionDir = path.join(os.homedir(), SESSION_NAME);
const values = {};
for (const key of KEYS) {
  const file = path.join(sessionDir, encodeURIComponent(`${SESSION_NAME}:${key}`));
  if (!fs.existsSync(file)) {
    console.error(`Missing session file: ${file}`);
    console.error("Log in first (npx mcp-telegram login), then re-run.");
    process.exit(1);
  }
  values[key] = fs.readFileSync(file).toString("base64");
}

const sessionB64 = Buffer.from(JSON.stringify(values)).toString("base64");

const body = [
  `TELEGRAM_API_ID=${apiId}`,
  `TELEGRAM_API_HASH=${apiHash}`,
  `TELEGRAM_TARGET_GROUP=${target}`,
  `TELEGRAM_SESSION=${sessionB64}`,
  "",
].join("\n");

fs.writeFileSync(OUT, body, { mode: 0o600 });
console.log(`Wrote ${OUT} (${body.length} bytes) — paste its 4 lines into the`);
console.log(`GitHub repo secret DAILY_QUOTE_ENV (Settings > Secrets > Actions).`);
console.log(`It is gitignored; never commit it.`);
