'use strict';

const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedFileURL } = require('./trusted-file-url.cjs');
const { LauncherService } = require('./services.cjs');
const { collectDeviceInfo } = require('./device-info.cjs');

app.setName('Renew');
app.setAppUserModelId('app.renew.launcher');
const entryPath = path.join(__dirname, '..', 'src', 'index.html');
let window = null;
let service = null;
let closeApproved = false;
let closePending = false;
let dialogPending = false;

function currentWindow() { return window && !window.isDestroyed() ? window : null; }
function trusted(event) {
  const target = currentWindow();
  if (!target || event.sender !== target.webContents || event.senderFrame !== target.webContents.mainFrame ||
      !isTrustedFileURL(event.senderFrame.url, entryPath)) {
    throw new Error('This request did not come from the Renew launcher.');
  }
}
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    try { return await action(...args); }
    catch (error) { throw new Error(error?.message || 'Renew could not complete that request. Please try again.'); }
  });
}
async function withDialog(action) {
  if (dialogPending) throw new Error('Finish the open file picker before opening another.');
  dialogPending = true;
  try { return await action(); }
  finally { dialogPending = false; }
}
function registerIPC() {
  handle('renew:get-state', () => service.getState());
  handle('renew:get-device-info', () => collectDeviceInfo({app}));
  handle('renew:choose-emulator', () => withDialog(async () => {
    const result = await dialog.showOpenDialog(currentWindow(), {
      title: 'Choose your mGBA executable', buttonLabel: 'Use mGBA',
      filters: [{ name: 'mGBA executable', extensions: ['exe'] }], properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return service.getState();
    return service.setEmulator(result.filePaths[0]);
  }));
  handle('renew:import-games', () => withDialog(async () => {
    const result = await dialog.showOpenDialog(currentWindow(), {
      title: 'Import your Game Boy games', buttonLabel: 'Import games',
      filters: [{ name: 'Game Boy games', extensions: ['gba', 'gbc', 'gb'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return service.getState();
    return service.importGames(result.filePaths);
  }));
  handle('renew:update-settings', patch => service.updateSettings(patch));
  handle('renew:update-game', (id, patch) => service.updateGame(id, patch));
  handle('renew:remove-game', id => service.removeGame(id));
  handle('renew:launch-game', id => service.launchGame(id));
  handle('renew:window-control', action => {
    const target = currentWindow();
    if (action === 'minimize') target.minimize();
    else if (action === 'maximize') target.isMaximized() ? target.unmaximize() : target.maximize();
    else if (action === 'close') target.close();
    else throw new Error('That window action is not supported.');
  });
}
function restoreWindow() {
  const target = currentWindow();
  if (!target) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
}
function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 980, minHeight: 680,
    title: 'Renew', frame: false, show: false, backgroundColor: '#111715',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => currentWindow()?.show());
  window.on('close', event => {
    if (closeApproved) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    void (async () => {
      try {
        if (service.hasActiveSession()) {
          const response = await dialog.showMessageBox(currentWindow(), {
            type: 'question', title: 'Keep your game running?',
            message: 'A game is still running in mGBA.',
            detail: 'Closing Renew will leave mGBA running. Play time is saved up to this point; time played after Renew closes will not be tracked.',
            buttons: ['Keep Renew open', 'Close Renew, keep game running'],
            defaultId: 0, cancelId: 0, noLink: true,
          });
          if (response.response !== 1) return;
        }
        await service.checkpointSession();
        await service.flush({ requireSaved: true });
        closeApproved = true;
        currentWindow()?.close();
      } catch (error) {
        await dialog.showMessageBox(currentWindow(), {
          type: 'error', title: 'Renew could not close safely',
          message: error.message || 'Please try closing Renew again.',
        });
      } finally { closePending = false; }
    })();
  });
  window.on('closed', () => { window = null; });
  // Use a fully encoded file URL: Electron loadFile's legacy URL formatter
  // leaves literal percent signs in Windows extraction paths unescaped.
  void window.loadURL(pathToFileURL(entryPath).href).catch(error => {
    dialog.showErrorBox('Renew could not open', `The launcher interface could not be loaded. ${error.message}`);
    closeApproved = true;
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', restoreWindow);
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    service = new LauncherService({
      statePath: path.join(app.getPath('userData'), 'library.json'),
      onState: state => currentWindow()?.webContents.send('renew:session', state),
      onRunning: () => currentWindow()?.minimize(),
      onFinished: restoreWindow,
    });
    await service.initialize();
    registerIPC();
    createWindow();
  }).catch(error => {
    dialog.showErrorBox('Renew could not start', error.message || 'Please try reopening Renew.');
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => {
    if (service && !currentWindow()) { closeApproved = false; createWindow(); }
    else restoreWindow();
  });
}
