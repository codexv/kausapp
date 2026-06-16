# HANDOFF — Desktop Messenger

A running log of every significant move on this project. Newest entries at the top of the changelog.

---

## Project objective

Build a **cross-platform desktop client for Facebook Messenger** (Mac, Windows, Ubuntu Linux).
Facebook discontinued its official desktop Messenger app, so this fills that gap. It must support
the full feature set: send/receive messages and attachments, play audio (voice messages), voice/video
calls, and open external links in the system browser.

## Architecture decision

**Electron wrapper around `https://www.messenger.com/`.**

Rationale:
- There is **no official Messenger chat API** for full-feature messaging anymore, and unofficial
  reverse-engineered APIs violate Meta's ToS and break constantly. Wrapping the official web app is
  the only stable, complete, and policy-safe path.
- The Messenger web app already implements everything we need (messages, attachments, audio messages,
  calls, reactions, etc.). Chromium (which Electron embeds) handles audio playback and media capture
  natively.
- One Electron codebase packages to **macOS (.dmg), Windows (.exe/nsis), and Linux (.AppImage + .deb)**
  via `electron-builder` — true cross-platform from a single source.
- This is the same proven approach used by the popular open-source Caprine client.

The wrapper's job is the "native desktop" glue the web app can't do on its own:
- Persistent login session (`partition: 'persist:messenger'`).
- Open non-Messenger links in the default browser (`shell.openExternal`).
- Grant microphone/camera permissions for voice messages and calls.
- Attachment download handling.
- Native window chrome, app menu, system tray, window-state persistence.

## Working agreements (per user)

- **Document every move in this `HANDOFF.md`.**
- **Make a versioned backup in `backups/` before editing any existing file.** Backups are named
  `backups/<original-filename>.<ISO-ish-timestamp>.bak`. Brand-new files don't need a backup.

---

## Project layout

```
Messenger/
├── package.json          # app metadata, scripts, electron-builder config (Kausapp / ph.coders.kausapp)
├── HANDOFF.md            # this file
├── README.md             # user-facing download/build/run instructions
├── ABOUT.md              # detailed teaser/marketing doc (also uploaded to irc.coders.ph:~/Kausapp/)
├── MONETIZATION.md       # monetization strategy & guardrails (planning/reference)
├── .github/workflows/build.yml   # CI: build mac/win/linux installers, attach to Release on v* tag
├── .gitignore
├── src/
│   └── main/
│       ├── main.js       # Electron main process (window, menu, tray, permissions, links, no-throttle)
│       └── preload.js    # isolated bridge into the page (currently minimal)
├── assets/
│   ├── make_icon.py      # generates icon.png / icon_512.png / icon.ico (Pillow)
│   ├── build_icns.sh     # generates icon.icns (sips + iconutil, macOS)
│   └── icon.{png,ico,icns}, icon_512.png   # original speech-bubble app icon
├── backups/              # versioned backups of edited files (<name>.<timestamp>.bak)
└── release/              # build output: Kausapp-*.dmg etc. (gitignored)
```

---

## Changelog

### 2026-06-13 — OLED only-in-dark-mode guard → v0.1.10
- Bug: enabling OLED on a **light** page (login screen, or Messenger in light mode) forced
  backgrounds black → dark text invisible → "just a black window." Confirmed via repro.
- Fix (`main.js`): `applyOledTheme` now checks `pageIsDark()` (body bg luminance < 110) and **only
  injects OLED when the page is actually dark**; the menu toggle shows a hint ("turn on Messenger
  Dark mode first") when blocked; on load it retries the dark-guarded apply briefly (SPA settle /
  login→app). CSS-scoping to `.__fb-dark-mode` was not viable (marker absent on login page / not on
  a stable element), so the guard lives in the app.
- Context (recent, since v0.1.9): OLED reworked to **token-based** (paint surfaces/popovers black via
  FB design tokens, drop blanket transparency) — fixed transparent search dropdown + restored bubble
  colors; then stopped the broad `[style*=gradient]` rule blacking **bubble** gradients (default
  "own" bubbles were turning black instead of blue) — now only the specific wallpaper div is killed.
- Also recently: rebrand Kausapp→**KausApp** (v0.1.8), consistent self-signed mac signing (v0.1.9),
  footer logo → "Coders Republic (coders.ph)" text, **~/ops onboarding** (admin re-ported to
  127.0.0.1:**8800**, registry updated), and `PLAN-MULTI-SERVICE.md` (scope: multi-service container
  of official web apps + theming; no integration).

### 2026-06-11 — admin.kausapp.com: root cause = tailscale-serve owns :443 → switched to HTTP
- "Can't open admin.kausapp.com" (TLS `internal_error` over the tunnel) root cause found:
  **`tailscale serve` owns TCP :443 on the tailnet IP** (config: `TCP 443/8443 HTTPS:true` for
  `hackpixels-droplet.tail5822ec.ts.net`). It intercepts all 443 to 100.99.99.75 and terminates TLS
  with the .ts.net cert — so a custom-domain HTTPS vhost (admin.kausapp.com) can't terminate at Caddy
  there → clients get `internal_error`. (Droplet→itself bypassed it; `:8080`/`:80` aren't intercepted.)
  Not MTU — tested MSS clamping (added then removed iptables OUTPUT+PREROUTING TCPMSS rules; no effect).
- **Solution:** serve the admin over **HTTP on :80** via Caddy (`http://admin.kausapp.com { reverse_proxy
  100.99.99.75:8080 }`). Port 80 isn't intercepted; tailnet is WireGuard-encrypted so HTTP is safe.
  ✅ **http://admin.kausapp.com now works (clean, no port).** Replaced the old redirect/tls block;
  repo snippet `admin/admin.caddy` updated. Clean HTTPS on :443 not feasible without disturbing the
  existing tailscale-serve setup (server.hackpixels.com/files.coders.ph).
- (User authorized the droplet firewall/Caddy changes directly.)

### 2026-06-11 — Rebrand fully live + Tailscale deploy unblock
- **Website rebrand deployed** to kausapp.com (KausApp on homepage + /download), after unblocking
  the Tailscale network issue.
- **Tailscale root cause (diagnosed):** the tailnet advertises broad routes incl. a `default →
  utun10`; with `accept-routes` on, traffic to part of Cloudflare's range (api.cloudflare.com,
  104.19.x) was hijacked into the tailnet and timed out — breaking wrangler + the app's Node fetch,
  while the site edge IPs (104.21.x) still worked. Set **`tailscale set --accept-routes=false`** (kept
  100.x tailnet/admin access). That fixed IPv4; Node still tried blackholed IPv6, so deploys use
  **`NODE_OPTIONS=--dns-result-order=ipv4first`**. Site deployed successfully that way.
  - To restore: `tailscale set --accept-routes=true` (re-blocks local CF deploys → use CI deploy then).
- **Admin redeploy gotcha:** the bulk `Kausapp→KausApp` sed also rewrote the **filesystem paths** in
  `admin/kausapp-admin.service` (`/home/acronix/Kausapp/...` → `/KausApp/...`), breaking the unit
  (env file not found). Reverted the path lines to `Kausapp` (real droplet dir); Description stays
  "KausApp". Admin service active again, titled "KausApp — Bug Reports".

