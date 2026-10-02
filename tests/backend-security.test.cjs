'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const desktopDirectory = path.join(__dirname, '..', 'desktop');
const settle = () => new Promise(resolve => setImmediate(resolve));

async function mainHarness() {
  const handlers = new Map();
  const app = new EventEmitter();
  const windows = [];
  const permissions = {};
  const calls = [];
  const answers = [];
  Object.assign(app, {
    setName: name => { app.name = name; }, setAppUserModelId: id => { app.modelId = id; },
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => '/application-data/renew', quit: () => { calls.push('quit'); },
  });
  class FakeService {
    constructor(options) { this.options = options; this.active = false; FakeService.instance = this; }
    async initialize() {}
    getState() { return { games: [], settings: {}, session: null }; }
    async updateSettings(patch) { calls.push(['settings', patch]); return this.getState(); }
    async updateGame(id, patch) { calls.push(['game', id, patch]); return this.getState(); }
    async launchGame(id) { calls.push(['launch', id]); return this.getState(); }
    async removeGame(id) { calls.push(['remove', id]); return this.getState(); }
    async setEmulator(file) { calls.push(['emulator', file]); return this.getState(); }
    async importGames(files) { calls.push(['import', files]); return this.getState(); }
    hasActiveSession() { return this.active; }
    async checkpointSession() { calls.push('checkpoint'); }
    async flush(options) { calls.push('flush'); calls.push(['flushOptions', options]); }
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: pathToFileURL(path.join(desktopDirectory, '..', 'src', 'index.html')).href };
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      this.webContents.send = (...args) => { calls.push(['send', ...args]); };
    }
    isDestroyed() { return this.destroyed; }
    removeMenu() {}
    async loadFile(file) { this.loaded = file; }
    show() { calls.push('show'); }
    focus() { calls.push('focus'); }
    isMinimized() { return false; }
    restore() { calls.push('restore'); }
    minimize() { calls.push('minimize'); }
    isMaximized() { return false; }
    maximize() { calls.push('maximize'); }
    unmaximize() { calls.push('unmaximize'); }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event);
      if (!event.prevented) { this.destroyed = true; this.emit('closed'); }
    }
  }
  const electron = {
    app, BrowserWindow: FakeWindow,
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    session: { defaultSession: {
      setPermissionRequestHandler: handler => { permissions.request = handler; },
      setPermissionCheckHandler: handler => { permissions.check = handler; },
    } },
    dialog: {
      showOpenDialog: async (_window, options) => { calls.push(['dialog', options]); return { canceled: true, filePaths: [] }; },
      showMessageBox: async (_window, options) => { calls.push(['message', options]); return { response: answers.shift() ?? 0 }; },
      showErrorBox: (...args) => { calls.push(['errorBox', ...args]); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(desktopDirectory, 'main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : name === './services.cjs' ? { LauncherService: FakeService } : require(name),
    __dirname: desktopDirectory,
  }, { filename: 'main.cjs' });
  await settle();
  const window = windows[0];
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { handlers, window, permissions, calls, answers, app, service: FakeService.instance, event };
}

test('preload exposes only the narrow allowlist and removes privileged event objects', async () => {
  let exposed;
  const ipc = new EventEmitter();
  const calls = [];
  ipc.invoke = (...args) => { calls.push(args); return Promise.resolve({}); };
  vm.runInNewContext(fs.readFileSync(path.join(desktopDirectory, 'preload.cjs'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } }, ipcRenderer: ipc };
    },
  });
  assert.equal(exposed.name, 'renewAPI');
  const api = exposed.api;
  assert.equal(Object.isFrozen(api), true);
  assert.deepEqual(Object.keys(api).sort(), ['chooseEmulator', 'getState', 'importGames', 'launchGame',
    'onSession', 'removeGame', 'updateGame', 'updateSettings', 'windowControl'].sort());
  await api.launchGame('game-1');
  assert.deepEqual(calls, [['renew:launch-game', 'game-1']]);
  const state = { session: null };
  const received = [];
  const unsubscribe = api.onSession((...args) => received.push(args));
  ipc.emit('renew:session', { privileged: true }, state);
  assert.deepEqual(received, [[state]]);
  unsubscribe();
  ipc.emit('renew:session', {}, state);
  assert.equal(received.length, 1);
  assert.throws(() => api.onSession('not a callback'), /callback/);
});

