const {test, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
let dom, serial = 0;
const fixtureGames = () => [
  {id: 'old', title: 'Old Orchard', system: 'GBA', art: 'aurora', favorite: true, playSeconds: 60, lastPlayed: '2026-09-30T12:00:00Z', addedAt: '2026-09-01T00:00:00Z'},
  {id: 'new', title: 'New Tide', system: 'GBC', art: 'ocean', favorite: false, playSeconds: 10, lastPlayed: '2026-10-02T12:00:00Z', addedAt: '2026-09-01T00:00:00Z'},
  {id: 'fresh', title: 'Fresh Ember', system: 'GB', art: 'ember', favorite: true, playSeconds: 0, lastPlayed: null, addedAt: '2026-10-03T00:00:00Z'},
  {id: 'quiet', title: 'Quiet Violet', system: 'GB', art: 'violet', favorite: false, playSeconds: 0, lastPlayed: null, addedAt: '2026-10-03T00:00:00Z'}
];
const settle = async () => {for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));};
async function setup({games = fixtureGames(), session = null, methods = {}} = {}) {
  dom?.window.close();
  dom = new JSDOM('<!doctype html><body><div id="app"></div><div id="announcer"></div><dialog id="dialog"></dialog><div id="toast" hidden></div>', {url: 'http://localhost/', pretendToBeVisual: true});
  global.window = dom.window; global.document = dom.window.document;
  global.CSS = {escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`)};
  const dialog = document.querySelector('#dialog');
  dialog.showModal = function () {this.setAttribute('open', '');};
  dialog.close = function () {this.removeAttribute('open');};
  const state = {games: structuredClone(games), session, settings: {emulatorPath: 'C:\\mGBA.exe', fullscreen: true, returnToLauncher: true}, warning: null, error: null};
  const calls = []; const copy = () => structuredClone(state); let handler;
  const context = {state, calls, copy, emit: patch => {Object.assign(state, patch); handler(copy());}};
  const defaults = {getState: async () => copy(), onSession: fn => {handler = fn; return () => {};},
    updateGame: async (id, patch) => {Object.assign(state.games.find(game => game.id === id), patch); return copy();},
    removeGame: async id => {state.games = state.games.filter(game => game.id !== id); return copy();},
    importGames: async () => copy(), chooseEmulator: async () => copy(), updateSettings: async patch => {Object.assign(state.settings, patch); return copy();},
    launchGame: async id => {state.session = {gameId: id, status: 'launching'}; return copy();}, windowControl: () => {}};
  window.renewAPI = Object.fromEntries(Object.entries(defaults).map(([name, fn]) => [name, (...args) => {calls.push({name, args}); return methods[name] ? methods[name](context, ...args) : fn(...args);} ]));
  await import(`../src/app.js?home=${++serial}`);
  return context;
}
afterEach(() => dom?.window.close());
const node = selector => {const found = document.querySelector(selector); assert.ok(found, `Exists: ${selector}`); return found;};
const click = selector => node(selector).click();
const focusClick = selector => {node(selector).focus(); click(selector);};
const ids = shelf => [...document.querySelectorAll(`[data-shelf="${shelf}"] .game-art-button`)].map(button => button.dataset.id);
const key = (value, target = document) => target.dispatchEvent(new window.KeyboardEvent('keydown', {key: value, bubbles: true, cancelable: true}));
const input = value => {const search = node('#search'); search.focus(); search.value = value; search.dispatchEvent(new window.Event('input', {bubbles: true}));};
const launches = context => context.calls.filter(call => call.name === 'launchGame');

test('Home opens first with truthful recent, favorite and unplayed shelves and latest played selection', async () => {
  const context = await setup();
  assert.equal(node('h1').textContent, 'Home');
  assert.equal(node('[data-focus="nav-home"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(ids('recent'), ['new', 'old']);
  assert.deepEqual(ids('favorites'), ['fresh', 'old']);
  assert.deepEqual(ids('unplayed'), ['fresh', 'quiet']);
  assert.equal(node('#hero-title').textContent, 'New Tide');
  assert.equal(node('[data-action="play"]').dataset.id, 'new');
  assert.match(node('.home-collection').textContent, /No recorded play history in Renew on this computer/);
  assert.deepEqual(context.calls.map(call => call.name), ['onSession', 'getState']);
});

test('Home card selection keeps both repeated cards, hero, artwork, palette and Play aligned', async () => {
  const context = await setup();
  focusClick('[data-focus="favorites-select-fresh"]');
  assert.equal(document.activeElement.dataset.focus, 'favorites-select-fresh');
  assert.equal(node('#hero-title').textContent, 'Fresh Ember');
  assert.equal(node('#app').dataset.palette, 'ember');
  assert.equal(node('.scene img').getAttribute('src'), './art/ember-v1.png');
  assert.equal(document.querySelectorAll('[data-action="select"][data-id="fresh"][aria-pressed="true"]').length, 2);
  assert.equal(node('[data-action="play"]').dataset.id, 'fresh');
  assert.equal(launches(context).length, 0);
});

test('each Home shelf preserves its independent scroll and duplicate-card focus', async () => {
  await setup(); node('[data-shelf="recent"]').scrollLeft = 25; node('[data-shelf="favorites"]').scrollLeft = 180; node('[data-shelf="unplayed"]').scrollLeft = 90;
  focusClick('[data-focus="favorites-select-old"]');
  assert.equal(node('[data-shelf="recent"]').scrollLeft, 25);
  assert.equal(node('[data-shelf="favorites"]').scrollLeft, 180);
  assert.equal(node('[data-shelf="unplayed"]').scrollLeft, 90);
  assert.equal(document.activeElement.dataset.focus, 'favorites-select-old');
});

test('Home search switches to the complete Library and preserves search focus and selected-game constraints', async () => {
  const context = await setup(); input('quiet');
  assert.equal(node('h1').textContent, 'Library');
  assert.equal(document.activeElement.id, 'search');
  assert.deepEqual(ids('library'), ['quiet']);
  assert.equal(node('#hero-title').textContent, 'Quiet Violet');
  assert.equal(node('#app').dataset.palette, 'violet');
  key('Enter'); assert.equal(launches(context).length, 0);
  input('missing'); assert.equal(document.querySelector('[data-action="play"]'), null);
  assert.equal(node('#app').dataset.palette, 'neutral');
  key('Escape'); assert.equal(ids('library').length, 4);
});

test('Home system filters apply to every shelf and clearing them leaves Home active', async () => {
  await setup(); focusClick('[data-focus="filter-GB"]');
  assert.equal(node('h1').textContent, 'Home');
  assert.deepEqual(ids('recent'), []); assert.deepEqual(ids('favorites'), ['fresh']); assert.deepEqual(ids('unplayed'), ['fresh', 'quiet']);
  assert.equal(node('#hero-title').textContent, 'Fresh Ember');
  assert.equal(document.activeElement.dataset.focus, 'filter-GB');
  click('[data-focus="home-clear-filters"]'); assert.deepEqual(ids('recent'), ['new', 'old']);
  assert.equal(node('h1').textContent, 'Home');
});

test('See all keeps the Home system filter while opening each uncapped truthful collection', async () => {
  await setup(); click('[data-focus="filter-GB"]'); click('[data-focus="home-all-unplayed"]');
  assert.equal(node('h1').textContent, 'Unplayed in Renew'); assert.deepEqual(ids('library'), ['fresh', 'quiet']);
  assert.equal(node('[data-focus="filter-GB"]').getAttribute('aria-pressed'), 'true');
  click('[data-focus="nav-home"]'); click('[data-focus="home-all-recent"]');
  assert.equal(node('h1').textContent, 'Recently played'); assert.deepEqual(ids('library'), ['new', 'old']);
  click('[data-focus="nav-home"]'); click('[data-focus="home-all-favorites"]');
  assert.equal(node('h1').textContent, 'Favorites'); assert.deepEqual(ids('library'), ['fresh', 'old']);
  click('[data-focus="nav-library"]'); assert.equal(ids('library').length, 4);
});

test('Home caps shelves at six while See all and Library expose every game', async () => {
  const games = Array.from({length: 9}, (_, i) => ({...fixtureGames()[0], id: `g${i}`, title: `Game ${i}`, favorite: true, lastPlayed: `2026-10-0${i + 1}T00:00:00Z`}));
  await setup({games}); assert.equal(ids('recent').length, 6); assert.equal(ids('favorites').length, 6);
  assert.equal(node('#hero-title').textContent, 'Game 8');
  click('[data-focus="home-all-recent"]'); assert.equal(ids('library').length, 9);
  click('[data-focus="select-g6"]'); click('[data-focus="nav-home"]');
  assert.equal(node('#hero-title').textContent, 'Game 6', 'A visible recent card remains selected.');
  click('[data-focus="nav-library"]'); click('[data-focus="select-g0"]'); click('[data-focus="nav-home"]');
  assert.equal(node('#hero-title').textContent, 'Game 0', 'A visible favorite remains selected.');
});

test('Home never keeps the hidden seventh game selected after returning from Library', async () => {
  const games = Array.from({length: 9}, (_, i) => ({...fixtureGames()[0], id: `g${i}`, title: `Game ${i}`, favorite: false, lastPlayed: `2026-10-0${i + 1}T00:00:00Z`}));
  await setup({games}); click('[data-focus="nav-library"]'); click('[data-focus="select-g0"]'); click('[data-focus="nav-home"]');
  assert.equal(node('#hero-title').textContent, 'Game 8'); assert.equal(node('[data-action="play"]').dataset.id, 'g8');
});

test('empty Home has three useful empty groups, import and Library but no fake selection', async () => {
  const context = await setup({games: []});
  assert.equal(document.querySelectorAll('.home-group-empty').length, 3);
  assert.equal(document.querySelectorAll('.game-card').length, 0);
  assert.equal(document.querySelector('[data-action="play"]'), null);
  assert.equal(node('#app').dataset.palette, 'neutral');
  document.activeElement.blur(); key('Enter'); assert.equal(launches(context).length, 0);
  click('[data-focus="empty-import"]'); await settle();
  assert.equal(context.calls.filter(call => call.name === 'importGames').length, 1);
  click('[data-focus="home-library"]'); assert.equal(node('h1').textContent, 'Library');
});

test('Home does not recast unknown or positive history as unplayed and full Library keeps those games reachable', async () => {
  const games = [{...fixtureGames()[0], favorite: false, lastPlayed: 'bad timestamp'}, {...fixtureGames()[1], lastPlayed: null}];
  await setup({games}); assert.equal(document.querySelectorAll('.game-card').length, 0);
  assert.equal(document.querySelector('[data-action="play"]'), null);
  click('[data-focus="home-library"]'); assert.equal(ids('library').length, 2);
});

test('favoriting from Home updates duplicate cards and groups without changing selection or sending a launch', async () => {
  const context = await setup(); click('[data-focus="unplayed-select-quiet"]'); focusClick('[data-focus="hero-favorite"]'); await settle();
  assert.deepEqual(ids('favorites'), ['fresh', 'old', 'quiet']);
  assert.equal(node('#hero-title').textContent, 'Quiet Violet');
  assert.equal(document.activeElement.dataset.focus, 'hero-favorite');
  assert.equal(launches(context).length, 0);
  click('[data-focus="hero-favorite"]'); await settle(); assert.deepEqual(ids('favorites'), ['fresh', 'old']);
});

test('stale selected game removal reconciles every shelf, hero, palette and launch target', async () => {
  const context = await setup(); click('[data-focus="favorites-select-fresh"]');
  context.emit({games: context.state.games.filter(game => game.id !== 'fresh')});
  assert.equal(document.querySelector('[data-id="fresh"]'), null); assert.equal(node('#hero-title').textContent, 'New Tide');
  assert.equal(node('[data-action="play"]').dataset.id, 'new'); assert.equal(node('#app').dataset.palette, 'ocean');
  context.emit({games: []}); assert.equal(document.querySelector('[data-action="play"]'), null); assert.equal(node('#app').dataset.palette, 'neutral');
});

test('a new launch stays selected in the session strip until verified history arrives, with all launch guards intact', async () => {
  const context = await setup(); click('[data-focus="unplayed-select-quiet"]'); click('[data-focus="hero-play"]'); await settle();
  assert.equal(launches(context).length, 1); assert.equal(launches(context)[0].args[0], 'quiet');
  assert.ok(!ids('unplayed').includes('quiet')); assert.ok(!ids('recent').includes('quiet'));
  assert.equal(node('#hero-title').textContent, 'Quiet Violet'); assert.match(node('.home-session').textContent, /Starting in mGBA/);
  assert.equal(node('[data-focus="hero-play"]').disabled, true); assert.equal(node('[data-focus="hero-play"]').textContent.trim(), 'Starting…');
  context.emit({session: {gameId: 'quiet', status: 'paused'}});
  assert.equal(node('[data-focus="hero-play"]').disabled, true);
  document.activeElement.blur(); key('Enter'); assert.equal(launches(context).length, 1);
  click('[data-focus="recent-select-new"]'); assert.equal(node('[data-focus="hero-play"]').disabled, true);
  click('[data-focus="session-select"]'); assert.equal(node('#hero-title').textContent, 'Quiet Violet');
  context.state.games.find(game => game.id === 'quiet').lastPlayed = '2026-10-04T00:00:00Z';
  context.state.games.find(game => game.id === 'quiet').playSeconds = 17;
  context.emit({session: null});
  assert.equal(node('#hero-title').textContent, 'Quiet Violet'); assert.deepEqual(ids('recent'), ['quiet', 'new', 'old']);
  assert.ok(!ids('unplayed').includes('quiet')); assert.equal(document.querySelector('.home-session'), null);
  assert.equal(node('[data-focus="hero-play"]').disabled, false);
});

test('an unsuccessful launch returns the game to Unplayed without fabricating a recorded session', async () => {
  const context = await setup(); click('[data-focus="unplayed-select-quiet"]'); click('[data-focus="hero-play"]'); await settle();
  context.emit({session: null});
  assert.equal(node('#hero-title').textContent, 'Quiet Violet'); assert.ok(ids('unplayed').includes('quiet')); assert.ok(!ids('recent').includes('quiet'));
  assert.equal(node('[data-focus="hero-play"]').disabled, false);
});

test('a stale session id does not invent a game card or discard existing launch guards', async () => {
  await setup({session: {gameId: 'removed', status: 'running'}});
  assert.equal(document.querySelector('.home-session'), null); assert.equal(node('[data-focus="hero-play"]').disabled, true);
  assert.equal(node('#hero-title').textContent, 'New Tide');
});

test('Home keyboard shelf arrows move focus without selecting or launching; Enter stays native', async () => {
  const context = await setup(); node('[data-focus="recent-select-new"]').focus();
  key('ArrowRight', document.activeElement); assert.equal(document.activeElement.dataset.focus, 'recent-select-old');
  assert.equal(node('#hero-title').textContent, 'New Tide');
  key('ArrowRight', document.activeElement); assert.equal(document.activeElement.dataset.focus, 'recent-select-new');
  key('End', document.activeElement); assert.equal(document.activeElement.dataset.focus, 'recent-select-old');
  key('Home', document.activeElement); assert.equal(document.activeElement.dataset.focus, 'recent-select-new');
  key('ArrowLeft', document.activeElement); assert.equal(document.activeElement.dataset.focus, 'recent-select-old');
  key('Enter', document.activeElement); assert.equal(launches(context).length, 0, 'jsdom does not synthesize native button activation.');
  key('/'); assert.equal(document.activeElement.id, 'search');
});

test('Home details dismissal restores the exact originating duplicate-card control', async () => {
  await setup(); focusClick('[data-focus="favorites-details-old"]');
  node('#dialog').dispatchEvent(new window.Event('cancel', {cancelable: true}));
  assert.equal(document.activeElement.dataset.focus, 'favorites-details-old');
});

test('Home routing and re-rendering preserve collapsed navigation and saved launch settings', async () => {
  await setup(); focusClick('[data-focus="menu-toggle"]');
  assert.equal(window.localStorage.getItem('renew.view.sidebar.v1'), 'expanded');
  click('[data-focus="home-library"]'); click('[data-focus="nav-home"]');
  assert.equal(node('#app').classList.contains('menu-collapsed'), false);
  click('[data-focus="settings"]'); click('#settings-tab-launch'); const toggle = node('#fullscreen'); toggle.checked = false; toggle.dispatchEvent(new window.Event('change')); await settle();
  node('#dialog').dispatchEvent(new window.Event('cancel', {cancelable: true}));
  click('[data-focus="nav-library"]'); click('[data-focus="nav-home"]'); click('[data-focus="settings"]');
  assert.equal(node('#fullscreen').checked, false);
});

test('palette and original artwork use the same finite local fallback and cannot inject a style or path', async () => {
  const {paletteForGame, artwork} = await import('../src/visuals.js');
  const game = {...fixtureGames()[0], id: '../../x', art: 'red; background:url(https://example.invalid)'};
  assert.equal(paletteForGame(game), paletteForGame({...game}));
  assert.ok(['aurora', 'ember', 'ocean', 'violet'].includes(paletteForGame(game)));
  assert.match(artwork(game), /^\.\/art\/(orchard|ember|ocean|violet)-v1\.png$/);
  assert.equal(paletteForGame(null), 'neutral');
});

for (const trigger of ['home-library', 'home-all-recent', 'home-all-unplayed', 'home-all-favorites']) {
  test(`Home ${trigger} sends focus to the destination rather than arming the body launch shortcut`, async () => {
    const context = await setup(); focusClick(`[data-focus="${trigger}"]`);
    assert.equal(document.activeElement.id, 'collection-title');
    key('Enter', document.activeElement); await settle(); assert.equal(launches(context).length, 0);
  });
}

test('when a focused session strip disappears on exit, focus stays safe and Enter cannot relaunch', async () => {
  const context = await setup({session: {gameId: 'new', status: 'running'}}); focusClick('[data-focus="session-select"]');
  context.emit({session: null});
  assert.notEqual(document.activeElement, document.body);
  key('Enter', document.activeElement); await settle(); assert.equal(launches(context).length, 0);
});

test('when a focused card disappears or moves shelves, focus resolves without an accidental body launch', async () => {
  const context = await setup(); focusClick('[data-focus="favorites-select-old"]');
  context.state.games.find(game => game.id === 'old').favorite = false; context.emit({});
  assert.equal(document.activeElement.dataset.focus, 'recent-select-old');
  context.emit({games: context.state.games.filter(game => game.id !== 'old')});
  assert.equal(document.activeElement.id, 'collection-title');
  key('Enter', document.activeElement); assert.equal(launches(context).length, 0);
});

test('zero-second recorded sessions never claim the game was not played', async () => {
  const games = [{...fixtureGames()[0], favorite: false, playSeconds: 0}];
  const context = await setup({games});
  assert.deepEqual(ids('recent'), ['old']); assert.deepEqual(ids('unplayed'), []);
  assert.doesNotMatch(node('.hero-meta').textContent, /Not played yet|No recorded play in Renew/);
  assert.match(node('.hero-meta').textContent, /No play time recorded in Renew/);
  context.emit({session: {gameId: 'old', status: 'running'}});
  assert.match(node('.hero-meta').textContent, /Session in progress/);
  assert.match(node('.card-info').textContent, /Session in progress/);
});

test('new local action palette fills retain readable white-text contrast and reduced-motion rules', async () => {
  const fs = require('node:fs'); const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8');
  const luminance = hex => {
    const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const fills = [...css.matchAll(/--action-(?:bg|hover):\s*(#[0-9a-f]{6})/g)].map(match => match[1]);
  assert.equal(fills.length, 10);
  for (const fill of fills) assert.ok(1.05 / (luminance(fill) + .05) >= 4.5, `White text contrast: ${fill}`);
  const activeCount = css.match(/\.nav-item\.active \.nav-count \{ color: (#[0-9a-f]{6})/)[1];
  const washes = [...css.matchAll(/--accent-wash:\s*(#[0-9a-f]{6})/g)].map(match => match[1]);
  assert.equal(washes.length, 5);
  for (const wash of washes) assert.ok((luminance(activeCount) + .05) / (luminance(wash) + .05) >= 4.5, `Active navigation count contrast: ${wash}`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('brand navigation retains keyboard focus so a repeated Enter never launches a game', async () => {
  const context = await setup(); click('[data-focus="nav-library"]'); focusClick('.brand');
  assert.equal(node('h1').textContent, 'Home'); assert.equal(document.activeElement.dataset.focus, 'brand');
  key('Enter', document.activeElement); assert.equal(launches(context).length, 0);
});

test('clearing empty Library search from Home leaves safe keyboard focus after its control disappears', async () => {
  const context = await setup(); input('unmatched'); focusClick('[data-focus="reset-filters"]');
  assert.equal(ids('library').length, 4); assert.equal(document.activeElement.id, 'collection-title');
  key('Enter', document.activeElement); assert.equal(launches(context).length, 0);
});

test('a late Home mutation cannot steal focus after newer navigation selects a different game', async () => {
  let finish; const pending = new Promise(resolve => {finish = resolve;});
  const context = await setup({methods: {updateGame: () => pending}});
  focusClick('[data-focus="hero-favorite"]');
  focusClick('[data-focus="home-all-unplayed"]');
  assert.equal(node('#hero-title').textContent, 'Fresh Ember'); assert.equal(document.activeElement.id, 'collection-title');
  const response = context.copy(); response.games.find(game => game.id === 'new').favorite = true; finish(response); await settle();
  assert.equal(document.activeElement.id, 'collection-title');
  assert.equal(node('#hero-title').textContent, 'Fresh Ember'); assert.equal(node('h1').textContent, 'Unplayed in Renew');
});

test('dismissing a late Home mutation failure restores newer navigation focus, not an old game action', async () => {
  let fail; const pending = new Promise((resolve, reject) => {fail = reject;});
  await setup({methods: {updateGame: () => pending}});
  focusClick('[data-focus="hero-favorite"]'); focusClick('[data-focus="home-all-unplayed"]');
  assert.equal(document.activeElement.id, 'collection-title');
  fail(new Error('Could not save favorite')); await settle();
  assert.equal(node('#dialog').open, true);
  node('#dialog').dispatchEvent(new window.Event('cancel', {cancelable: true}));
  assert.equal(document.activeElement.id, 'collection-title');
  assert.equal(node('#hero-title').textContent, 'Fresh Ember');
});
