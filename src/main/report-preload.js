'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, safe bridge for the bug-report window.
contextBridge.exposeInMainWorld('reportAPI', {
  onInit: (cb) => ipcRenderer.on('report:init', (_e, data) => cb(data)),
  submit: (payload) => ipcRenderer.invoke('report:submit', payload),
  close: () => ipcRenderer.send('report:close')
});
