#!/usr/bin/env node
/* restore-session.mjs -------------------------------------------------------
 * Rebuilds the GramJS session store from the TELEGRAM_SESSION secret so the
 * script can send as the same user account it does locally.
 *
 * Writes, under the home directory:
 *   <SESSION_NAME>/encodeURIComponent(<SESSION_NAME>:authKey)  (and dcId, port,
 *   serverAddress) — exactly the file names StoreSession looks for on this
 *   platform (path.sep differs between the Windows export and the Linux CI run,
 *   so names are computed here, values are copied verbatim).
 *
 * Usage: node scripts/restore-session.mjs [--out <dir>]
 * ------------------------------------------------------------------------- */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SESSION_NAME = [".mcp-telegram", "sessions", "1718604740"].join(path.sep);

const outFlag = process.argv.indexOf("--out");
const baseDir = outFlag > -1 ? process.argv[outFlag + 1] : os.homedir();

const b64 = process.env.TELEGRAM_SESSION;
if (!b64) {
  console.error("TELEGRAM_SESSION is not set (CI: it lives in DAILY_QUOTE_ENV).");
  process.exit(2);
}

let values;
try {
  values = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
} catch {
  console.error("TELEGRAM_SESSION is not valid base64 JSON.");
  process.exit(2);
}

const sessionDir = path.join(baseDir, SESSION_NAME);
fs.mkdirSync(sessionDir, { recursive: true });

let written = 0;
for (const [key, value] of Object.entries(values)) {
  const file = path.join(sessionDir, encodeURIComponent(`${SESSION_NAME}:${key}`));
  fs.writeFileSync(file, Buffer.from(value, "base64"));
  written++;
}
console.log(`Restored ${written} session file(s) into ${sessionDir}`);