### 2026-06-11 — Consistent self-signed code-signing for in-place macOS updates → v0.1.9
- Root cause of "update isn't applying in place": macOS builds were **pure ad-hoc signed**
  (`codesign -s -`) = a NEW identity every build, so Squirrel.Mac won't swap in place. (RAVEIRC gets
  free in-place updates because it's **Tauri** — its updater verifies with its own minisign key,
  independent of OS code-signing; per `RAVEv4/docs/SIGNING.md`. Electron's macOS updater can't do that.)
- Fix: generated a **consistent self-signed code-signing cert** ("KausApp Self-Signed", code-signing
  EKU). Stored p12+password backup in `backups/signing/` (gitignored). Added GitHub secrets
  **CSC_LINK** (base64 p12) + **CSC_KEY_PASSWORD**.
- `package.json` build.mac: `identity: "KausApp Self-Signed"`, `hardenedRuntime: false`.
- `build/afterPack.js`: skip ad-hoc when `CSC_LINK` is set (CI signs with the cert; local stays ad-hoc).
- CI `build.yml`: pass CSC_LINK/CSC_KEY_PASSWORD to the **macOS job only**; removed
  `CSC_IDENTITY_AUTO_DISCOVERY=false`. Win/Linux still unsigned.
- ⚠️ The cert MUST stay constant forever (changing it breaks in-place updates) — keep
  `backups/signing/kausapp-codesign.p12` + password safe. Still self-signed → "unidentified developer"
  on first install (right-click Open).
- Plan: user downloads **v0.1.9** once (rename + consistent cert baseline); v0.1.9 → future updates
  apply in place on macOS. (Verify electron-builder actually signs with the cert in CI logs.)
- Pending: website deploy still blocked locally by Tailscale (wrangler "fetch failed"); download page
  still shows old branding until deployed from a non-Tailscale moment.

### 2026-06-11 — Rebrand display name Kausapp → KausApp (capital A) → v0.1.8
- Changed the **display name** everywhere to **KausApp** (app UI, dialogs, About, report window,
  website pages, ABOUT/README/WEBDEV/MONETIZATION docs, admin page title, Caddy/systemd descriptions,
  userstyle comments). Bulk `sed 's/Kausapp/KausApp/g'` on those files.
- **Deliberately left lowercase identifiers unchanged** (changing them would break things): npm
  `name` `kausapp`, `appId` `ph.coders.kausapp` (update continuity), GitHub repo `kausapp`, domain
  `kausapp.com`, Pages project `kausapp`, KV namespace ids, the droplet path `~/Kausapp/`, and the
  **existing v0.1.0 release asset URLs** in `site/download/index.html` fallback links.
- HANDOFF prior entries left as-is (historical; also reference the real `~/Kausapp/` path).
- New build artifacts will be `KausApp-<ver>.dmg`, `KausApp Setup <ver>.exe`, etc. ⚠️ macOS bundle
  name changes `Kausapp.app`→`KausApp.app`, so the v0.1.7→v0.1.8 auto-update may not apply in place on
  mac — users likely re-download v0.1.8 once from the site (Win/Linux: may leave the old install).
- **Blocker hit:** local `wrangler pages deploy` fails ("fetch failed") because this Mac is on
  Tailscale (same Node-network issue as the app). git push + ssh + GitHub CI are unaffected. Website
  rebrand deploy is committed/ready; needs one wrangler run from a non-Tailscale moment (or add a CF
  token to GH Actions to deploy the site from CI).

### 2026-06-11 — Fix "Restart now" not restarting (macOS) → v0.1.6
- Bug: the update-downloaded "Restart now" button didn't restart on macOS. Cause: the window
  `close` handler hides the app (keep-alive) on mac, so `quitAndInstall()`'s window close was
  intercepted → app never quit → update not applied.
- Fix: `updater.js` now calls an `onBeforeInstall` hook before `quitAndInstall()`; `main.js` passes
  `() => { isQuitting = true; }` so the close handler allows the quit. Cut **v0.1.6**.
- To get v0.1.6 from a pre-fix build: Check for Updates downloads it; if "Restart now" still no-ops,
  fully **Quit (Cmd+Q)** and reopen — `autoInstallOnAppQuit` applies it on quit.

### 2026-06-11 — OLED: strip per-chat gradient theme ("weird" chat background)
- User's "weird chat background" turned out to be a **Messenger per-conversation chat theme**
  (purple/blue gradient wallpaper) — confirmed by viewing the **screenshot in their in-app bug
  report** (the whole report→KV→admin pipeline paid off: fetched the report via the admin secret,
  decoded the screenshot, saw the gradient). Left list + right pane were already black.
- Fix (hosted `oled.css` + bundled fallback): strip gradient backgrounds (`[style*="gradient"]` →
  `#000`), which removes chat-theme wallpapers while leaving url() avatars/photos intact. Deploy +
  reload applies it (no app release). Earlier fix also forced main regions solid black + removed gray
  dividers/shadows.
- Workflow note: bug-report screenshots are now a usable debugging channel — pull newest via the
  admin API with ADMIN_SECRET, base64-decode the screenshot.

### 2026-06-11 — Switch footer logo to provided SVG (coders_minimal.svg)
- User supplied `coders_minimal.svg` — a self-contained **dark-card** logo (white "coders" + red "o",
  red accents on a dark rounded card, designed for dark backgrounds). Copied to `site/coders-logo.svg`.
- Updated both footers to use the SVG and **removed the white chip** (no longer needed — the SVG is its
  own dark card); kept a soft drop shadow, height ~48–52px. Removed `site/coders-logo.png`.
  Deployed + verified.

### 2026-06-11 — Use the real Coders Republic logo in footers
- Replaced the flat white-knockout with the **actual** brand logo from coders.ph
  (`logo-full-white.png` → `site/coders-logo.png`). Since its text is dark (made for light bgs), it
  now sits on a clean **white chip** (rounded, padded, soft shadow) so it's legible on the black
  footers. Updated both `site/index.html` + `site/download/index.html`; removed `coders-logo-white.png`.
  Deployed + verified live.

### 2026-06-11 — admin.kausapp.com: switch to redirect (reverse_proxy wouldn't load on client)
- The direct reverse_proxy + `remote_ip 100.64.0.0/10` block served fine from the droplet but the
  user's tailnet device couldn't load `admin.kausapp.com` (IP:8080 worked). DNS confirmed grey-cloud
  (→100.99.99.75), so not a proxy issue — likely the remote_ip/reverse_proxy path.
- Per user request, changed the Caddy block to a **redirect**: `admin.kausapp.com` keeps its DNS-01
  cert and `redir`s to `http://100.99.99.75:8080{uri}` (the working tailnet URL). Restored the
  pre-admin Caddyfile from backup, appended the redirect block, reloaded. Verified: 302 →
  http://100.99.99.75:8080 → 200. Repo snippet `admin/admin.caddy` updated to match.

### 2026-06-11 — Fix main-process HTTP on Tailscale (report send + remote userstyles) → v0.1.7
- Symptom: bug report failed with "fetch failed" (with or without screenshot), AND the OLED gradient
  fix "came back" — both while the user was on Tailscale (for admin.kausapp.com). Root cause: the
  app's MAIN process used Node's global `fetch` (system network stack), which breaks on the Tailscale
  network (likely IPv6/routing). Chromium (renderer) is unaffected, so messenger.com/site pages load
  fine. The broken main-process fetch failed the report POST and the remote userstyle fetch (→ fell
  back to the stale bundled CSS, so the gradient reappeared).
