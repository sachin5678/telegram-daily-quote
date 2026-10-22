/**
 * Generate a quote card by EDITING an existing brand card.
 *
 * ChatGPT's image tool currently refuses fresh generations ("please upload the
 * image you want me to edit"), so we give it the target it asks for: one of the
 * existing NEW AGE ALGORITHMS cards, and ask it to keep the design and swap
 * the quote, attribution and background scene.
 *
 *   node scripts/chatgpt-card-edit.mjs <prompt-file> <out-png> [reference.png]
 *
 * The reference image is served from a throwaway loopback HTTP server so the
 * page can fetch it and hand it to the composer as a file upload.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CAMO = process.env.CAMOFOX_BASE_URL ?? 'http://127.0.0.1:9377';
const USER = process.env.CHATGPT_USER_ID ?? 'chatgpt-webui-mcp';
const SESSION = process.env.CHATGPT_SESSION_KEY ?? 'chatgpt-webui';
const COOKIE = readFileSync('C:/Users/Admin/.secrets/chatgpt-session', 'utf8').trim();

const promptFile = process.argv[2];
const outFile = process.argv[3];
const reference = process.argv[4] ?? 'E:/Desktop/YT/telegram-daily-quote/cards/raw/ref-quote-64.jpg';
const prompt = readFileSync(promptFile, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(p, init = {}) {
  const res = await fetch(`${CAMO}${p}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${p} -> ${res.status} ${text.slice(0, 200)}`);
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
const evaluate = (tabId, expression) =>
  api(`/tabs/${tabId}/evaluate`, { method: 'POST', body: JSON.stringify({ userId: USER, expression }) });

/** Inline the reference card as a data URL so the page can build a File. */
function attachSnippet(referencePath) {
  const bytes = readFileSync(referencePath);
  const b64 = bytes.toString('base64');
  const name = path.basename(referencePath);
  return `(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const file = new File([arr], ${JSON.stringify(name)}, { type: 'image/jpeg' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const inputs = Array.from(document.querySelectorAll('input[type=file]'));
  let assigned = null;
  for (const input of inputs) {
    try {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      assigned = 'input';
      break;
    } catch (e) {}
  }
  if (!assigned) {
    const ta = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
    ta.focus();
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    assigned = 'paste';
  }
  return { assigned, inputs: inputs.length, size: file.size };
})()`;
}

async function main() {
  const tab = await api('/tabs', {
    method: 'POST',
    body: JSON.stringify({ userId: USER, sessionKey: SESSION, url: 'https://chatgpt.com/' }),
  });
  const tabId = tab.tabId;
  console.log('tab', tabId, 'reference', reference);
  try {
    await sleep(7000);

    let snap = await snapshot(tabId);
    const newChatRef = findRef(snap, 'link', /new chat/i) ?? findRef(snap, 'button', /new chat/i);
    if (newChatRef) {
      console.log('clicking New chat', newChatRef);
      await clickSafe(tabId, { ref: newChatRef });
      await sleep(4000);
    }

    // attach the reference card
    const attach = await evaluate(tabId, attachSnippet(reference));
    console.log('attach:', JSON.stringify(attach?.result ?? attach));
    await sleep(8000);

    snap = await snapshot(tabId);
    console.log('composer after attach:\n' + snap.split('\n').slice(-16).join('\n'));

    const boxRef = findRef(snap, 'textbox', /.*/i);
    if (!boxRef) throw new Error('prompt_textbox_not_found');
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
    const seen = new Set();
    while (Date.now() < deadline) {
      await sleep(10_000);
      const imgs = await api(
        `/tabs/${tabId}/images?userId=${encodeURIComponent(USER)}&resolveBlobs=true&triggerLazyLoad=true`
      );
      const list = Array.isArray(imgs?.images) ? imgs.images : [];
      for (const img of list) {
        const u = String(img?.url ?? img?.src ?? '');
        const alt = String(img?.alt ?? '');
        if (!u || /auth0\.com\/avatars/.test(u)) continue;
        if (!/Generated image/i.test(alt) && !/(oaiusercontent|estuary|oaidalle|blob\.core\.windows\.net)/i.test(u)) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        console.log('image candidate:', u.slice(0, 110));
        const r = await fetch(u, {
          headers: {
            Cookie: `__Secure-next-auth.session-token=${COOKIE}`,
            Referer: 'https://chatgpt.com/',
            Accept: 'image/*,*/*;q=0.8',
          },
        });
        if (r.ok) {
          const bytes = Buffer.from(await r.arrayBuffer());
          if (bytes.length > 10_000) {
            writeFileSync(outFile, bytes);
            console.log(`saved ${outFile} (${(bytes.length / 1048576).toFixed(2)} MB)`);
            return;
          }
        } else {
          console.log('download failed', r.status);
        }
      }
      const s = await snapshot(tabId);
      const said = s.split('\n').filter((l) => /ChatGPT said:|paragraph:/.test(l)).slice(-2).join(' | ');
      console.log('  … ' + said.slice(0, 240));
    }
    throw new Error('no image within the timeout');
  } finally {
    if (process.env.KEEP_TAB === '1') console.log(`tab kept open: ${tabId}`);
    else await api(`/tabs/${tabId}`, { method: 'DELETE', body: JSON.stringify({ userId: USER }) }).catch(() => {});
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
