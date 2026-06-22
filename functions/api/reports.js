// Cloudflare Pages Function — /api/reports  (admin-only, secret-protected)
// Reads/deletes bug reports from REPORTS KV. The Function has the KV binding, so
// the droplet admin needs no Cloudflare token — just the shared ADMIN_SECRET.
//
//   GET  /api/reports        (X-Admin-Secret header)    -> { ok, reports:[...] }   (newest first)
//   POST /api/reports   {action:"delete", key, secret}  -> { ok }   (or X-Admin-Secret header)
//
// ADMIN_SECRET is a Pages secret (wrangler pages secret put ADMIN_SECRET).

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Constant-time string compare. SHA-256 both sides and compare the digest
// bytes: digests are fixed length (32 bytes), so the byte loop never short-
// circuits on length and reveals no timing signal about the secret.
async function timingSafeEqualStr(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function authed(request, env, bodySecret) {
  const want = env.ADMIN_SECRET;
  if (!want) return false;
  const got = request.headers.get('x-admin-secret') || bodySecret || '';
  if (!got) return false;
  return timingSafeEqualStr(got, want);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.REPORTS) return json({ ok: false, error: 'storage_unavailable' }, 500);
  if (!(await authed(request, env))) return json({ ok: false, error: 'unauthorized' }, 401);

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
  if (!env.REPORTS) return json({ ok: false, error: 'storage_unavailable' }, 500);
  let body = {};
  try { body = await request.json(); } catch { /* ignore */ }
  if (!(await authed(request, env, body.secret))) return json({ ok: false, error: 'unauthorized' }, 401);

  if (body.action === 'delete' && body.key) {
    await env.REPORTS.delete(String(body.key));
    return json({ ok: true });
  }
  return json({ ok: false, error: 'bad_request' }, 400);
}