- Fix: use Electron's **`net.fetch`** (Chromium network stack) instead of Node `fetch` for both the
  report POST and `loadStyleCss`. Bundled `userstyle-oled.css` also already carries the latest fixes.
- Cut **v0.1.7**. Immediate workaround for the user pre-update: temporarily disconnect Tailscale, then
  report send + remote CSS work.

### 2026-06-11 — Clean https://admin.kausapp.com (Caddy + DNS-01)
- User wanted the clean HTTPS URL (no `:8080`). The droplet runs **Caddy** (not nginx) on 80/443,
  already with the **cloudflare DNS module** + `{env.CF_API_TOKEN}` (used by `files.coders.ph`).
- Added a Caddy site block (`admin/admin.caddy`, appended to `/etc/caddy/Caddyfile`) serving
  **admin.kausapp.com** with a real Let's Encrypt cert via **Cloudflare DNS-01** (HTTP/TLS-ALPN can't
  work — domain points to a private tailscale IP), reverse-proxying to the admin on `100.99.99.75:8080`.
  Tailnet-only enforced via `remote_ip 100.64.0.0/10` (else 403).
- Caddyfile backed up before edit; validated; `systemctl reload caddy`. Verified from a tailnet source:
  **HTTP 200, ssl_verify=0 (valid cert)**, renders Bug Reports. Token covers kausapp.com (cert issued).
- **Now live: https://admin.kausapp.com** from any tailnet device (the `:8080` direct URL still works too).
- Note: couldn't (and didn't need to) read the CF token — guardrail blocked the sudo secret read;
  Caddy references `{env.CF_API_TOKEN}` itself.

### 2026-06-11 — Tailscale admin LIVE (admin.kausapp.com)
- Created DNS **`admin.kausapp.com` A → 100.99.99.75** (DNS-only/grey-cloud) using the user's
  `~/.cf_dns` token (DNS:Edit; it lacked KV read).
- **Re-architected to avoid a KV token on the droplet:** added secret-protected
  `functions/api/reports.js` (`GET` list / `POST` delete, guarded by **ADMIN_SECRET**) — the Pages
  Function has the KV binding, so no Cloudflare credential lives on the droplet. Set `ADMIN_SECRET`
  via `wrangler pages secret put`. Verified: authorized 200, unauthorized 401.
- Rewrote `admin/server.py` to fetch reports from `https://kausapp.com/api/reports` with the shared
  secret (env `ADMIN_SECRET`). Added a browser User-Agent — Cloudflare error **1010** was blocking
  the default Python-urllib UA.
- Deployed on droplet: `~/Kausapp/admin/` + `kausapp-admin.env` (chmod 600) + systemd unit
  `kausapp-admin` (enabled, active, binds **100.99.99.75:8080**). Passwordless sudo available.
- **Live at `http://admin.kausapp.com:8080`** from any tailnet device. (Port 80 on the droplet is
  taken by nginx; clean port-80 URL would need an nginx vhost — optional follow-up.)
- Note: KV `list()` is eventually consistent (~up to 60s) so new reports take a moment to appear.
- Security: removed local `/tmp` secret copy and `~/.cf_dns` after use; recommend rolling that token.

### 2026-06-11 — Admin not opening — diagnosis
- `admin.kausapp.com` has **no DNS record** yet; droplet admin service **not installed/running**
  (port 8080 idle); **no KV token** on the droplet. (Droplet tailscale IP confirmed 100.99.99.75;
  note **port 80 is already in use** there — likely nginx — so admin will use :8080 or need an nginx
  vhost.)
- The wrangler OAuth credential is **zone:read only** → cannot create DNS (verified: auth error).
  Need a Cloudflare API token with **DNS:Edit (kausapp.com)** + **Workers KV Storage:Read** to create
  the record and run the admin. Pending user-provided token in `~/.cf_token`.

### 2026-06-10 — Remote-hosted userstyles → v0.1.5 (theme tweaks need no app release)
- Userstyles now **fetched from kausapp.com at runtime**, with the bundled `src/main/userstyle-*.css`
  as offline fallback. `main.js`: added `loadStyleCss(name, localPath)` (fetch
  `https://kausapp.com/styles/<name>.css?t=<ts>` no-store → text, else local file); `toggleUserStyle`
  now takes a style name.
- Published `site/styles/oled.css` + `site/styles/compact.css` (served, verified HTTP 200).
- Cut **v0.1.5**. **From now on, theme iteration = edit `site/styles/*.css` + `wrangler pages deploy
  --branch main`; users just reload the app (toggle off/on or Cmd/Ctrl+R) — no new release.**
  Keep `site/styles/*` and `src/main/userstyle-*` in sync (bundled = fallback).

### 2026-06-10 — OLED theme: force ALL surfaces black → v0.1.4
- User reported OLED wasn't fully black (token overrides missed surfaces). Rewrote
  `userstyle-oled.css` to the robust "transparent containers over a black root" technique:
  black `html/body/#facebook`, token overrides, then `background-color: transparent` on all
  structural containers (div/section/nav/li/table/etc.) so the black root shows through everywhere.
  Deliberately does NOT clear `background-image` (preserves avatars/photos). Restores Messenger-blue
  accent (bubbles, Send) + faint input backgrounds for usability.
- Cut **v0.1.4**.
- **Note on iteration:** tuning userstyles via full releases is slow. Faster loops to offer the user:
  (a) `npm start` re-applies the CSS instantly; (b) optionally host userstyles on kausapp.com and have
  the app fetch them at runtime (decouples theme tweaks from app releases).

### 2026-06-10 — Pure black (OLED) theme → v0.1.3
- Added **View → "Pure black (OLED) theme"** toggle. Injects `src/main/userstyle-oled.css` which
  forces Messenger's dark surfaces to true `#000` (overrides FB design-token CSS vars + html/body +
  common dark grays). Best with Messenger's own Dark mode on. Persisted via `oledTheme` setting.
- Refactored userstyle injection into a generic `toggleUserStyle()` helper (used by both compact
  sidebar and OLED), re-applied on `did-finish-load`.
- Cut **v0.1.3** batching the OLED theme + the 90% default zoom so they're testable via Check for
  Updates. (Userstyles default OFF, so no impact unless toggled; still unverified blind — refine
  selectors from a screenshot if they look off.)

### 2026-06-10 — Admin scaffolding, website on droplet, web-dev docs, smaller default zoom
- **Droplet web dev**: uploaded the website dev files to `irc.coders.ph:~/Kausapp/website/`
  (`site/`, `functions/`, `wrangler.toml`) so web dev can continue from the droplet. Droplet has
  Python 3.12 but **no Node** — deploying from there needs Node + wrangler (documented).
- **`WEBDEV.md`** (repo root) — full website dev/deploy guide (structure, KV ids, API endpoints,
  `wrangler pages deploy --branch main`, deploy-from-droplet via Node install or `CLOUDFLARE_API_TOKEN`,
  data viewing). Uploaded to droplet as `~/Kausapp/website/README.md`.
