# Kausapp — Website Dev Guide

How to develop and deploy the **kausapp.com** website (the coming-soon landing page, the unlisted
`/download` page, and the serverless API). This same guide is uploaded to the droplet at
`~/Kausapp/website/README.md` so web dev can be continued from there.

## What the website is

- Hosted on **Cloudflare Pages**, project name **`kausapp`** (Cloudflare account `acronix@coders.ph`,
  account id `30951f274c5ebe109b224b63bc6de688`).
- Custom domains: **kausapp.com** + **www.kausapp.com** (DNS on Cloudflare, proxied CNAMEs →
  `kausapp.pages.dev`).
- Deployed via **direct upload with wrangler** (not Git integration).

## Structure

```
website/
├── site/                     # static assets (the deployed site root)
│   ├── index.html            # coming-soon landing page (black/blue theme)
│   ├── download/index.html   # unlisted /download page (auto-tracks latest GitHub release)
│   ├── icon.png, icon_512.png        # app icon (favicon / social / hero)
│   └── coders-logo-white.png         # Coders Republic logo (white knockout)
├── functions/                # Cloudflare Pages Functions (serverless API)
│   └── api/
│       ├── subscribe.js      # POST /api/subscribe  -> stores email in SUBSCRIBERS KV
│       └── report.js         # POST /api/report     -> stores bug report in REPORTS KV
└── wrangler.toml             # Pages config + KV bindings
```

### KV namespaces (bound in `wrangler.toml`)
| Binding | Purpose | Namespace id |
| --- | --- | --- |
| `SUBSCRIBERS` | coming-soon email signups (`sub:<email>`) | `931015b6e7054ed386a825f5188e0979` |
| `REPORTS` | in-app bug reports (`report:<ts>-<uuid>`) | `ce3a8a24c91b4797a3dedf4d78e3fb7c` |

### API endpoints
- `POST /api/subscribe` — body `{ "email": "..." }` → `{ ok: true }`
- `POST /api/report` — body `{ description, screenshot(dataURL), version, platform }` → `{ ok, id }`

## Editing

The pages are plain HTML/CSS/JS (no build step). Edit files under `site/` directly. Preview locally
by opening `site/index.html` in a browser, or run any static server, e.g.:

```bash
python3 -m http.server 8000 --directory site   # then open http://localhost:8000
```

(Note: the `/api/*` Functions only run on Cloudflare, not in the plain static preview.)

## Deploying

Deploys require **Node + wrangler + Cloudflare auth**.

```bash
# from the website/ directory (the one containing wrangler.toml)
npx wrangler login                              # one-time, opens a browser to authorize
npx wrangler pages deploy --branch main         # IMPORTANT: --branch main = production (kausapp.com)
```

> **Always pass `--branch main`.** Without it the deploy lands as a *preview* and the live domain
> won't update.

### Deploying from the droplet
The droplet has Python but **no Node**, so install Node first (one-time):

```bash
# on the droplet (Ubuntu) — install Node LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
# then, from ~/Kausapp/website:
npx wrangler login          # authorize (headless: use a Cloudflare API token instead — see below)
npx wrangler pages deploy --branch main
```

Headless auth (no browser on the droplet): create a Cloudflare API token with **Account → Cloudflare
Pages: Edit** and export it before deploying:

```bash
export CLOUDFLARE_API_TOKEN=...   # Pages:Edit token
export CLOUDFLARE_ACCOUNT_ID=30951f274c5ebe109b224b63bc6de688
npx wrangler pages deploy --branch main
```

## Source of truth & sync

The canonical repo is **https://github.com/codexv/kausapp** (the website lives under `site/`,
`functions/`, `wrangler.toml` at the repo root). The droplet copy in `~/Kausapp/website/` is a working
copy for editing from there — keep them in sync via git (clone the repo on the droplet) or by copying
changed files back. After any edit, redeploy with the wrangler command above.

## Viewing collected data

```bash
# email signups
npx wrangler kv key list --namespace-id=931015b6e7054ed386a825f5188e0979 --remote
# bug reports (also viewable on the Tailscale admin — see admin/README.md)
npx wrangler kv key list --namespace-id=ce3a8a24c91b4797a3dedf4d78e3fb7c --remote
```
