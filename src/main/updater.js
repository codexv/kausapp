'use strict';

// Standard Electron auto-update, backed by GitHub Releases (the feed is
// configured by the `build.publish` block in package.json; electron-builder
// embeds it as app-update.yml and publishes latest.yml / latest-mac.yml /
// latest-linux.yml alongside each release).
//
// Flow: on launch (and every 6h) we check the latest GitHub Release. If a newer
// version exists, electron-updater downloads it in the background, then we
// prompt the user to restart and apply it.

const { app, dialog } = require('electron');

function initAutoUpdates(getWindow) {
  // Auto-update only makes sense for a packaged, installed app. In dev
  // (electron .) there's no update metadata, and electron-updater throws.
  if (!app.isPackaged) return;

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    console.error('[updater] electron-updater not available:', err && err.message);
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if user declines "restart now", apply on next quit

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info && info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
  });

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading ${Math.round(p.percent)}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const win = typeof getWindow === 'function' ? getWindow() : null;
    const opts = {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Kausapp ${info && info.version ? info.version : ''} is ready to install.`,
      detail: 'Restart Kausapp to apply the update. It will also install automatically the next time you quit.'
    };
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts);
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  autoUpdater.on('error', (err) => {
    // Network hiccups / no release yet shouldn't crash or nag the user.
    console.error('[updater] error:', err == null ? 'unknown' : (err.stack || err).toString());
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* handled by 'error' */ });
  check();
  // Re-check every 6 hours while the app stays open.
  setInterval(check, 6 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdates };
