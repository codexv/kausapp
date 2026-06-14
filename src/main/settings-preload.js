'use strict';

// Bridge for the Settings slide-over (settings.html).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  patch: (p) => ipcRenderer.invoke('settings:patch', p),
  action: (name, arg) => ipcRenderer.invoke('settings:action', { name, arg }),
  close: () => ipcRenderer.send('settings:close'),
  onFocusTab: (cb) => ipcRenderer.on('settings:focus-tab', (e, tab) => cb(tab))
});
