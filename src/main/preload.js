'use strict';

// Preload for the service web views (messenger.com, web.whatsapp.com, …).
//
// Intentionally empty: the services are full SPAs we render untouched, and
// nothing in those pages consumes a bridge today. This file is kept as the seam
// where per-page niceties (custom notifications, keyboard shortcuts, theme
// hooks) would be wired via contextBridge.exposeInMainWorld when needed.
