# X-Panel RTDB Security Probe — Cloudflare Worker

A Cloudflare Worker that receives a Firebase Realtime Database URL, probes its public read exposure itself, and posts a security verdict (PUBLIC / SECURED) to a Telegram channel. The URL appears in the message as the **subject being checked**, not as the headline data.

## What it does

1. **Receives** `{ "url": "https://xxx.firebaseio.com" }` via `POST /probe`
2. **Probes the RTDB itself** by hitting these paths and checking the HTTP status + response body:
   - `/.json?shallow=true` (root read exposure)
   - `/device_count.json`
   - `/users.json`
   - `/messages.json`
   - `/inbox.json`
   - `/sms.json`
   - `/.json` (full dump attempt)
3. **Sends a Telegram message** with the verdict in blockquoted Markdown format
4. **Returns** the verdict JSON to the calling client

## What it does NOT do

- Does not log, save, or relay the URL as headline data
- Does not extract or forward Firebase API keys, project IDs, or device counts
- Does not return any RTDB data to the client (only status codes / yes-no verdicts per path)

## Deploy

### Prerequisites
- Node.js installed (https://nodejs.org)
- A free Cloudflare account (https://dash.cloudflare.com/sign-up)
- A Telegram bot (create via @BotFather → `/newbot`)
- A Telegram channel or group where the bot has been added as admin

### Step 1 — Install Wrangler

```bash
npm install -g wrangler
```

### Step 2 — Login to Cloudflare

```bash
wrangler login
```

A browser tab opens — log in and click Allow.

### Step 3 — Create a project folder

On your computer:

```bash
mkdir x-panel-rtdb-probe
cd x-panel-rtdb-probe
```

Copy `worker.js` and `wrangler.toml` from this repo into that folder.

### Step 4 — Set the Telegram secrets

```bash
wrangler secret put BOT_TOKEN
# paste your bot token from @BotFather, press Enter

wrangler secret put CHAT_ID
# paste your channel/group ID, press Enter
```

To get your `CHAT_ID`:
- For a **public channel**: it starts with `@` (e.g. `@x_panel_logs`)
- For a **private channel/group**: starts with `-100` (e.g. `-1001234567890`)

To find a private ID, add your bot to the channel, send any message there, then visit:

```
https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
```

The `chat.id` field in the response is your CHAT_ID.

### Step 5 — Deploy

```bash
wrangler deploy
```

You'll see output like:

```
Published x-panel-rtdb-probe (1.23 sec)
  https://x-panel-rtdb-probe.<YOUR-SUBDOMAIN>.workers.dev
```

Copy that URL — paste it into the **Probe Worker URL** field inside X-Panel.

## Test

```bash
curl -X POST https://x-panel-rtdb-probe.<YOUR-SUBDOMAIN>.workers.dev/probe \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.firebaseio.com"}'
```

Expected response:

```json
{
  "ok": true,
  "target": "https://example.firebaseio.com",
  "verdict": "PUBLIC",
  "exposedPaths": ["device_count.json", "users.json", ".json?shallow=true"],
  "results": [...],
  "telegram": { "posted": true, "error": null },
  "timestamp": "2026-08-01 14:00:00 UTC"
}
```

## Telegram message format

```
🔓 X-Panel RTDB Probe

> *Target:* `https://example.firebaseio.com`
> *Verdict:* *PUBLIC*
> *Public paths found:*
>   • `device_count.json`
>   • `users.json`
> *Probed at:* `2026-08-01 14:00:00 UTC`
> *Probe count:* `7`

_Channel: x-panel-security-log_
```

If everything is secured:

```
🔒 X-Panel RTDB Probe

> *Target:* `https://example.firebaseio.com`
> *Verdict:* *SECURED*
> *Public paths found:*
>   • _none_
> *Probed at:* `2026-08-01 14:00:00 UTC`
> *Probe count:* `7`

_Channel: x-panel-security-log_
```

## Health check

```bash
curl https://x-panel-rtdb-probe.<YOUR-SUBDOMAIN>.workers.dev/health
```

Returns:

```json
{
  "status": "ok",
  "service": "x-panel-rtdb-probe",
  "note": "POST { url } to /probe"
}
```

## Files in this folder

| File | Purpose |
|---|---|
| `worker.js` | The Worker code |
| `wrangler.toml` | Cloudflare config (name, entry point) |
| `README.md` | This file |
