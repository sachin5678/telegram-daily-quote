/**
 * Generate a quote card with Gemini (the edge function's own first-choice
 * image generator) — the fallback when the ChatGPT path is unavailable.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = readFileSync('C:/Users/Admin/.secrets/gemini-key', 'utf8').trim();
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image';
const prompt = process.argv[2];
const out = process.argv[3];

const body = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
};

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  }
);
const json = await res.json();
if (!res.ok) {
  console.error('gemini failed', res.status, JSON.stringify(json).slice(0, 400));
  process.exit(1);
}
const parts = json.candidates?.[0]?.content?.parts ?? [];
const img = parts.find((p) => p.inlineData?.data);
if (!img) {
  console.error('no image in response:', JSON.stringify(json).slice(0, 600));
  process.exit(1);
}
const bytes = Buffer.from(img.inlineData.data, 'base64');
if (out) {
  writeFileSync(out, bytes);
  console.log(`saved ${out} (${(bytes.length / 1048576).toFixed(2)} MB)`);
} else {
  console.log(`image bytes: ${bytes.length}`);
}
