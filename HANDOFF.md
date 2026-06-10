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
- **Deploy method chosen: Cloudflare Pages + GitHub git-integration.** Settings for the user to apply
  in the CF dashboard: connect repo `codexv/kausapp`, production branch `main`, framework preset
  None, **build command blank**, **build output directory `site`**, root `/`. Then add custom
  domains `kausapp.com` + `www.kausapp.com` (DNS already on Cloudflare → auto records + SSL).
  Auto-redeploys on push to main. (Pending user completing the dashboard steps.)

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