- **Tailscale admin (code complete; deploy pending token)**: droplet has Tailscale at
  **100.99.99.75** (tailnet name `hackpixels-droplet`). Built `admin/server.py` (Python stdlib, no
  deps) that reads the REPORTS KV via the CF API and renders reports (desc, version, platform, ts,
  screenshot) + Delete. Plus `admin/kausapp-admin.service` (systemd) + `kausapp-admin.env.example` +
  `admin/README.md`. Access model: **admin.kausapp.com → 100.99.99.75 via DNS-only A record**
  (tailnet-only; WireGuard-encrypted so plain HTTP is fine). **Pending:** a CF API token with
  "Workers KV Storage: Read" on the droplet + the DNS A record → then enable the service.
- **Default zoom**: app now defaults to **90%** (`DEFAULT_ZOOM`, one step smaller) for a denser feel;
  applied on load, respects a saved `zoomFactor`. (Not released yet — will batch into next version.)
- Note: user's trailing "also…" message was cut off — awaiting the rest.

### 2026-06-10 — Check for Updates menu + version display + bug reporting → v0.1.2
- **Check for Updates…** added under the **Help** menu. `updater.js` reworked to expose a manual
  `checkForUpdates()` that shows dialogs (checking → "up to date" / "update available" / error). The
  background auto-check (launch + 6h) is unchanged.
- **Version display:** Help menu shows `Kausapp v<version>` (disabled label), plus website +
  release-notes links; native **About panel** populated via `app.setAboutPanelOptions`.
- **Report a Bug…** (Help menu): captures a screenshot of the current Messenger view
  (`capturePage()`), opens a modal window (`report.html` + `report-preload.js`) with a description
  box + screenshot preview + "attach screenshot" toggle, then POSTs to `/api/report`.
  - Backend: `functions/api/report.js` Pages Function stores reports in new KV namespace **REPORTS**
    (`ce3a8a24c91b4797a3dedf4d78e3fb7c`), key `report:<ts>-<uuid>`, value includes description,
    screenshot data URL (capped ~6MB), version, platform, ua, country. Tested live (200/ok), KV clean.
- Bumped **0.1.1 → 0.1.2**; cutting the release so the installed app can pull it via Check for Updates.
- **Correction (re: earlier macOS note):** ad-hoc/self-signed macOS auto-update CAN apply as long as
  old+new builds share a consistent signing identity (user confirmed it works on their RAVEIRC app).
  Will verify empirically on v0.1.2; if the ad-hoc per-build signature fails Squirrel's check, switch
  to a stable self-signed cert (no paid Apple account needed).
- **Admin (pending):** decided design = **admin.kausapp.com → droplet's Tailscale IP (DNS-only)**, so
  only tailnet devices can reach it. To build next: admin viewer app on the tailscale droplet reading
  the REPORTS KV, + the DNS record. (A public CF URL can't be Tailscale-gated; this routes the
  hostname to a private 100.x IP instead.)

### 2026-06-10 — Compact chat list (collapse left menu to icons) — experimental
- Added a **View → "Compact chat list (icons only)"** checkbox that injects a userstyle collapsing
  Messenger's left conversation list to an avatar-only rail. Persisted in `userData/settings.json`.
- New files/wiring: `src/main/userstyle-compact.css` (the CSS), plus settings load/save +
  `applyCompactSidebar()` (insertCSS/removeInsertedCSS) + re-apply on `did-finish-load` + the menu
  toggle in `main.js`.
- **Caveat:** messenger.com classes are obfuscated, so the CSS targets `role`/`aria-label="Chats"`
  selectors (more stable) — but it's **unverified visually** (can't reach the logged-in DOM from
  the build env). Needs the user to test via `npm start` and refine selectors from a screenshot /
  DevTools. Not released yet (source only) to avoid burning a release on an unverified style.
- Settings module (`loadSettings`/`saveSettings`) is now reusable for future prefs.

### 2026-06-10 — Fix "app is damaged" (ad-hoc signing) → v0.1.1
- User hit **"Kausapp is damaged and can't be opened"** when installing the downloaded dmg. Cause:
  the app was **entirely unsigned**; macOS (esp. Apple Silicon) flags unsigned quarantined downloads
  as "damaged".
- **Immediate workaround given to user:** `xattr -dr com.apple.quarantine /Applications/Kausapp.app`.
- **Build fix:** added `build/afterPack.js` (referenced via `build.afterPack`) that **ad-hoc signs**
  the macOS `.app` (`codesign --force --deep --sign -`). Verified locally → `Signature=adhoc`. This
  downgrades the error from "damaged" to the milder "unidentified developer" (right-click → Open).
- **Still NOT fully fixed:** removing the warning entirely needs a paid Apple Developer ID +
  notarization. Tracked as TODO. (Windows/Linux unaffected.)
- Bumped version **0.1.0 → 0.1.1** and cut the release so the download page (auto-tracks latest)
  serves the ad-hoc-signed build.

### 2026-06-10 — Coders Republic logo in footers + download→home link
- coders.ph only ships `logo-full-white.png` which is actually a **dark** logo (for light bgs).
  Generated a **white-knockout** version (`site/coders-logo-white.png`, white text + brand-red "o")
  via PIL for our black footers. Removed the unused dark source from `site/`.
- Replaced the "Coders Republic" text link with the logo (linked to coders.ph) in both
  `site/index.html` and `site/download/index.html` footers.
