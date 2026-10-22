/**
 * Write the exact prompt for one card id to a text file.
 *
 *   node scripts/dump-prompt.mjs 65          -> scripts/.prompt-65.txt   (original wording)
 *   node scripts/dump-prompt.mjs 65 --fresh  -> scripts/.prompt-65b.txt  (fresh-generation wording)
 *   node scripts/dump-prompt.mjs 65 --edit   -> scripts/.prompt-65e.txt  (edit an existing card)
 *
 * The "fresh" variant is needed when ChatGPT's image tool mis-routes a
 * generation as an edit and asks for an existing image target.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'E:/Desktop/YT/telegram-daily-quote';
const id = Number(process.argv[2]);
const fresh = process.argv.includes('--fresh');
const edit = process.argv.includes('--edit');
const spec = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'cards-batch.json'), 'utf8'));
const card = spec.cards.find((c) => c.id === id);
if (!card) {
  console.error(`no card with id ${id}`);
  process.exit(1);
}

const style = spec.brand.style
  .map((s) =>
    s
      .replace(/^Square 1:1 premium motivational quote card, 1080x1080\.$/, 'square 1:1 premium motivational quote card poster (1080x1080)')
      .replace(/^Background: /, 'Background: ')
  )
  .map((s) => `- ${s}`);

const prompt = edit
  ? [
      "Keep this card's exact layout, brand logo, wordmark, gold rule, tagline, ivory panel, gold quote mark, serif typography and colour palette.",
      '',
      'Change only the content:',
      `- Replace the quote text with exactly: "${card.quote}"`,
      `- Replace the attribution with exactly: ${card.author.toUpperCase()}`,
      `- Replace the background scene with: ${card.theme}`,
      `- Highlight these words in gold: ${card.gold.join(' and ')}`,
      '',
      'Make sure every word is perfectly spelled and legible, the text sits neatly inside the panel, and nothing else is written on the image.',
    ].join('\n')
  : fresh
  ? [
      'Generate a brand-new image from scratch. This is a fresh generation of a new picture — it is NOT an edit, NOT a modification, and NOT an application of a design to any existing image, photo, canvas or file. No reference image is attached or needed.',
      '',
      `Draw a square 1:1 premium motivational quote card poster (1080x1080).`,
      '',
      'The poster must display this text, spelled exactly as written:',
      `"${card.quote}"`,
      'and, below it, the attribution:',
      card.author.toUpperCase(),
      '',
      'Visual style:',
      ...style,
      `- Highlight these words in gold: ${card.gold.join(' and ')}`,
      '- Typography must be perfectly spelled and legible, generous line spacing, nothing crowded, no watermark, no extra text, no logo of any other brand.',
    ].join('\n')
  : [
      'Create ONE square 1:1 premium motivational quote card image.',
      '',
      'QUOTE (reproduce exactly, these words only):',
      `"${card.quote}"`,
      `ATTRIBUTION (exact): ${card.author}`,
      '',
      `BACKGROUND SCENE: ${card.theme}`,
      `KEY WORDS TO HIGHLIGHT IN GOLD: ${card.gold.join(' | ')}`,
      '',
      'DESIGN:',
      ...spec.brand.style.map((s) => `- ${s}`),
      '',
      'Render the quote text exactly as given, correct spelling, nothing else written on the image.',
    ].join('\n');

const out = path.join(ROOT, 'scripts', `.prompt-${id}${fresh ? 'b' : edit ? 'e' : ''}.txt`);
writeFileSync(out, prompt, 'utf8');
console.log(out);
