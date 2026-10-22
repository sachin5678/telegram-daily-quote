/**
 * Retry the missing cards through ChatGPT until they come out (or we give up).
 *
 *   node scripts/retry-cards.mjs 65,69 [attempts] [gapSeconds]
 *
 * Each attempt runs the plain-composer driver; on success the raw download is
 * resized to exactly 1080x1080 into cards/1080/quote-<id>.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Desktop/YT/telegram-daily-quote';
const OUT_DIR = path.join(ROOT, 'cards', '1080');
const RAW_DIR = path.join(ROOT, 'cards', 'raw');

const ids = (process.argv[2] ?? '65,69').split(',').map(Number);
const attempts = Number(process.argv[3] ?? 4);
const gap = Number(process.argv[4] ?? 240) * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

for (const id of ids) {
  const dest = path.join(OUT_DIR, `quote-${id}.png`);
  if (existsSync(dest)) {
    console.log(`quote-${id}.png already exists`);
    continue;
  }
  const promptFile = path.join(ROOT, 'scripts', `.prompt-${id}b.txt`);
  if (!existsSync(promptFile)) {
    console.log(`no prompt file for ${id} — skipping`);
    continue;
  }
  const raw = path.join(RAW_DIR, `quote-${id}-raw.png`);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    console.log(`\n### quote-${id} attempt ${attempt}/${attempts}`);
    try {
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'chatgpt-card-plain.mjs'), promptFile, raw],
        { stdio: 'inherit', cwd: ROOT, timeout: 700_000 }
      );
    } catch (e) {
      console.log(`attempt ${attempt} failed: ${String(e.message).slice(0, 120)}`);
    }
    if (existsSync(raw)) {
      resize1080(raw, dest);
      console.log(`SAVED ${dest}`);
      break;
    }
    if (attempt < attempts) {
      console.log(`waiting ${gap / 1000}s before the next attempt…`);
      await sleep(gap);
    }
  }
}
console.log('retry-cards done');
