/**
 * Diagnostic: dump the current ChatGPT tabs (snapshot text + screenshot) so we
 * can see what the page is actually showing (errors, rate limits, empty
 * responses) instead of guessing.
 *
 *   node scripts/diagnose-tabs.mjs [outDir]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CAMO = process.env.CAMOFOX_BASE_URL ?? 'http://127.0.0.1:9377';
const USER = process.env.CHATGPT_USER_ID ?? 'chatgpt-webui-mcp';
const OUT = process.argv[2] ?? 'C:/Users/Admin/AppData/Local/Temp/kilo/chatgpt-diag';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init = {}) {
  const res = await fetch(`${CAMO}${pathname}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

mkdirSync(OUT, { recursive: true });

const tabs = await api(`/tabs?userId=${encodeURIComponent(USER)}`);
const list = Array.isArray(tabs?.tabs) ? tabs.tabs : [];
console.log('tabs:', list.map((t) => `${t.tabId} ${t.url}`).join('\n      '));

for (const t of list) {
  const id = t.tabId ?? t.id;
  const safe = String(id).slice(0, 8);
  try {
    const snap = await api(`/tabs/${id}/snapshot?userId=${encodeURIComponent(USER)}`);
    writeFileSync(path.join(OUT, `tab-${safe}.txt`), String(snap?.snapshot ?? ''), 'utf8');
    console.log(`snapshot -> tab-${safe}.txt (${String(snap?.snapshot ?? '').length} chars)`);
  } catch (e) {
    console.log(`snapshot failed for ${safe}: ${e.message}`);
  }
  try {
    const png = await fetch(`${CAMO}/tabs/${id}/screenshot?userId=${encodeURIComponent(USER)}`);
    if (png.ok) {
      const buf = Buffer.from(await png.arrayBuffer());
      writeFileSync(path.join(OUT, `tab-${safe}.png`), buf);
      console.log(`screenshot -> tab-${safe}.png (${(buf.length / 1024).toFixed(0)} KB)`);
    } else {
      console.log(`screenshot failed for ${safe}: ${png.status}`);
    }
  } catch (e) {
    console.log(`screenshot error for ${safe}: ${e.message}`);
  }
  await sleep(500);
}
console.log('out:', OUT);
