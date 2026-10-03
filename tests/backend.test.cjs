'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LauncherService, canonicalPath } = require('../desktop/services.cjs');

const EXE = 'C:\\Program Files\\mGBA\\mGBA.exe';
const ROM = 'C:\\My ROMs\\A game & friends; [1] $test.gba';
const OTHER = 'C:\\My ROMs\\Second.gbc';

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'renew-test-'));
  const statePath = path.join(directory, 'library.json');
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = new Map();
  const add = (file, target = file, regular = true) => files.set(canonicalPath(file, 'win32'), { target, regular });
  const remove = file => files.delete(canonicalPath(file, 'win32'));
  add(EXE); add(ROM); add(OTHER);
  const fileAPI = { ...fs,
    async stat(file) {
      // On Windows the real temporary library also has a drive-letter path.
      // Keep persistence on the real filesystem instead of treating it as a ROM.
      if (file === statePath) return fs.stat(file);
      if (/^[a-z]:[\\/]/i.test(file)) {
        const entry = files.get(canonicalPath(file, 'win32'));
        if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isFile: () => entry.regular, size: 100 };
      }
      return fs.stat(file);
    },
    async realpath(file) {
      const entry = files.get(canonicalPath(file, 'win32'));
      if (!entry) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return entry.target;
    },
  };
  let time = Date.parse('2026-10-02T12:00:00.000Z');
  let id = 0;
  const calls = [];
  const states = [];
  let minimized = 0;
  let restored = 0;
  const child = new EventEmitter();
  child.unref = () => { child.unrefCount = (child.unrefCount || 0) + 1; };
  child.kill = () => { throw new Error('Renew must never kill the emulator.'); };
  const service = new LauncherService({ statePath, platform: 'win32', fsImpl: fileAPI,
    spawnImpl: (...args) => { calls.push(args); return child; },
    now: () => time, idFactory: () => `game-${++id}`,
    onState: state => states.push(state), onRunning: () => minimized++, onFinished: () => restored++,
    ...overrides });
  const ready = async () => {
    await service.initialize();
    await service.setEmulator(EXE);
    await service.importGames([ROM]);
    return service.getState().games[0].id;
  };
  return { service, statePath, directory, files, add, remove, child, calls, states, fileAPI, ready,
    tick: milliseconds => { time += milliseconds; },
    minimized: () => minimized, restored: () => restored };
}

test('fresh library has safe defaults and returned state cannot mutate it', async t => {
  const f = await fixture(t);
  const state = await f.service.initialize();
  assert.deepEqual(state.settings, { emulatorPath: '', fullscreen: true, returnToLauncher: true });
  assert.equal(state.session, null);
  assert.deepEqual(state.games, []);
  state.settings.fullscreen = false;
  assert.equal(f.service.getState().settings.fullscreen, true);
});

test('Windows canonicalization covers casing, separators, dot segments, and extended prefixes', () => {
  assert.equal(canonicalPath('C:/Games/../Games/A.GBA', 'win32'), 'c:\\games\\a.gba');
  assert.equal(canonicalPath('\\\\?\\C:\\Games\\A.GBA', 'win32'), 'c:\\games\\a.gba');
  assert.equal(canonicalPath('\\\\?\\UNC\\server\\Games\\A.GBA', 'win32'), '\\\\server\\games\\a.gba');
});

test('imports only supported uncompressed files and deduplicates canonical real paths', async t => {
  const f = await fixture(t);
  f.add('C:\\Junction\\alias.gba', ROM);
  const state = await f.service.importGames([ROM, ROM.toUpperCase(), ROM.replaceAll('\\', '/'), 'C:\\Junction\\alias.gba', OTHER]);
  assert.equal(state.games.length, 2);
  assert.equal(state.games[0].system, 'GBA');
  assert.equal(state.games[1].system, 'GBC');
  assert.match(state.warning, /3 games/);
  await assert.rejects(f.service.importGames(['C:\\Games\\archive.zip']), /uncompressed/);
  assert.equal(f.service.getState().games.length, 2);
});

