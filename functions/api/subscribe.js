// Cloudflare Pages Function — POST /api/subscribe
// Stores coming-soon email signups in the SUBSCRIBERS KV namespace.
// Key:   "sub:<lowercased-email>"
// Value: JSON { email, ts, ua, country }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SUBSCRIBERS) {
    return json({ ok: false, error: 'storage_unavailable' }, 500);
  }

  let email = '';
  try {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await request.json();
      email = (data.email || '').toString().trim().toLowerCase();
    } else {
      const form = await request.formData();
      email = (form.get('email') || '').toString().trim().toLowerCase();
    }
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  // Lightweight abuse guard: cap signups per IP per UTC day to bound KV growth
  // via flooding. Counter key is namespaced (rl:sub:*) so it never collides
  // with sub:* subscriber records. No-op if the IP header is absent.
  const ip = request.headers.get('cf-connecting-ip') || '';
  if (ip) {
    const day = new Date().toISOString().slice(0, 10);
    const rlKey = `rl:sub:${day}:${ip}`;
    const count = parseInt((await env.SUBSCRIBERS.get(rlKey)) || '0', 10) || 0;
    if (count >= 30) return json({ ok: false, error: 'rate_limited' }, 429);
    await env.SUBSCRIBERS.put(rlKey, String(count + 1), { expirationTtl: 86400 });
  }

  const record = {
    email,
    ts: new Date().toISOString(),
    ua: request.headers.get('user-agent') || '',
    country: request.headers.get('cf-ipcountry') || ''
  };

  // put() overwrites on duplicate — idempotent, no double entries.
  await env.SUBSCRIBERS.put(`sub:${email}`, JSON.stringify(record));

  return json({ ok: true });
}

// Anything other than POST gets a clear 405.
export async function onRequest(context) {
  if (context.request.method === 'POST') return onRequestPost(context);
  return json({ ok: false, error: 'method_not_allowed' }, 405);
}
