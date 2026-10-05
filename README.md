# Telegram Daily Quote Bot

Posts a premium **1080×1080 quote card + greeting** to the *New Age Algo
Strategies* Telegram channel every morning at **08:00 IST, Monday–Saturday**
(Sundays skipped) — fully cloud-side, laptop off.

## Current production architecture (Supabase)

```
pg_cron (Mon–Sat 02:30 UTC = 08:00 IST)
        │   select public.send_daily_quote()
        ▼
send_daily_quote()  ── picks a random carded quote (table quotes),
        │              reads secrets from app_secrets (never committed)
        │   HTTP POST (shared secret)
        ▼
Edge Function daily-quote  (supabase/functions/daily-quote/index.ts)
        │   1) stored card  quote-images/quote-{id}.png   ← premium, 1080×1080
        │   2) fallback: generateImage (Gemini → Pollinations → OpenAI)
        │   3) fallback: text message containing the quote
        ▼
Telegram sendPhoto — caption is the "Good Morning" greeting only;
                     the quote itself lives inside the card image.
```

| Piece | Where it lives |
|---|---|
| Quotes (46) + `has_image` rotation flags | Postgres table `quotes` |
| Premium card artwork (18 in rotation) | Supabase Storage bucket `quote-images` + `cards/1080/` here |
| Scheduler | pg_cron job, schedule `30 2 * * 1-6` |
| Edge function source | `supabase/functions/daily-quote/index.ts` — secret **redacted**, set `DAILY_QUOTE_SECRET` before deploying |
| DB function source | `supabase/migrations/20261005_send_daily_quote.sql` |
| Card generation (batch) | local ChatGPT bridge → resize → upload (see `scripts/`) |

> The GitHub Actions workflow documented below is the **legacy** sender —
> kept for manual runs only (its schedule is disabled). Production runs on
> Supabase pg_cron.

---

## Configuration

Everything comes from environment variables — nothing is hard-coded.

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_API_ID` | ✅ | Telegram *api id* of the app the session was created with |
| `TELEGRAM_API_HASH` | ✅ | matching *api hash* |
| `TELEGRAM_TARGET_GROUP` | ✅ | `@group_username` or chat id like `-1001234567890` |
| `QUOTE_INDEX` | – | pin a specific quote (0-based) instead of a random one |

Locally they live in a gitignored `.env`; in CI they travel in **one**
repository secret (`DAILY_QUOTE_ENV`) together with the session.

> **Never** commit `.env` or `daily-quote.env`, and never paste the API
> id/hash into the README.

## Local setup

```powershell
cd telegram-daily-quote
npm install
Copy-Item .env.example .env   # then fill in the three values
npm run send
```

`npm run send` = `node --env-file-if-exists=.env send-quote.js` (Node ≥ 22.9).

### Authentication (first run only)

The bot sends **as your Telegram user account**, using a GramJS session created
once by `npx mcp-telegram login`. The session store lives at:

```
~/.mcp-telegram/sessions/1718604740/
```

If you are not authorized, run the login once, then `npm run send`.

### Optional: local schedule (fallback)

```powershell
$action  = New-ScheduledTaskAction -Execute "node" -Argument "--env-file-if-exists=.env `"$PWD\send-quote.js`"" -WorkingDirectory $PWD
$trigger = New-ScheduledTaskTrigger -Daily -At "8:00AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "TelegramDailyQuote" -Action $action -Trigger $trigger -Settings $settings
```

The historical `TelegramDailyQuote` task exists in **Disabled** state — if the
cloud deployment is active, keep it disabled so quotes are not sent twice.
Re-enable with `Enable-ScheduledTask -TaskName TelegramDailyQuote` only as a
fallback.

## Deployment (GitHub Actions)

The workflow is `.github/workflows/daily-quote.yml`:

| Trigger | When |
|---|---|
| `schedule` (`30 2 * * *`) | 08:00 IST daily (02:30 UTC) |
| `workflow_dispatch` | manual run from the Actions tab, optional `quote_index` input |
| `repository_dispatch` (`daily-quote`) | external cron (cron-job.org) alternative |

### One-time setup

1. Create the secret **Settings → Secrets and variables → Actions → New
   repository secret**:
   * **Name:** `DAILY_QUOTE_ENV`
   * **Value:** the contents of `daily-quote.env` (4 lines)
2. Generate that file on this machine:

   ```powershell
   npm run export      # writes daily-quote.env (gitignored)
   ```

   It contains the API id/hash, the target group and a **trimmed** session:
   only `authKey`, `dcId`, `port` and `serverAddress` (~3 KB). The full store
   is 1220 files / 108 KB, which would not fit GitHub's 48 KB secret limit —
   the entity caches are left out on purpose because GramJS rebuilds them
   automatically (verified: a trimmed session resolves the target group fine).
3. Run the workflow once: **Actions → Daily Quote → Run workflow**.

### Why the session works in CI

`scripts/restore-session.mjs` decodes `TELEGRAM_SESSION` and writes the four
session files under the home directory using the exact file names
`StoreSession` expects *for the current platform* — GramJS builds them as
`encodeURIComponent(sessionName + ":" + key)`, and `path.sep` differs between
the Windows export (`%5C`) and the Linux runner (`%2F`), so the names are
computed at restore time instead of being copied across.

### External scheduler (if GitHub's `schedule` does not fire)

Same pattern as the `new-age-algos` repo: a cron-job.org job POSTs to

```
POST /repos/<OWNER>/<REPO>/actions/workflows/daily-quote.yml/dispatches
Authorization: Bearer <fine-grained PAT: Actions: read & write>
{"ref":"main","inputs":{}}
```

scheduled as `0 2 * * 1-5` … actually `0 2 * * *` (07:30 IST) or `30 2 * * *`
(08:00 IST) in `Asia/Kolkata`. GitHub answers `204` on acceptance, so a bad
token shows up as a cron-job.org job failure.

## Customising the quotes

Edit the `QUOTES` array in `send-quote.js` (20 entries today), or pin one for a
test run with the `QUOTE_INDEX` input / env var.

```powershell
$env:QUOTE_INDEX = "3"; npm run send    # sends quote #4
```

## Security notes

* `.env` and `daily-quote.env` are gitignored — only `.env.example` (empty
  placeholders) is committed.
* The CI secret holds the session for **one user account with access to one
  group**; revoke it by logging out the session (`npx mcp-telegram login`
  with a new session, then re-export) if the repo or secret ever leaks.
* Workflow permissions are `contents: read` only.
* The quote is plain text — no HTML/Markdown parsing, no injection surface.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variables` | fill in `.env` locally, or set the `DAILY_QUOTE_ENV` secret |
| `Not authorized` | run `npx mcp-telegram login` locally, then `npm run export` again |
| `TELEGRAM_SESSION is not set` in CI | secret name is `DAILY_QUOTE_ENV`, not individual vars |
| Workflow exits 2 immediately | secret missing/empty — check the name exactly |
| Quote sent twice | both `schedule` *and* cron-job.org enabled, or local task re-enabled — keep exactly one |
