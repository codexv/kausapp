'use strict';

const {
  app,
  BrowserWindow,
  WebContentsView,
  shell,
  Menu,
  Tray,
  nativeImage,
  session,
  dialog,
  ipcMain,
  screen,
  net
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { initAutoUpdates, checkForUpdates } = require('./updater');

// Where bug reports are submitted (Cloudflare Pages Function backed by KV).
const REPORT_ENDPOINT = 'https://kausapp.com/api/report';

// Default zoom — one step (≈10%) smaller than 100% for a denser, app-like feel.
const DEFAULT_ZOOM = 0.9;

// Height of the bottom service bar (the app chrome strip beneath the web views).
// Kept equal to the top title bar so the two black strips are symmetric.
const BAR_HEIGHT = 48;

// Height of the custom (frameless) title bar at the very top. The window uses a
// hidden native title bar so this strip can be painted pure black; the OS window
// controls (mac traffic lights / Win+Linux overlay) are positioned within it.
const TOP_BAR = 48;

// electron-context-menu is ESM-only (v4+), so it's loaded via dynamic import()
// inside app.whenReady() rather than a top-level require.

// Pretend to be a normal desktop Chrome so each service serves its full web app.
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Service registry — each is the OFFICIAL web app of a service, wrapped in its
// own WebContentsView with an isolated, persistent session (independent login).
// `extra` = additional hostnames that should count as "inside" the service
// (auth, CDNs) so they don't bounce to the system browser. `themeable` = our
// OLED/compact userstyles are tuned for it (currently Messenger only).
// ---------------------------------------------------------------------------
const SERVICES = [
  {
    id: 'messenger',
    name: 'Messenger',
    url: 'https://www.messenger.com/',
    color: '#0a7cff',
    themeable: true,
    oledRemote: 'oled', // REMOTE_STYLE key + bundled userstyle-oled.css
    extra: ['facebook.com', 'fbcdn.net', 'fbsbx.com']
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    color: '#25d366',
    extra: ['whatsapp.net']
  },
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/direct/inbox/',
    color: '#e1306c',
    extra: ['cdninstagram.com', 'facebook.com', 'fbcdn.net']
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/a/',
    color: '#2aabee',
    extra: []
  },
  {
    id: 'discord',
    name: 'Discord',
    url: 'https://discord.com/app',
    color: '#5865f2',
    // Not custom-themed: Discord has its own built-in OLED ("Midnight")
    // appearance which syncs to the account — users enable it in Discord itself.
    extra: ['discordapp.com', 'discordapp.net', 'discord.gg']
  }
];

const DEFAULT_ENABLED = SERVICES.map((s) => s.id);

const isDev = process.argv.includes('--dev');

// ---------------------------------------------------------------------------
// Real-time delivery: stop Chromium from throttling the app when it's in the
// background, hidden, or occluded. Without this, renderer timers and each
// service's push (MQTT/WebSocket) connection get throttled when not focused,
// causing delayed messages/notifications. Set BEFORE app is ready.
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

// Live state: one entry per CREATED service view.
const views = new Map(); // id -> { view, svc, favicon, unread }
let activeId = null;
let settingsView = null;

// ---------------------------------------------------------------------------
// Settings persistence (userData/settings.json) — small key/value preferences.
// ---------------------------------------------------------------------------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// In-memory cache. settings.json is written only by this process, so a cache is
// safe and avoids a synchronous disk read on every hot-path call (pushState →
// orderedEnabledServices → loadSettings fires on each title/favicon update).
let settingsCache = null;

function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    settingsCache = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    settingsCache = {};
  }
  return settingsCache;
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  settingsCache = next;
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(next));
  } catch {
    /* best-effort — keep the in-memory value even if the write fails */
  }
}

// Ordered list of ENABLED service definitions (respects saved order + enabled set).
function orderedEnabledServices() {
  const s = loadSettings();
  const enabled = Array.isArray(s.enabledServices) ? s.enabledServices : DEFAULT_ENABLED;
  const order = Array.isArray(s.serviceOrder) ? s.serviceOrder : DEFAULT_ENABLED;
  const byId = new Map(SERVICES.map((svc) => [svc.id, svc]));
  const seen = new Set();
  const out = [];
  for (const id of order) {
    if (byId.has(id) && enabled.includes(id) && !seen.has(id)) {
      out.push(byId.get(id));
      seen.add(id);
    }
  }
  // Any enabled service not covered by the saved order (e.g. new build) → append.
  for (const svc of SERVICES) {
    if (enabled.includes(svc.id) && !seen.has(svc.id)) out.push(svc);
  }
  return out.length ? out : [SERVICES[0]];
}

