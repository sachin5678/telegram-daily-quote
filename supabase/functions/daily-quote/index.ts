// Supabase Edge Function: daily-quote (deployed version: 7, verify_jwt=false)
// Pulled from the live deployment for version control on 2026-10-05.
//
// SECRETS NOTE: the shared secret was REDACTED for this public repo
// (deployed copy has the value inline). To deploy this exact file:
//   supabase secrets set DAILY_QUOTE_SECRET=<value>
// Bot token / chat id / API keys are NOT in this file - they arrive in the
// request body from public.send_daily_quote(), which reads table app_secrets.
//
// Flow: pg_cron (Mon-Sat 08:00 IST) -> public.send_daily_quote() -> this
// function -> stored card from quote-images/quote-{id}.png (1080x1080) ->
// generateImage chain (Gemini -> Pollinations -> OpenAI) as fallback ->
// text-only fallback -> Telegram sendPhoto/sendMessage.

import jpegjs from "npm:jpeg-js";

const SECRET = Deno.env.get("DAILY_QUOTE_SECRET") ?? "";

// ===================== Pure-TS PNG codec (no native deps) =====================
interface Bitmap { w: number; h: number; data: Uint8Array }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function zlibInflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const s = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const s = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

async function decodePNG(png: Uint8Array): Promise<Bitmap> {
  if (png.length < 8 || png[0] !== 137 || png[1] !== 80) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idats: Uint8Array[] = [];
  let plte: Uint8Array | null = null;
  while (pos + 8 <= png.length) {
    const len = u32(png, pos);
    const t = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7]);
    const ds = pos + 8;
    if (t === "IHDR") {
      width = u32(png, ds); height = u32(png, ds + 4);
      bitDepth = png[ds + 8]; colorType = png[ds + 9]; interlace = png[ds + 12];
    } else if (t === "IDAT") {
      idats.push(png.slice(ds, ds + len));
    } else if (t === "PLTE") {
      plte = png.slice(ds, ds + len);
    } else if (t === "IEND") {
      break;
    }
    pos = ds + len + 4;
  }
  if (!width || !height) throw new Error("missing IHDR");
  if (bitDepth !== 8 || interlace !== 0) throw new Error("unsupported PNG depth/interlace: " + bitDepth + "/" + interlace);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 3 ? 1 : 1;
  const raw = await zlibInflate(concat(idats));
  const stride = width * ch;
  const un = new Uint8Array(stride * height);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    const line = un.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? un.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const rv = raw[rp + x];
      const a = x >= ch ? line[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v: number;
      if (f === 0) v = rv;
      else if (f === 1) v = rv + a;
      else if (f === 2) v = rv + b;
      else if (f === 3) v = rv + ((a + b) >> 1);
      else if (f === 4) v = rv + paeth(a, b, c);
      else throw new Error("bad PNG filter " + f);
      line[x] = v & 0xff;
    }
    rp += stride;
  }
  const rgba = new Uint8Array(width * height * 4);
  if (colorType === 6) {
    rgba.set(un);
  } else {
    for (let i = 0, p = 0; i < width * height; i++) {
      if (colorType === 2) {
        rgba[i * 4] = un[p]; rgba[i * 4 + 1] = un[p + 1]; rgba[i * 4 + 2] = un[p + 2]; rgba[i * 4 + 3] = 255; p += 3;
      } else if (colorType === 0) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = un[p]; rgba[i * 4 + 3] = 255; p += 1;
      } else if (colorType === 4) {
        rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = un[p]; rgba[i * 4 + 3] = un[p + 1]; p += 2;
      } else if (colorType === 3) {
        if (!plte) throw new Error("palette PNG missing PLTE");
        const idx = un[p++] * 3;
        rgba[i * 4] = plte[idx]; rgba[i * 4 + 1] = plte[idx + 1]; rgba[i * 4 + 2] = plte[idx + 2]; rgba[i * 4 + 3] = 255;
      } else {
        throw new Error("unsupported colorType " + colorType);
      }
    }
  }
  return { w: width, h: height, data: rgba };
}

