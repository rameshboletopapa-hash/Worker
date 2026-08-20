// ============================================================
// X-Panel MaksudXpanel — Firebase RTDB Probe + Device Stats → Telegram
// ============================================================
// Receives a POST to /probe with { url, total, online, offline }
// Probes the RTDB for public read exposure and sends a combined
// message to Telegram.
//
// Environment variables (set with `wrangler secret put`):
//   BOT_TOKEN   — Telegram bot token
//   CHAT_ID     — Telegram channel/group chat ID
// ============================================================

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'x-panel-maksud',
          note: 'POST { url, total, online, offline } to /probe'
        }),
        { status: 200, headers: { 'content-type': 'application/json', ...corsHeaders() } }
      );
    }

    if (url.pathname !== '/probe') {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Use POST' }),
        { status: 405, headers: { 'content-type': 'application/json', ...corsHeaders() } }
      );
    }

    // 1. Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const target = (body?.url || '').trim();
    if (!target) return json({ error: 'Missing "url" field' }, 400);

    // ✅ UPDATED: Accept BOTH firebaseio.com AND firebasedatabase.app (with optional region)
    // Matches: https://project.firebaseio.com OR https://project.region.firebasedatabase.app
    if (!/^https:\/\/[a-zA-Z0-9-]+\.(firebaseio\.com|firebasedatabase\.app)(\/|$)/.test(target)) {
      return json({ error: 'URL must be a valid Firebase RTDB URL (firebaseio.com or firebasedatabase.app)' }, 400);
    }

    // Normalize: ensure trailing slash
    const normalized = target.endsWith('/') ? target : target + '/';

    // 2. Probe the RTDB (we still do it, but won't show all exposed paths in Telegram)
    const probePaths = [
      '.json?shallow=true',
      'device_count.json',
      'users.json',
      'messages.json',
      'inbox.json',
      'sms.json',
      '.json'
    ];

    const results = await Promise.all(
      probePaths.map(async (p) => {
        const probeUrl = normalized + p;
        try {
          const r = await fetch(probeUrl, {
            method: 'GET',
            cf: { cacheTtl: 0, cacheEverything: false },
            signal: AbortSignal.timeout(8000)
          });
          const txt = await r.text();
          return {
            path: p,
            status: r.status,
            exposed: r.status === 200 && txt && txt !== 'null' && txt.length > 2,
            bytes: txt.length
          };
        } catch (e) {
          return { path: p, status: 0, exposed: false, error: String(e.message || e) };
        }
      })
    );

    const exposedPaths = results.filter(r => r.exposed).map(r => r.path);
    const verdict = exposedPaths.length > 0 ? 'PUBLIC' : 'SECURED';

    // 3. Build the Telegram message – clean, blockquoted, with stats
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const verdictEmoji = verdict === 'PUBLIC' ? '🔓' : '🔒';
    const verdictStatus = verdict === 'PUBLIC' ? '⚠️ Exposed' : '✅ Secured';

    // Device stats (optional)
    const total = body?.total;
    const online = body?.online;
    const offline = body?.offline;
    const hasStats = (typeof total === 'number' && typeof online === 'number' && typeof offline === 'number');

    let statsLine = '';
    if (hasStats) {
      statsLine = `> 🩶 **Total:** \`${total}\`  ·  💚 **Online:** \`${online}\`  ·  💔 **Offline:** \`${offline}\``;
    } else {
      statsLine = '> *Device stats not provided.*';
    }

    const logText =
`${verdictEmoji} *X‑Panel Security Alert*

> 📌 **Target:** \`${target}\`
> 🛡️ **Verdict:** *${verdict}* ${verdictStatus}
${statsLine}
> 📅 **Checked:** \`${now}\`

_Channel: #x-panel_`;

    // 4. Send to Telegram
    let tgOk = false;
    let tgError = null;
    try {
      const tgUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
      const tgRes = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.CHAT_ID,
          text: logText,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      const tgBody = await tgRes.json().catch(() => ({}));
      tgOk = !!tgBody.ok;
      if (!tgOk) tgError = tgBody.description || 'telegram api error';
    } catch (e) {
      tgError = String(e.message || e);
    }

    // 5. Return response (we still include the probe results in JSON)
    return json({
      ok: true,
      target,
      verdict,
      exposedPaths,
      results,
      telegram: { posted: tgOk, error: tgError },
      timestamp: now
    });
  }
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() }
  });
}
