<p align="center">
  <img src="assets/icon.png" width="120" alt="Kausapp icon">
</p>

<h1 align="center">Kausapp</h1>

<p align="center">A lightweight, cross-platform desktop client for <b>Facebook Messenger</b>.<br>
By <a href="https://coders.ph">Coders Republic (coders.ph)</a></p>

---

Kausapp brings Messenger back to the desktop on **macOS, Windows, and Linux**. It wraps the official
`messenger.com` web app and adds native desktop behavior — system tray, real-time notifications,
external-link handling, persistent login, and microphone/camera access for voice & video calls.

> **Not affiliated with or endorsed by Meta.** "Facebook" and "Messenger" are trademarks of Meta
> Platforms, Inc. Kausapp is an independent client that loads the official Messenger web app.

## Features

- Full Messenger web experience — messages, attachments, reactions, voice messages, voice/video calls
- **Real-time delivery with no throttling** — messages and notifications arrive instantly even when
  the window is hidden or in the background
- Audio playback and media capture handled natively by Chromium
- External links open in your default browser
- Stays logged in between launches
- System tray + window-state memory

## Download

Official site: **[kausapp.coders.ph](https://kausapp.coders.ph)** — or grab the installer for your
platform directly from the [**Releases**](../../releases) page:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `Kausapp-<version>-arm64.dmg` |
| macOS (Intel) | `Kausapp-<version>.dmg` |
| Windows | `Kausapp Setup <version>.exe` |
| Linux | `Kausapp-<version>.AppImage` / `.deb` |

> The app is **not code-signed** yet, so on first launch macOS may say "unidentified developer"
> (right-click → Open) and Windows SmartScreen may warn (More info → Run anyway).

## Develop / run

```bash
npm install
npm start        # launch the app
npm run dev      # launch with DevTools open
```

## Build installers locally

```bash
npm run dist:mac     # macOS .dmg (x64 + arm64)
npm run dist:win     # Windows installer (.exe / NSIS)
npm run dist:linux   # Linux .AppImage + .deb
```

> Building for a given OS is most reliable **on** that OS. Pushing a `v*` tag builds all three
> platforms automatically via GitHub Actions and attaches them to a Release (see
> `.github/workflows/build.yml`). Output lands in `release/`.

## Regenerate the icon

```bash
python3 assets/make_icon.py   # writes icon.png / icon_512.png / icon.ico
bash assets/build_icns.sh     # writes icon.icns (macOS only)
```

---

See [`HANDOFF.md`](./HANDOFF.md) for the architecture decision and full development log.

Licensed under MIT.
