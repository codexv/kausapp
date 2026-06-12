# KausApp → Multi-Service Messenger — Plan (Direction A)

> Status: **PLANNING**. No code yet. Direction chosen: **A — multi-service wrapper of
> official web clients + enhanced features** (Ferdium/Rambox-shaped, not a Matrix/bridge
> unified inbox). This builds on the existing Electron app and reuses all the desktop glue
> we already shipped.

## 1. Goal & non-goals
- **Goal:** one desktop app holding multiple chat services (each = its own official web
  client in an isolated session), with unified notifications/badges and a layer of
  "enhanced" features that make KausApp better than a plain tab-stack.
- **Non-goals (for now):** a merged cross-service inbox, reverse-engineered protocol
  bridges, iMessage. Those are Direction B (separate, funded, high-ToS-risk effort).

## 2. Architecture
Refactor the single-window app into a **shell + per-service views**:
- **Shell (host page):** a left **service rail** (icons, unread badges, add/reorder) +
  top-level chrome. Rendered by a local trusted page (our HTML), not a remote site.
- **Service views:** one **`WebContentsView`** (Electron 30+; preferred over the legacy
  `BrowserView`/`<webview>`) per service instance, attached to the window, shown/hidden on
  switch. Each gets:
  - its own **session partition** `persist:svc-<id>` → fully isolated logins (multi-account =
    multiple partitions of the same service);
  - the **desktop glue we already have**, applied per view: no-throttle, external-link →
    browser, media/notification permissions, spellcheck, context menu, per-service userstyles.
- **ServiceManager (main process):** owns the registry, view lifecycle (create/show/hide/
  sleep/destroy), partitions, and wiring. This is the main new module.
- **Service registry (JSON/TS):** `{ id, name, icon, url, userAgent, partition, userstyles?,
  notifications: bool, muted: bool }`. Ships with built-ins; user can add **custom services**
  (any URL) like Ferdium.

What **carries over unchanged**: auto-updater + consistent code-signing, tray, window-state,
single-instance, the userstyle-injection system (now per-service), permission handler,
external-link handling, bug-report/admin, build/release pipeline.

## 3. Candidate services (official web clients only)
**v1 ship list (DECIDED):** Messenger (done) · **WhatsApp Web** · **Telegram Web** ·
**Instagram DMs** · **Discord**.
Later/Tier 2 (post-v1): Slack, Google Messages (SMS/RCS), X/Twitter DMs, LinkedIn, Google
Chat, Microsoft Teams, Mastodon — plus user-added custom services.
Skip permanently: **iMessage** (no web client; off-limits), **Signal** (web client retired).

## 4. Core features (parity + the hard part)
1. **Session isolation** per service/account (partitions). ✔ straightforward.
2. **Unified notifications + unread badges** — *the hardest core problem.* Each web app fires
   notifications differently. Plan: a per-view preload intercepts the page's `Notification`
   API + title/badge changes, forwards to main → native notification + aggregated dock/tray
   badge + per-service rail badge. Per-service mute/DND.
3. **Service management:** enable/disable, reorder, mute, add custom, multi-account.
4. **Resource control:** N services = N Chromium renderers (RAM-heavy, like Slack/Ferdium).
   Option to "sleep" inactive services (unload to save RAM) — trade-off vs real-time delivery;
   make it per-service configurable.

## 4b. Unified Inbox (the centerpiece — chosen direction)
One merged, consistently-formatted inbox of **incoming messages across all services**; click a
message → **read-render the thread** in KausApp's own UI; **reply in-app** (the reply is sent
*through* the real service); plus a **"View in [service]"** button to jump to the original web app.

