/**
 * Upload the new quote cards to Supabase Storage and register them in the
 * `quotes` table so the daily rotation picks them up.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-cards.mjs [--only 65,66]
 *
 * Needs the service-role key (the anon key cannot write). The card for a
 * quote id must be quote-images/quote-<id>.png — the edge function looks it
 * up by exactly that name.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Desktop/YT/telegram-daily-quote';
const URL_BASE = process.env.SUPABASE_URL ?? 'https://ifnaqugtthrpmcikivok.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'quote-images';

if (!KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required (the anon key cannot write to the bucket)');
  process.exit(2);
}

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) ?? '').split('=')[1];
const onlyIds = only ? new Set(only.split(',').map(Number)) : null;
const dry = args.includes('--dry');

const spec = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'cards-batch.json'), 'utf8'));
const cards = spec.cards.filter((c) => !onlyIds || onlyIds.has(c.id));
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let uploaded = 0;
let registered = 0;

for (const card of cards) {
  const file = path.join(ROOT, 'cards', '1080', `quote-${card.id}.png`);
  if (!existsSync(file)) {
    console.log(`quote-${card.id}.png missing — skipped`);
    continue;
  }

  // 1. The card -> storage bucket (upsert).
  const bytes = readFileSync(file);
  const up = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/quote-${card.id}.png`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: bytes,
  });
  const upText = await up.text();
  if (up.ok) {
    uploaded += 1;
    console.log(`uploaded quote-${card.id}.png (${(bytes.length / 1048576).toFixed(1)} MB)`);
  } else {
    console.log(`upload FAILED quote-${card.id}.png -> ${up.status} ${upText.slice(0, 160)}`);
    continue;
  }

  // 2. The quote -> rotation table (id, text, has_image).
  if (dry) {
    console.log(`  [dry] would upsert quotes id=${card.id}`);
    continue;
  }
  const row = { id: card.id, text: card.quote, has_image: true };
  const ins = await fetch(`${URL_BASE}/rest/v1/quotes?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  const insText = await ins.text();
  if (ins.ok) {
    registered += 1;
    console.log(`  quotes row ${card.id} upserted — "${card.quote.slice(0, 48)}…"`);
  } else {
    console.log(`  quotes upsert FAILED ${card.id} -> ${ins.status} ${insText.slice(0, 200)}`);
  }
}

console.log(`\ndone: ${uploaded} card(s) uploaded, ${registered} quote row(s) registered`);
