// Cloudflare Pages Function — POST /api/report
// Stores in-app bug reports in the REPORTS KV namespace.
// Key:   "report:<iso-ts>-<uuid>"
// Value: JSON { description, screenshot(dataURL|''), version, platform, ua, country, ts }

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.REPORTS) return json({ ok: false, error: 'storage_unavailable' }, 500);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  const description = String((data && data.description) || '').trim().slice(0, 5000);
  if (!description) return json({ ok: false, error: 'empty_description' }, 400);

  // Lightweight abuse guard: cap submissions per IP per UTC day. KV is eventually
  // consistent so this is a soft limit, but it stops a single client from
  // flooding the namespace. No-op if the IP header is absent.
  const ip = request.headers.get('cf-connecting-ip') || '';
  const day = new Date().toISOString().slice(0, 10);
  if (ip) {
    const rlKey = `rl:${day}:${ip}`;
    const count = parseInt((await env.REPORTS.get(rlKey)) || '0', 10) || 0;
    if (count >= 20) return json({ ok: false, error: 'rate_limited' }, 429);
    await env.REPORTS.put(rlKey, String(count + 1), { expirationTtl: 86400 });
  }

  // Global daily write ceiling: bounds total KV growth even under distributed
  // flooding from many IPs. High cap so it never trips on legitimate traffic.
  {
    const gKey = `rl:${day}:_global`;
    const gCount = parseInt((await env.REPORTS.get(gKey)) || '0', 10) || 0;
    if (gCount >= 2000) return json({ ok: false, error: 'rate_limited' }, 429);
    await env.REPORTS.put(gKey, String(gCount + 1), { expirationTtl: 86400 });
  }

  // Cap screenshot size (~6MB data URL) to stay well under KV's value limit.
  let screenshot = typeof data.screenshot === 'string' ? data.screenshot : '';
  if (screenshot && (!screenshot.startsWith('data:image/') || screenshot.length > 6_000_000)) {
    screenshot = '';
  }

  // Optional structured diagnostics (e.g. OLED theme DOM capture). Kept in a
  // separate field so it isn't subject to the 5000-char description cap.
  const diagnostics = typeof data.diagnostics === 'string'
    ? data.diagnostics.slice(0, 200_000)
    : '';
  // Coerce kind to a known value; anything unexpected falls back to 'bug'.
  const kindRaw = String((data && data.kind) || 'bug');
  const kind = ['bug', 'diagnostics'].includes(kindRaw) ? kindRaw : 'bug';

  const ts = new Date().toISOString();
  const id = `report:${ts}-${crypto.randomUUID()}`;
  const record = {
    description,
    diagnostics,
    kind,
    screenshot,
    version: String((data && data.version) || '').slice(0, 64),
    platform: String((data && data.platform) || '').slice(0, 64),
    ua: request.headers.get('user-agent') || '',
    country: request.headers.get('cf-ipcountry') || '',
    ts
  };

  await env.REPORTS.put(id, JSON.stringify(record));
  return json({ ok: true, id });
}

export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