- Added a **"← Back to home"** link (top-left) on the download page → `/`.
- Deployed to production (note: must pass `--branch main` to wrangler or the deploy lands as a
  preview and kausapp.com won't update). Verified logo + back-link live on kausapp.com.

### 2026-06-10 — Download page at /download (unlisted)
- Added **`site/download/index.html`** → live at **https://kausapp.com/download**. Black/blue themed,
  OS-detected primary button + cards for all platforms (mac arm64/intel, win exe, linux AppImage/deb).
- Links are hardcoded to the v0.1.0 release (work with no JS) and **auto-upgrade to the latest
  release** via the GitHub API (`/releases/latest`), with version label auto-updating too.
- **Not linked from the homepage** (per user) — direct URL only. Also `noindex,nofollow` so it stays
  out of search until launch. Verified: homepage has no `/download` reference.
- This is the QA/test + distribution entry point for the installable app.

### 2026-06-10 — v0.1.0 released (all platforms) + macOS dmgs rebuilt with new icon
- Cut **v0.1.0**: bumped nothing (already 0.1.0), tagged `v0.1.0`, pushed → CI built all 3 platforms
  green and `softprops/action-gh-release` published the (non-draft) Release.
- **Release URL:** https://github.com/codexv/kausapp/releases/tag/v0.1.0
- Assets attached: mac `dmg` (intel + arm64) + `zip` (intel + arm64), Windows `Kausapp.Setup.0.1.0.exe`,
  Linux `.AppImage` + `_amd64.deb`, plus blockmaps and the update feeds `latest.yml` /
  `latest-mac.yml` / `latest-linux.yml`. The auto-updater is now live against this feed.
- These CI-built artifacts include the **new black/blue icon** (built from current main). The local
  `release/` dmgs were also rebuilt with the new icon during the updater work.
- **How to ship an update going forward:** bump `version` in package.json → commit → `git tag vX.Y.Z
  && git push origin vX.Y.Z`. CI builds + publishes the Release; installed apps detect it on next
  launch / 6h check and self-update (Windows + Linux; macOS once signed).

### 2026-06-10 — Auto-update system (electron-updater + GitHub Releases)
- Added the standard Electron auto-update flow so updates can be pushed by just publishing a new
  GitHub Release.
- `electron-updater` added to dependencies. `build.publish` set to GitHub (`owner: codexv,
  repo: kausapp`) so electron-builder embeds `app-update.yml` and emits `latest*.yml` feed files.
- macOS: added a **`zip`** target alongside `dmg` (Squirrel.Mac requires the zip for updates).
- **`src/main/updater.js`** — `initAutoUpdates()`: no-op when `!app.isPackaged` (dev); on launch +
  every 6h checks GitHub, auto-downloads in background, and on `update-downloaded` shows a
  "Restart now / Later" dialog (also installs on next quit). Errors are logged, never nag.
- Wired into `main.js` (`initAutoUpdates(() => mainWindow)` after window creation).
- Rebuilt macOS locally → dmg + zip + blockmaps + `latest-mac.yml` (verified, references v0.1.0).
- CI workflow: added `release/*.zip` to the upload/release globs (was missing → mac updates would
  have lacked their artifact).
- **Caveat:** macOS auto-update requires the app to be **code-signed + notarized** (Squirrel.Mac
  validates the signature) — Windows (NSIS) and Linux (AppImage) auto-update work unsigned. So mac
  auto-update is wired but won't fully apply until we add an Apple Developer cert. Tracked as TODO.

### 2026-06-10 — Real email capture (Cloudflare Pages Function + KV)
- Replaced the notify form's `mailto:` with a real, self-owned signup endpoint.
- Created KV namespace **SUBSCRIBERS** (id `931015b6e7054ed386a825f5188e0979`).
- Added **`wrangler.toml`** (name `kausapp`, `pages_build_output_dir = "site"`, KV binding) so the
  Pages project bundles Functions + binds KV. Deploy command is now `npx wrangler pages deploy`
  (no positional dir — reads config).
- Added **`functions/api/subscribe.js`** — Pages Function: `POST /api/subscribe` validates the email,
  stores `sub:<email>` → JSON `{email, ts, ua, country}` in KV (idempotent). Non-POST → 405.
- Updated `site/index.html` form JS to `fetch('/api/subscribe')` with success/error states.
- Verified live on kausapp.com: valid → `{ok:true}` 200 (KV key created), invalid → 400, GET → 405.
  Removed the test entry; KV starts empty.
- **Viewing signups:** `npx wrangler kv key list --namespace-id=931015b6e7054ed386a825f5188e0979
  --remote` (or dashboard → Workers & Pages → KV → SUBSCRIBERS). Read one:
  `wrangler kv key get --namespace-id=… "sub:<email>" --remote`.
- `.gitignore`: added `.wrangler/` cache dir.
- TODO: optional double opt-in / export-to-CSV / notify-on-launch broadcast.

### 2026-06-10 — Rebrand colors to black & blue
- User disliked the purple theme → switched brand to **black & blue**, then specified the page
  **background should be black** (not a blue gradient).
- **Icon** (`assets/make_icon.py`): gradient changed indigo→violet ⇒ **black (8,10,18) → blue
  (20,86,255)**; typing dots changed violet ⇒ **blue (20,86,255)**. Regenerated
  `icon.png/icon_512.png/icon.ico/icon.icns`; copied PNGs to `site/`.
- **Landing page** (`site/index.html`): body background now **solid black** with subtle blue radial
  glows (behind logo + rising from bottom); accents (button, badge, pills, links, dots, logo glow)
  switched to blue (`--blue #1456ff`). Removed the old gradient `drift` animation.
- Redeployed to Cloudflare Pages (production). Verified kausapp.com serves the black-bg/blue page;
  old purple (`a440d6`) removed.
- App icon used in installers is now black/blue too (consistent brand). No rebuild cut yet.

### 2026-06-10 — Dropped kausapp.coders.ph; kausapp.com is the sole canonical domain
- Per user: move everything to kausapp.com and drop kausapp.coders.ph.
- `kausapp.coders.ph` was never actually created (no DNS record existed) — it was only a *planned*
  subdomain referenced in docs, so nothing to tear down on Cloudflare. Earlier `kausapp.com` redirect
  TODO is therefore void.
- Updated references to point at kausapp.com: `package.json` homepage, `README.md` official-site
  link, `MONETIZATION.md` domain section. GitHub repo homepage updated to `https://kausapp.com` via
  `gh repo edit`. (`site/index.html` already used kausapp.com in its meta — unchanged.)
- Prior changelog entries that mention kausapp.coders.ph are left as-is (accurate historical record).

### 2026-06-10 — kausapp.com LIVE
- Resolved the custom-domain DNS blocker. First DNS-edit token the user supplied was scoped to the
  `coders.ph` zone only (auth error on kausapp.com). User updated the token to cover kausapp.com.
- Via the token (read from `~/.cf_token`, never echoed): zone had **0** DNS records (so the earlier
  "pending" was simply no DNS at all). Created two proxied CNAMEs in zone
  `44a1dccbe614e8ba2fbea9da6b465475`: `kausapp.com → kausapp.pages.dev` and
  `www.kausapp.com → kausapp.pages.dev`.
- Verified live: both apex and `www` return **HTTP 200 with valid SSL** and the correct page
  (title + "Coming Soon"). (Local Tailscale resolver lagged on the new records; confirmed via public
  resolver 1.1.1.1 + pinned Cloudflare edge IP.)
- **kausapp.com is now serving the coming-soon page.** `kausapp.coders.ph` redirect + real email
  capture still TODO.
- Security: `~/.cf_token` removed after use; recommend rolling that Cloudflare token.

### 2026-06-10 — Coming-soon landing page (kausapp.com)
- User registered **kausapp.com** on Cloudflare; wants a "coming soon" page.
- Created **`site/`** — a self-contained static landing page:
  - `site/index.html` — branded (indigo→violet gradient matching the icon), animated logo,
    "Coming Soon" badge, tagline, platform pills (macOS/Windows/Linux), email "Notify me" form
    (currently `mailto:hello@coders.ph` — swap for a real list before launch), Coders Republic
    footer, Meta non-affiliation disclaimer, Open Graph/social meta + favicon.
  - `site/icon.png`, `site/icon_512.png` — copied from assets for the page + social preview.
- Deployment: tooling check — `wrangler` not installed (use `npx`), no `CLOUDFLARE_API_TOKEN` in
  env, `cloudflared` present. **Deploy requires the user's Cloudflare auth** → pending choice of
  method (wrangler+token / Pages git-integration / droplet). Page committed to the repo so
  Cloudflare Pages can build from `site/`.
- **Deploy method (revised per user): Cloudflare Pages direct upload via wrangler**, with app
  installers delivered separately via GitHub Releases ("let git handle the app delivery"). The
  dashboard git-integration flow was abandoned as more confusing.
- **Deployed.** User authenticated wrangler via `wrangler login` (OAuth, account
  `acronix@coders.ph`, account id `30951f274c5ebe109b224b63bc6de688`). Created Pages project
  `kausapp` and deployed `site/` → **live at https://kausapp.pages.dev** (HTTP 200, valid SSL,
  correct title verified).
- **Custom domains** `kausapp.com` + `www.kausapp.com` attached to the Pages project via the
  Cloudflare API (using the wrangler OAuth token). Zone is active and in the same account.
