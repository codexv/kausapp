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