test('emulator selection requires absolute, regular, existing .exe file', async t => {
  const f = await fixture(t);
  f.add('C:\\directory.exe', 'C:\\directory.exe', false);
  await assert.rejects(f.service.setEmulator('mgba.exe'), /mGBA .exe/);
  await assert.rejects(f.service.setEmulator('C:\\mgba.cmd'), /mGBA .exe/);
  await assert.rejects(f.service.setEmulator('C:\\missing.exe'), /missing/);
  await assert.rejects(f.service.setEmulator('C:\\directory.exe'), /missing/);
  assert.equal((await f.service.setEmulator(EXE)).settings.emulatorPath, EXE);
});

test('settings enforce boolean types and do not accept executable paths or arbitrary flags', async t => {
  const f = await fixture(t);
  for (const value of ['false', 0, 1, null, [], {}]) {
    await assert.rejects(f.service.updateSettings({ fullscreen: value }), /true or false/);
  }
  await assert.rejects(f.service.updateSettings({ emulatorPath: EXE }), /unsupported/);
  await assert.rejects(f.service.updateSettings({ args: '--debug' }), /unsupported/);
  await assert.rejects(f.service.updateSettings(null), /unsupported/);
  const state = await f.service.updateSettings({ fullscreen: false, returnToLauncher: false });
  assert.equal(state.settings.fullscreen, false);
  assert.equal(state.settings.returnToLauncher, false);
});

test('game edits validate titles/favorites and removal never deletes the ROM', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await assert.rejects(f.service.updateGame(id, { title: ' ' }), /title/);
  await assert.rejects(f.service.updateGame(id, { title: 'a'.repeat(161) }), /title/);
  await assert.rejects(f.service.updateGame(id, { favorite: 'true' }), /true or false/);
  await assert.rejects(f.service.updateGame(id, { path: OTHER }), /unsupported/);
  const state = await f.service.updateGame(id, { title: '  My game  ', favorite: true });
  assert.equal(state.games[0].title, 'My game');
  assert.equal(state.games[0].favorite, true);
  await f.service.removeGame(id);
  assert.equal(f.service.getState().games.length, 0);
  assert.equal(f.files.has(canonicalPath(ROM, 'win32')), true);
  await assert.rejects(f.service.removeGame(id), /no longer/);
});

test('launch passes spaces and metacharacters as one literal argument with no shell', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  const result = await f.service.launchGame(id);
  assert.equal(result.session.status, 'launching');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], EXE);
  assert.deepEqual(f.calls[0][1], ['-f', '--', ROM]);
  assert.deepEqual(f.calls[0][2], { shell: false, windowsHide: true, detached: true,
    stdio: 'ignore', cwd: 'C:\\Program Files\\mGBA' });
  assert.equal(f.child.unrefCount, 1);
  assert.equal(f.minimized(), 0);
  f.child.emit('spawn');
  await f.service.flush();
  assert.equal(f.minimized(), 1);
  assert.equal(f.service.getState().session.status, 'running');
  f.child.emit('close', 0, null);
  await f.service.flush();
});

test('windowed launch explicitly overrides an inherited fullscreen preference', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.updateSettings({ fullscreen: false });
  await f.service.launchGame(id);
  assert.deepEqual(f.calls[0][1], ['-C', 'fullscreen=0', '--', ROM]);
  f.child.emit('close', 0, null);
  await f.service.flush();
});

test('concurrent launches are blocked before asynchronous file checks complete', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  const first = f.service.launchGame(id);
  await assert.rejects(f.service.launchGame(id), /already starting or running/);
  await first;
  await assert.rejects(f.service.launchGame(id), /already starting or running/);
  assert.equal(f.calls.length, 1);
  f.child.emit('close', 0, null);
  await f.service.flush();
  assert.equal(f.service.hasActiveSession(), false);
});

test('missing emulator is checked again at launch, and retry is possible', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  f.remove(EXE);
  await assert.rejects(f.service.launchGame(id), /executable is missing/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.hasActiveSession(), false);
  assert.equal(f.service.getState().session, null);
  f.add(EXE);
  await f.service.launchGame(id);
  assert.equal(f.calls.length, 1);
  f.child.emit('close', 0, null);
  await f.service.flush();
});