- **Blocker (handoff to user):** domains stuck at `pending` — DNS records were not auto-created and
  the wrangler OAuth token only has `zone:read` (no `dns_records:edit`), so DNS can't be created from
  here. User to either (A) add two CNAMEs in the dashboard — `@` → `kausapp.pages.dev` (proxied) and
  `www` → `kausapp.pages.dev` (proxied), deleting any conflicting apex parking record — or (B)
  provide an API token with `Zone→DNS→Edit` so this can be finished here. Once DNS points to Pages,
  domains go active + SSL auto-provisions.
- Note: redeploys are manual (`npx wrangler pages deploy site --project-name kausapp`) since we used
  direct upload, not git-integration. TODO: real email capture for the notify form (currently mailto).

### 2026-06-10 — Monetization strategy documented
- User plans to acquire **kausapp.com** and wants the project monetized; asked for insights.
- Created **`MONETIZATION.md`** capturing the full strategy. Core constraint: cannot legally
  paywall Messenger *access* (Meta Platform Terms) → monetize value we add, our audience, and
  Coders Republic's business instead.
- Paths (priority order): (1) **freemium on our own features** (multi-account, themes, advanced
  notifications, scheduling, privacy toggles) via Lemon Squeezy/Paddle, ~$15–25 one-time;
  (2) donations/supporter tier; (3) **kausapp.com as an SEO acquisition engine** (high-intent
  "Messenger desktop app" search demand) monetized via ads/affiliates/email list on the *site*;
  (4) **Coders Republic lead-gen / white-label** desktop-client service (likely highest value).
- Guardrails noted: code-sign before charging, stay descriptive (not branded), publish
  Privacy Policy + Terms, never sell/scrape data, skip app stores (direct download from kausapp.com).
- Domain plan: make `kausapp.com` primary; redirect `kausapp.coders.ph` → it.
- Recommended sequence: free + code-sign + SEO now → 2–3 Pro features + freemium in ~1 month →
  ride traffic for affiliates/Pro + CR client work. Treat license sales as small revenue; audience
  + lead-gen as the real prize. (Strategy, not legal advice — review Meta terms before paid launch.)

### 2026-06-10 — GitHub repo + cross-platform CI (all green)
- Public repo created: **https://github.com/codexv/kausapp** (account `codexv`; no org). Homepage set
  to `https://kausapp.coders.ph` (planned hosting site); topics added.
- `.github/workflows/build.yml` — matrix build on macOS/Windows/Linux. Push to main builds + uploads
  artifacts; a `v*` tag also attaches installers to a GitHub Release (`softprops/action-gh-release`).
  Build step uses `--publish never` + `CSC_IDENTITY_AUTO_DISCOVERY=false` (unsigned for now).
- `.gitignore` updated to exclude local `backups/` and `assets/icon.iconset/` from the repo.
- `package.json` homepage → `kausapp.coders.ph`; README download section points to the site.
- **First CI run**: macOS ✓ + Windows ✓, **Linux ✗** — `.deb` needs a maintainer email. Fixed by
  adding `build.linux.maintainer = "Coders Republic <kriokaze@gmail.com>"`. (TODO: swap to a real
  coders.ph address before public launch.)
- **Rebuild: all three platforms green** — macOS (.dmg), Windows (.exe/NSIS), Linux (.AppImage + .deb).
  Tagging `v0.1.0` will produce a downloadable Release with all installers.
- Note: harmless CI annotation about Node 20 actions being deprecated (works until Sept 2026).

### 2026-06-10 — Branding (Kausapp), icon, installers, ABOUT.md + droplet upload
- **Naming**: publisher = **Coders Republic (coders.ph)**. App name decided as **"Kausapp"**
  (Filipino *kausap* = "person you talk with"; doubled "p" embeds "app"; coined name → better for
  trademark/domain than the plain dictionary word "Kausap"). Briefly set to "Kausap" then switched
  to "Kausapp" per user.
  - Edited `package.json`: name `kausapp`, productName `Kausapp`, appId `ph.coders.kausapp`,
    author/homepage = Coders Republic. (Backed up before each edit → `backups/`.)
  - Edited `src/main/main.js`: window title, tray tooltip, tray menu label → "Kausapp".
