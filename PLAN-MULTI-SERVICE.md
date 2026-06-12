# KausApp → Multi-Service Messenger — Plan

> Status: **PLANNING**. No code yet. **Chosen scope:** a clean multi-service *container* —
> each service is its **own official web app** in an isolated view — plus a strong **theming**
> layer. **No integration** (unified inbox, DOM scraping, send-automation, bridges) — that was
> considered and **dropped** (legal/ToS risk, account-ban risk on sends, and a per-service
> adapter-maintenance treadmill). The differentiator is **polish + theming**, not aggregation.

## 1. Goal & non-goals
- **Goal:** one desktop app that hosts multiple chat services (each = its official web client in
  an isolated session) with great theming, and the native-feeling desktop glue we already built.
- **Non-goals (explicitly dropped):** merged/unified inbox, scraping message content, sending
  via composer automation, protocol bridges, iMessage. We never touch message content — each
  service's own web app handles messaging exactly as the vendor ships it.

## 2. Architecture
Refactor the single-window app into a **shell + per-service views**:
- **Shell (host page):** a left **service rail** (icons, the web app's own unread badge, add/
  reorder) + chrome + a settings/theming panel. A local trusted page (our HTML), not a remote site.
- **Service views:** one **`WebContentsView`** (Electron 30+; preferred over legacy `BrowserView`/
  `<webview>`) per service instance, shown/hidden on switch. Each gets:
  - its own **session partition** `persist:svc-<id>` → isolated logins (multi-account = multiple
    partitions of the same service);
  - the **glue we already have**, per view: no-throttle (real-time), external-link → browser,
    media/notification permissions, spellcheck, context menu, and **per-service theming/userstyles**.
- **ServiceManager (main):** owns the registry + view lifecycle (create/show/hide/sleep/destroy).
- **Service registry (JSON/TS):** `{ id, name, icon, url, userAgent, partition, theme?, muted? }`.
  Built-ins ship; users can add **custom services** (any URL) like Ferdium.

**Carries over unchanged:** auto-updater + consistent code-signing, tray, window-state,
single-instance, the userstyle-injection + remote-theme system, permission handler, external-link
handling, bug-report/admin, CI build/release.

## 3. Services (official web clients only)
**v1:** Messenger (done) · WhatsApp Web · Telegram Web · Instagram DMs · Discord.
**Later:** Slack, Google Messages (SMS/RCS), X DMs, LinkedIn, Google Chat, Teams, Mastodon, + custom.
**Skip:** iMessage (no web client), Signal (web client retired).

## 4. Core features
1. **Per-service/account session isolation** (partitions); multi-account.
2. **Notifications:** rely on **each web app's own** native notifications (we just don't throttle
   and grant permission). Per-service mute. Unread shown via the web app's own title/favicon badge,
   surfaced on the rail + tray/dock. **No scraping** — purely passthrough.
3. **Service management:** enable/disable, reorder, mute, add custom, multi-account.
4. **Resource control:** N services = N renderers (RAM). Optional "sleep inactive" (trade-off vs
   real-time); per-service configurable.

## 5. Theming (the differentiator)
- **Global theme + per-service overrides.** Each service can pick: system, our **OLED pure-black**,
  **compact**, or a **custom CSS** userstyle (Ferdium-style), plus accent color, density, default zoom.
- **Built on what we have:** the userstyle injection + **remote-hosted theme** system (themes load
  from kausapp.com at runtime, bundled fallback) — extend per service into a small **theme library**.
- **Shell theming too** (rail/chrome): light/dark/OLED to match.
- **Settings/Theming UI** in the shell to manage all of the above.

## 6. Risks / unknowns
- **Memory footprint** with many live renderers (mitigate: sleep inactive).
- **Per-service breakage:** web UIs change → UA tuning + theme selectors need upkeep (low stakes:
  worst case a theme looks off; messaging still works via the vendor's app).
- **ToS posture:** loading official web clients is the safe path; avoid anything that looks like a
  bot. Multi-account WhatsApp is limited by WhatsApp itself.

## 7. Migration (from today's single-window app)
1. Extract single-window logic → `ServiceManager` + service registry; keep `main.js` thin.
2. Build the shell host page (rail + chrome + settings) and the active-view layout.
3. Port the glue (no-throttle, links, permissions, **per-service theming**) to per-view.
4. Messenger becomes "just another service" in the registry.

## 8. Milestones
- **M0 — Plan** (this doc).
- **M1 — Shell + multi-view:** rail, switching, isolated sessions for the v1 services; reuse glue.
- **M2 — Service management + notifications:** enable/reorder/mute, add custom, multi-account,
  native-notification passthrough + per-service/aggregate unread badge.
- **M3 — Theming:** global + per-service themes (OLED/compact/custom CSS), accent/density/zoom,
  theme library, settings UI. → ship **v0.2.0**.
- **M4 — Polish:** quick-switcher (Cmd/Ctrl+K), sleep-inactive performance, optional DND, release.
- *(Later/optional: AI helpers — only if revisited; not in scope now.)*

## 9. Decisions — RESOLVED
- ✅ **Scope:** multi-service **container** of official web apps + **theming**. **No integration**
  (unified inbox / scraping / send-automation) — dropped.
- ✅ **v1 services:** Messenger + WhatsApp + Telegram + Instagram + Discord.
- ✅ **Centerpiece/differentiator:** theming (global + per-service, on our existing userstyle/
  remote-theme system).
- ✅ **Notifications:** native passthrough only (no scraping).
- ✅ **View tech:** `WebContentsView`. **Branding:** keep **KausApp**.
- ⏳ **Free vs Pro split:** open — revisit with MONETIZATION.md (e.g. Pro = multi-account, premium
  themes, custom CSS).

Planning complete. Next when ready: **M1** — shell + service rail + multi-view with isolated
sessions for the v1 services. (Not started — awaiting go-ahead. Will follow the ~/ops protocol.)
