const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const power = import('../src/power.js');
const makeStorage = () => {const values = new Map(); return {localStorage: {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)}, values};};
const game = (id, title = id) => ({id, title, system: 'GBA', playSeconds: 0, lastPlayed: null});

test('Power user defaults are strict booleans with safe versioned parsing and remembered inactive subchoice', async () => {
  const p = await power; const host = makeStorage();
  for (const raw of [null, '', 'garbage', '{}', '[]', 'null', 'true', '{"version":2,"enabled":true,"commandPalette":true}', '{"version":1,"enabled":"true","commandPalette":1}']) {
    host.values.set(p.POWER_PREFERENCE_KEY, raw);
    assert.deepEqual(p.readPowerPreferences(host), {version: 1, enabled: false, commandPalette: false});
  }
  p.writePowerPreferences(host, {version:1, enabled:false, commandPalette:true, extra:'drop'});
  assert.deepEqual(p.readPowerPreferences(host), {version:1, enabled:false, commandPalette:true});
  assert.equal(p.paletteEnabled(p.readPowerPreferences(host)), false);
  assert.equal(p.paletteEnabled({enabled:true, commandPalette:true}), true);
});

test('Power user reset and writes are isolated from library, sidebar and emulator choices; denied storage is safe', async () => {
  const p = await power; const host = makeStorage();
  host.values.set('renew.view.sidebar.v1', 'expanded'); host.values.set('library.json', 'private library');
  p.writePowerPreferences(host, {version:1, enabled:true, commandPalette:true});
  assert.equal(p.resetPowerPreferences(host), true); assert.equal(host.values.has(p.POWER_PREFERENCE_KEY), false);
  assert.equal(host.values.get('renew.view.sidebar.v1'), 'expanded'); assert.equal(host.values.get('library.json'), 'private library');
  const blocked = {get localStorage() {throw new Error('Denied');}};
  assert.deepEqual(p.readPowerPreferences(blocked), p.DEFAULT_POWER_PREFERENCES);
  assert.equal(p.writePowerPreferences(blocked, p.DEFAULT_POWER_PREFERENCES), false); assert.equal(p.resetPowerPreferences(blocked), false);
});

test('palette has a fixed vocabulary, twelve-result cap, escaped titles and no arbitrary command syntax', async () => {
  const p = await power; const state = {games: Array.from({length:30}, (_, n) => game(`g${n}`, `Game ${n}`))};
  assert.equal(p.paletteCommands(state, false).length, 12);
  const found = p.paletteCommands(state, false, ' GAME 29 '); assert.equal(found.length, 1); assert.equal(found[0].gameId, 'g29');
  assert.equal(p.paletteCommands(state, false, 'rm -rf /').length, 0);
  state.games = [game('x" onclick="bad', '<img src=x onerror=bad>')];
  const html = p.renderPaletteResults(p.paletteCommands(state, false, 'img'));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/); assert.match(html, /&quot;/);
  assert.equal(p.paletteCommands(state, false).some(c => /shell|script|install|delete|shutdown|restart|plugin/i.test(c.id)), false);
});

test('palette launch guards recheck every active session status, pending work and missing game', async () => {
  const p = await power;
  for (const session of [{gameId:'a',status:'launching'}, {gameId:'a',status:'running'}, {gameId:'gone',status:'paused'}]) {
    const state = {games:[game('a'),game('b')], session};
    for (const command of p.paletteCommands(state, false).filter(c => c.gameId)) assert.equal(command.disabled, true);
    assert.equal(p.canLaunchGame(state, 'b', false), false);
  }
  const state = {games:[game('a')],session:null};
  assert.equal(p.canLaunchGame(state, 'a', false), true); assert.equal(p.canLaunchGame(state, 'a', true), false); assert.equal(p.canLaunchGame(state, 'removed', false), false);
  for (const id of ['import','pick-unplayed','play:a']) assert.equal(p.paletteCommands(state,true).find(c=>c.id===id).disabled,true);
});

test('Pick unplayed uses uncapped truthful history and excludes the current session', async () => {
  const p = await power; const state = {games:Array.from({length:15}, (_,n)=>game(`g${n}`)),session:{gameId:'g0',status:'launching'}};
  state.games.push({...game('played'),playSeconds:1}, {...game('dated'),lastPlayed:'2026-10-02T00:00:00Z'}, {...game('invalid'),lastPlayed:'not-a-date'});
  assert.equal(p.unplayedCandidates(state).length,14); assert.ok(p.unplayedCandidates(state).some(g=>g.id==='g9'));
  assert.ok(!p.unplayedCandidates(state).some(g=>['g0','played','dated','invalid'].includes(g.id)));
});

test('device panel does not accept unknown fields or guess hardware from runtime values', async () => {
  const p = await power;
  const html = p.renderDeviceInfo({version:1,runtimePlatform:{value:'win32',status:'reported',source:'FAKE SOURCE'},renewVersion:{value:'<b>0.1</b>',status:'reported'},secret:'do not render'});
  assert.match(html,/win32/); assert.match(html,/Not identified/); assert.match(html,/Not included in this build/); assert.match(html,/Wine/);
  assert.match(html,/Source: process.platform/); assert.doesNotMatch(html,/FAKE SOURCE|do not render|<b>/); assert.match(html,/&lt;b&gt;/);
  assert.match(p.renderDeviceInfo(null),/unavailable/); assert.match(p.renderDeviceInfo({version:2}),/unavailable/);
});

test('command palette text has at least 4.5:1 source contrast in all game palettes', async () => {
  const css = fs.readFileSync(require('node:path').join(__dirname,'../src/styles.css'),'utf8');
  const luminance = hex => {const values=hex.match(/[\da-f]{2}/gi).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
  for (const palette of ['neutral','aurora','ocean','ember','violet']) {
    for (const [foreground,background] of [['eef5ff','12273d'],['b7cde2','12273d'],['eef5ff','234360'],['b7cde2','234360'],['bacbdb','101d2b'],['a8bbce','101d2b']]) assert.ok((luminance(foreground)+.05)/(luminance(background)+.05)>=4.5,`${palette}: ${foreground}/${background}`);
  }
  assert.match(css,/\.palette-command \{[^}]*background: #12273d; color: #eef5ff/s);
});