function resizeRGBA(src: Bitmap, dw: number, dh: number): Bitmap {
  const sw = src.w, sh = src.h, s = src.data;
  const d = new Uint8Array(dw * dh * 4);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    let sy = (y + 0.5) * yr - 0.5;
    if (sy < 0) sy = 0; if (sy > sh - 1) sy = sh - 1;
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, sh - 1), fy = sy - y0;
    for (let x = 0; x < dw; x++) {
      let sx = (x + 0.5) * xr - 0.5;
      if (sx < 0) sx = 0; if (sx > sw - 1) sx = sw - 1;
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, sw - 1), fx = sx - x0;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const i00 = (y0 * sw + x0) * 4 + c, i01 = (y0 * sw + x1) * 4 + c;
        const i10 = (y1 * sw + x0) * 4 + c, i11 = (y1 * sw + x1) * 4 + c;
        const top = s[i00] * (1 - fx) + s[i01] * fx;
        const bot = s[i10] * (1 - fx) + s[i11] * fx;
        const v = top * (1 - fy) + bot * fy + 0.5;
        d[o + c] = v > 255 ? 255 : v;
      }
    }
  }
  return { w: dw, h: dh, data: d };
}

async function encodePNG(bmp: Bitmap): Promise<Uint8Array> {
  const stride = bmp.w * 4;
  const raw = new Uint8Array((stride + 1) * bmp.h);
  for (let y = 0; y < bmp.h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(bmp.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = await zlibDeflate(raw);
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(bmp.w), 0);
  ihdr.set(be32(bmp.h), 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const out = new Uint8Array(12 + data.length);
  out.set(be32(data.length), 0);
  out.set(tb, 4);
  out.set(data, 8);
  out.set(be32(crc32(concat([tb, data]))), 8 + data.length);
  return out;
}

async function to1080(png: Uint8Array): Promise<Uint8Array> {
  const bmp = await decodePNG(png);
  const resized = resizeRGBA(bmp, 1080, 1080);
  return await encodePNG(resized);
}

async function ensure1080(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x47) return await to1080(data);
  if (data[0] === 0xff && data[1] === 0xd8) {
    const d = jpegjs.decode(data, { useTArray: true, formatAsRGBA: true });
    const bmp = { w: d.width, h: d.height, data: d.data as Uint8Array };
    return await encodePNG(resizeRGBA(bmp, 1080, 1080));
  }
  return data;
}

// ===================== Telegram + OpenAI =====================
function captionImage(): string {
  return "\u2600\ufe0f Good Morning!\n\n\ud83d\udca1 Have a great day ahead!";
}

function captionText(q: string): string {
  return "\u2600\ufe0f Good Morning!\n\n\"" + q + "\"\n\n\ud83d\udca1 Have a great day ahead!";
}

function imagePrompt(q: string): string {
  return "Premium square 1:1 social media quote card for a trading and finance audience. " +
    "Dark navy charcoal background with a subtle gold candlestick chart silhouette and faint grid lines, " +
    "thin elegant gold divider accents, minimalist luxury magazine style, modern sans-serif typography in crisp white, " +
    "quote text centered and clearly readable, generous margins, high contrast, no watermark, no logos, no faces. " +
    "Render this exact quote text: \"" + q + "\"";
}

async function generateImage(openaiKey: string, geminiKey: string, geminiModel: string, quote: string): Promise<Uint8Array> {
  const errors: string[] = [];

  // 1) Gemini (Google AI Studio free tier) — best quality + readable quote text
  if (geminiKey && geminiKey.startsWith("AIza")) {
    try {
      const gres = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent", {
        method: "POST",
        headers: { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: imagePrompt(quote) }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        }),
      });
      if (gres.ok) {
        const gj = await gres.json();
        const cand = gj && gj.candidates && gj.candidates[0];
        const parts = (cand && cand.content && cand.content.parts) || [];
        for (const part of parts) {
          if (part.inlineData && part.inlineData.data) {
            const bin = atob(part.inlineData.data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            if (bytes.length > 10000) return bytes;
          }
        }
        errors.push("gemini: no image in response");
      } else {
        errors.push("gemini -> " + gres.status + ": " + (await gres.text()).slice(0, 250));
      }
    } catch (e) {
      errors.push("gemini -> " + String((e && e.message) || e));
    }
  }

  // 2) FREE fallback: Pollinations.ai (no key, no credits; returns JPEG)
  try {
    const seed = Math.floor(Math.random() * 1000000);
    const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(imagePrompt(quote)) +
      "?width=1080&height=1080&nologo=true&seed=" + seed;
    const res = await fetch(url, { headers: { "User-Agent": "daily-quote-bot/1.0" } });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 10000 && bytes[0] === 0xff && bytes[1] === 0xd8) return bytes;
    }
  } catch (_e) { /* fall through */ }

  // 3) OpenAI fallback (only if free sources failed)
  const attempts = [
    { model: "gpt-image-1", size: "1024x1024", quality: "medium" },
    { model: "gpt-image-1.5", size: "1024x1024", quality: "medium" },
  ];
  for (const a of attempts) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ prompt: imagePrompt(quote), n: 1 }, a)),
    });
    if (res.ok) {
      const j = await res.json();
      const d = j && j.data && j.data[0];
      if (d && d.b64_json) {
        const bin = atob(d.b64_json);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      if (d && d.url) {
        const ir = await fetch(d.url);
        if (ir.ok) return new Uint8Array(await ir.arrayBuffer());
        errors.push(a.model + ": image url download failed " + ir.status);
      } else {
        errors.push(a.model + ": no image data in response");
      }
    } else {
      errors.push(a.model + " -> " + res.status + ": " + (await res.text()).slice(0, 250));
    }
  }
  throw new Error(errors.join(" || "));
}