test('missing, directory, and unsupported real ROM files never spawn', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  f.remove(ROM);
  await assert.rejects(f.service.launchGame(id), /game file is missing/);
  f.add(ROM, ROM, false);
  await assert.rejects(f.service.launchGame(id), /game file is missing/);
  f.add(ROM, 'C:\\Games\\actually.zip');
  await assert.rejects(f.service.launchGame(id), /no longer resolves/);
  assert.equal(f.calls.length, 0);
});

test('spawn error then close finalizes exactly once and does not credit play time', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
  f.child.emit('close', -2, null);
  await f.service.flush();
  assert.equal(f.service.getState().session, null);
  assert.match(f.service.getState().error.message, /could not start.*Choose mGBA/);
  assert.equal(f.service.getState().games[0].playSeconds, 0);
  assert.equal(f.service.getState().games[0].lastPlayed, null);
  assert.equal(f.restored(), 1);
  assert.equal(f.minimized(), 0);
  assert.equal(f.states.filter(state => !state.session).length, 1);
});

test('synchronous spawn exception becomes an actionable terminal state', async t => {
  const f = await fixture(t, { spawnImpl: () => { throw Object.assign(new Error('blocked'), { code: 'EACCES' }); } });
  const id = await f.ready();
  await f.service.launchGame(id);
  await f.service.flush();
  assert.match(f.service.getState().error.message, /permissions/);
  assert.equal(f.service.hasActiveSession(), false);
});

test('normal process lifecycle records elapsed time once, even with repeated events', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(12650);
  f.child.emit('exit', 0, null);
  f.child.emit('close', 0, null);
  f.child.emit('close', 0, null);
  await f.service.flush();
  const state = f.service.getState();
  assert.equal(state.session, null);
  assert.equal(state.games[0].playSeconds, 12);
  assert.equal(state.games[0].lastPlayed, '2026-10-02T12:00:00.000Z');
  assert.equal(f.minimized(), 1);
  assert.equal(f.restored(), 1);
  assert.equal(state.error, null);
});

test('early nonzero close reports a useful error and return setting is honored', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.updateSettings({ returnToLauncher: false });
  await f.service.launchGame(id);
  f.child.emit('spawn');
  f.tick(50);
  f.child.emit('close', 2, null);
  await f.service.flush();
  assert.match(f.service.getState().error.message, /exit code 2.*game file is supported/);
  assert.equal(f.service.getState().games[0].playSeconds, 0);
  assert.equal(f.restored(), 0);
});

test('active game cannot be removed while its process is tracked', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  await assert.rejects(f.service.removeGame(id), /Close this game/);
  f.child.emit('close', 0, null);
  await f.service.flush();
  await f.service.removeGame(id);
});

test('checkpoint and final close never count the same seconds twice or kill the game', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(5000);
  await f.service.checkpointSession();
  assert.equal(f.service.getState().games[0].playSeconds, 5);
  assert.equal(f.service.hasActiveSession(), true);
  f.tick(6000);
  f.child.emit('close', 0, null);
  await f.service.flush();
  assert.equal(f.service.getState().games[0].playSeconds, 11);
});

test('concurrent mutations and lifecycle persistence preserve every update', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  const edit = f.service.updateGame(id, { favorite: true, title: 'Saved title' });
  f.child.emit('spawn');
  await edit;
  await f.service.flush();
  f.tick(3000);
  const setting = f.service.updateSettings({ fullscreen: false });
  f.child.emit('close', 0, null);
  await setting;
  await f.service.flush();
  const stored = JSON.parse(await fs.readFile(f.statePath, 'utf8'));
  assert.equal(stored.settings.fullscreen, false);
  assert.equal(stored.games[0].favorite, true);
  assert.equal(stored.games[0].title, 'Saved title');
  assert.equal(stored.games[0].playSeconds, 3);
  assert.equal(stored.games[0].lastPlayed, '2026-10-02T12:00:00.000Z');
  assert.equal('session' in stored, false);
  assert.deepEqual((await fs.readdir(f.directory)).sort(), ['library.json']);
});

