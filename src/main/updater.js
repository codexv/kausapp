'use strict';

// Standard Electron auto-update, backed by GitHub Releases (feed configured by
// build.publish in package.json). Checks on launch + every 6h, downloads in the
// background, and prompts to restart. Also exposes a manual "Check for Updates"
// that surfaces user-facing dialogs (checking / up to date / available / error).

const { app, dialog } = require('electron');

let autoUpdater = null;
let getWin = null;
let manualCheck = false; // true when the user explicitly invoked a check

function win() {
  return typeof getWin === 'function' ? getWin() : null;
}

function box(opts) {
  const w = win();
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
}

function load() {
  if (autoUpdater) return autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[updater] electron-updater not available:', err && err.message);
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  wireEvents();
  return autoUpdater;
}

function wireEvents() {
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info && info.version);
    if (manualCheck) {
      manualCheck = false;
      box({
        type: 'info',
        buttons: ['OK'],
        title: 'Update available',
        message: `Kausapp ${info && info.version ? info.version : ''} is available.`,
        detail: 'It’s downloading in the background — you’ll be asked to restart when it’s ready.'
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
    if (manualCheck) {
      manualCheck = false;
      box({
        type: 'info',
        buttons: ['OK'],
        title: 'You’re up to date',
        message: 'You’re up to date',
        detail: `Kausapp ${app.getVersion()} is the latest version.`
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading ${Math.round(p.percent)}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await box({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Kausapp ${info && info.version ? info.version : ''} is ready to install.`,
      detail: 'Restart Kausapp to apply it. It will also install automatically the next time you quit.'
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err == null ? 'unknown' : (err.stack || err).toString());
    if (manualCheck) {
      manualCheck = false;
      box({
        type: 'error',
        buttons: ['OK'],
        title: 'Update check failed',
        message: 'Couldn’t check for updates',
        detail: String((err && err.message) || err || 'Unknown error')
      });
    }
  });
}

function initAutoUpdates(getWindow) {
  getWin = getWindow;
  if (!app.isPackaged) return; // no update metadata in dev
  if (!load()) return;
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 6 * 60 * 60 * 1000);
}

// Triggered by the "Check for Updates…" menu item.
function checkForUpdates(getWindow) {
  if (getWindow) getWin = getWindow;
  if (!app.isPackaged) {
    box({
      type: 'info',
      buttons: ['OK'],
      title: 'Updates',
      message: 'Updates are only available in the installed app.',
      detail: 'You’re running an unpackaged/dev build.'
    });
    return;
  }
  if (!load()) return;
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { initAutoUpdates, checkForUpdates };
