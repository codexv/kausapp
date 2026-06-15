'use strict';

// Bridge for the bottom service bar (shell.html). The shell is local app chrome;
// it only sends intent (switch service / open settings) and renders the state
// the main process pushes (services, unread badges, active service).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  onState: (cb) => ipcRenderer.on('shell:state', (e, state) => cb(state)),
  switchTo: (id) => ipcRenderer.send('shell:switch', id),
  reload: () => ipcRenderer.send('shell:reload'),
  openSettings: (tab) => ipcRenderer.send('shell:open-settings', tab),
  addService: () => ipcRenderer.send('shell:open-settings', 'services'),
  ready: () => ipcRenderer.send('shell:ready')
});