async function sendPhoto(token: string, chat: string, png: Uint8Array, cap: string) {
  const form = new FormData();
  form.append("chat_id", chat);
  form.append("photo", new Blob([png], { type: "image/png" }), "quote.png");
  form.append("caption", cap);
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendPhoto", { method: "POST", body: form });
  return { status: res.status, body: (await res.text()).slice(0, 500) };
}

async function sendText(token: string, chat: string, text: string) {
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text }),
  });
  return { status: res.status, body: (await res.text()).slice(0, 500) };
}

function proceduralBitmap(): Bitmap {
  const w = 256, h = 256;
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.floor(x * 255 / w);
      d[i + 1] = 40;
      d[i + 2] = Math.floor(y * 255 / h);
      d[i + 3] = 255;
    }
  }
  return { w, h, data: d };
}

const BUCKET_URL = "https://ifnaqugtthrpmcikivok.supabase.co/storage/v1/object/public/quote-images/";

async function fetchStoredImage(quoteId: string): Promise<Uint8Array | null> {
  if (!quoteId || !/^[0-9]+$/.test(quoteId)) return null;
  try {
    const res = await fetch(BUCKET_URL + "quote-" + quoteId + ".png");
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 10000) return bytes;
    }
  } catch (_e) { /* fall through */ }
  return null;
}

// ===================== Handler =====================
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  let p: Record<string, string>;
  try { p = await req.json(); } catch { return new Response("invalid json", { status: 400 }); }
  if (!p || p.secret !== SECRET) return new Response("unauthorized", { status: 401 });

  const chat = String(p.chat_id || "");
  const token = String(p.bot_token || "");
  if (!chat || !token) return new Response("missing fields", { status: 400 });

  if (p.test_image) {
    try {
      const tsrc = await encodePNG(proceduralBitmap());
      const out = await to1080(tsrc);
      const check = await decodePNG(out);
      const r = await sendPhoto(token, chat, out, "Daily-quote image pipeline self-test - resize to " + check.w + "x" + check.h + " OK");
      return Response.json({ mode: "test-image", width: check.w, height: check.h, telegram_status: r.status });
    } catch (e) {
      return Response.json({ mode: "test-image", error: String((e && e.message) || e) }, { status: 500 });
    }
  }

  const quote = String(p.quote || "");
  if (!quote) return new Response("missing fields", { status: 400 });
  const quoteId = String(p.quote_id || "");
  const openaiKey = String(p.openai_key || "");
  const geminiKey = String(p.gemini_key || "");
  const geminiModel = String(p.gemini_model || "gemini-2.5-flash-image");

  let mode = "text";
  let source = "";
  let reason = "";

  // 1) Premium card already stored in Supabase Storage
  try {
    const stored = await fetchStoredImage(quoteId);
    if (stored) {
      const png = await ensure1080(stored);
      const r = await sendPhoto(token, chat, png, captionImage());
      if (r.status === 200) { mode = "image"; source = "stored"; }
      else reason = "telegram sendPhoto failed: " + r.body;
    } else {
      reason = "no stored card for quote_id=" + (quoteId || "(empty)");
    }
  } catch (e) {
    reason = "stored image failed: " + String((e && e.message) || e);
  }

  // 2) Generated-image fallback chain (Gemini -> Pollinations -> OpenAI)
  if (mode !== "image") {
    try {
      let png = await generateImage(openaiKey, geminiKey, geminiModel, quote);
      png = await ensure1080(png);
      const r = await sendPhoto(token, chat, png, captionImage());
      if (r.status === 200) { mode = "image"; source = "generated"; }
      else reason += " | telegram sendPhoto failed: " + r.body;
    } catch (e) {
      reason += " | image generation failed: " + String((e && e.message) || e);
    }
  }

  if (mode === "image") return Response.json({ mode: "image", source: source, size: "1080x1080" });

  // 3) Text-only fallback (quote text included)
  console.warn("FALLBACK text mode. reason=" + reason);
  const r = await sendText(token, chat, captionText(quote));
  return Response.json({ mode: "text", fallback_reason: reason, telegram_status: r.status });
});

export {};
