// Cloudflare Pages Function — /api/reports  (admin-only, secret-protected)
// Reads/deletes bug reports from REPORTS KV. The Function has the KV binding, so
// the droplet admin needs no Cloudflare token — just the shared ADMIN_SECRET.
//
//   GET  /api/reports?key=SECRET            -> { ok, reports:[...] }   (newest first)
//   POST /api/reports   {action:"delete", key, secret}  -> { ok }
//
// ADMIN_SECRET is a Pages secret (wrangler pages secret put ADMIN_SECRET).

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function authed(request, url, env, bodySecret) {
  const want = env.ADMIN_SECRET;
  if (!want) return false;
  const got = request.headers.get('x-admin-secret') || url.searchParams.get('key') || bodySecret || '';
  return got === want;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (!env.REPORTS) return json({ ok: false, error: 'storage_unavailable' }, 500);
  if (!authed(request, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);

  // Scope to report records only — the namespace also holds rl:* rate-limit
  // counters (numeric, auto-expiring) which must never surface as "reports".
  const list = await env.REPORTS.list({ prefix: 'report:', limit: 1000 });
  const keys = list.keys.map((k) => k.name).sort().reverse(); // newest first (ts-prefixed)
  const reports = [];
  for (const key of keys.slice(0, 500)) {
    const raw = await env.REPORTS.get(key);
    if (!raw) continue;
    try {
      const rec = JSON.parse(raw);
      rec._key = key;
      reports.push(rec);
    } catch {
      reports.push({ _key: key, description: '(unparseable record)', ts: '', version: '', platform: '' });
    }
  }
  return json({ ok: true, reports });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (!env.REPORTS) return json({ ok: false, error: 'storage_unavailable' }, 500);
  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!authed(request, url, env, body.secret)) return json({ ok: false, error: 'unauthorized' }, 401);

  if (body.action === 'delete' && body.key) {
    await env.REPORTS.delete(String(body.key));
    return json({ ok: true });
  }
  return json({ ok: false, error: 'bad_request' }, 400);
}
