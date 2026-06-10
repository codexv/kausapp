#!/usr/bin/env python3
"""
Kausapp bug-report admin — a tiny, dependency-free viewer.

Reads bug reports from the Cloudflare REPORTS KV namespace and renders them as a
web page. Intended to run on the Tailscale droplet and bind to the tailnet IP so
it is reachable ONLY from within the tailnet (admin.kausapp.com -> tailscale IP,
DNS-only). All tailnet traffic is WireGuard-encrypted, so plain HTTP is fine.

Config via environment (see admin/kausapp-admin.env.example):
  CF_API_TOKEN   Cloudflare API token with "Workers KV Storage: Read" (Edit to allow delete)
  CF_ACCOUNT_ID  Cloudflare account id           (default: the kausapp account)
  REPORTS_KV_ID  REPORTS KV namespace id         (default: the REPORTS namespace)
  BIND_HOST      Address to bind                  (default: 100.99.99.75 — the tailnet IP)
  BIND_PORT      Port to bind                     (default: 8080)
"""

import json
import os
import html
import urllib.request
import urllib.parse
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CF_API = "https://api.cloudflare.com/client/v4"
CF_TOKEN = os.environ.get("CF_API_TOKEN", "")
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "30951f274c5ebe109b224b63bc6de688")
KV_ID = os.environ.get("REPORTS_KV_ID", "ce3a8a24c91b4797a3dedf4d78e3fb7c")
BIND_HOST = os.environ.get("BIND_HOST", "100.99.99.75")
BIND_PORT = int(os.environ.get("BIND_PORT", "8080"))


def cf(path, method="GET"):
    req = urllib.request.Request(
        CF_API + path,
        method=method,
        headers={"Authorization": f"Bearer {CF_TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def list_keys():
    out, cursor = [], ""
    while True:
        q = "?limit=1000" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        res = cf(f"/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_ID}/keys{q}")
        out.extend(k["name"] for k in res.get("result", []))
        cursor = (res.get("result_info") or {}).get("cursor", "")
        if not cursor:
            break
    return out


def get_value(key):
    req = urllib.request.Request(
        f"{CF_API}/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_ID}/values/{urllib.parse.quote(key)}",
        headers={"Authorization": f"Bearer {CF_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def delete_key(key):
    cf(f"/accounts/{ACCOUNT_ID}/storage/kv/namespaces/{KV_ID}/values/{urllib.parse.quote(key)}", method="DELETE")


def load_reports():
    keys = sorted(list_keys(), reverse=True)  # newest first (ts-prefixed)
    reports = []
    for k in keys[:500]:
        try:
            v = get_value(k)
            v["_key"] = k
            reports.append(v)
        except Exception as e:  # noqa: BLE001
            reports.append({"_key": k, "description": f"(failed to load: {e})", "ts": "", "version": "", "platform": ""})
    return reports


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
            f'<a href="{html.escape(shot)}" target="_blank"><img src="{html.escape(shot)}" alt="screenshot"></a>'
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
<meta name="robots" content="noindex,nofollow"><title>Kausapp — Bug Reports</title>
<style>{PAGE_CSS}</style></head><body>
<header><h1>Kausapp — Bug Reports</h1><span class="count">{len(reports)} report(s)</span></header>
{body}
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
                self._send(200, render(load_reports()))
            except urllib.error.HTTPError as e:
                self._send(500, f"<pre>Cloudflare API error {e.code}: {e.read().decode()[:500]}</pre>")
            except Exception as e:  # noqa: BLE001
                self._send(500, f"<pre>Error: {html.escape(str(e))}</pre>")
        elif self.path == "/api/reports":
            try:
                self._send(200, json.dumps(load_reports()), "application/json")
            except Exception as e:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(e)}), "application/json")
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
                    delete_key(key)
            except Exception:  # noqa: BLE001
                pass
            self.send_response(303)
            self.send_header("Location", "/")
            self.end_headers()
        else:
            self._send(404, "not found", "text/plain")

    def log_message(self, *_):
        pass  # quiet


def main():
    if not CF_TOKEN:
        raise SystemExit("CF_API_TOKEN is not set. See admin/kausapp-admin.env.example")
    srv = ThreadingHTTPServer((BIND_HOST, BIND_PORT), Handler)
    print(f"Kausapp admin listening on http://{BIND_HOST}:{BIND_PORT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
