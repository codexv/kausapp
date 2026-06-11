#!/usr/bin/env python3
"""
KausApp bug-report admin — a tiny, dependency-free viewer.

Renders the bug reports submitted from the app. To avoid storing any Cloudflare
credential on the droplet, it reads the reports through the secret-protected
Cloudflare endpoint `https://kausapp.com/api/reports` (the Pages Function has the
KV binding). The droplet only holds a shared ADMIN_SECRET.

Runs on the droplet bound to the Tailscale IP, so it's reachable ONLY from the
tailnet (admin.kausapp.com -> 100.99.99.75, DNS-only). Tailnet traffic is
WireGuard-encrypted, so plain HTTP is fine.

Config via environment (see admin/kausapp-admin.env.example):
  ADMIN_SECRET   shared secret matching the Pages ADMIN_SECRET   (required)
  REPORTS_API    reports endpoint   (default: https://kausapp.com/api/reports)
  BIND_HOST      bind address       (default: 100.99.99.75 — the tailnet IP)
  BIND_PORT      bind port          (default: 8080)
"""

import json
import os
import html
import urllib.request
import urllib.parse
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")
REPORTS_API = os.environ.get("REPORTS_API", "https://kausapp.com/api/reports")
BIND_HOST = os.environ.get("BIND_HOST", "100.99.99.75")
BIND_PORT = int(os.environ.get("BIND_PORT", "8080"))

# A normal browser-ish UA so Cloudflare doesn't block the request as a bot
# (default Python-urllib UA trips Cloudflare error 1010).
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 KausAppAdmin/1.0"


def fetch_reports():
    url = f"{REPORTS_API}?key={urllib.parse.quote(ADMIN_SECRET)}"
    req = urllib.request.Request(url, headers={"X-Admin-Secret": ADMIN_SECRET, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read().decode())
    if not data.get("ok"):
        raise RuntimeError(data.get("error", "unknown error"))
    return data.get("reports", [])


def delete_report(key):
    body = json.dumps({"action": "delete", "key": key, "secret": ADMIN_SECRET}).encode()
    req = urllib.request.Request(REPORTS_API, data=body, method="POST",
                                 headers={"Content-Type": "application/json",
                                          "X-Admin-Secret": ADMIN_SECRET, "User-Agent": UA})
    urllib.request.urlopen(req, timeout=20).read()


PAGE_CSS = """
:root{--blue:#1456ff}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0e1a;color:#e8eefc;padding:28px}
header{display:flex;align-items:center;gap:14px;margin-bottom:22px}
h1{font-size:22px;font-weight:800}
.count{color:#9fb3d8;font-size:14px}
.empty{color:#9fb3d8;margin-top:40px;text-align:center}
.card{background:#10162a;border:1px solid #22304f;border-radius:14px;padding:18px;margin-bottom:16px;display:grid;grid-template-columns:1fr 280px;gap:18px}
.card .meta{font-size:12px;color:#8fa3c8;margin-bottom:8px}
.card .desc{white-space:pre-wrap;line-height:1.55;font-size:14px}
.badge{display:inline-block;background:rgba(20,86,255,.18);border:1px solid rgba(59,130,246,.5);color:#cfe0ff;border-radius:999px;padding:2px 10px;font-size:11px;margin-right:6px}
.shot img{width:100%;border-radius:10px;border:1px solid #22304f;cursor:zoom-in}
.noshot{color:#5f6f92;font-size:12px;font-style:italic}
#lb{display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;cursor:zoom-out;align-items:center;justify-content:center;padding:24px}
#lb.open{display:flex}
#lb img{max-width:96vw;max-height:96vh;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.6)}
.del{margin-top:10px;background:#3a1020;border:1px solid #5a1a2a;color:#ff9bb0;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit}
a{color:#cfe0ff}
@media(max-width:780px){.card{grid-template-columns:1fr}}
"""


def render(reports):
    rows = []
    for r in reports:
        ts = html.escape(str(r.get("ts", "")))
        ver = html.escape(str(r.get("version", "")))
        plat = html.escape(str(r.get("platform", "")))
        country = html.escape(str(r.get("country", "")))
        desc = html.escape(str(r.get("description", "")))
        key = html.escape(str(r.get("_key", "")))
        shot = r.get("screenshot", "")
        shot_html = (
            f'<img class="shot-img" src="{html.escape(shot)}" alt="screenshot" loading="lazy">'
            if isinstance(shot, str) and shot.startswith("data:image/")
            else '<div class="noshot">No screenshot attached</div>'
        )
        rows.append(f"""
        <div class="card">
          <div>
            <div class="meta">
              <span class="badge">v{ver}</span><span class="badge">{plat}</span>
              {('<span class="badge">'+country+'</span>') if country else ''}
              <span>{ts}</span>
            </div>
            <div class="desc">{desc}</div>
            <form method="post" action="/delete" onsubmit="return confirm('Delete this report?')">
              <input type="hidden" name="key" value="{key}">
              <button class="del" type="submit">Delete</button>
            </form>
          </div>
          <div class="shot">{shot_html}</div>
        </div>""")
    body = "".join(rows) if rows else '<div class="empty">No bug reports yet. 🎉</div>'
    return f"""<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>KausApp — Bug Reports</title>
<style>{PAGE_CSS}</style></head><body>
<header><h1>KausApp — Bug Reports</h1><span class="count">{len(reports)} report(s)</span></header>
{body}
<div id="lb"><img id="lbimg" alt="screenshot full size"></div>
<script>
  var lb = document.getElementById('lb'), lbimg = document.getElementById('lbimg');
  document.addEventListener('click', function (e) {{
    if (e.target.classList && e.target.classList.contains('shot-img')) {{
      lbimg.src = e.target.src; lb.classList.add('open');
    }} else if (e.target === lb || e.target === lbimg) {{
      lb.classList.remove('open'); lbimg.src = '';
    }}
  }});
  document.addEventListener('keydown', function (e) {{ if (e.key === 'Escape') {{ lb.classList.remove('open'); lbimg.src = ''; }} }});
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="text/html; charset=utf-8"):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            try:
                self._send(200, render(fetch_reports()))
            except urllib.error.HTTPError as e:
                self._send(502, f"<pre>Upstream error {e.code}: {html.escape(e.read().decode()[:400])}</pre>")
            except Exception as e:  # noqa: BLE001
                self._send(500, f"<pre>Error: {html.escape(str(e))}</pre>")
        elif self.path == "/healthz":
            self._send(200, "ok", "text/plain")
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        if self.path == "/delete":
            length = int(self.headers.get("Content-Length", "0"))
            form = urllib.parse.parse_qs(self.rfile.read(length).decode())
            key = (form.get("key") or [""])[0]
            try:
                if key:
                    delete_report(key)
            except Exception:  # noqa: BLE001
                pass
            self.send_response(303)
            self.send_header("Location", "/")
            self.end_headers()
        else:
            self._send(404, "not found", "text/plain")

    def log_message(self, *_):
        pass


def main():
    if not ADMIN_SECRET:
        raise SystemExit("ADMIN_SECRET is not set. See admin/kausapp-admin.env.example")
    srv = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"KausApp admin listening on http://{BIND_HOST}:{BIND_PORT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
