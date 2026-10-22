/**
 * Read a few rows from the Supabase `quotes` table with the anon key
 * (read-only probe — the write path needs the service-role key).
 */
import { readFileSync } from 'node:fs';

const env = readFileSync('E:/Desktop/YT/new-age-algos-web/.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1]?.trim();
const key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim();
if (!url || !key) {
  console.error('anon key/url not found in new-age-algos-web/.env.local');
  process.exit(2);
}

const res = await fetch(`${url}/rest/v1/quotes?select=id,text,has_image&order=id&limit=8`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log('status', res.status);
const body = await res.text();
console.log(body.slice(0, 1500));
