/**
 * Generate a quote card on chatgpt.com through camofox directly.
 *
 * The chatgpt-webui-mcp server looks for a visible "Create image" button, but
 * ChatGPT moved that option behind the composer's "+" menu — so the MCP flow
 * now returns an empty result. This driver does the same steps by hand:
 *
 *   + -> "Create image" -> type the prompt -> Enter -> wait -> download
 *
 *   node scripts/chatgpt-card.mjs <prompt-file> <out-png>
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

/** Find the ref of the first node matching role+label in the a11y snapshot. */
function findRef(snap, role, labelRe) {
  const lines = snap.split('\n');
  for (const line of lines) {
    const m = line.match(new RegExp(`${role}\\s+"([^"]*)"\\s+\\[(e\\d+)\\]`));
    if (!m) continue;
    if (labelRe.test(m[1])) return m[2];
  }
  return null;
}

const click = (tabId, ref) =>
  api(`/tabs/${tabId}/click`, { method: 'POST', body: JSON.stringify({ userId: USER, ref }) });
/** A click can time out inside camofox while still landing — treat it as soft. */
const clickSafe = async (tabId, payload) => {
  try {
    await api(`/tabs/${tabId}/click`, { method: 'POST', body: JSON.stringify({ userId: USER, ...payload }) });
  } catch (e) {
    console.log(`  (click reported: ${e.message.slice(0, 90)})`);
  }
  await sleep(1500);
};
const press = (tabId, key) =>
  api(`/tabs/${tabId}/press`, { method: 'POST', body: JSON.stringify({ userId: USER, key }) });
const type = (tabId, ref, text) =>
  api(`/tabs/${tabId}/type`, { method: 'POST', body: JSON.stringify({ userId: USER, ref, text }) });
const wait = (tabId, timeout) =>
  api(`/tabs/${tabId}/wait`, { method: 'POST', body: JSON.stringify({ userId: USER, timeout, waitForNetwork: true }) });

async function main() {
  const tab = await api('/tabs', {
    method: 'POST',
    body: JSON.stringify({ userId: USER, sessionKey: SESSION, url: 'https://chatgpt.com/' }),
  });
  const tabId = tab.tabId;
  console.log('tab', tabId);
  try {
    await sleep(6000);

    // 0. always start a NEW chat — chatgpt.com restores the last
    //    conversation, which would answer with the previous card's quote.
    let snap = await snapshot(tabId);
    const newChatRef = findRef(snap, 'link', /new chat/i) ?? findRef(snap, 'button', /new chat/i);
    if (newChatRef) {
      console.log('clicking New chat', newChatRef);
      await clickSafe(tabId, { ref: newChatRef });
      await sleep(4000);
    }

    // 1. open the composer's "+" menu ("Add files and more")
    snap = await snapshot(tabId);
    let ref = findRef(snap, 'button', /add files and more/i);
    if (!ref) {
      console.log('could not find the + button; snapshot tail:\n' + snap.slice(-1500));
      throw new Error('plus_button_not_found');
    }
    console.log('clicking +', ref);
    await clickSafe(tabId, { ref });

    // 2. "Create image" in the menu
    snap = await snapshot(tabId);
    let imgRef =
      findRef(snap, 'button', /create image.*visuali/i) ??
      findRef(snap, 'menuitem', /create image/i) ??
      findRef(snap, 'button', /create image/i) ??
      (snap.match(/-\s*button[^"]*"Create image[^"]*"\s*\[(e\d+)\]/i) ?? [])[1] ??
      null;
    if (!imgRef) {
      console.log('menu snapshot tail:\n' + snap.slice(-2500));
      throw new Error('create_image_item_not_found');
    }
    console.log('clicking Create image', imgRef);
    await clickSafe(tabId, { ref: imgRef });
    await sleep(2000);

    // 2b. verify the image mode is actually on (the composer shows a chip)
    const after = await snapshot(tabId);
    const modeOn = /Create image/i.test(after.split('\n').slice(-40).join('\n'));
    console.log('image mode chip:', modeOn ? 'on' : 'NOT on');
    if (!modeOn) {
      console.log('composer state:\n' + after.split('\n').slice(-18).join('\n'));
    }

    // 3. type the prompt
    snap = await snapshot(tabId);
    const boxRef = findRef(snap, 'textbox', /.*/i);
    if (!boxRef) {
      console.log('no textbox in snapshot:\n' + snap.slice(-2000));
      throw new Error('prompt_textbox_not_found');
    }
    console.log('typing into', boxRef);
    await type(tabId, boxRef, prompt);
    await sleep(2000);

    // 4. send — the image surface has an explicit Send button (Enter does
    //    not submit there).
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

    // 5. wait for the generated image
    const deadline = Date.now() + 600_000;
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
        // the profile avatar is not the artwork
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
      const tail = s.split('\n').slice(-14).join('\n');
      console.log('  … urls:', list.map((i) => String(i?.url ?? '').slice(0, 60)).join(' | ') || '(none)');
      console.log('  … tail:', tail.split('\n').map((l) => l.trim()).join(' / ').slice(0, 220));
    }
    if (!saved) {
      const s = await snapshot(tabId);
      const say = s.split('\n').filter((l) => /said:|paragraph:|heading "/.test(l)).slice(-6).join('\n');
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
