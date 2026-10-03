'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LibraryStore, DEFAULT_SETTINGS, validateDocument } = require('../desktop/library-store.cjs');
const { MGBASession } = require('../desktop/mgba-session.cjs');

async function storageFixture(t, fsImpl = fs) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'renew-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, 'library.json');
  return { statePath, directory, store: new LibraryStore({ statePath, fsImpl, platform: 'win32' }) };
}

const EXE = 'C:\\Program Files\\mGBA\\mGBA.exe';
const ROM = 'C:\\Games\\Space & metacharacters; [1].gba';
const game = { id: 'one', path: ROM };
function sessionFixture() {
  let time = Date.parse('2026-10-02T12:00:00.000Z');
  const events = [];
  const launches = [];
  const children = [];
  const fsImpl = {
    async stat(file) {
      if (![EXE, ROM].includes(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return { isFile: () => true };
    },
    async realpath(file) { return file; },
  };
  const session = new MGBASession({ fsImpl, platform: 'win32', now: () => time,
    spawnImpl: (...args) => {
      launches.push(args);
      const child = new EventEmitter();
      child.unref = () => { child.unreferenced = true; };
      child.kill = () => { assert.fail('The session module must not kill a game.'); };
      children.push(child);
      return child;
    },
    onStarting: value => events.push(['starting', value]),
    onRunning: value => events.push(['running', value]),
    onFinished: value => events.push(['finished', value]),
  });
  return { session, events, launches, children, tick: milliseconds => { time += milliseconds; } };
}

test('library store owns schema version and persists only library data', async t => {
  const f = await storageFixture(t);
  assert.deepEqual(await f.store.load(), { games: [], settings: { ...DEFAULT_SETTINGS }, warning: null });
  await f.store.write({ games: [], settings: { ...DEFAULT_SETTINGS, fullscreen: false },
    session: { gameId: 'temporary' }, warning: 'temporary', error: { message: 'temporary' } });
  const raw = JSON.parse(await fs.readFile(f.statePath, 'utf8'));
  assert.deepEqual(Object.keys(raw).sort(), ['games', 'schemaVersion', 'settings']);
  assert.equal(raw.schemaVersion, 1);
  assert.equal((await f.store.load()).settings.fullscreen, false);
  assert.deepEqual(await fs.readdir(f.directory), ['library.json']);
});

test('library store snapshots and serializes independent concurrent writes', async t => {
  const replacements = [];
  const fsImpl = { ...fs, async rename(from, to) {
    replacements.push(JSON.parse(await fs.readFile(from, 'utf8')).settings.fullscreen);
    return fs.rename(from, to);
  } };
  const f = await storageFixture(t, fsImpl);
  const first = { games: [], settings: { ...DEFAULT_SETTINGS, fullscreen: true } };
  const writeOne = f.store.write(first);
  first.settings.fullscreen = false;
  const writeTwo = f.store.write({ games: [], settings: { ...DEFAULT_SETTINGS, fullscreen: false } });
  await Promise.all([writeOne, writeTwo]);
  assert.deepEqual(replacements, [true, false]);
  assert.equal((await f.store.load()).settings.fullscreen, false);
  assert.deepEqual(await fs.readdir(f.directory), ['library.json']);
});

test('library store independently protects unreadable schema from replacement', async t => {
  const f = await storageFixture(t);
  const original = '{"schemaVersion":999,"games":[]}';
  await fs.writeFile(f.statePath, original);
  assert.match((await f.store.load()).warning, /kept unchanged/);
  assert.throws(() => f.store.assertWritable(), /protect your data/);
  await assert.rejects(f.store.write({ games: [], settings: { ...DEFAULT_SETTINGS } }), /protect your data/);
  assert.equal(await fs.readFile(f.statePath, 'utf8'), original);
});

test('library schema validation returns detached data and enforces game/settings types', () => {
  const source = { schemaVersion: 1, games: [], settings: { ...DEFAULT_SETTINGS } };
  const validated = validateDocument(source, 'win32');
  validated.settings.fullscreen = false;
  assert.equal(source.settings.fullscreen, true);
  assert.throws(() => validateDocument({ ...source, settings: { ...source.settings, fullscreen: 'false' } }, 'win32'), /settings/);
  assert.throws(() => validateDocument({ ...source, games: [{ id: 'bad' }] }, 'win32'), /game entry/);
});

test('mGBA session validates files and locks launches independently of library storage', async () => {
  const f = sessionFixture();
  assert.equal(await f.session.resolveEmulator(EXE), EXE);
  assert.equal(await f.session.resolveGame(ROM), ROM);
  await assert.rejects(f.session.resolveGame('C:\\Games\\archive.zip'), /uncompressed/);
  await assert.rejects(f.session.launch(game, { emulatorPath: 'C:\\missing.exe', fullscreen: false }), /missing/);
  assert.equal(f.session.hasActiveSession(), false);
  const first = f.session.launch(game, { emulatorPath: EXE, fullscreen: false });
  assert.equal(f.session.hasActiveSession(), true);
  await assert.rejects(f.session.launch(game, { emulatorPath: EXE, fullscreen: true }), /already starting or running/);
  await first;
  assert.equal(f.launches.length, 1);
  assert.equal(f.launches[0][0], EXE);
  assert.deepEqual(f.launches[0][1], ['-C', 'fullscreen=0', '--', ROM]);
  assert.equal(f.launches[0][2].shell, false);
  assert.equal(f.children[0].unreferenced, true);
  assert.equal(f.session.isGameActive('one'), true);
  assert.equal(f.session.checkpoint(), null);
  f.children[0].emit('close', 0, null);
  assert.equal(f.session.hasActiveSession(), false);
});

test('mGBA session reports elapsed deltas and exactly one terminal result without owning game records', async () => {
  const f = sessionFixture();
  await f.session.launch(game, { emulatorPath: EXE, fullscreen: true });
  const child = f.children[0];
  child.emit('spawn');
  child.emit('spawn');
  assert.equal(f.session.isRunning('one'), true);
  f.tick(10000);
  assert.deepEqual(f.session.checkpoint(), { gameId: 'one', seconds: 10 });
  f.tick(-5000);
  assert.deepEqual(f.session.checkpoint(), { gameId: 'one', seconds: 0 });
  f.tick(8000);
  child.emit('close', 2, null);
  child.emit('close', 2, null);
  child.emit('error', Object.assign(new Error('late error'), { code: 'ENOENT' }));
  assert.deepEqual(f.events.map(([name]) => name), ['starting', 'running', 'finished']);
  const terminal = f.events[2][1];
  assert.equal(terminal.seconds, 3);
  assert.match(terminal.error.message, /exit code 2/);
  assert.equal(f.session.checkpoint(), null);
  assert.equal(f.session.hasActiveSession(), false);
  assert.deepEqual(game, { id: 'one', path: ROM });
});