test('valid library is restored with no stale runtime session', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.updateGame(id, { favorite: true });
  const restarted = new LauncherService({ statePath: f.statePath, platform: 'win32' });
  const state = await restarted.initialize();
  assert.equal(state.games[0].favorite, true);
  assert.equal(state.settings.emulatorPath, EXE);
  assert.equal(state.session, null);
  assert.equal(state.warning, null);
});

for (const [label, content] of [
  ['broken JSON', '{ "games": [ broken'],
  ['wrong schema', JSON.stringify({ schemaVersion: 99, games: [], settings: {} })],
  ['invalid settings', JSON.stringify({ schemaVersion: 1, games: [], settings: { emulatorPath: '', fullscreen: 'true', returnToLauncher: true } })],
]) {
  test(`${label} is preserved byte-for-byte and never silently overwritten`, async t => {
    const f = await fixture(t);
    await fs.writeFile(f.statePath, content);
    const state = await f.service.initialize();
    assert.match(state.warning, /kept unchanged/);
    await assert.rejects(f.service.updateSettings({ fullscreen: false }), /protect your data/);
    await assert.rejects(f.service.importGames([ROM]), /protect your data/);
    assert.equal(await fs.readFile(f.statePath, 'utf8'), content);
  });
}

test('duplicate or invalid saved entries block writes instead of discarding user data', async t => {
  const f = await fixture(t);
  await f.ready();
  const original = JSON.parse(await fs.readFile(f.statePath, 'utf8'));
  original.games.push({ ...original.games[0], id: 'other-id', path: original.games[0].path.toUpperCase() });
  // Keep extension/system consistent: Windows paths are case insensitive.
  const raw = JSON.stringify(original);
  await fs.writeFile(f.statePath, raw);
  const restarted = new LauncherService({ statePath: f.statePath, platform: 'win32' });
  assert.match((await restarted.initialize()).warning, /kept unchanged/);
  await assert.rejects(restarted.updateSettings({ fullscreen: false }), /protect/);
  assert.equal(await fs.readFile(f.statePath, 'utf8'), raw);
});

test('failed atomic replacement leaves old file and memory intact, removes temporary files, and allows retry', async t => {
  const f = await fixture(t);
  await f.ready();
  const original = await fs.readFile(f.statePath, 'utf8');
  const originalRename = f.fileAPI.rename;
  f.fileAPI.rename = async () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); };
  await assert.rejects(f.service.updateSettings({ fullscreen: false }), /could not save/);
  assert.equal(f.service.getState().settings.fullscreen, true);
  assert.equal(await fs.readFile(f.statePath, 'utf8'), original);
  assert.deepEqual(await fs.readdir(f.directory), ['library.json']);
  f.fileAPI.rename = originalRename;
  await f.service.updateSettings({ fullscreen: false });
  assert.equal(f.service.getState().settings.fullscreen, false);
});

test('session remains tracked and surfaces a warning if a runtime save fails', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  const originalRename = f.fileAPI.rename;
  f.fileAPI.rename = async () => { throw new Error('disk unavailable'); };
  f.child.emit('spawn');
  await f.service.flush();
  assert.equal(f.service.getState().session.status, 'running');
  assert.match(f.service.getState().warning, /kept in memory/);
  f.fileAPI.rename = originalRename;
  f.tick(2000);
  f.child.emit('close', 0, null);
  await f.service.flush();
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 2);
  assert.equal(f.service.getState().warning, null);
});

test('closing checkpoint rejects failed session saves, retains data, and retries without double-counting', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(5000);
  const originalRename = f.fileAPI.rename;
  f.fileAPI.rename = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  await assert.rejects(f.service.checkpointSession(), /could not save.*kept in memory/);
  await assert.rejects(f.service.flush({ requireSaved: true }), /could not save/);
  assert.equal(f.service.hasActiveSession(), true);
  assert.equal(f.service.getState().games[0].playSeconds, 5);
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 0);
  f.fileAPI.rename = originalRename;
  f.tick(2000);
  await f.service.checkpointSession();
  await f.service.flush({ requireSaved: true });
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 7);
  f.tick(3000);
  f.child.emit('close', 0, null);
  await f.service.flush({ requireSaved: true });
  assert.equal(f.service.getState().games[0].playSeconds, 10);
});

