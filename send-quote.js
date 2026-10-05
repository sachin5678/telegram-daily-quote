const { TelegramClient } = require("telegram");
const { StoreSession } = require("telegram/sessions");
const os = require("os");
const path = require("path");

// MUST chdir to home so the relative session path resolves correctly
// (gramjs StoreSession prefixes "./" and path.resolve() against cwd)
process.chdir(os.homedir());

const API_ID = parseInt(process.env.TELEGRAM_API_ID || "", 10);
const API_HASH = process.env.TELEGRAM_API_HASH;
const TARGET = process.env.TELEGRAM_TARGET_GROUP;

// Relative session path — matches where `npx mcp-telegram login` saved it.
// On CI, scripts/restore-session.mjs rebuilds this store from the
// TELEGRAM_SESSION secret first (see .github/workflows/daily-quote.yml).
const SESSION_NAME = ".mcp-telegram" + path.sep + "sessions" + path.sep + "1718604740";

const missing = [];
if (!API_ID) missing.push("TELEGRAM_API_ID");
if (!API_HASH) missing.push("TELEGRAM_API_HASH");
if (!TARGET) missing.push("TELEGRAM_TARGET_GROUP");
if (missing.length) {
  console.error("Missing required environment variables: " + missing.join(", "));
  console.error("Locally: fill in .env (see .env.example). In CI: the DAILY_QUOTE_ENV repository secret.");
  process.exit(2);
}

const QUOTES = [
  "The only way to do great work is to love what you do. — Steve Jobs",
  "Success is not final, failure is not fatal: it is the courage to continue that counts. — Winston Churchill",
  "In the middle of difficulty lies opportunity. — Albert Einstein",
  "Believe you can and you're halfway there. — Theodore Roosevelt",
  "The future belongs to those who believe in the beauty of their dreams. — Eleanor Roosevelt",
  "It does not matter how slowly you go as long as you do not stop. — Confucius",
  "Everything you've ever wanted is on the other side of fear. — George Addair",
  "Hardships often prepare ordinary people for an extraordinary destiny. — C.S. Lewis",
  "The only impossible journey is the one you never begin. — Tony Robbins",
  "Act as if what you do makes a difference. It does. — William James",
  "Quality is not an act, it is a habit. — Aristotle",
  "The best time to plant a tree was 20 years ago. The second best time is now. — Chinese Proverb",
  "Your limitation — it's only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it.",
  "Success doesn't just find you. You have to go out and get it.",
  "The harder you work for something, the greater you'll feel when you achieve it.",
  "Don't stop when you're tired. Stop when you're done.",
  "Wake up with determination. Go to bed with satisfaction."
];

// QUOTE_INDEX lets a manual (workflow_dispatch) run pin a specific quote;
// otherwise one is picked at random.
function pickQuoteIndex() {
  const raw = process.env.QUOTE_INDEX;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 0 && n < QUOTES.length) return n;
    console.warn(`QUOTE_INDEX=${raw} out of range (0..${QUOTES.length - 1}); picking randomly.`);
  }
  return Math.floor(Math.random() * QUOTES.length);
}

async function main() {
  const session = new StoreSession(SESSION_NAME);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.connect();
  if (!(await client.isUserAuthorized())) {
    console.error("Not authorized. Run `npx mcp-telegram login` first (locally),");
    console.error("or restore the session from TELEGRAM_SESSION (CI).");
    process.exit(1);
  }

  const index = pickQuoteIndex();
  const quote = QUOTES[index];
  const message = `\u2600\ufe0f Good Morning!\n\n"${quote}"\n\n\ud83d\udca1 Have a great day ahead!`;

  await client.sendMessage(TARGET, { message });
  console.log(`Quote #${index} sent to ${TARGET}:`);
  console.log(message);

  await client.disconnect();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
