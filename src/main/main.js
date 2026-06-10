'use strict';

const {
  app,
  BrowserWindow,
  shell,
  Menu,
  Tray,
  nativeImage,
  session,
  dialog
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { initAutoUpdates } = require('./updater');

// electron-context-menu is ESM-only (v4+), so it's loaded via dynamic import()
// inside app.whenReady() rather than a top-level require.

const MESSENGER_URL = 'https://www.messenger.com/';
// Pretend to be a normal desktop Chrome so messenger.com serves the full web app.
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const isDev = process.argv.includes('--dev');

// ---------------------------------------------------------------------------
// Real-time delivery: stop Chromium from throttling the app when it's in the
// background, hidden, or occluded. Without this, the renderer's timers and the
// Messenger push (MQTT/WebSocket) connection get throttled when the window
// isn't focused, causing delayed messages and notifications. These switches
// must be set BEFORE app is ready.
// ---------------------------------------------------------------------------
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Single instance lock — focus the existing window instead of opening a second one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Settings persistence (userData/settings.json) — small key/value preferences.
// ---------------------------------------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  try {
    const next = { ...loadSettings(), ...patch };
    fs.writeFileSync(settingsFile(), JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Compact chat list: inject a userstyle that collapses Messenger's left
// conversation list to an avatar-only rail. Toggleable + persisted.
// ---------------------------------------------------------------------------
const COMPACT_CSS_PATH = path.join(__dirname, 'userstyle-compact.css');
let compactCssKey = null; // insertCSS handle, so we can remove it on toggle-off

async function applyCompactSidebar(enable) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  try {
    if (enable && compactCssKey === null) {
      const css = fs.readFileSync(COMPACT_CSS_PATH, 'utf8');
      compactCssKey = await wc.insertCSS(css);
    } else if (!enable && compactCssKey !== null) {
      await wc.removeInsertedCSS(compactCssKey);
      compactCssKey = null;
    }
  } catch {
    /* best-effort — page may not be ready */
  }
}

// ---------------------------------------------------------------------------
// Window state persistence (size + position) — stored in userData/window-state.json
// ---------------------------------------------------------------------------
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
  } catch {
    return { width: 1100, height: 800 };
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isMinimized()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify(bounds));
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// External-link handling: anything that isn't messenger/facebook opens in the
// user's default browser instead of inside the app.
// ---------------------------------------------------------------------------
function isInternalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'www.messenger.com' ||
      hostname === 'messenger.com' ||
      hostname.endsWith('.messenger.com') ||
      hostname === 'www.facebook.com' ||
      hostname === 'facebook.com' ||
      hostname.endsWith('.facebook.com') ||
      hostname.endsWith('.fbcdn.net')
    );
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
    shell.openExternal(url);
  }
}

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 480,
    minHeight: 400,
    title: 'Kausapp',
    icon: resolveIcon(),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // Keep the renderer (and Messenger's realtime push connection) running at
      // full speed even when the window is hidden/minimized/in the background.
      backgroundThrottling: false,
      partition: 'persist:messenger'
    }
  });

  mainWindow.loadURL(MESSENGER_URL, { userAgent: DESKTOP_USER_AGENT });

  // Open target=_blank / window.open links externally.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      return { action: 'allow' };
    }
    openExternal(url);
    return { action: 'deny' };
  });

  // Intercept top-level navigations to non-Messenger destinations.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      // On macOS keep the app alive in the background like a native messenger.
      if (process.platform === 'darwin') {
        event.preventDefault();
        mainWindow.hide();
        return;
      }
    }
    saveWindowState();
  });

  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  // Re-apply userstyles after every (re)load — inserted CSS is per page load.
  mainWindow.webContents.on('did-finish-load', () => {
    compactCssKey = null; // previous handle is invalid after a load
    if (loadSettings().compactSidebar) applyCompactSidebar(true);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ---------------------------------------------------------------------------
// Icon resolution — falls back gracefully if the icon asset is missing.
// ---------------------------------------------------------------------------
function resolveIcon() {
  const png = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  if (fs.existsSync(png)) {
    const img = nativeImage.createFromPath(png);
    if (!img.isEmpty()) return img;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Permissions: allow microphone/camera (voice messages + calls), notifications,
// and media playback. Deny everything else by default.
// ---------------------------------------------------------------------------
function configurePermissions() {
  const ses = session.fromPartition('persist:messenger');
  const ALLOWED = new Set([
    'media', // microphone + camera (voice/video calls, audio messages)
    'notifications',
    'audioCapture',
    'videoCapture',
    'clipboard-read',
    'clipboard-sanitized-write',
    'fullscreen'
  ]);

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(ALLOWED.has(permission));
  });

  // Downloads (attachments): prompt for a save location, report completion.
  ses.on('will-download', (event, item) => {
    item.once('done', (e, state) => {
      if (state === 'completed' && mainWindow) {
        // Bounce the dock / flash the taskbar so the user knows it's done.
        if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload Messenger',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload()
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Compact chat list (icons only)',
          type: 'checkbox',
          checked: !!loadSettings().compactSidebar,
          click: (item) => {
            saveSettings({ compactSidebar: item.checked });
            applyCompactSidebar(item.checked);
          }
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'windowMenu' }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTray() {
  const icon = resolveIcon();
  if (!icon) return; // no icon asset yet — skip tray until one exists

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Kausapp');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Kausapp',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
    }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  configurePermissions();

  // Right-click context menu with copy/paste, "open link externally", etc.
  // electron-context-menu is ESM-only, so load it dynamically.
  const { default: contextMenu } = await import('electron-context-menu');
  contextMenu({
    showSaveImageAs: true,
    showCopyImageAddress: true,
    showSearchWithGoogle: false
  });

  buildMenu();
  createWindow();
  buildTray();

  // Start the GitHub-Releases-backed auto-updater (no-op in dev / unpackaged).
  initAutoUpdates(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
