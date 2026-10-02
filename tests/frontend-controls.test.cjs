const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// This is an adapter/DOM contract suite. jsdom does not render Chromium, open
// native dialogs, synthesize native button keyboard activation, or run mGBA.
let dom;
let serial = 0;
const fixtureGames = () => [
  { id: 'a', title: 'Green World', system: 'GBA', favorite: true, playSeconds: 65, lastPlayed: '2026-10-01T00:00:00Z', addedAt: '2026-09-01T00:00:00Z', art: 'aurora', path: 'C:\\Games\\Green World.gba' },
  { id: 'b', title: 'Blue Moon', system: 'GB', favorite: false, playSeconds: 0, lastPlayed: null, addedAt: '2026-10-02T00:00:00Z', art: 'ocean', path: 'C:\\Games\\Blue Moon.gb' },
  { id: 'c', title: 'Amber Trail', system: 'GBC', favorite: false, playSeconds: 3600, lastPlayed: '2026-09-29T00:00:00Z', addedAt: '2026-09-28T00:00:00Z', art: 'ember', path: 'C:\\Games\\Amber Trail.gbc' },
  { id: 'd', title: 'Quiet Fields', system: 'GBA', favorite: true, playSeconds: 180, lastPlayed: '2026-09-30T00:00:00Z', addedAt: '2026-09-27T00:00:00Z', art: 'violet', path: 'C:\\Games\\Quiet Fields.gba' }
];
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function setup(options = {}) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="announcer"></div><dialog id="dialog"></dialog><div id="toast" hidden></div></body></html>', { url: options.realPreview ? 'http://localhost/?preview=1' : 'http://localhost/', pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  global.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`) };
  if (options.sidebarPreference) window.localStorage.setItem('renew.view.sidebar.v1', options.sidebarPreference);
  if (options.blockStorage) Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
  const dialog = document.querySelector('#dialog');
  dialog.showModal = function () { this.setAttribute('open', ''); };
  dialog.close = function () { this.removeAttribute('open'); };
  const state = { games: structuredClone(options.games ?? fixtureGames()), settings: { emulatorPath: 'C:\\Emulators\\mGBA.exe', fullscreen: true, returnToLauncher: true, ...options.settings }, session: null, warning: null, error: null };
  const calls = [];
  const copy = () => structuredClone(state);
  const context = { state, calls, copy, dialog };
  const defaults = {
    getState: async () => copy(),
    chooseEmulator: async () => copy(),
    importGames: async () => copy(),
    updateSettings: async patch => { Object.assign(state.settings, patch); return copy(); },
    updateGame: async (id, patch) => { Object.assign(state.games.find(game => game.id === id), patch); return copy(); },
    removeGame: async id => { state.games = state.games.filter(game => game.id !== id); return copy(); },
    launchGame: async id => { state.session = { gameId: id, status: 'running' }; return copy(); },
    windowControl: () => {},
    clearPreview: async () => { state.games = []; return copy(); }
  };
  const api = { preview: Boolean(options.preview), onSession: handler => { context.emit = patch => { Object.assign(state, patch); handler(copy()); }; return () => {}; } };
  for (const [name, implementation] of Object.entries(defaults)) {
    api[name] = (...args) => { calls.push({ name, args: structuredClone(args) }); return options.methods?.[name] ? options.methods[name](context, ...args) : implementation(...args); };
  }
  if (!options.realPreview) window.renewAPI = api;
  context.api = options.realPreview ? null : api;
  await import(`../src/app.js?controls=${++serial}`);
  return context;
}
afterEach(() => { dom?.window.close(); });
const node = selector => { const value = document.querySelector(selector); assert.ok(value, `Control exists: ${selector}`); return value; };
const click = selector => node(selector).click();
const callCount = (context, name) => context.calls.filter(call => call.name === name).length;
const callsFor = (context, name) => context.calls.filter(call => call.name === name).map(call => call.args);
const titles = () => [...document.querySelectorAll('.card-title')].map(item => item.textContent);
function input(selector, value) { const element = node(selector); element.value = value; element.dispatchEvent(new window.Event('input', { bubbles: true })); }
function change(selector, value) { const element = node(selector); if (element.type === 'checkbox') element.checked = value; else element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })); }
const key = value => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
const cancelDialog = () => node('#dialog').dispatchEvent(new window.Event('cancel', { cancelable: true }));

