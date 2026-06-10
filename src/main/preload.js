'use strict';

// The preload runs in an isolated context with access to a limited Node API.
// For now we keep the page untouched (messenger.com is a full SPA), but this is
// the seam where we can later inject UX niceties: unread-count badges, custom
// notification handling, theme tweaks, keyboard shortcuts, etc.

const { contextBridge } = require('electron');

// Expose a minimal, namespaced API instead of leaking Node into the page.
contextBridge.exposeInMainWorld('desktopMessenger', {
  version: '0.1.0',
  platform: process.platform
});
