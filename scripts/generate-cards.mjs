/**
 * Generate quote cards through OUR ChatGPT (chatgpt-webui-mcp -> camofox ->
 * chatgpt.com), then resize to exactly 1080x1080 — the same pipeline that
 * produced cards 59-64.
 *
 *   node scripts/generate-cards.mjs [--only 65,66] [--dry]
 *
 * The MCP server drops the raw image into
 * C:\Users\Admin\.chatgpt-webui-mcp\images\chatgpt-image-*.png; this script
 * picks the newest one, resizes it and writes cards/1080/quote-<id>.png.
 */
import { readFileSync, readdirSync, statSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = 'E:/Desktop/YT/telegram-daily-quote';
const MCP_PKG = 'C:/Users/Admin/AppData/Roaming/npm/node_modules/chatgpt-webui-mcp';
const MCP_SDK = `${MCP_PKG}/node_modules/@modelcontextprotocol/sdk`;

// The MCP SDK ships inside the globally installed chatgpt-webui-mcp; import it
// from there so this project needs no new dependency.
const { Client } = await import(pathToFileURL(`${MCP_SDK}/dist/esm/client/index.js`).href);
const { StdioClientTransport } = await import(pathToFileURL(`${MCP_SDK}/dist/esm/client/stdio.js`).href);
const RAW_DIR = 'C:/Users/Admin/.chatgpt-webui-mcp/images';
const OUT_DIR = path.join(ROOT, 'cards', '1080');

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1];
const onlyIds = only ? new Set(only.split(',').map(Number)) : null;
const dry = args.includes('--dry');
const limit = Number((args.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] ?? 99);

const spec = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'cards-batch.json'), 'utf8'));
const cards = spec.cards.filter((c) => !onlyIds || onlyIds.has(c.id)).slice(0, limit);

const token = readFileSync('C:/Users/Admin/.secrets/chatgpt-session', 'utf8').trim();

/** The prompt that produces the card. */
function buildPrompt(card) {
  return [
    `Create ONE square 1:1 premium motivational quote card image.`,
    '',
    `QUOTE (reproduce exactly, these words only):`,
    `"${card.quote}"`,
    `ATTRIBUTION (exact): ${card.author}`,
    '',
    `BACKGROUND SCENE: ${card.theme}`,
    `KEY WORDS TO HIGHLIGHT IN GOLD: ${card.gold.join(' | ')}`,
    '',
    'DESIGN:',
    ...spec.brand.style.map((s) => `- ${s}`),
    '',
    `Render the quote text exactly as given, correct spelling, nothing else written on the image.`,
  ].join('\n');
}

const newestRaw = () => {
  const files = readdirSync(RAW_DIR)
    .filter((f) => f.startsWith('chatgpt-image-') && f.endsWith('.png'))
    .map((f) => ({ f, t: statSync(path.join(RAW_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files.length ? path.join(RAW_DIR, files[0].f) : null;
};

/** Resize to exactly 1080x1080 (same as scripts/resize-cards.ps1). */
function resize1080(src, dest) {
  const ps = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("${src}")
$bmp = New-Object System.Drawing.Bitmap(1080, 1080)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.DrawImage($img, 0, 0, 1080, 1080)
$g.Dispose()
$bmp.Save("${dest}", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$img.Dispose()
Write-Output "ok"
`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  if (!out.includes('ok')) throw new Error(`resize failed: ${out}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [`${MCP_PKG}/dist/index.js`],
    env: {
      ...process.env,
      CHATGPT_SESSION_TOKEN: token,
      CHATGPT_TRANSPORT: 'camofox',
      CHATGPT_BROWSER_BASE_URL: 'http://127.0.0.1:9377',
      CHATGPT_USER_ID: 'chatgpt-webui-mcp',
      CHATGPT_SESSION_KEY: 'chatgpt-webui',
      CHATGPT_WORKSPACE: 'PRO',
    },
    stderr: 'pipe',
  });

  const client = new Client({ name: 'card-generator', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  console.log('mcp connected');

  for (const card of cards) {
    const out = path.join(OUT_DIR, `quote-${card.id}.png`);
    if (existsSync(out) && !dry) {
      console.log(`quote-${card.id}.png already exists — skipping`);
      continue;
    }
    const before = newestRaw();
    console.log(`\n=== quote-${card.id}: ${card.quote.slice(0, 60)}... (${card.author})`);
    const t0 = Date.now();

    // chatgpt.com can be slow to load and camofox's navigate/snapshot timeout
    // is 30s, so a failed attempt is usually transient — retry with a pause.
    let text = '';
    let raw = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await client.callTool(
        {
          name: 'chatgpt_webui_prompt',
          arguments: {
            prompt: buildPrompt(card),
            create_image: true,
            model_mode: 'auto',
            workspace: 'PRO',
            mode: 'wait',
            wait_timeout_ms: 900_000,
          },
        },
        undefined,
        { timeout: 1_200_000 }
      );
      text = (res.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      console.log(`[attempt ${attempt}] ${text.slice(0, 300).replace(/\n+/g, ' | ')}`);
      if (!text.trim()) console.log(`  raw: ${JSON.stringify(res).slice(0, 400)}`);
      raw = text.match(/saved to:\s*(.+)$/im)?.[1]?.trim();
      if (raw) {
        raw = raw.replace(/\//g, path.sep);
        if (!existsSync(raw)) raw = null;
      }
      if (raw) break;
      if (attempt < 5) {
        console.log(`  retrying in ${45}s…`);
        await new Promise((r) => setTimeout(r, 45_000));
      }
    }
    console.log(`took ${((Date.now() - t0) / 1000).toFixed(0)}s`);

    if (!raw) {
      raw = newestRaw();
      if (raw && raw === before) raw = null;
      if (raw) console.log(`(fallback) ${path.basename(raw)}`);
    }
    if (!raw) {
      console.log(`quote-${card.id}: NO IMAGE produced`);
      continue;
    }
    console.log(`raw: ${path.basename(raw)}`);
    if (!dry) {
      const dest = path.join(OUT_DIR, `quote-${card.id}.png`);
      resize1080(raw, dest);
      console.log(`saved ${dest}`);
    }
    // Let the browser settle before the next card.
    await new Promise((r) => setTimeout(r, 8000));
  }

  await client.close();
  console.log('\ndone');
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
