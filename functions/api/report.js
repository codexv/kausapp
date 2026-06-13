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
  const kind = String((data && data.kind) || 'bug').slice(0, 32);

  const ts = new Date().toISOString();
  const id = `report:${ts}-${crypto.randomUUID()}`;
  const record = {
    description,
    diagnostics,
    kind,
    screenshot,
    version: String((data && data.version) || ''),
    platform: String((data && data.platform) || ''),
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