test('native window uses isolation, sandbox, and denies navigation, popups, webviews, and permissions', async () => {
  const h = await mainHarness();
  assert.equal(h.app.modelId, 'app.renew.launcher');
  assert.equal(h.window.options.backgroundColor, '#111715');
  const prefs = h.window.options.webPreferences;
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInWorker, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.webviewTag, false);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.allowRunningInsecureContent, false);
  assert.equal(h.window.openHandler().action, 'deny');
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
    let prevented = false;
    h.window.webContents.emit(name, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  let allowed;
  h.permissions.request(null, 'camera', value => { allowed = value; });
  assert.equal(allowed, false);
  assert.equal(h.permissions.check(), false);
  assert.equal(h.service.options.statePath, '/application-data/renew/library.json');
});

test('IPC accepts only the launcher main frame, and rejects unknown window actions', async () => {
  const h = await mainHarness();
  const get = h.handlers.get('renew:get-state');
  assert.equal((await get(h.event())).session, null);
  await assert.rejects(get({ sender: {}, senderFrame: h.window.webContents.mainFrame }), /did not come/);
  await assert.rejects(get({ sender: h.window.webContents, senderFrame: { url: h.window.webContents.mainFrame.url } }), /did not come/);
  h.window.webContents.mainFrame.url = 'https://untrusted.example/';
  await assert.rejects(get(h.event()), /did not come/);
  h.window.webContents.mainFrame.url = pathToFileURL(path.join(desktopDirectory, '..', 'src', 'index.html')).href;
  await assert.rejects(h.handlers.get('renew:window-control')(h.event(), 'execute'), /not supported/);
  await h.handlers.get('renew:window-control')(h.event(), 'minimize');
  assert.ok(h.calls.includes('minimize'));
});

test('native pickers restrict emulator and game extensions and cancellation does not mutate state', async () => {
  const h = await mainHarness();
  await h.handlers.get('renew:choose-emulator')(h.event());
  await h.handlers.get('renew:import-games')(h.event());
  const dialogs = h.calls.filter(call => Array.isArray(call) && call[0] === 'dialog');
  assert.equal(JSON.stringify(dialogs[0][1].filters[0].extensions), '["exe"]');
  assert.equal(JSON.stringify(dialogs[1][1].filters[0].extensions), '["gba","gbc","gb"]');
  assert.equal(h.calls.some(call => Array.isArray(call) && ['emulator', 'import'].includes(call[0])), false);
});

test('closing with an active game requires a choice and checkpoints without stopping the emulator', async () => {
  const h = await mainHarness();
  h.service.active = true;
  h.answers.push(0, 1);
  h.window.close();
  await settle();
  assert.equal(h.window.destroyed, false);
  assert.equal(h.calls.includes('checkpoint'), false);
  h.window.close();
  await settle();
  assert.equal(h.window.destroyed, true);
  assert.ok(h.calls.includes('checkpoint'));
  assert.ok(h.calls.includes('flush'));
  const messages = h.calls.filter(call => Array.isArray(call) && call[0] === 'message');
  assert.match(messages[1][1].detail, /leave mGBA running/);
  assert.equal(h.service.active, true);
});

test('failed close checkpoint keeps the native window open and exposes an actionable error', async () => {
  const h = await mainHarness();
  h.service.active = true;
  h.answers.push(1);
  const checkpoint = h.service.checkpointSession.bind(h.service);
  h.service.checkpointSession = async () => { throw new Error('Renew could not save your library. Check that your disk has space.'); };
  h.window.close();
  await settle();
  assert.equal(h.window.destroyed, false);
  assert.equal(h.calls.includes('flush'), false);
  const errorDialog = h.calls.find(call => Array.isArray(call) && call[0] === 'message' && call[1].type === 'error');
  assert.ok(errorDialog);
  assert.match(errorDialog[1].message, /disk has space/);
  assert.equal(h.service.active, true);
  h.service.checkpointSession = checkpoint;
  h.answers.push(1);
  h.window.close();
  await settle();
  assert.equal(h.window.destroyed, true);
  assert.equal(h.calls.find(call => Array.isArray(call) && call[0] === 'flushOptions')[1].requireSaved, true);
});

test('a late unsaved-write failure in strict flush also prevents native window closure', async () => {
  const h = await mainHarness();
  h.service.flush = async options => {
    assert.equal(options.requireSaved, true);
    throw new Error('The completed session has not been saved.');
  };
  h.window.close();
  await settle();
  assert.equal(h.window.destroyed, false);
  const errorDialog = h.calls.find(call => Array.isArray(call) && call[0] === 'message' && call[1].type === 'error');
  assert.match(errorDialog[1].message, /not been saved/);
});
