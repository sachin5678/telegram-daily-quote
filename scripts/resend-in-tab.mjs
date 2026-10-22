/**
 * Resend a prompt inside an existing ChatGPT tab and download the generated
 * image. ChatGPT's image tool sometimes mis-routes a fresh generation as an
 * "edit target" and asks for the same prompt to be sent again — this script
 * does exactly that, in the same conversation.
 *
 *   node scripts/resend-in-tab.mjs <tabId> <prompt-file> <out-png>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CAMO = process.env.CAMOFOX_BASE_URL ?? 'http://127.0.0.1:9377';
const USER = process.env.CHATGPT_USER_ID ?? 'chatgpt-webui-mcp';
const COOKIE = readFileSync('C:/Users/Admin/.secrets/chatgpt-session', 'utf8').trim();

const tabId = process.argv[2];
const prompt = readFileSync(process.argv[3], 'utf8');
const outFile = process.argv[4];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${CAMO}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const snapshot = async () => {
  const j = await api(`/tabs/${tabId}/snapshot?userId=${encodeURIComponent(USER)}`);
  return String(j?.snapshot ?? '');
};

function findRef(snap, role, labelRe) {
  for (const line of snap.split('\n')) {
    const m = line.match(new RegExp(`${role}\\s+"([^"]*)"\\s+\\[(e\\d+)\\]`));
    if (!m) continue;
    if (labelRe.test(m[1])) return m[2];
  }
  return null;
}

const clickSafe = async (payload) => {
  try {
    await api(`/tabs/${tabId}/click`, { method: 'POST', body: JSON.stringify({ userId: USER, ...payload }) });
  } catch (e) {
    console.log(`  (click reported: ${e.message.slice(0, 90)})`);
  }
  await sleep(1500);
};

const type = (ref, text) =>
  api(`/tabs/${tabId}/type`, { method: 'POST', body: JSON.stringify({ userId: USER, ref, text }) });
const press = (key) =>
  api(`/tabs/${tabId}/press`, { method: 'POST', body: JSON.stringify({ userId: USER, key }) });

async function main() {
  const snap0 = await snapshot();
  const boxRef = findRef(snap0, 'textbox', /.*/i);
  if (!boxRef) throw new Error('prompt_textbox_not_found');
  console.log('typing into', boxRef);
  await type(boxRef, prompt);
  await sleep(2000);

  const snap = await snapshot();
  const sendRef = findRef(snap, 'button', /^send$/i);
  if (sendRef) {
    console.log('clicking Send', sendRef);
    await clickSafe({ ref: sendRef });
  } else {
    console.log('no Send button — pressing Enter');
    await press('Enter');
  }
  console.log('resent — waiting for the image…');

  const deadline = Date.now() + 600_000;
  const seen = new Set();
  while (Date.now() < deadline) {
    await sleep(10_000);
    const imgs = await api(
      `/tabs/${tabId}/images?userId=${encodeURIComponent(USER)}&resolveBlobs=true&triggerLazyLoad=true`
    );
    const list = Array.isArray(imgs?.images) ? imgs.images : [];
    for (const img of list) {
      const url = String(img?.url ?? img?.src ?? '');
      const alt = String(img?.alt ?? '');
      if (!url || /auth0\.com\/avatars/.test(url)) continue;
      if (!/Generated image/i.test(alt) && !/(oaiusercontent|estuary|oaidalle|blob\.core\.windows\.net)/i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      console.log('image candidate:', url.slice(0, 120));
      const res = await fetch(url, {
        headers: {
          Cookie: `__Secure-next-auth.session-token=${COOKIE}`,
          Referer: 'https://chatgpt.com/',
          Accept: 'image/*,*/*;q=0.8',
        },
      });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 10_000) {
          writeFileSync(outFile, bytes);
          console.log(`saved ${outFile} (${(bytes.length / 1048576).toFixed(2)} MB)`);
          return;
        }
      } else {
        console.log('download failed', res.status);
      }
    }
    const s = await snapshot();
    const said = s.split('\n').filter((l) => /ChatGPT said:|paragraph:/.test(l)).slice(-2).join(' | ');
    console.log('  … ' + said.slice(0, 260));
  }
  throw new Error('no image within the timeout');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