**Everything rides one abstraction — the per-service Adapter** (a content script injected via each
view's preload). The same adapter powers notifications (M2), the unified inbox, thread render, and
send:
- `observeIncoming(cb)` — MutationObserver on the chat list / notifications → emits
  `{ service, threadId, name, avatar, snippet, ts, unread }` as messages arrive (drives the inbox + badges).
- `getConversations()` — snapshot of recent threads.
- `getThread(threadId)` — open + scrape the message list → normalized messages (text + basic media refs).
- `sendMessage(threadId, text)` — focus the composer, inject text, trigger send. **Text-only,
  per-service, OPT-IN, behind an explicit account-risk warning** (this automates the official web
  client — strict services like WhatsApp/Meta can flag/ban accounts; selectors break often).
- `openInApp(threadId)` — bring the service view forward + open the thread (always available; the
  reliable fallback for media, calls, reactions, attachments, and any service where send is risky/off).

**Honest scope of "fetch all incoming":** live latest-message-per-thread (from each service's
sidebar/notifications) + the full thread on open. Not a backfill of every message body across all
threads (web apps don't expose that at once). Services must be loaded/logged-in to observe + send.

**Rendering reality:** text threads render cleanly; rich content (voice notes, reactions,
reply-quotes, stickers, link previews, edits/deletes) is a parity treadmill → render what's cheap,
defer the rest to "View in app." Each adapter is hand-built and needs maintenance as DOMs change.

## 5. Enhanced features (the differentiators) — layered, phased
- **Global quick-switcher** (Cmd/Ctrl+K) across services (+ recent services).
- **Unified notification center / "next unread"** navigation across services.
- **Do-Not-Disturb** global + per-service + **schedules**; keyword/VIP allow-through.
- **Workspaces/profiles** (group services; e.g. Work vs Personal).
- **Per-service themes** (extend our OLED/compact userstyles to each service).
- **AI (opt-in):** summarize unread threads, draft/clean-up replies via the **Claude API**.
  Strong differentiator. **Privacy:** strictly opt-in, clearly disclosed (message content
  leaves the device), user-supplied or app key TBD.
- **Compose helpers:** snippets/templates, message scheduling (best-effort within web apps).
- *Note:* true cross-service **search** needs message access we don't have in wrappers →
  scope to per-service search shortcuts for v1.

These map directly onto the earlier **MONETIZATION.md** thesis: charge for value *we* add
(multi-account, AI, advanced notifications, workspaces) — never for access to the services.

## 6. Key risks / unknowns
- **Notifications/unread across many web apps** = the make-or-break engineering problem.
- **Memory footprint** with many live renderers.
- **Per-service breakage**: web UIs change; UA spoofing + userstyles need upkeep.
- **ToS posture**: loading official web clients is far safer than bridges, but some services
  dislike embedded/automated clients (UA tuning per service; avoid automation that looks like
  a bot). Multi-account WhatsApp is limited by WhatsApp itself.
- **AI privacy/consent** + cost.

## 7. Migration path (from today's single-window app)
1. Extract single-window logic → `ServiceManager` + service registry; keep `main.js` thin.
2. Build the shell host page (rail + chrome) + the active-view layout.
3. Port the glue (no-throttle, links, permissions, userstyles) to per-view.
4. Messenger becomes "just another service" in the registry.

## 8. Milestones
- **M0 — Plan** (this doc).
- **M1 — Shell + multi-view:** rail, switching, isolated sessions for the v1 services
  (Messenger, WhatsApp, Telegram, Instagram, Discord). Reuse glue.
- **M2 — Adapter framework + notifications:** the per-service Adapter (§4b), unified
  notifications, aggregate + per-service unread badges, mute/DND, add/reorder/custom services.
- **M3 — Unified Inbox (read):** merged incoming feed (`observeIncoming` + `getConversations`),
  consistent thread **read-render** (`getThread`), **"View in app"** (`openInApp`). → ship **v0.2.0**.
- **M3b — In-app reply (send):** `sendMessage` per service, **opt-in + account-risk warning**,
  text-only; rich content defers to "View in app". Roll out service-by-service as each proves stable.
- **M4 — AI (opt-in):** summarize threads + **draft replies** (Claude API) — pairs with M3b (draft
  in-app, send via adapter or open-in-app) + settings/consent.
- **M5 — Enhanced + polish:** quick-switcher, DND schedules, workspaces, per-service themes,
  multi-account, settings UI, performance (sleep inactive vs keep-warm for the inbox), release.

## 9. Decisions — RESOLVED
- ✅ **v1 service list:** Messenger + WhatsApp Web + Telegram Web + Instagram DMs + Discord.
- ✅ **Centerpiece:** a **Unified Inbox** (§4b) — aggregate incoming, read-render threads in our
  UI, reply in-app, "View in app" fallback — all built on the per-service **Adapter**.
- ✅ **Sending:** the only path is automating each service's web composer → **per-service, opt-in,
  account-risk-warned (M3b)**; "View in app" is the universal, safe fallback.
- ✅ **AI:** deferred to **M4** (draft replies pair with M3b).
- ✅ **View tech:** `WebContentsView`. **Branding:** keep **KausApp**.
- ⏳ **Free vs Pro split:** open — revisit with MONETIZATION.md when the enhanced layer takes shape.

Planning phase complete. Next action when ready: **M1** — shell + service rail + multi-view with
isolated sessions for the v1 services. (Not started — awaiting go-ahead.)
