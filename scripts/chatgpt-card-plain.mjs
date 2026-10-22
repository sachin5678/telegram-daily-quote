/**
 * Generate a quote card on chatgpt.com through camofox WITHOUT the composer's
 * "Create image" chip.
 *
 * With the chip on, ChatGPT treats the request as an image edit and replies
 * "Please upload or identify the image you want me to modify." — so the
 * prompt goes through the normal composer and the model is asked to generate
 * the image itself.
 *
 *   node scripts/chatgpt-card-plain.mjs <prompt-file> <out-png>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CAMO = process.env.CAMOFOX_BASE_URL ?? 'http://127.0.0.1:9377';
const USER = process.env.CHATGPT_USER_ID ?? 'chatgpt-webui-mcp';
const SESSION = process.env.CHATGPT_SESSION_KEY ?? 'chatgpt-webui';
const COOKIE = readFileSync('C:/Users/Admin/.secrets/chatgpt-session', 'utf8').trim();

const promptFile = process.argv[2];
const outFile = process.argv[3];
const prompt = readFileSync(promptFile, 'utf8');

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

const snapshot = async (tabId) => {
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

const clickSafe = async (tabId, payload) => {
  try {
    await api(`/tabs/${tabId}/click`, { method: 'POST', body: JSON.stringify({ userId: USER, ...payload }) });
  } catch (e) {
    console.log(`  (click reported: ${e.message.slice(0, 90)})`);
  }
  await sleep(1500);
};

const type = (tabId, ref, text) =>
  api(`/tabs/${tabId}/type`, { method: 'POST', body: JSON.stringify({ userId: USER, ref, text }) });
const press = (tabId, key) =>
  api(`/tabs/${tabId}/press`, { method: 'POST', body: JSON.stringify({ userId: USER, key }) });

async function main() {
  const tab = await api('/tabs', {
    method: 'POST',
    body: JSON.stringify({ userId: USER, sessionKey: SESSION, url: 'https://chatgpt.com/' }),
  });
  const tabId = tab.tabId;
  console.log('tab', tabId);
  try {
    await sleep(7000);

    let snap = await snapshot(tabId);
    const newChatRef = findRef(snap, 'link', /new chat/i) ?? findRef(snap, 'button', /new chat/i);
    if (newChatRef) {
      console.log('clicking New chat', newChatRef);
      await clickSafe(tabId, { ref: newChatRef });
      await sleep(4000);
    }

    snap = await snapshot(tabId);
    const boxRef = findRef(snap, 'textbox', /.*/i);
    if (!boxRef) {
      console.log('no textbox in snapshot:\n' + snap.slice(-2000));
      throw new Error('prompt_textbox_not_found');
    }
    console.log('typing into', boxRef);
    await type(tabId, boxRef, prompt);
    await sleep(2000);

    snap = await snapshot(tabId);
    const sendRef = findRef(snap, 'button', /^send$/i);
    if (sendRef) {
      console.log('clicking Send', sendRef);
      await clickSafe(tabId, { ref: sendRef });
    } else {
      console.log('no Send button — pressing Enter');
      await press(tabId, 'Enter');
    }
    console.log('sent — waiting for the image…');

    const deadline = Date.now() + Number(process.env.MAX_WAIT_MS ?? 600_000);
    let saved = false;
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
            saved = true;
            break;
          }
        } else {
          console.log('download failed', res.status);
        }
      }
      if (saved) break;
      const s = await snapshot(tabId);
      const said = s
        .split('\n')
        .filter((l) => /ChatGPT said:|paragraph:/.test(l))
        .slice(-3)
        .join(' | ');
      console.log('  … ' + said.slice(0, 300));
    }
    if (!saved) {
      const s = await snapshot(tabId);
      const say = s.split('\n').filter((l) => /ChatGPT said:|paragraph:/.test(l)).slice(-6).join('\n');
      console.log('CONVERSATION TAIL:\n' + say);
      throw new Error('no image within the timeout');
    }
  } finally {
    if (process.env.KEEP_TAB === '1') console.log(`tab kept open: ${tabId}`);
    else await api(`/tabs/${tabId}`, { method: 'DELETE', body: JSON.stringify({ userId: USER }) }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