// Navigation, collection tools, and every repeated control family.
test('control audit: menu collapse/expand survives reload and storage denial is recoverable', async () => {
  await setup();
  node('[data-action="toggle-menu"]').focus();
  click('[data-action="toggle-menu"]');
  assert.equal(node('[data-action="toggle-menu"]').getAttribute('aria-expanded'), 'true');
  assert.equal(node('[data-action="toggle-menu"]').getAttribute('aria-label'), 'Collapse navigation menu');
  assert.equal(document.activeElement.dataset.focus, 'menu-toggle');
  const preference = window.localStorage.getItem('renew.view.sidebar.v1');
  await setup({ sidebarPreference: preference });
  assert.equal(node('#app').classList.contains('menu-collapsed'), false);
  click('[data-action="toggle-menu"]');
  assert.equal(window.localStorage.getItem('renew.view.sidebar.v1'), 'collapsed');
  await setup({ blockStorage: true });
  click('[data-action="toggle-menu"]');
  assert.equal(node('#app').classList.contains('menu-collapsed'), false);
  assert.match(node('#toast').textContent, /could not save the preference/);
});
test('control audit: Library, Favorites, and brand reset the intended navigation filters', async () => {
  await setup();
  click('[data-view="favorites"]');
  assert.deepEqual(titles(), ['Green World', 'Quiet Fields']);
  input('#search', 'quiet');
  click('[data-focus="filter-GBA"]');
  click('[data-view="library"]');
  assert.equal(node('#search').value, '');
  assert.equal(titles().length, 4);
  assert.equal(node('[data-focus="filter-all"]').getAttribute('aria-pressed'), 'true');
  click('[data-view="favorites"]');
  input('#search', 'missing');
  click('.brand');
  assert.equal(titles().length, 4);
  assert.equal(node('[data-view="library"]').classList.contains('active'), true);
  assert.equal(node('#search').value, '');
});
for (const location of ['system', 'filter']) {
  for (const [system, expected] of [['GBA', ['Green World', 'Quiet Fields']], ['GBC', ['Amber Trail']], ['GB', ['Blue Moon']]]) {
    test(`control audit: ${location} ${system} filter works, reflects selection, and toggles off`, async () => {
      await setup();
      click(`[data-focus="${location}-${system}"]`);
      assert.deepEqual(titles(), expected);
      assert.equal(node(`[data-focus="system-${system}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(node(`[data-focus="filter-${system}"]`).getAttribute('aria-pressed'), 'true');
      assert.match(node('#announcer').textContent, new RegExp(`^${expected.length} games shown$`));
      click(`[data-focus="${location}-${system}"]`);
      assert.equal(titles().length, 4);
      assert.equal(node('[data-focus="filter-all"]').getAttribute('aria-pressed'), 'true');
    });
  }
}
test('control audit: All games and Clear filters preserve Favorites while resetting systems and search', async () => {
  await setup();
  click('[data-view="favorites"]');
  click('[data-focus="system-GB"]');
  click('[data-focus="filter-all"]');
  assert.deepEqual(titles(), ['Green World', 'Quiet Fields']);
  input('#search', 'absent');
  click('[data-focus="filter-GBC"]');
  click('[data-action="reset-filters"]');
  assert.equal(node('#search').value, '');
  assert.deepEqual(titles(), ['Green World', 'Quiet Fields']);
  assert.equal(node('[data-view="favorites"]').classList.contains('active'), true);
});
test('control audit: search input, empty-input clear, slash shortcut and Escape preserve data and focus', async () => {
  const context = await setup();
  key('/'); assert.equal(document.activeElement.id, 'search');
  input('#search', '  BLUE  '); assert.deepEqual(titles(), ['Blue Moon']);
  assert.equal(document.activeElement.id, 'search');
  input('#search', ''); assert.equal(titles().length, 4);
  input('#search', 'nothing'); assert.match(node('.empty-collection h3').textContent, /No games found/);
  key('Escape'); assert.equal(node('#search').value, ''); assert.equal(titles().length, 4);
  assert.equal(context.state.games.length, 4);
  assert.equal(callCount(context, 'updateGame'), 0);
});
test('control audit: every sort option changes actual card order and preserves focused sort', async () => {
  await setup();
  node('#sort').focus();
  for (const [sort, expected] of [['title', ['Amber Trail', 'Blue Moon', 'Green World', 'Quiet Fields']], ['played', ['Amber Trail', 'Quiet Fields', 'Green World', 'Blue Moon']], ['recent', ['Blue Moon', 'Green World', 'Quiet Fields', 'Amber Trail']]]) {
    change('#sort', sort); assert.deepEqual(titles(), expected); assert.equal(node('#sort').value, sort); assert.equal(document.activeElement.id, 'sort');
  }
});
test('control audit: list and grid switches change the layout state without losing the collection', async () => {
  await setup();
  node('[data-layout="list"]').focus(); click('[data-layout="list"]');
  assert.equal(node('.game-grid').classList.contains('list-layout'), true);
  assert.equal(node('[data-layout="list"]').getAttribute('aria-pressed'), 'true');
  assert.equal(node('[data-layout="grid"]').getAttribute('aria-pressed'), 'false');
  assert.equal(document.activeElement.dataset.focus, 'layout-list');
  click('[data-layout="grid"]');
  assert.equal(node('.game-grid').classList.contains('list-layout'), false);
  assert.equal(node('[data-layout="grid"]').getAttribute('aria-pressed'), 'true');
  assert.equal(titles().length, 4);
});
for (const control of ['select', 'title']) {
  test(`control audit: card ${control} selects the correct hero and overview without launching`, async () => {
    const context = await setup();
    node(`[data-focus="${control}-b"]`).focus(); click(`[data-focus="${control}-b"]`);
    assert.equal(node('#hero-title').textContent, 'Blue Moon');
    assert.equal(node('.selected-summary strong').textContent, 'Blue Moon');
    assert.equal(node('[data-focus="select-b"]').getAttribute('aria-pressed'), 'true');
    assert.equal(node('[data-focus="select-a"]').getAttribute('aria-pressed'), 'false');
    assert.equal(node('[data-action="play"]').dataset.id, 'b');
    assert.equal(document.activeElement.dataset.focus, `${control}-b`);
    assert.equal(callCount(context, 'launchGame'), 0);
  });
}
for (const selector of ['[data-focus="details-b"]', '[aria-label="Edit selected game details"]']) {
  test(`control audit: ${selector} opens actual selected game details`, async () => {
    await setup(); click('[data-focus="select-b"]'); click(selector);
    assert.equal(node('#dialog').open, true); assert.equal(node('#dialog-title').textContent, 'Blue Moon');
    assert.equal(node('#game-title').value, 'Blue Moon'); assert.match(node('.field-hint').textContent, /Blue Moon\.gb/);
    click('[aria-label="Close game details"]'); assert.equal(node('#dialog').open, false);
  });
}

// All actual import placements use the native adapter contract, never fake clicks.
const imports = [
  ['heading', '.add-button', false],
  ['quick actions', '[aria-label="Add games from quick actions"]', false],
  ['empty hero', '[data-focus="empty-import"]', true],
  ['empty collection', '.empty-collection [data-action="import"]', true],
  ['empty overview', '.game-overview [data-action="import"]', true]
];
for (const [name, selector, empty] of imports) {
  test(`control audit: Add games from ${name} calls import once and renders returned entries`, async () => {
    const context = await setup({ ...(empty ? { games: [] } : {}), methods: { importGames: async ctx => { ctx.state.games.push({ ...fixtureGames()[0], id: 'imported', title: 'Imported Homebrew' }); return ctx.copy(); } } });
    click(selector); await settle();
    assert.equal(callCount(context, 'importGames'), 1);
    assert.ok(titles().includes('Imported Homebrew'));
    assert.equal(node('.add-button').disabled, false);
    assert.equal(context.state.games.length, empty ? 1 : 5);
  });
}
test('control audit: canceled Add games restores controls and keeps the original library', async () => {
  const task = deferred(); const context = await setup({ methods: { importGames: () => task.promise } });
  click('.add-button'); click('[aria-label="Add games from quick actions"]');
  assert.equal(callCount(context, 'importGames'), 1);
  assert.equal(node('.add-button').disabled, true);
  assert.equal(node('[aria-label="Add games from quick actions"]').disabled, true);
  task.resolve(context.copy()); await settle();
  assert.deepEqual(titles(), ['Blue Moon', 'Green World', 'Quiet Fields', 'Amber Trail']);
  assert.equal(node('.add-button').disabled, false); assert.equal(node('#dialog').open, false);
});
test('control audit: every empty-library import button is visibly disabled while import is pending', async () => {
  const task = deferred(); const context = await setup({ games: [], methods: { importGames: () => task.promise } });
  click('[data-focus="empty-import"]');
  const disabled = [...document.querySelectorAll('[data-action="import"]')].map(button => ({ label: button.textContent.trim(), disabled: button.disabled }));
  task.resolve(context.copy()); await settle();
  assert.ok(disabled.every(control => control.disabled), `Pending import controls: ${JSON.stringify(disabled)}`);
});
for (const dismissal of ['[aria-label="Close message"]', '#dialog .dialog-actions [data-close]']) {
  test(`control audit: failed Add games shows an actionable error and ${dismissal} dismisses it`, async () => {
    const context = await setup({ methods: { importGames: async () => { throw new Error('The selected file could not be read.'); } } });
    node('.add-button').focus(); click('.add-button'); await settle();
    assert.equal(callCount(context, 'importGames'), 1);
    assert.equal(node('#dialog').open, true); assert.match(node('#dialog .dialog-description').textContent, /could not be read/);
    click(dismissal); assert.equal(node('#dialog').open, false);
    assert.equal(document.activeElement.dataset.focus, 'import'); assert.equal(node('.add-button').disabled, false);
  });
}

// Hero actions and custom keyboard dispatch, with explicit pending/session behavior.
test('control audit: hero favorite toggles API state, accessible state, cards and favorites counts', async () => {
  const context = await setup();
  click('[data-focus="hero-favorite"]'); await settle();
  assert.deepEqual(callsFor(context, 'updateGame'), [['a', { favorite: false }]]);
  assert.equal(node('[data-focus="hero-favorite"]').getAttribute('aria-pressed'), 'false');
  assert.equal(node('[data-focus="hero-favorite"]').getAttribute('aria-label'), 'Add to favorites');
  assert.equal(node('[data-view="favorites"] .nav-count').textContent, '1');
  click('[data-focus="hero-favorite"]'); await settle();
  assert.deepEqual(callsFor(context, 'updateGame')[1], ['a', { favorite: true }]);
  assert.equal(node('[data-focus="hero-favorite"]').getAttribute('aria-pressed'), 'true');
  assert.equal(node('[data-view="favorites"] .nav-count').textContent, '2');
});
test('control audit: pending hero favorite is visibly disabled and repeat clicks coalesce', async () => {
  const task = deferred(); const context = await setup({ methods: { updateGame: () => task.promise } });
  click('[data-focus="hero-favorite"]'); click('[data-focus="hero-favorite"]');
  const disabled = node('[data-focus="hero-favorite"]').disabled;
  task.resolve(context.copy()); await settle();
  assert.equal(callCount(context, 'updateGame'), 1); assert.equal(disabled, true);
});
test('control audit: hero Play sends selected ID once, locks during launch/session and re-enables on exit', async () => {
  const task = deferred(); const context = await setup({ methods: { launchGame: () => task.promise } });
  click('[data-focus="select-b"]'); click('[data-focus="hero-play"]'); click('[data-focus="hero-play"]');
  assert.deepEqual(callsFor(context, 'launchGame'), [['b']]); assert.equal(node('[data-focus="hero-play"]').disabled, true);
  const running = context.copy(); running.session = { gameId: 'b', status: 'running' }; task.resolve(running); await settle();
  assert.equal(node('[data-focus="hero-play"]').disabled, true); assert.match(node('[data-focus="hero-play"]').textContent, /Playing/);
  click('[data-focus="select-a"]'); assert.equal(node('[data-focus="hero-play"]').disabled, true);
  context.emit({ session: null }); assert.equal(node('[data-focus="hero-play"]').disabled, false);
});
test('control audit: Enter launches from the body only, and shortcuts do not hijack inputs or dialogs', async () => {
  const context = await setup();
  node('#search').focus(); key('Enter'); assert.equal(callCount(context, 'launchGame'), 0);
  click('[data-action="settings"]'); node('#choose-emulator').focus(); key('Enter'); key('/');
  assert.equal(callCount(context, 'launchGame'), 0); assert.equal(document.activeElement.id, 'choose-emulator');
  cancelDialog(); document.activeElement.blur(); assert.equal(document.activeElement, document.body);
  key('Enter'); await settle(); assert.deepEqual(callsFor(context, 'launchGame'), [['a']]);
});
test('control audit: failed Play surfaces error and allows a later retry', async () => {
  const context = await setup({ methods: { launchGame: async () => { throw new Error('The emulator executable has moved. Choose it again in Settings.'); } } });
  click('[data-focus="hero-play"]'); await settle();
  assert.match(node('#dialog .dialog-description').textContent, /Choose it again in Settings/);
  cancelDialog(); click('[data-focus="hero-play"]'); await settle();
  assert.equal(callCount(context, 'launchGame'), 2); assert.equal(node('[data-focus="hero-play"]').disabled, false);
});

// Settings entry points, real state patches, cancellation, and errors.
for (const selector of ['[data-focus="settings"]', '[aria-label="Open launcher settings"]', '[aria-label="Configure launch preferences"]']) {
  test(`control audit: ${selector} opens Settings and Done dismisses it`, async () => {
    const context = await setup(); click(selector);
    assert.equal(node('#dialog').open, true); assert.ok(node('#choose-emulator'));
    assert.match(node('.emulator-path span').textContent, /mGBA\.exe/);
    click('#dialog .dialog-actions [data-close]');
    assert.equal(node('#dialog').open, false); assert.equal(callCount(context, 'updateSettings'), 0);
  });
}
for (const setting of ['fullscreen', 'returnToLauncher']) {
  test(`control audit: Settings ${setting} switch persists both directions via exact patch`, async () => {
    const context = await setup(); click('[data-focus="settings"]');
    change(`#${setting}`, false); await settle();
    assert.deepEqual(callsFor(context, 'updateSettings'), [[{ [setting]: false }]]);
    assert.equal(node(`#${setting}`).checked, false); assert.equal(node('#announcer').textContent, 'Setting saved');
    click('[aria-label="Close settings"]'); click('[data-focus="settings"]');
    assert.equal(node(`#${setting}`).checked, false);
    change(`#${setting}`, true); await settle();
    assert.deepEqual(callsFor(context, 'updateSettings')[1], [{ [setting]: true }]);
    assert.equal(node(`#${setting}`).checked, true);
  });
}
test('control audit: Choose mGBA updates the path and canceling a subsequent picker retains it', async () => {
  let choices = 0;
  const context = await setup({ methods: { chooseEmulator: async ctx => { if (!choices++) ctx.state.settings.emulatorPath = 'C:\\Other Folder\\mGBA.exe'; return ctx.copy(); } } });
  click('[data-focus="settings"]'); click('#choose-emulator'); await settle();
  assert.equal(node('.emulator-path span').textContent, 'C:\\Other Folder\\mGBA.exe');
  click('#choose-emulator'); await settle();
  assert.equal(callCount(context, 'chooseEmulator'), 2); assert.equal(node('.emulator-path span').textContent, 'C:\\Other Folder\\mGBA.exe');
  assert.equal(node('#dialog').open, true); assert.equal(node('#choose-emulator').disabled, false);
});
test('control audit: pending Choose mGBA locks settings and allows close; late success cannot reopen', async () => {
  const task = deferred(); const context = await setup({ methods: { chooseEmulator: () => task.promise } });
  node('[data-focus="settings"]').focus(); click('[data-focus="settings"]'); click('#choose-emulator'); click('#choose-emulator');
  assert.equal(callCount(context, 'chooseEmulator'), 1);
  assert.equal(node('#choose-emulator').disabled, true); assert.equal(node('#fullscreen').disabled, true); assert.equal(node('#returnToLauncher').disabled, true);
  assert.equal(node('[aria-label="Close settings"]').disabled, false); assert.equal(node('#dialog').getAttribute('aria-busy'), 'true');
  click('[aria-label="Close settings"]'); task.resolve(context.copy()); await settle();
  assert.equal(node('#dialog').open, false); assert.equal(document.activeElement.dataset.focus, 'settings');
});
test('control audit: failed setting save reverts to persisted switch value and displays one retryable error', async () => {
  let attempt = 0;
  const context = await setup({ methods: { updateSettings: async (ctx, patch) => { if (!attempt++) throw new Error('Settings could not be saved.'); Object.assign(ctx.state.settings, patch); return ctx.copy(); } } });
  click('[data-focus="settings"]'); change('#returnToLauncher', false); await settle();
  assert.equal(node('#returnToLauncher').checked, true); assert.equal(node('#returnToLauncher').disabled, false);
  assert.match(node('[data-operation-error]').textContent, /could not be saved/);
  change('#returnToLauncher', false); await settle();
  assert.equal(callCount(context, 'updateSettings'), 2); assert.equal(node('#returnToLauncher').checked, false);
  assert.equal(document.querySelector('[data-operation-error]'), null);
});
test('control audit: failed emulator choice stays in Settings with a retryable inline error', async () => {
  const context = await setup({ methods: { chooseEmulator: async () => { throw new Error('Choose an existing mGBA .exe file.'); } } });
  click('[data-focus="settings"]'); click('#choose-emulator'); await settle();
  assert.equal(node('#dialog').open, true); assert.match(node('[data-operation-error]').textContent, /existing mGBA/);
  click('#choose-emulator'); await settle(); assert.equal(callCount(context, 'chooseEmulator'), 2);
  assert.equal(document.querySelectorAll('[data-operation-error]').length, 1);
  cancelDialog(); assert.equal(node('#dialog').open, false);
});
test('control audit: Settings Escape/cancel and outside dismissal close without extra mutations', async () => {
  const context = await setup(); node('[data-focus="settings"]').focus(); click('[data-focus="settings"]');
  cancelDialog(); assert.equal(node('#dialog').open, false); assert.equal(document.activeElement.dataset.focus, 'settings');
  click('[data-focus="settings"]');
  // Geometry is stubbed only to exercise the handler, not to claim hit testing.
  node('#dialog').getBoundingClientRect = () => ({ left: 10, right: 100, top: 10, bottom: 100 });
  node('#dialog').dispatchEvent(new window.MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
  assert.equal(node('#dialog').open, true);
  node('#dialog').dispatchEvent(new window.MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }));
  assert.equal(node('#dialog').open, false); assert.equal(callCount(context, 'updateSettings'), 0);
});

// Details form, every dismissal/removal button, and interrupted/error paths.
test('control audit: Save name rejects blank input, clears validity on edit, and trims a valid name', async () => {
  const context = await setup(); click('[data-focus="details-b"]');
  input('#game-title', '  '); click('#save-title');
  assert.equal(callCount(context, 'updateGame'), 0); assert.equal(node('#game-title').validationMessage, 'Enter a display name.');
  input('#game-title', '  My Blue Moon  '); assert.equal(node('#game-title').validationMessage, '');
  click('#save-title'); await settle();
  assert.deepEqual(callsFor(context, 'updateGame'), [['b', { title: 'My Blue Moon' }]]);
  assert.ok(titles().includes('My Blue Moon')); assert.equal(node('#dialog').open, false);
});
test('control audit: detail Favorite and Unfavorite preserve unsaved title and use current game state', async () => {
  const context = await setup(); click('[data-focus="details-b"]'); input('#game-title', 'A draft');
  click('#detail-favorite'); await settle();
  assert.match(node('#detail-favorite').textContent, /Unfavorite/); assert.equal(node('#game-title').value, 'A draft');
  click('#detail-favorite'); await settle();
  assert.deepEqual(callsFor(context, 'updateGame'), [['b', { favorite: true }], ['b', { favorite: false }]]);
  assert.equal(node('#game-title').value, 'A draft'); assert.equal(document.activeElement.id, 'detail-favorite');
});
for (const cancel of ['[aria-label="Cancel removal"]', '#dialog .dialog-actions [data-close]']) {
  test(`control audit: removal ${cancel} keeps the game and never calls removeGame`, async () => {
    const context = await setup(); click('[data-focus="details-b"]'); click('#remove-game');
    assert.match(node('#dialog-title').textContent, /Remove Blue Moon/); click(cancel);
    assert.equal(node('#dialog').open, false); assert.equal(callCount(context, 'removeGame'), 0); assert.ok(titles().includes('Blue Moon'));
  });
}
test('control audit: confirm removal sends only the game ID, coalesces clicks and removes the entry', async () => {
  const task = deferred(); const context = await setup({ methods: { removeGame: () => task.promise } });
  node('[data-focus="details-b"]').focus(); click('[data-focus="details-b"]'); click('#remove-game'); click('#confirm-remove'); click('#confirm-remove');
  assert.deepEqual(callsFor(context, 'removeGame'), [['b']]); assert.equal(node('#confirm-remove').disabled, true);
  assert.equal(node('[aria-label="Cancel removal"]').disabled, false);
  const removed = context.copy(); removed.games = removed.games.filter(game => game.id !== 'b'); task.resolve(removed); await settle();
  assert.ok(!titles().includes('Blue Moon')); assert.equal(node('#dialog').open, false); assert.equal(document.activeElement.dataset.focus, 'import');
});
test('control audit: failed removal retains entry and confirmation offers retry or Keep game', async () => {
  const context = await setup({ methods: { removeGame: async () => { throw new Error('Library could not be saved.'); } } });
  click('[data-focus="details-b"]'); click('#remove-game'); click('#confirm-remove'); await settle();
  assert.ok(titles().includes('Blue Moon')); assert.equal(node('#dialog').open, true); assert.equal(node('#confirm-remove').disabled, false);
  assert.match(node('[data-operation-error]').textContent, /could not be saved/);
  click('#confirm-remove'); await settle(); assert.equal(callCount(context, 'removeGame'), 2);
  click('#dialog .dialog-actions [data-close]'); assert.equal(node('#dialog').open, false);
});
test('control audit: close game details abandons the draft without calling save', async () => {
  const context = await setup(); node('[data-focus="details-b"]').focus(); click('[data-focus="details-b"]'); input('#game-title', 'Unsaved');
  click('[aria-label="Close game details"]'); assert.equal(callCount(context, 'updateGame'), 0); assert.equal(document.activeElement.dataset.focus, 'details-b');
  click('[data-focus="details-b"]'); assert.equal(node('#game-title').value, 'Blue Moon');
  cancelDialog(); assert.equal(node('#dialog').open, false);
});
test('control audit: session errors open the error dialog and both message controls remain available', async () => {
  const context = await setup(); context.emit({ session: null, error: { message: 'mGBA exited unexpectedly.' } });
  assert.equal(node('#dialog').open, true); assert.match(node('#dialog .dialog-description').textContent, /exited unexpectedly/);
  assert.equal(node('[aria-label="Close message"]').disabled, false); assert.equal(node('#dialog .dialog-actions [data-close]').disabled, false);
  cancelDialog(); assert.equal(node('#dialog').open, false);
});

// These assert bridge dispatch, not actual native minimize/maximize/close effects.
for (const command of ['minimize', 'maximize', 'close']) {
  test(`control audit: native window ${command} dispatches only its exact command`, async () => {
    const context = await setup(); click(`[data-command="${command}"]`);
    assert.deepEqual(callsFor(context, 'windowControl'), [[command]]);
    assert.equal(callCount(context, 'launchGame'), 0);
  });
}
test('control audit: preview-only empty-library action calls clearPreview; native window controls are absent', async () => {
  const context = await setup({ preview: true });
  assert.equal(document.querySelector('[data-action="window"]'), null);
  click('[data-focus="settings"]'); click('#clear-preview'); await settle();
  assert.equal(callCount(context, 'clearPreview'), 1); assert.equal(titles().length, 0);
  assert.equal(node('#dialog').open, false); assert.ok(node('[data-focus="empty-import"]'));
});

test('control audit: running-session Enter shortcut does not dispatch a second launch', async () => {
  const context = await setup();
  key('Enter'); await settle();
  assert.equal(node('[data-focus="hero-play"]').disabled, true);
  key('Enter'); await settle();
  assert.equal(callCount(context, 'launchGame'), 1);
});
for (const selector of ['[aria-label="Open launcher settings"]', '[aria-label="Configure launch preferences"]', '[aria-label="Edit selected game details"]']) {
  test(`control audit: closing dialog returns keyboard focus to ${selector}`, async () => {
    await setup(); node(selector).focus(); click(selector);
    cancelDialog();
    assert.equal(node('#dialog').open, false);
    assert.equal(document.activeElement.matches(selector), true, `Focus returned to ${document.activeElement.outerHTML}`);
  });
}

test('control audit: every interactive element in each generated app/dialog state belongs to the audited inventory', async () => {
  const selectors = [
    '[data-focus="menu-toggle"]', '.brand', '[data-view="library"]', '[data-view="favorites"]',
    '[data-focus="system-GBA"]', '[data-focus="system-GBC"]', '[data-focus="system-GB"]', '[data-focus="settings"]',
    '[data-command="minimize"]', '[data-command="maximize"]', '[data-command="close"]', '.add-button',
    '[aria-label="Add games from quick actions"]', '[aria-label="Open launcher settings"]', '[aria-label="Configure launch preferences"]',
    '[data-focus="hero-play"]', '[data-focus="hero-favorite"]', '[aria-label="Edit selected game details"]',
    '#search', '#sort', '[data-focus="layout-grid"]', '[data-focus="layout-list"]',
    '[data-focus="filter-all"]', '[data-focus="filter-GBA"]', '[data-focus="filter-GBC"]', '[data-focus="filter-GB"]',
    '.game-art-button', '.card-title', '.card-menu', '[data-focus="empty-import"]', '.empty-collection [data-action="import"]',
    '.game-overview [data-action="import"]', '[data-action="reset-filters"]',
    '#choose-emulator', '#fullscreen', '#returnToLauncher', '[aria-label="Close settings"]', '#dialog .dialog-actions [data-close]',
    '#game-title', '#save-title', '#detail-favorite', '#remove-game', '[aria-label="Close game details"]',
    '#confirm-remove', '[aria-label="Cancel removal"]', '[aria-label="Close message"]', '#clear-preview'
  ];
  const observed = new Set();
  function inventory(stateName) {
    for (const control of document.querySelectorAll('#app button, #app input, #app select, #app a, #dialog[open] button, #dialog[open] input, #dialog[open] select, #dialog[open] a')) {
      const matched = selectors.filter(selector => control.matches(selector));
      assert.ok(matched.length, `Unaudited control in ${stateName}: ${control.outerHTML}`);
      for (const selector of matched) observed.add(selector);
    }
  }
  const context = await setup(); inventory('populated desktop');
  click('[data-focus="settings"]'); inventory('settings'); cancelDialog();
  click('[data-focus="details-b"]'); inventory('game details'); click('#remove-game'); inventory('remove confirmation'); cancelDialog();
  input('#search', 'missing'); inventory('no matching games'); key('Escape');
  context.emit({ error: { message: 'Representative error' } }); inventory('error message'); cancelDialog();
  await setup({ games: [] }); inventory('empty desktop');
  await setup({ preview: true }); click('[data-focus="settings"]'); inventory('preview settings');
  assert.deepEqual(selectors.filter(selector => !observed.has(selector)), [], 'Every inventory selector was encountered');
});


test('control audit: real preview adapter handles file selection, duplicate/unsupported files and picker cancellation', async () => {
  await setup({ realPreview: true });
  let picker;
  const originalClick = window.HTMLInputElement.prototype.click;
  window.HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') picker = this;
    else originalClick.call(this);
  };
  click('.add-button');
  assert.ok(picker); assert.equal(picker.accept, '.gba,.gbc,.gb'); assert.equal(picker.multiple, true);
  Object.defineProperty(picker, 'files', { value: [new window.File(['inert test data'], 'Homebrew.gba'), new window.File(['inert test data'], 'Color.GBC'), new window.File(['ignored'], 'Unsupported.zip')] });
  picker.dispatchEvent(new window.Event('change')); await settle();
  assert.equal(titles().length, 8); assert.ok(titles().includes('Homebrew')); assert.ok(titles().includes('Color'));
  assert.ok(!titles().includes('Unsupported'));
  click('[aria-label="Add games from quick actions"]');
  Object.defineProperty(picker, 'files', { value: [new window.File(['inert test data'], 'Homebrew.gba')] });
  picker.dispatchEvent(new window.Event('change')); await settle(); assert.equal(titles().length, 8);
  click('.add-button'); picker.dispatchEvent(new window.Event('cancel')); await settle();
  assert.equal(titles().length, 8); assert.equal(node('.add-button').disabled, false); assert.equal(node('#dialog').open, false);
});
test('control audit: real preview Play and Choose emulator explain unavailable native actions', async () => {
  await setup({ realPreview: true });
  click('[data-focus="hero-play"]'); await settle();
  assert.match(node('#dialog .dialog-description').textContent, /does not launch an emulator/);
  click('#dialog .dialog-actions [data-close]');
  click('[data-focus="settings"]'); click('#choose-emulator'); await settle();
  assert.match(node('[data-operation-error]').textContent, /preview cannot access or run programs/);
  assert.equal(node('#choose-emulator').disabled, false); assert.equal(node('.emulator-path span').textContent, 'No emulator selected');
});
test('control audit: real preview Explore empty-library clears samples and a fresh adapter starts a new preview', async () => {
  await setup({ realPreview: true }); assert.equal(titles().length, 6);
  click('[data-focus="settings"]'); click('#clear-preview'); await settle();
  assert.equal(titles().length, 0); assert.equal(node('#dialog').open, false);
  assert.ok(node('[data-focus="empty-import"]'));
  await setup({ realPreview: true }); assert.equal(titles().length, 6);
});
