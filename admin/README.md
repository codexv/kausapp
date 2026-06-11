# KausApp Bug-Report Admin (Tailscale-only)

A tiny, dependency-free **Python (stdlib)** web app that lists the in-app bug reports submitted via
`POST /api/report`. It reads them from the Cloudflare **REPORTS** KV namespace and renders a page
with each report's description, version/platform, timestamp, and screenshot.

## Access model — why it's "Tailscale only"

A public Cloudflare URL **cannot** be gated by Tailscale (Cloudflare never sees tailnet membership).
Instead we serve the admin from the **droplet** (`irc.coders.ph`, tailnet name `hackpixels-droplet`,
Tailscale IP **100.99.99.75**) and point **admin.kausapp.com** at that **private 100.x IP via a
DNS-only A record**. Public users resolve a non-routable IP and can't connect; tailnet devices route
it over WireGuard and reach it. All tailnet traffic is WireGuard-encrypted, so plain HTTP is fine.

```
admin.kausapp.com  --(DNS A, DNS-only/grey-cloud)-->  100.99.99.75 : 8080  (only reachable on tailnet)
```

## Files
- `server.py` — the admin web app (no pip deps; Python 3.x stdlib only).
- `kausapp-admin.env.example` — config template (copy to `kausapp-admin.env`, fill `CF_API_TOKEN`).
- `kausapp-admin.service` — systemd unit to run it persistently as `acronix`.

## Deploy on the droplet

```bash
# 1) Files live at ~/KausApp/admin (uploaded from the repo's admin/).
cd ~/KausApp/admin

# 2) Config: create the env file with a Cloudflare API token that has
#    "Account -> Workers KV Storage -> Read" (Edit to enable the Delete button).
cp kausapp-admin.env.example kausapp-admin.env
chmod 600 kausapp-admin.env
nano kausapp-admin.env        # paste CF_API_TOKEN=...

# 3) Run as a service.
sudo cp kausapp-admin.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kausapp-admin
systemctl status kausapp-admin          # should be active; listening on 100.99.99.75:8080

# quick check from a tailnet device:
curl http://100.99.99.75:8080/healthz   # -> ok
```

## DNS (one-time)

Create a **DNS-only** (grey-cloud) A record in the kausapp.com zone:
`admin.kausapp.com  A  100.99.99.75`  (Proxy **OFF** — Cloudflare can't proxy a private IP).

Then from any tailnet device: **http://admin.kausapp.com:8080**

> Want it on plain `:80` (so just `http://admin.kausapp.com`)? Either set `BIND_PORT=80` and grant the
> binding capability (`sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which python3))`), or
> front it with nginx on the tailnet IP. `:8080` avoids needing root.

## Endpoints
- `GET /` — HTML list of reports (newest first), with Delete buttons.
- `GET /api/reports` — JSON of all reports.
- `GET /healthz` — liveness check.
