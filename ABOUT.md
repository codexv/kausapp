# Kausapp — Messenger, back on your desktop

**Kausapp** is a fast, lightweight, cross-platform desktop client for **Facebook Messenger**,
built and maintained by **Coders Republic (coders.ph)**.

When Facebook retired its official desktop Messenger app, millions of people were pushed back into a
browser tab that gets lost, muted, and throttled. **Kausapp brings Messenger back to where it
belongs — a real desktop app** that runs natively on macOS, Windows, and Ubuntu Linux, stays logged
in, and delivers your messages the instant they arrive.

---

## Why Kausapp?

- **No more lost browser tabs.** A dedicated app window with its own icon, tray presence, and
  notifications — not buried among 40 tabs.
- **Instant, real-time messages.** We disable the background throttling that slows down browser
  tabs, so messages and notifications land immediately even when the window is hidden or minimized.
- **One app, every platform.** The same experience on your MacBook, your Windows PC, and your
  Ubuntu workstation.
- **Lightweight & focused.** It does one thing — Messenger — and does it cleanly, without the weight
  of a full browser.
- **Private & direct.** Kausapp talks straight to the official Messenger service. No middle-man
  servers, no analytics layer, no scraping — your conversations stay between you and Meta, exactly
  as they would in the browser.

---

## The name

*Kausap* is the Filipino word for **"the person you're talking with"** — and **"to converse."** The
doubled final letter in **Kausapp** quietly embeds *app*: a chat app you talk to people on. Proudly
built in the Philippines by Coders Republic.

---

## Features

### 💬 Messaging
- Full Messenger experience — one-on-one chats, group chats, and communities
- Send and receive text, emoji, GIFs, stickers, and reactions
- Typing indicators, read receipts, and seen status
- Reply threads, message reactions, edit, and unsend
- Message search and chat history

### 📎 Attachments & media
- Send and receive **photos, videos, files, and documents** of any supported type
- Drag-and-drop and paste-to-send
- **Download attachments** straight to your computer with a native save dialog
- Inline image and video previews

### 🎙️ Voice & video
- **Voice messages** — record and play back audio clips natively
- **Voice and video calls**, one-on-one and group, with full microphone and camera support
- Native audio playback for clips, notifications, and call tones
- Screen sharing during calls (where supported by Messenger)

### 🔔 Notifications & presence
- **Real-time desktop notifications** that fire the moment a message arrives
- **No background throttling** — delivery stays instant even when the app is minimized, hidden, or
  behind other windows
- System tray icon for quick access and background running
- Active/online presence kept alive reliably

### 🖥️ Desktop-native experience
- **Stays logged in** across restarts — sign in once
- Remembers your **window size and position**
- **External links open in your default browser**, not trapped inside the app
- Native right-click menus (copy, paste, save image, spellcheck)
- Single-instance — clicking the icon focuses your existing window instead of opening duplicates
- Keyboard shortcuts, zoom controls, and full-screen mode
- macOS: stays in the background on close (like a true native messenger); Windows/Linux: closes
  cleanly or minimizes to tray

### 🌐 Cross-platform
- **macOS** — universal `.dmg` for both Apple Silicon (M-series) and Intel Macs
- **Windows** — one-click `.exe` installer (NSIS)
- **Linux** — portable `.AppImage` and Debian/Ubuntu `.deb` packages

---

## Under the hood

- Built on **Electron**, wrapping the official `messenger.com` web app — the only stable,
  policy-safe path to Messenger's complete, always-up-to-date feature set. When Meta ships a new
  Messenger feature, it appears in Kausapp automatically.
- Packaged with **electron-builder** for true single-codebase, multi-platform installers.
- Hardened renderer (context isolation on, Node integration off) with a scoped permission model —
  microphone, camera, and notifications are granted to Messenger; everything else is denied by
  default.
- Persistent, sandboxed session storage so your login survives restarts without exposing
  credentials to the app.

---

## Privacy & security

- Kausapp adds **no servers of its own** — it connects directly to Meta's official Messenger
  service, the same endpoint your browser uses.
- **No telemetry, no tracking, no ad layer** injected by the app.
- Your messages, media, and login are handled by Messenger itself; Kausapp is simply the window.

---

## Roadmap

- Unread-message badge counts on the dock / taskbar / tray
- Optional dark-mode sync with the OS
- Customizable global hotkeys
- Auto-update for new releases
- Per-platform code signing for friction-free installs

---

## Legal

Kausapp is **not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.** "Facebook" and
"Messenger" are trademarks of Meta Platforms, Inc. Kausapp is an independent desktop client that
loads the official Messenger web app and does not modify, intercept, or store the contents of your
conversations.

---

<p align="center"><b>Kausapp</b> — built with ❤️ by <a href="https://coders.ph">Coders Republic</a> · coders.ph</p>
