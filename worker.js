// ============================================================
// ⚡ 𝒁𝑬𝑵𝑰𝑻𝑯 LOGs ⚡
// ============================================================
// Receives POST /probe with:
//   { url, total, online, offline }
//
// Forwards logs to a specific Telegram forum topic.
//
// IMPORTANT:
// Store BOT_TOKEN as a Cloudflare Worker secret.
// Do NOT hardcode the token in source code.
// ============================================================

const CHAT_ID = '-1004291828596';
const MESSAGE_THREAD_ID = 3;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'zenith-logs',
          note: 'POST { url, total, online, offline } to /probe'
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders()
          }
        }
      );
    }

    if (url.pathname !== '/probe') {
      return new Response('Not found', {
        status: 404,
        headers: corsHeaders()
      });
    }

    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Use POST' }),
        {
          status: 405,
          headers: {
            'content-type': 'application/json',
            ...corsHeaders()
          }
        }
      );
    }

    // Parse body
    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const target = String(body?.url || '').trim();

    if (!target) {
      return json({ error: 'Missing "url" field' }, 400);
    }

    const total = body?.total;
    const online = body?.online;
    const offline = body?.offline;

    const hasStats =
      typeof total === 'number' &&
      typeof online === 'number' &&
      typeof offline === 'number';

    // ============================================================
    // 🇮🇳 India Standard Time
    // ============================================================

    const now = new Date();

    const indiaTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);

    // HTML escape helper
    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    // ============================================================
    // 📊 Stats
    // ============================================================

    let statsLine;

    if (hasStats) {
      statsLine =
        `> 🩶 <b>Total:</b> <code>${total}</code>\n` +
        `> 💚 <b>Online:</b> <code>${online}</code>\n` +
        `> 💔 <b>Offline:</b> <code>${offline}</code>`;
    } else {
      statsLine = '> ℹ️ <i>Device stats not provided.</i>';
    }

    // ============================================================
    // 📩 Telegram message
    // ============================================================

    const logText =
`⚡ <b>𝒁𝑬𝑵𝑰𝑻𝑯 LOGs</b> ⚡

<blockquote>
📌 <b>Target</b>
<code>${escapeHtml(target)}</code>
</blockquote>

<blockquote>
${statsLine.replace(/^> /gm, '')}
</blockquote>

<blockquote>
📅 <b>Checked:</b> <code>${escapeHtml(indiaTime)} IST</code>
</blockquote>

<i>Channel: #zenith-logs</i>`;

    // ============================================================
    // 📤 Send to Telegram
    // ============================================================

    let tgOk = false;
    let tgError = null;

    try {
      // BOT_TOKEN should be configured as a Cloudflare secret:
      // wrangler secret put BOT_TOKEN
      const BOT_TOKEN = env.BOT_TOKEN;

      if (!BOT_TOKEN) {
        throw new Error('BOT_TOKEN secret is not configured');
      }

      const tgUrl =
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

      const tgRes = await fetch(tgUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          message_thread_id: MESSAGE_THREAD_ID,
          text: logText,

          // HTML provides reliable blockquote formatting
          parse_mode: 'HTML',

          disable_web_page_preview: true
        })
      });

      const tgBody = await tgRes.json().catch(() => ({}));

      tgOk = !!tgBody.ok;

      if (!tgOk) {
        tgError =
          tgBody.description ||
          'Telegram API error';
      }
    } catch (e) {
      tgError = String(e.message || e);
    }

    // ============================================================
    // 📡 API response
    // ============================================================

    return json({
      ok: true,
      target,
      telegram: {
        posted: tgOk,
        error: tgError
      },
      timestamp: indiaTime,
      timezone: 'Asia/Kolkata',
      utcOffset: '+05:30'
    });
  }
};

// ============================================================
// CORS
// ============================================================

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
  };
}

// ============================================================
// JSON response
// ============================================================

function json(obj, status = 200) {
  return new Response(
    JSON.stringify(obj, null, 2),
    {
      status,
      headers: {
        'content-type': 'application/json',
        ...corsHeaders()
      }
    }
  );
}  });
}