test('closing also rejects a finished session with an unsaved terminal write', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(9000);
  const originalRename = f.fileAPI.rename;
  f.fileAPI.rename = async () => { throw new Error('disk unavailable'); };
  f.child.emit('close', 0, null);
  await f.service.flush();
  assert.equal(f.service.hasActiveSession(), false);
  assert.equal(f.service.getState().games[0].playSeconds, 9);
  await assert.rejects(f.service.checkpointSession(), /could not save/);
  await assert.rejects(f.service.flush({ requireSaved: true }), /could not save/);
  f.fileAPI.rename = originalRename;
  await f.service.checkpointSession();
  await f.service.flush({ requireSaved: true });
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 9);
  assert.equal(f.service.getState().warning, null);
});

test('oversized import is rejected before disk replacement and leaves the usable library intact', async t => {
  const f = await fixture(t);
  await f.ready();
  const batches = [[], []];
  for (let index = 0; index < 20000; index++) {
    const file = `C:\\ROMs\\${'Collection'.repeat(9)}\\Game ${'X'.repeat(140)}${String(index).padStart(5, '0')}.gba`;
    assert.ok(file.length < 260);
    f.add(file);
    batches[Math.floor(index / 10000)].push(file);
  }
  await f.service.importGames(batches[0]);
  const original = await fs.readFile(f.statePath, 'utf8');
  const originalState = f.service.getState();
  assert.ok(Buffer.byteLength(original, 'utf8') < 10 * 1024 * 1024);
  await assert.rejects(f.service.importGames(batches[1]), /10 MiB library storage limit.*saved library is unchanged/);
  assert.equal(await fs.readFile(f.statePath, 'utf8'), original);
  assert.deepEqual(f.service.getState(), originalState);
  assert.deepEqual(await fs.readdir(f.directory), ['library.json']);
  const restarted = new LauncherService({ statePath: f.statePath, platform: 'win32' });
  const state = await restarted.initialize();
  assert.equal(state.warning, null);
  assert.equal(state.games.length, 10001);
});

test('wall-clock rollback between checkpoints cannot credit the same play time twice', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(10000);
  await f.service.checkpointSession();
  assert.equal(f.service.getState().games[0].playSeconds, 10);
  f.tick(-5000);
  await f.service.checkpointSession();
  assert.equal(f.service.getState().games[0].playSeconds, 10);
  f.tick(5000);
  f.child.emit('close', 0, null);
  await f.service.flush({ requireSaved: true });
  assert.equal(f.service.getState().games[0].playSeconds, 10);
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 10);
});

test('duplicate-only imports preserve the higher-priority unsaved-session warning', async t => {
  const f = await fixture(t);
  const id = await f.ready();
  await f.service.launchGame(id);
  f.child.emit('spawn');
  await f.service.flush();
  f.tick(9000);
  const originalRename = f.fileAPI.rename;
  f.fileAPI.rename = async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  f.child.emit('close', 0, null);
  await f.service.flush();
  const warning = f.service.getState().warning;
  assert.match(warning, /could not save.*kept in memory/);
  const duplicateState = await f.service.importGames([ROM]);
  assert.equal(duplicateState.warning, warning);
  assert.equal(duplicateState.games.length, 1);
  assert.equal(duplicateState.games[0].playSeconds, 9);
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 0);
  assert.equal((await f.service.importGames([])).warning, warning);
  await assert.rejects(f.service.flush({ requireSaved: true }), /could not save/);
  f.fileAPI.rename = originalRename;
  await f.service.checkpointSession();
  await f.service.flush({ requireSaved: true });
  assert.equal(f.service.getState().warning, null);
  assert.equal(JSON.parse(await fs.readFile(f.statePath, 'utf8')).games[0].playSeconds, 9);
  assert.match((await f.service.importGames([ROM])).warning, /1 game was already/);
});
