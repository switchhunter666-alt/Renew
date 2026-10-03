'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The renderer receives capabilities, never Node, an IPC primitive, or filesystem access.
contextBridge.exposeInMainWorld('renewAPI', Object.freeze({
  getState: () => ipcRenderer.invoke('renew:get-state'),
  getDeviceInfo: () => ipcRenderer.invoke('renew:get-device-info'),
  chooseEmulator: () => ipcRenderer.invoke('renew:choose-emulator'),
  importGames: () => ipcRenderer.invoke('renew:import-games'),
  updateSettings: patch => ipcRenderer.invoke('renew:update-settings', patch),
  updateGame: (id, patch) => ipcRenderer.invoke('renew:update-game', id, patch),
  removeGame: id => ipcRenderer.invoke('renew:remove-game', id),
  launchGame: id => ipcRenderer.invoke('renew:launch-game', id),
  windowControl: action => ipcRenderer.invoke('renew:window-control', action),
  onSession: callback => {
    if (typeof callback !== 'function') throw new TypeError('A session callback is required.');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('renew:session', listener);
    return () => ipcRenderer.removeListener('renew:session', listener);
  },
}));