// ---------------------------------------------------------------------------
// Userstyles (OLED / compact). Hosted on kausapp.com so the theme can be tuned
// without an app release; we fetch the latest at apply time and fall back to the
// bundled copy when offline. These are tuned for Messenger's DOM (themeable).
// ---------------------------------------------------------------------------
const COMPACT_CSS_PATH = path.join(__dirname, 'userstyle-compact.css');
// insertCSS handles keyed by slot (null/undefined = not inserted). Slots:
// 'compact' (messenger), and 'oled:<serviceId>' per themeable service. Handles
// are invalidated on every page load — see did-finish-load.
const cssKeys = {};
// Serializes OLED applies per service so a service's post-load retry interval
// can't double-insert while a previous (network-fetched) apply is in flight.
const oledApplying = {};

const REMOTE_STYLE = {
  compact: 'https://kausapp.com/styles/compact.css',
  oled: 'https://kausapp.com/styles/oled.css'
};

async function loadStyleCss(name, localPath) {
  try {
    const res = await net.fetch(`${REMOTE_STYLE[name]}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const css = await res.text();
      if (css && css.trim()) return css;
    }
  } catch {
    /* offline / fetch failed — fall back to bundled copy */
  }
  try {
    return fs.readFileSync(localPath, 'utf8');
  } catch {
    return '';
  }
}

// The messenger view's webContents (theming target), or null if not created yet.
function messengerWc() {
  const e = views.get('messenger');
  return e ? e.view.webContents : null;
}
function activeWc() {
  const e = activeId && views.get(activeId);
  return e ? e.view.webContents : null;
}

async function toggleUserStyle(wc, name, cssPath, slot, enable) {
  if (!wc || wc.isDestroyed()) return;
  try {
    if (enable && cssKeys[slot] === null) {
      const css = await loadStyleCss(name, cssPath);
      // Re-check after the await: a destroy/load could have raced the fetch.
      if (css && !wc.isDestroyed() && cssKeys[slot] === null) {
        cssKeys[slot] = await wc.insertCSS(css);
      }
    } else if (!enable && cssKeys[slot] !== null) {
      await wc.removeInsertedCSS(cssKeys[slot]);
      cssKeys[slot] = null;
    }
  } catch {
    /* best-effort — page may not be ready */
  }
}

function applyCompactSidebar(enable) {
  return toggleUserStyle(messengerWc(), 'compact', COMPACT_CSS_PATH, 'compact', enable);
}

// Is this page currently in DARK mode? (low body-background luminance.) OLED
// forces backgrounds black; on a LIGHT page that turns dark text invisible (a
// "black window"), so we only ever apply OLED when the page is already dark.
async function pageIsDark(wc) {
  if (!wc || wc.isDestroyed()) return false;
  try {
    return !!(await wc.executeJavaScript(
      "(function(){try{var m=(getComputedStyle(document.body).backgroundColor||'').match(/\\d+/g);" +
      "if(!m)return false;return (0.299*+m[0]+0.587*+m[1]+0.114*+m[2])<110;}catch(e){return false;}})()",
      true));
  } catch { return false; }
}

// Apply/remove the OLED userstyle on ONE service's view (its own stylesheet).
async function applyOledToService(svc, enable, userInitiated = false) {
  if (!svc || !svc.themeable || !svc.oledRemote) return;
  const entry = views.get(svc.id);
  if (!entry) return;
  const wc = entry.view.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (oledApplying[svc.id]) return; // an apply is already in flight for this view
  oledApplying[svc.id] = true;
  try {
    if (enable && !(await pageIsDark(wc))) {
      // Only Messenger has a user-facing light page worth explaining; the others
      // are always dark, so just skip silently if a load momentarily reads light.
      if (userInitiated && svc.id === 'messenger' && mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['OK'],
          title: 'Turn on Messenger Dark mode first',
          message: 'OLED applies on top of Messenger’s Dark mode.',
          detail: 'Enable Dark mode in Messenger (Settings → Preferences → appearance), then this OLED theme will kick in. It stays off on light pages so it can’t black out the screen.'
        });
      }
      return; // never black out a light page
    }
    const localPath = path.join(__dirname, `userstyle-${svc.oledRemote}.css`);
    await toggleUserStyle(wc, svc.oledRemote, localPath, `oled:${svc.id}`, enable);
  } finally {
    oledApplying[svc.id] = false;
  }
}

// Apply/remove OLED across every themeable service that currently has a view.
function applyOledTheme(enable, userInitiated = false) {
  for (const svc of SERVICES) {
    if (svc.themeable && svc.oledRemote && views.has(svc.id)) {
      applyOledToService(svc, enable, userInitiated);
    }
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
    fs.writeFileSync(windowStateFile(), JSON.stringify(mainWindow.getBounds()));
  } catch {
    /* best-effort */
  }
}

// Drop a saved x/y that no longer lands on any connected display (e.g. an
// external monitor was unplugged), so the window can't open fully off-screen.
function visibleWindowState() {
  const state = loadWindowState();
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return state;
  const onScreen = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return state.x < wa.x + wa.width && state.x + 80 > wa.x &&
           state.y < wa.y + wa.height && state.y + 40 > wa.y;
  });
  return onScreen ? state : { width: state.width, height: state.height };
}

// ---------------------------------------------------------------------------
// External-link handling — anything outside the active service opens in the
// user's default browser instead of a bare in-app window.
// ---------------------------------------------------------------------------
// Facebook/Messenger route outbound links through redirector shims
// (l.facebook.com / lm.facebook.com / l.messenger.com / l.php?u=<encoded>).
const FB_LINK_SHIMS = ['l.facebook.com', 'lm.facebook.com', 'l.messenger.com', 'lm.messenger.com'];

function unwrapFbLink(url) {
  try {
    const u = new URL(url);
    if (FB_LINK_SHIMS.includes(u.hostname)) {
      const real = u.searchParams.get('u');
      if (real) return real;
    }
  } catch { /* ignore */ }
  return url;
}

// Registrable-ish domain of a URL (last two labels). Good enough for grouping.
function baseDomain(hostname) {
  const parts = String(hostname || '').split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

function isInternalToService(svc, url) {
  try {
    const { hostname } = new URL(url);
    if (FB_LINK_SHIMS.includes(hostname)) {
      return false; // link-redirector shims are always outbound
    }
    const home = baseDomain(new URL(svc.url).hostname);
    const allowed = new Set([home, ...(svc.extra || [])]);
    const hb = baseDomain(hostname);
    return allowed.has(hb) || hostname.endsWith(`.${home}`) || hostname === home;
  } catch {
    return false;
  }
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) shell.openExternal(url);
}

// Title like "(3) Messenger" / "WhatsApp (3)" → unread count.
function parseUnread(title) {
  const m = /\((\d+)\+?\)/.exec(String(title || ''));
  return m ? Math.min(parseInt(m[1], 10) || 0, 99) : 0;
}

// ---------------------------------------------------------------------------
// Per-service session: media/notification permissions + attachment downloads.
// ---------------------------------------------------------------------------
const ALLOWED_PERMISSIONS = new Set([
  'media', 'notifications', 'audioCapture', 'videoCapture',
  'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'
]);

function configureSession(partition) {
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.on('will-download', (event, item) => {
    item.once('done', (e, state) => {
      if (state === 'completed' && process.platform === 'darwin' && app.dock) {
        app.dock.bounce('informational');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Per-service page tweaks (injected JS, not CSS — these need text/structure
// matching that CSS selectors can't express on obfuscated markup).
// ---------------------------------------------------------------------------
// WhatsApp Web's logged-out QR page shows a full-width "Download WhatsApp for
// Mac/Windows" promo banner above the QR. Its classes are Meta's rotating
// obfuscated kind, so we find it by its heading text and hide the banner
// container — with position guards (near top, wide, short) so we can never hide
// the QR itself. Self-retries for ~15s to catch the SPA's late render; no-ops
// (and stays cheap) once the user is logged in and the banner is gone.
const WHATSAPP_HIDE_DOWNLOAD_BANNER = `(function(){
  var tries = 0;
  function ownText(el){
    var t = '';
    for (var i = 0; i < el.childNodes.length; i++){
      var n = el.childNodes[i];
      if (n.nodeType === 3) t += n.textContent;
    }
    return t.trim();
  }
  function hide(){
    var divs = document.querySelectorAll('div');
    for (var i = 0; i < divs.length; i++){
      if (!/^Download WhatsApp for /i.test(ownText(divs[i]))) continue;
      // Walk up to the widest near-top, short ancestor = the banner strip.
      var node = divs[i], banner = null;
      for (var up = 0; up < 8 && node; up++){
        var r = node.getBoundingClientRect();
        if (r.top < 130 && r.width > 360 && r.height > 24 && r.height <= 150) banner = node;
        node = node.parentElement;
      }
      if (banner){ banner.style.setProperty('display', 'none', 'important'); return true; }
    }
    return false;
  }
  function tick(){ try { hide(); } catch (e) {} if (++tries < 15) setTimeout(tick, 1000); }
  tick();
})();`;

// ---------------------------------------------------------------------------
// Service views (WebContentsView, one per enabled service, kept warm).
// ---------------------------------------------------------------------------
function makeServiceView(svc) {
  const partition = `persist:${svc.id}`;
  configureSession(partition);

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false,
      partition
    }
  });
  view.setBackgroundColor('#000000');

  const wc = view.webContents;
  wc.loadURL(svc.url, { userAgent: DESKTOP_USER_AGENT });

  // External destinations → system browser; in-service navigations stay in app.
  wc.setWindowOpenHandler(({ url }) => {
    const target = unwrapFbLink(url);
    if (isInternalToService(svc, target)) return { action: 'allow' };
    openExternal(target);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const target = unwrapFbLink(url);
    if (!isInternalToService(svc, target)) {
      event.preventDefault();
      openExternal(target);
    }
  });

  // status: 'loading' | 'ready' | 'failed' — drives the shell's error overlay.
  const entry = { view, svc, favicon: null, unread: 0, status: 'loading', failDesc: '' };
  views.set(svc.id, entry);

  wc.on('page-title-updated', (e, title) => {
    entry.unread = parseUnread(title);
    pushState();
  });
  wc.on('page-favicon-updated', (e, favicons) => {
    if (favicons && favicons.length) { entry.favicon = favicons[0]; pushState(); }
  });

  // A (re)load is starting — clear any prior failure so the view becomes visible.
  wc.on('did-start-loading', () => {
    if (entry.status === 'failed') { entry.status = 'loading'; layout(); pushState(); }
  });

  // Main-frame load failure (network down, blocked, DNS). -3 is a user/SPA abort.
  wc.on('did-fail-load', (e, errorCode, errorDescription, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      entry.status = 'failed';
      entry.failDesc = errorDescription || `error ${errorCode}`;
      layout();
      pushState();
    }
  });

  wc.on('did-finish-load', () => {
    entry.status = 'ready';
    const s = loadSettings();
    wc.setZoomFactor(typeof s.zoomFactor === 'number' ? s.zoomFactor : DEFAULT_ZOOM);

    if (svc.id === 'whatsapp') {
      wc.executeJavaScript(WHATSAPP_HIDE_DOWNLOAD_BANNER, true).catch(() => { /* best-effort */ });
    }

    if (svc.themeable) {
      // inserted-CSS handles are invalid after a load
      cssKeys[`oled:${svc.id}`] = null;
      if (svc.id === 'messenger') {
        cssKeys.compact = null;
        if (s.compactSidebar) applyCompactSidebar(true);
      }
      if (s.oledTheme && svc.oledRemote) {
        // Dark styling can settle after load (SPA); a fresh launch may show the
        // light login page first. Retry the dark-guarded apply briefly.
        let tries = 0;
        const t = setInterval(() => {
          if (cssKeys[`oled:${svc.id}`] != null || ++tries > 8 || !views.get(svc.id) || !loadSettings().oledTheme) {
            clearInterval(t);
            return;
          }
          applyOledToService(svc, true);
        }, 800);
      }
    }
    layout();
    pushState();
  });

  return entry;
}

function ensureServiceViews() {
  const wanted = orderedEnabledServices();
  // Create any missing enabled views.
  for (const svc of wanted) {
    if (!views.has(svc.id)) {
      const entry = makeServiceView(svc);
      mainWindow.contentView.addChildView(entry.view);
    }
  }
  // Destroy views that are no longer enabled.
  const wantedIds = new Set(wanted.map((s) => s.id));
  for (const [id, entry] of [...views]) {
    if (!wantedIds.has(id)) {
      try { mainWindow.contentView.removeChildView(entry.view); } catch { /* */ }
      try { entry.view.webContents.destroy(); } catch { /* */ }
      views.delete(id);
    }
  }
  // Make sure something valid is active.
  if (!activeId || !views.has(activeId)) {
    const saved = loadSettings().activeService;
    setActive(saved && views.has(saved) ? saved : wanted[0].id);
  } else {
    layout();
    pushState();
  }
}

function setActive(id) {
  if (!views.has(id)) {
    const svc = SERVICES.find((s) => s.id === id);
    if (!svc) return;
    const entry = makeServiceView(svc);
    mainWindow.contentView.addChildView(entry.view);
  }
  activeId = id;
  closeSettings();
  // Re-adding moves the view to the top of the stack (above the others).
  mainWindow.contentView.addChildView(views.get(id).view);
  saveSettings({ activeService: id });
  layout();
  pushState();
  const wc = activeWc();
  if (wc && !wc.isDestroyed()) wc.focus();
}

// Position the active service view (and settings overlay) above the bottom bar.
function layout() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [w, h] = mainWindow.getContentSize();
  // Content sits between the top title bar and the bottom service bar.
  const contentH = Math.max(0, h - TOP_BAR - BAR_HEIGHT);
  for (const [id, entry] of views) {
    // Active view fills the content area — unless it failed to load, where we
    // hide it (0×0) so the shell's error overlay shows through underneath.
    if (id === activeId && !settingsView && entry.status !== 'failed') {
      entry.view.setBounds({ x: 0, y: TOP_BAR, width: w, height: contentH });
    } else {
      entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }
  }
  if (settingsView) settingsView.setBounds({ x: 0, y: TOP_BAR, width: w, height: contentH });
}

// Push the bottom-bar state (services, badges, active) to the shell renderer.
// Debounced: page-title/favicon events can fire in bursts during activity.
let pushTimer = null;
function pushState() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; doPushState(); }, 50);
}

function doPushState() {
  // The debounced timer can fire after the window is gone (quit). Check the
  // window itself BEFORE touching .webContents — a destroyed BrowserWindow
  // throws "Object has been destroyed" on any property access.
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  const active = activeId && views.get(activeId);
  const payload = {
    services: orderedEnabledServices().map((svc) => {
      const e = views.get(svc.id);
      return {
        id: svc.id,
        name: svc.name,
        color: svc.color,
        favicon: e ? e.favicon : null,
        unread: e ? e.unread : 0,
        active: svc.id === activeId && !settingsView
      };
    }),
    settingsOpen: !!settingsView,
    // Error overlay for the active service when its main frame failed to load.
    activeStatus: active ? active.status : 'loading',
    activeName: active ? active.svc.name : '',
    activeError: active && active.status === 'failed' ? active.failDesc : ''
  };
  mainWindow.webContents.send('shell:state', payload);
}

// ---------------------------------------------------------------------------
// Settings: a slide-over panel (its own WebContentsView over the content area).
// ---------------------------------------------------------------------------
function openSettings(tab) {
  if (!mainWindow) return;
  if (!settingsView) {
    settingsView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'settings-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    settingsView.setBackgroundColor('#0a0a0c');
    settingsView.webContents.loadFile(path.join(__dirname, 'settings.html'));
    settingsView.webContents.on('did-finish-load', () => {
      if (settingsView) settingsView.webContents.send('settings:focus-tab', tab || 'appearance');
    });
  }
  mainWindow.contentView.addChildView(settingsView); // on top
  layout();
  pushState();
  settingsView.webContents.send('settings:focus-tab', tab || 'appearance');
}

function closeSettings() {
  if (!settingsView) return;
  try { mainWindow.contentView.removeChildView(settingsView); } catch { /* */ }
  try { settingsView.webContents.destroy(); } catch { /* */ }
  settingsView = null;
  layout();
  pushState();
}

// ---------------------------------------------------------------------------
// Main window (the shell). Its own webContents draws the bottom bar; the service
// views sit on top of it, covering everything except the bottom strip.
// ---------------------------------------------------------------------------
function createWindow() {
  const state = visibleWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 480,
    minHeight: 400,
    title: 'KausApp',
    icon: resolveIcon(),
    backgroundColor: '#000000',
    // Deliver the FIRST click on the bottom bar even when a service view
    // currently holds focus. Without this, AppKit swallows that click just to
    // transfer first-responder, so switching services took two clicks.
    acceptFirstMouse: true,
    // Hidden native title bar → our own pure-black strip at the top. Keep the OS
    // window controls: traffic lights on macOS, a black overlay on Windows/Linux.
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 12, y: 17 } }
      : { titleBarOverlay: { color: '#000000', symbolColor: '#e8eefc', height: TOP_BAR } }),
    webPreferences: {
      preload: path.join(__dirname, 'shell-preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'shell.html'));

  // The shell page is local chrome — never navigate it; bounce links to browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) { event.preventDefault(); openExternal(url); }
  });

  mainWindow.on('resize', () => { layout(); saveWindowState(); });
  mainWindow.on('move', saveWindowState);

  mainWindow.on('close', (event) => {
    if (!isQuitting && process.platform === 'darwin') {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    saveWindowState();
  });

  // Window really gone (quit): drop the reference and cancel any pending pushState
  // timer so it can't fire against a destroyed window.
  mainWindow.on('closed', () => {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    ensureServiceViews();
    pushState();
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
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

// The app icon as a small data URL for the shell's bottom-bar wordmark. Computed
// once; '' if no icon asset (the shell falls back to a text-only wordmark).
let brandIconUrl = null;
function brandIcon() {
  if (brandIconUrl !== null) return brandIconUrl;
  const img = resolveIcon();
  brandIconUrl = img ? img.resize({ width: 36, height: 36 }).toDataURL() : '';
  return brandIconUrl;
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
            { label: 'Settings…', accelerator: 'Cmd+,', click: () => openSettings('appearance') },
            { type: 'separator' },
            { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Reload Service', accelerator: 'CmdOrCtrl+R', click: () => { const wc = activeWc(); if (wc) wc.reload(); } },
        ...(isMac ? [] : [{ label: 'Settings…', accelerator: 'Ctrl+,', click: () => openSettings('appearance') }]),
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
          click: (item) => { saveSettings({ compactSidebar: item.checked }); applyCompactSidebar(item.checked); }
        },
        {
          label: 'Pure Black (OLED) theme',
          type: 'checkbox',
          checked: !!loadSettings().oledTheme,
          click: (item) => { saveSettings({ oledTheme: item.checked }); applyOledTheme(item.checked, true); }
        },
        { type: 'separator' },
        {
          label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus',
          click: () => { const wc = activeWc(); if (wc) { const z = wc.getZoomFactor() + 0.1; wc.setZoomFactor(z); saveSettings({ zoomFactor: z }); } }
        },
        {
          label: 'Zoom Out', accelerator: 'CmdOrCtrl+-',
          click: () => { const wc = activeWc(); if (wc) { const z = Math.max(0.5, wc.getZoomFactor() - 0.1); wc.setZoomFactor(z); saveSettings({ zoomFactor: z }); } }
        },
        {
          label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0',
          click: () => { const wc = activeWc(); if (wc) { wc.setZoomFactor(DEFAULT_ZOOM); saveSettings({ zoomFactor: DEFAULT_ZOOM }); } }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: () => { const wc = activeWc(); if (wc) wc.toggleDevTools(); } }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `KausApp v${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => checkForUpdates(() => mainWindow) },
        { label: 'Report a Bug…', click: () => openBugReport() },
        { label: 'Send Theme Diagnostics…', click: () => sendThemeDiagnostics() },
        { type: 'separator' },
        { label: 'KausApp Website', click: () => shell.openExternal('https://kausapp.com') },
        { label: 'Release Notes', click: () => shell.openExternal('https://github.com/codexv/kausapp/releases') }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function buildTray() {
  const icon = resolveIcon();
  if (!icon) return;
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('KausApp');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show KausApp', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => { if (mainWindow) (mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show()); });
}

// ---------------------------------------------------------------------------
// Bug reporting: capture a screenshot of the active service + a description,
// then POST to the backend (stored in KV; viewable on the admin page).
// ---------------------------------------------------------------------------
let reportWindow = null;
let pendingScreenshot = '';

async function openBugReport() {
  if (!mainWindow) return;
  if (reportWindow && !reportWindow.isDestroyed()) { reportWindow.focus(); return; }

  pendingScreenshot = '';
  try {
    const wc = activeWc();
    if (wc && !wc.isDestroyed()) pendingScreenshot = (await wc.capturePage()).toDataURL();
  } catch { /* screenshot is best-effort */ }

  reportWindow = new BrowserWindow({
    width: 540, height: 660, parent: mainWindow, modal: true,
    title: 'Report a Bug', resizable: false, minimizable: false, maximizable: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'report-preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  reportWindow.setMenuBarVisibility(false);
  reportWindow.loadFile(path.join(__dirname, 'report.html'));
  reportWindow.webContents.on('did-finish-load', () => {
    if (reportWindow && !reportWindow.isDestroyed()) {
      reportWindow.webContents.send('report:init', {
        screenshot: pendingScreenshot, version: app.getVersion(), platform: process.platform
      });
    }
  });
  reportWindow.on('closed', () => { reportWindow = null; });
}

function registerReportIpc() {
  ipcMain.handle('report:submit', async (event, payload) => {
    const includeShot = !(payload && payload.includeScreenshot === false);
    const body = {
      description: String((payload && payload.description) || '').slice(0, 5000),
      screenshot: includeShot ? pendingScreenshot : '',
      version: app.getVersion(),
      platform: process.platform
    };
    try {
      const res = await net.fetch(REPORT_ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.ok === true, error: data.error };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  ipcMain.on('report:close', () => {
    if (reportWindow && !reportWindow.isDestroyed()) reportWindow.close();
  });
}

// ---------------------------------------------------------------------------
// Self-diagnosing theme capture — the app walks the conversation DOM itself
// (CSS vars + distinct backgrounds) and submits it. One click, no console.
// ---------------------------------------------------------------------------
const THEME_DIAG_SCRIPT = `(() => {
  const out = { url: location.href, vars: {}, backgrounds: [] };
  try {
    const cs = getComputedStyle(document.documentElement);
    const KEYS = ['bubble','message','accent','surface','card','wash','nav',
                  'comment','highlight','primary','background'];
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (prop.indexOf('--') === 0 && KEYS.some(k => prop.indexOf(k) !== -1)) {
        out.vars[prop] = cs.getPropertyValue(prop).trim();
      }
    }
  } catch (e) { out.varsError = String(e); }
  try {
    const main = document.querySelector('[role="main"]') || document.body;
    const seen = new Set();
    const els = main.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const s = getComputedStyle(el);
      const bg = s.backgroundColor;
      const bgImg = s.backgroundImage;
      const hasImg = bgImg && bgImg !== 'none';
      const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
      if (transparent && !hasImg) continue;
      const cls = (el.className && el.className.toString)
        ? el.className.toString().slice(0, 110) : '';
      const key = bg + '|' + (hasImg ? bgImg.slice(0, 50) : '') + '|' + cls;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = el.getBoundingClientRect();
      out.backgrounds.push({
        tag: el.tagName.toLowerCase(), cls: cls, bg: bg,
        bgImg: hasImg ? bgImg.slice(0, 90) : '',
        w: Math.round(r.width), h: Math.round(r.height),
        text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 36)
      });
      if (out.backgrounds.length >= 80) break;
    }
  } catch (e) { out.bgError = String(e); }
  return out;
})()`;

async function sendThemeDiagnostics() {
  if (!mainWindow) return;

  // Explicit consent: this leaves the device with on-screen text + a screenshot.
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Send diagnostics', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Send theme diagnostics?',
    message: 'This sends a screenshot of the current view plus on-screen text snippets to KausApp.',
    detail: 'Used only to fix theming. It includes visible message text and contact names from the active service. Don’t send if sensitive information is on screen.'
  });
  if (response !== 0) return;

  const wc = activeWc();
  let diag;
  try {
    diag = wc && !wc.isDestroyed()
      ? await wc.executeJavaScript(THEME_DIAG_SCRIPT, true)
      : { error: 'no active service view' };
  } catch (err) {
    diag = { error: String((err && err.message) || err) };
  }

  let screenshot = '';
  try { if (wc && !wc.isDestroyed()) screenshot = (await wc.capturePage()).toDataURL(); } catch { /* */ }

  const body = {
    kind: 'diagnostics',
    description: `[THEME DIAGNOSTICS] ${activeId || 'unknown'} auto-capture (no console). See diagnostics field.`,
    diagnostics: JSON.stringify(diag, null, 2),
    screenshot,
    version: app.getVersion(),
    platform: process.platform
  };

  try {
    const res = await net.fetch(REPORT_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'Diagnostics sent', message: 'Theme diagnostics sent — thank you!',
        detail: 'KausApp captured the active view’s colors, text snippets, and a screenshot, and sent them. No console needed.'
      });
    } else {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
  } catch (err) {
    dialog.showMessageBox(mainWindow, {
      type: 'error', title: 'Could not send diagnostics',
      message: 'Diagnostics could not be sent.', detail: String((err && err.message) || err)
    });
  }
}

// ---------------------------------------------------------------------------
// IPC from the shell (bottom bar) and the settings panel.
// ---------------------------------------------------------------------------
function registerShellIpc() {
  ipcMain.on('shell:ready', () => {
    pushState();
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('shell:brand', { icon: brandIcon(), version: app.getVersion() });
    }
  });
  // The bar only renders enabled services, so a valid switch always has a view.
  ipcMain.on('shell:switch', (e, id) => { if (id && views.has(id)) setActive(id); });
  ipcMain.on('shell:reload', () => { const wc = activeWc(); if (wc && !wc.isDestroyed()) wc.reload(); });
  ipcMain.on('shell:open-settings', (e, tab) => openSettings(tab));

  ipcMain.handle('settings:load', () => {
    const s = loadSettings();
    const enabled = Array.isArray(s.enabledServices) ? s.enabledServices : DEFAULT_ENABLED;
    const ordered = orderedEnabledServices().map((x) => x.id);
    // Full service list in display order (enabled first, then the rest).
    const rest = SERVICES.filter((x) => !ordered.includes(x.id)).map((x) => x.id);
    const displayOrder = [...ordered, ...rest];
    return {
      version: app.getVersion(),
      platform: process.platform,
      settings: {
        oledTheme: !!s.oledTheme,
        compactSidebar: !!s.compactSidebar,
        zoomFactor: typeof s.zoomFactor === 'number' ? s.zoomFactor : DEFAULT_ZOOM,
        launchAtLogin: app.getLoginItemSettings().openAtLogin
      },
      services: displayOrder.map((id) => {
        const svc = SERVICES.find((x) => x.id === id);
        return { id: svc.id, name: svc.name, color: svc.color, enabled: enabled.includes(id), themeable: !!svc.themeable };
      })
    };
  });

  ipcMain.handle('settings:patch', (e, patch) => {
    patch = patch || {};
    const updates = {};
    if (typeof patch.oledTheme === 'boolean') updates.oledTheme = patch.oledTheme;
    if (typeof patch.compactSidebar === 'boolean') updates.compactSidebar = patch.compactSidebar;
    if (typeof patch.zoomFactor === 'number') updates.zoomFactor = Math.min(2, Math.max(0.5, patch.zoomFactor));
    if (Array.isArray(patch.enabledServices)) updates.enabledServices = patch.enabledServices.filter((id) => SERVICES.some((s) => s.id === id));
    if (Array.isArray(patch.serviceOrder)) updates.serviceOrder = patch.serviceOrder.filter((id) => SERVICES.some((s) => s.id === id));
    if (Object.keys(updates).length) saveSettings(updates);

    if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });

    // Reflect immediately.
    if ('oledTheme' in updates) applyOledTheme(updates.oledTheme, true);
    if ('compactSidebar' in updates) applyCompactSidebar(updates.compactSidebar);
    if ('zoomFactor' in updates) for (const [, en] of views) { try { en.view.webContents.setZoomFactor(updates.zoomFactor); } catch { /* */ } }
    if ('enabledServices' in updates || 'serviceOrder' in updates) ensureServiceViews();
    pushState();
    return { ok: true };
  });

  ipcMain.handle('settings:action', (e, msg) => {
    const name = msg && msg.name;
    if (name === 'check-updates') checkForUpdates(() => mainWindow);
    else if (name === 'report-bug') openBugReport();
    else if (name === 'diagnostics') sendThemeDiagnostics();
    else if (name === 'open-url' && msg.arg) shell.openExternal(String(msg.arg));
    return { ok: true };
  });

  ipcMain.on('settings:close', () => { closeSettings(); if (activeId) setActive(activeId); });
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
  app.setAboutPanelOptions({
    applicationName: 'KausApp',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: 'Coders Republic — coders.ph'
  });

  registerReportIpc();
  registerShellIpc();

  const { default: contextMenu } = await import('electron-context-menu');
  contextMenu({ showSaveImageAs: true, showCopyImageAddress: true, showSearchWithGoogle: false });

  buildMenu();
  createWindow();
  buildTray();

  initAutoUpdates(() => mainWindow, () => { isQuitting = true; });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) mainWindow.show();
  });
});

app.on('before-quit', () => { isQuitting = true; saveWindowState(); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