- **Icon** (original artwork, NOT Meta's logo — required for distribution under our own name):
  - `assets/make_icon.py` (Pillow) generates a 1024px indigo→violet squircle with a white speech
    bubble + three typing dots → `icon.png`, `icon_512.png`, `icon.ico`.
  - `assets/build_icns.sh` (sips + iconutil) builds `icon.icns` for macOS.
- **Installers built locally** (macOS, code-signing skipped — no cert yet):
  `release/Kausapp-0.1.0.dmg` (Intel, 97MB) + `release/Kausapp-0.1.0-arm64.dmg` (Apple Silicon,
  91MB) via `npm run dist:mac`. Win/Linux installers to be produced via CI (need their own OS).
- **`README.md`** rewritten with Kausapp branding, download table, trademark disclaimer, build/icon
  instructions. (Backed up first.)
- **`ABOUT.md`** created — detailed, teaser-ready marketing doc for coders.ph (overview, why,
  full categorized feature list, tech, privacy, roadmap, legal). Expanded from an initial short
  version per user request.
- **Droplet upload**: target clarified to `irc.coders.ph` (user `acronix`, home `/home/acronix`).
  Note: originally given as `server.coders.ph` (does not resolve) — confirmed correct host with
  user before connecting. Created `~/Kausapp/` and uploaded `ABOUT.md` (5379 bytes, 124 lines).
  Verified present on server.

### 2026-06-10 — Real-time delivery + boot fixes
- `npm install` completed (369 packages). Note: 6 high-severity advisories are all in
  `electron-builder` **build-time** transitive deps (not shipped in the app); non-blocking.
- **Real-time/no-glitch requirement** (user): disabled Chromium background throttling so the
  Messenger push connection (MQTT/WebSocket) and renderer timers keep running at full speed even
  when the window is hidden/minimized/occluded. Backed up `main.js` first → `backups/`.
  - Added command-line switches: `disable-background-timer-throttling`,
    `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows`,
    `disable-features=CalculateNativeWinOcclusion`.
  - Added `backgroundThrottling: false` to the BrowserWindow `webPreferences`.
  - Net effect: messages/notifications arrive in real time regardless of focus state. Actual
    message sync is performed by the messenger.com web app itself (its own realtime stack), which
    we no longer let the OS throttle.
- **Boot fix**: `electron-context-menu` v4 is ESM-only and broke `require()` in our CommonJS main
  process (`ERR_REQUIRE_ESM`). Converted to a dynamic `import()` inside `app.whenReady()`.
  Backed up `main.js` first → `backups/`.
- **Smoke test**: `npm start` / `electron . --dev` boots cleanly. App loads, stays alive, no
  crash. Only console output is benign DevTools "Autofill.enable" warnings (DevTools-only noise).

### 2026-06-10 — Initial scaffold
- `git init` in an empty project directory. Toolchain present: Node v26.0.0, npm 11.12.1, git 2.54.0.
- Created directory structure: `src/main/`, `assets/`, `backups/`.
- **`package.json`** — Electron app config. Deps: `electron-context-menu`. Dev deps: `electron`,
  `electron-builder`. Scripts for `start`, `dev`, and per-platform `dist:*` builds. `build` block
  configures mac (dmg, x64+arm64), win (nsis x64), linux (AppImage + deb).
- **`src/main/main.js`** — main process. Implements:
  - BrowserWindow loading messenger.com with a desktop Chrome user-agent (so the full web app loads).
  - Persistent session partition (stay logged in across launches).
  - External-link handling via `setWindowOpenHandler` + `will-navigate` → `shell.openExternal`.
  - Permission handler granting media/notifications/clipboard/fullscreen, denying the rest.
  - Attachment download hook (`will-download`).
  - Application menu, system tray (skipped gracefully until an icon asset exists), window-state
    persistence (size/position in userData), single-instance lock, macOS hide-on-close behavior.
  - `electron-context-menu` for right-click copy/paste/save-image.
- **`src/main/preload.js`** — minimal `contextBridge` exposure; seam for future page injection.
- **`.gitignore`** — ignores node_modules, release, dist, logs, .DS_Store.

### Next steps (TODO)
- [ ] `npm install` and smoke-test `npm start` (verify messenger.com loads + login works).
- [ ] Add app icons to `assets/` (icon.png 512+, icon.icns for mac, icon.ico for win) so tray/build work.
- [ ] Verify: audio message playback, attachment send/receive, external link opening, voice call mic prompt.
- [ ] Cross-platform build test (`npm run dist:mac` etc.).
- [ ] Optional polish: unread badge count, desktop notifications passthrough, dark-mode sync.

---

## 2026-06-13 — OLED restart (minimal) + self-diagnosing theme capture → v0.1.12

User was done with the manual DevTools-inspect loop for the OLED sent-bubble-black
bug. Decision: **start the OLED theme over from scratch (minimal)** AND add a
**self-diagnosing capture** so neither side needs the console again.

- **`site/styles/oled.css` rewritten minimal & bubble-safe.** Backed up old file to
  `backups/oled.css.<ts>.bak`. New file ONLY blackens the backmost layers:
  `html, body, #facebook` → `#000`, plus the documented wash/nav/message-list
  background tokens. **Removed everything that could reach a bubble**: surface/card
  token overrides, the `.x9f619.x1ja2u2z.x18d0r48` wallpaper-kill (prime suspect —
  generic FB utility classes also land on bubble wrappers, forcing them black),
  the gradient rules, input/composer tinting. Messenger's native dark mode now
  owns bubbles/panels/popovers, so colors stay correct. Synced bundled fallback
  (`cp site/styles/oled.css src/main/userstyle-oled.css`). **Deployed to
  kausapp.com** (`wrangler pages deploy`) — takes effect at runtime, no app
  release needed for the bubble fix.
- **Self-diagnosing theme capture (`Help → Send Theme Diagnostics…`).** New
  `sendThemeDiagnostics()` in main.js runs `THEME_DIAG_SCRIPT` in the page via
  `executeJavaScript`: collects relevant `:root` CSS custom properties
  (bubble/surface/accent/wash/etc.) + the distinct non-transparent backgrounds in
  the `[role=main]` conversation (deduped by color+image+class, capped at 80) —
  which reveals the actual bubble color and the class carrying it. Captures a
  screenshot too, POSTs to `REPORT_ENDPOINT` with `kind:'diagnostics'`. Shows a
  confirmation dialog. **No console, one click.**
- **Backend (`functions/api/report.js`)** now accepts a separate `diagnostics`
  field (capped 200 KB, so it isn't subject to the 5000-char `description` cap)
  and a `kind` field. **Admin (`admin/server.py`)** renders diagnostics in a
  collapsible `<details><pre>` block and shows a `diagnostics` kind badge.
  Backend deployed with the site.

---

## 2026-06-15 — Multi-service shell + bottom bar + Settings panel → v0.2.0

Big architectural step (Direction A: wrap each service's OFFICIAL web app + our
theming; no bridges/scraping/unified-inbox). The app is no longer a single
Messenger window — it's a **shell** hosting one `WebContentsView` per service,
each with its own persistent session (independent login), kept warm for instant
switching. User chose a **bottom bar** layout + services: Messenger (existing),
WhatsApp, Instagram DMs, Telegram, Discord.

- **`src/main/main.js` rewritten** into a multi-service shell:
  - `SERVICES` registry (id/name/url/color/extra-hosts/themeable). Messenger keeps
    `persist:messenger` so the existing login survives; others get `persist:<id>`.
  - The shell BrowserWindow loads `shell.html` (its own webContents = the bottom
    bar chrome). Service `WebContentsView`s are added to `mainWindow.contentView`,
    sized to cover everything ABOVE the 56px bar; active one full-size, others
    zero-sized (kept alive → real-time stays warm for all). `setActive()` re-adds
    the view to bring it to top + focuses.
  - Per-service external-link handling (`isInternalToService` via registrable
    domain + per-service `extra` hosts; FB l.* shims still unwrapped/externalized).
  - Per-service session config (media/notif permissions + downloads).
  - Unread badges from `page-title-updated` (parse `(n)`); favicons from
    `page-favicon-updated` → pushed to the bar.
  - Theming (OLED/compact) now targets the **messenger view's** webContents; menu
    + settings toggles route there. Other services use native dark for now.
  - Bug report + theme diagnostics now capture the **active** service view.
- **New UI files:**
  - `shell.html` + `shell-preload.js` — the bottom bar: service icons (favicon w/
    monogram fallback), active pill + accent underline, unread badges, tooltips,
    `+` add, `⚙` settings. Window-draggable empty areas.
  - `settings.html` + `settings-preload.js` — slide-over Settings (own
    WebContentsView over the content area). Tabs: **Appearance** (OLED, compact,
    zoom stepper), **Services** (enable/disable + reorder, last-one-stays-on),
    **General** (launch-at-login, check updates, report bug, diagnostics, about).
- **Native menu** trimmed: Settings… (Cmd/Ctrl+,), Reload Service, per-active-view
  zoom, devtools; Help keeps updates/report/diagnostics. Tray unchanged.
- Verified: clean boot, all 5 favicons render in the bar, Messenger logged-in +
  OLED themed. NEEDS user test: switching, settings panel, the 4 new logins.

---

## 2026-06-16 — Code audit + cleanup pass (no new features)

Ran a full audit of the v0.2.0 shell (FULL-AUDIT.md brief: correctness →
security → completeness → a11y → perf → simplicity → design), then fixed all
findings. Snapshot taken first: `backups/audit-fix-20260616-005214/`.
Design reference chosen for the consistency pass: **Linear** (dark, dense, single
accent, tight token system).

**Correctness**
- OLED double-insert race: `applyOledTheme` now serialized with an `oledApplying`
  guard so the post-load retry interval can't insert the CSS twice while a
  network-fetched apply is in flight. `toggleUserStyle` re-checks `isDestroyed()`
  + slot after the await.
- Dead unread-badge `.dot` logic removed from `shell.html`.
- `shell:switch` restricted to `views.has(id)` (the bar only renders enabled).
- Off-screen window guard: `visibleWindowState()` drops a saved x/y that no
  longer lands on any connected display.
- `ensureServiceViews` no longer calls `loadSettings()` 3× in one ternary.

**Security / privacy**
- `functions/api/report.js`: per-IP/UTC-day soft rate limit (20/day) via `rl:*`
  KV keys (TTL 24h). `functions/api/reports.js` now lists with `prefix:'report:'`
  so rate-limit keys never surface as reports.
- "Send Theme Diagnostics" now shows an explicit consent dialog (screenshot +
  on-screen text leave the device) before capture; success copy made accurate.
- Added CSP meta to `shell.html` (allows remote favicons only) and `settings.html`.

**Completeness**
- Service load **error state**: views track `status` (loading/ready/failed);
  `did-fail-load` (main frame, non-abort) flags failed → main process hides the
  view (0×0) and the shell shows an error overlay with a **Retry** button
  (`shell:reload`). `did-start-loading` clears it on retry.
- `settings.html` `init()` wrapped in try/catch with a visible error note.
- `report.html` textarea got `maxlength=5000` + a live counter.

**Accessibility**
- Settings tabs: real `role=tablist/tab/tabpanel`, `aria-selected`, roving
  tabindex + arrow-key nav. Switches get a visible `:focus-visible` ring (the
  hidden input now fills the control). Reorder buttons + toggles labelled; tab
  emoji `aria-hidden`. Bottom-bar active service marked `aria-current`.

**Performance**
- Settings cached in memory (`settingsCache`) — no more synchronous disk read on
  every hot-path `loadSettings()` (was firing on each title/favicon update).
- `pushState()` debounced (50ms) to coalesce burst title/favicon events.

**Simplicity / design**
- Deleted the unused, stale `desktopMessenger` preload bridge (was `version:'0.1.0'`).
- Collapsed the `compactRef`/`oledRef` getter/setter wrappers into a `cssKeys`
  object. Hoisted the FB link-shim host list to one `FB_LINK_SHIMS` const.
- Removed the duplicate "Settings…" item from the View menu.
- Unified design tokens across shell/settings/report: single accent (#1456ff +
  one hover), one radius system (8/10/12 + pill), 8px-grid spacing, and matched
  the report window background to the app dark (#0a0a0c, was blue-tinted #0a0e1a).

**Known debt left as-is:** OLED still keys off Meta's obfuscated composer class
chain (`.x16sw7j7…`) — no clean fix without it; per-service theming for the 4
non-Messenger apps still pending.

Verified: `node --check` on all JS clean; no stale refs; dev build boots (via an
isolated `--user-data-dir`, since the installed app holds the single-instance
lock) and renders the bar + a service view with no JS errors. Shipped as
**v0.2.1** (committed + tagged; CI release build) and the Cloudflare functions
redeployed for the report rate limit.

---

## 2026-06-16 — Pure-black bars + frameless title bar → v0.2.2

User request: bottom bar pure black, plus a pure-black title bar at the very top.

- `main.js`: window now uses `titleBarStyle: 'hidden'` so the native gray title
  bar is gone. macOS keeps traffic lights (`trafficLightPosition {x:12,y:11}`);
  Windows/Linux get a black `titleBarOverlay` (symbolColor #e8eefc, height 36).
  New `TOP_BAR = 36`; `layout()` offsets all service/settings views to start at
  y=TOP_BAR with height `h - TOP_BAR - BAR_HEIGHT`.
- `shell.html`: bottom bar `--bar-bg` → `#000` (was #0d0d10); added a fixed
  `.titlebar` strip (pure black, draggable, bottom hairline border) showing the
  active service name centered (muted). Error overlay top offset to `--top-h`.
- Verified: `node --check` clean; dev build (isolated user-data-dir) boots,
  renders the black top strip with the centered service name and the offset
  content view, no JS errors. Bundled change → ships via app release only (no
  Cloudflare deploy).

---

## 2026-06-16 — Bar polish (equal heights + bottom wordmark) → v0.2.3

- Top + bottom bars now equal height: both `48px` (top was 36→bumped, bottom
  56→trimmed). `main.js` `TOP_BAR=48`, `BAR_HEIGHT=48`, mac
  `trafficLightPosition.y=17`; `shell.html` `--top-h`/`--bar-h` = 48px.
- Bottom bar right side gained an app wordmark (logo + "KausApp") before the `+`.
  The icon is sent to the shell once as a data URL via a new `shell:brand` IPC
  (`brandIcon()` resizes assets/icon.png to 36px; CSP already allows `data:`),
  with a text-only fallback if the asset is missing.
- Verified: `node --check` clean; dev build boots, both black bars render at equal
  height, wordmark shows bottom-right, top bar shows the active service name.

---

## 2026-06-16 — WhatsApp QR banner hide + switch-click fix → v0.2.4

- **WhatsApp "Download WhatsApp for Mac" QR-page banner removed.** New injected
  JS `WHATSAPP_HIDE_DOWNLOAD_BANNER` (run on the whatsapp view's did-finish-load):
  finds the div whose own text starts with "Download WhatsApp for", walks up to
  the wide/short/near-top ancestor (the banner strip) and sets display:none.
  Position guards (top<130, width>360, 24<h<=150) ensure the QR is never hidden.
  Self-retries ~15s for the SPA's late render; cheap no-op once logged in.
  Verified out-of-band: on the live QR page the heading went visible→hidden and
  hideMatched=true. (Found the selector via a throwaway Electron DOM inspector.)
- **Switching services needed two clicks — fixed.** Added `acceptFirstMouse:true`
  to the BrowserWindow. When a service WebContentsView held focus, AppKit ate the
  first click on the bottom bar (first-responder transfer); now that click counts.

---

## 2026-06-16 — Per-service OLED; Discord theme added → v0.2.5

Generalized OLED theming from Messenger-only to per-service, and added Discord
as the second themeable service (user request: extend OLED, one at a time).

- `main.js` theming refactor:
  - `cssKeys` is now a dynamic slot map; OLED slots are `oled:<serviceId>`,
    compact stays `compact` (messenger only). `oledApplying` is per-service.
  - `pageIsDark(wc)` takes a webContents (was messenger-only).
  - New `applyOledToService(svc, enable, userInitiated)` injects that service's
    own stylesheet; `applyOledTheme()` fans out to every themeable+enabled view.
    The "turn on dark mode" hint is messenger-only (others are always dark).
  - did-finish-load applies per-service OLED with the same SPA retry loop, keyed
    by `oled:<id>`; compact reset scoped to messenger.
  - SERVICES: `oledRemote` per themeable service → messenger `oled`, discord
    `oled-discord`. `REMOTE_STYLE['oled-discord']` added. Removed dead OLED_CSS_PATH.
- `userstyle-oled-discord.css` (+ hosted `site/styles/oled-discord.css`):
  backgrounds-only override of Discord's tokens — both the 2024 visual-refresh
  (`--bg-base-*`, `--bg-surface-*`) and legacy (`--background-*`) systems — to a
  true-black/near-black tier set, plus `[class*="appMount"]` → #000. Never touches
  text/role/status colors.
- Verified out-of-band: injecting the css on live Discord flipped appMount/body
  from oklab(0.183) → rgb(0,0,0). Full app boots on Discord with OLED on, no
  errors. NOTE: inner-panel tiers (sidebars/chat) only resolve when logged in
  (token chunk loads post-login) — needs user verification on their session to
  fine-tune the tiers. Hosted css → future tweaks need no app release.
- settings.html hint updated: "OLED is tuned for Messenger and Discord."
