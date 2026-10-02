'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const SYSTEMS = Object.freeze({ '.gba': 'GBA', '.gbc': 'GBC', '.gb': 'GB' });
const ART = Object.freeze(['aurora', 'ember', 'ocean', 'violet']);
const SCHEMA_VERSION = 1;
const MAX_LIBRARY_BYTES = 10 * 1024 * 1024;
const DEFAULT_SETTINGS = Object.freeze({ emulatorPath: '', fullscreen: true, returnToLauncher: true });

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function validString(value, max = 32767) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}
function pathApi(platform) { return platform === 'win32' ? path.win32 : path; }
function canonicalPath(value, platform = process.platform) {
  const api = pathApi(platform);
  let normalized = api.normalize(value);
  if (platform === 'win32') {
    // Treat extended-length and ordinary Windows paths as the same file identity.
    normalized = normalized.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    return normalized.toLowerCase();
  }
  return normalized;
}
function absolutePath(value, platform) {
  return validString(value) && pathApi(platform).isAbsolute(value);
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function assertKeys(value, keys, label) {
  if (!plainObject(value) || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error(`${label} contains unsupported fields.`);
  }
}
function validateDocument(document, platform = process.platform) {
  if (!plainObject(document) || document.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(document.games) || document.games.length > 50000 || !plainObject(document.settings)) {
    throw new Error('The library format is not supported.');
  }
  const settings = document.settings;
  if (typeof settings.emulatorPath !== 'string' ||
      (settings.emulatorPath !== '' && (!absolutePath(settings.emulatorPath, platform) ||
        pathApi(platform).extname(settings.emulatorPath).toLowerCase() !== '.exe')) ||
      typeof settings.fullscreen !== 'boolean' || typeof settings.returnToLauncher !== 'boolean') {
    throw new Error('The saved settings are invalid.');
  }
  const ids = new Set();
  const paths = new Set();
  const games = document.games.map(game => {
    if (!plainObject(game) || !validString(game.id, 128) || !validString(game.title, 160) ||
        !game.title.trim() || !absolutePath(game.path, platform) ||
        SYSTEMS[pathApi(platform).extname(game.path).toLowerCase()] !== game.system ||
        typeof game.favorite !== 'boolean' || !Number.isSafeInteger(game.playSeconds) || game.playSeconds < 0 ||
        !(game.lastPlayed === null || validDate(game.lastPlayed)) || !validDate(game.addedAt) ||
        !ART.includes(game.art) || ids.has(game.id) || paths.has(canonicalPath(game.path, platform))) {
      throw new Error('A saved game entry is invalid or duplicated.');
    }
    ids.add(game.id);
    paths.add(canonicalPath(game.path, platform));
    return { id: game.id, title: game.title, path: game.path, system: game.system,
      favorite: game.favorite, playSeconds: game.playSeconds, lastPlayed: game.lastPlayed,
      addedAt: game.addedAt, art: game.art };
  });
  return { games, settings: { emulatorPath: settings.emulatorPath,
    fullscreen: settings.fullscreen, returnToLauncher: settings.returnToLauncher } };
}

class LauncherService {
  constructor({ statePath, fsImpl = fs, spawnImpl = spawn, platform = process.platform,
    now = () => Date.now(), idFactory = randomUUID, onState = () => {},
    onRunning = () => {}, onFinished = () => {} } = {}) {
    if (!statePath) throw new Error('A library storage path is required.');
    this.statePath = statePath;
    this.fs = fsImpl;
    this.spawn = spawnImpl;
    this.platform = platform;
    this.paths = pathApi(platform);
    this.now = now;
    this.idFactory = idFactory;
    this.onState = onState;
    this.onRunning = onRunning;
    this.onFinished = onFinished;
    this.games = [];
    this.settings = { ...DEFAULT_SETTINGS };
    this.session = null;
    this.warning = null;
    this.error = null;
    this._queue = Promise.resolve();
    this._initialization = null;
    this._writeBlocked = false;
    this._launchPending = false;
    this._active = null;
    this._persistenceWarning = null;
    this._unsavedSession = false;
  }

  initialize() {
    if (!this._initialization) this._initialization = this._load();
    return this._initialization;
  }
  async _load() {
    try {
      const stats = await this.fs.stat(this.statePath);
      if (!stats.isFile() || stats.size > MAX_LIBRARY_BYTES) throw new Error('The library file is invalid or too large.');
      const raw = await this.fs.readFile(this.statePath, 'utf8');
      const parsed = validateDocument(JSON.parse(raw), this.platform);
      this.games = parsed.games;
      this.settings = parsed.settings;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this._writeBlocked = true;
        this.warning = 'Your saved library could not be read safely. It has been kept unchanged. ' +
          'Close Renew, back up library.json in its app data folder, and repair or rename it before restarting. ' +
          'Changes are paused to protect your data.';
      }
    }
    return this.getState();
  }
  getState() {
    return { games: this.games.map(game => ({ ...game })), settings: { ...this.settings },
      session: this.session ? { ...this.session } : null, warning: this.warning,
      error: this.error ? { ...this.error } : null };
  }
  _notify() {
    try { this.onState(this.getState()); } catch { /* A closed window must not break tracking. */ }
  }
  _enqueue(action) {
    const result = this._queue.then(action);
    this._queue = result.catch(() => {});
    return result;
  }
  _writable() {
    if (this._writeBlocked) throw new Error(this.warning);
  }
  _document(games = this.games, settings = this.settings) {
    return { schemaVersion: SCHEMA_VERSION, games, settings };
  }
  async _persist(document) {
    this._writable();
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_LIBRARY_BYTES) {
      throw new Error('This change would exceed the 10 MiB library storage limit. Import fewer games or remove unused entries, then try again. Your saved library is unchanged.');
    }
    const temp = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      await this.fs.mkdir(path.dirname(this.statePath), { recursive: true });
      handle = await this.fs.open(temp, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.fs.rename(temp, this.statePath);
      this._unsavedSession = false;
      if (this.warning === this._persistenceWarning) this.warning = null;
      this._persistenceWarning = null;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await this.fs.unlink(temp).catch(() => {});
      const friendly = new Error('Renew could not save your library. Check that its app data folder is writable and that your disk has space.');
      friendly.cause = error;
      throw friendly;
    }
  }
  async _saveSessionState({ strict = false } = {}) {
    try {
      await this._persist(this._document());
      if (this.warning === this._persistenceWarning) this.warning = null;
      this._persistenceWarning = null;
    } catch (error) {
      this._unsavedSession = true;
      this._persistenceWarning = error.message + ' Session changes are being kept in memory until they can be saved.';
      this.warning = this._persistenceWarning;
      if (strict) { this._notify(); throw new Error(this._persistenceWarning, { cause: error }); }
    }
  }
  async _regularFile(filePath, kind) {
    if (!absolutePath(filePath, this.platform)) throw new Error(`Choose a valid absolute ${kind} file path.`);
    try {
      const stats = await this.fs.stat(filePath);
      if (!stats.isFile()) throw new Error('NOT_FILE');
      return await this.fs.realpath(filePath);
    } catch (error) {
      if (kind === 'mGBA') throw new Error('The mGBA executable is missing or cannot be read. Choose your mGBA .exe again in Settings.');
      throw new Error('This game file is missing or cannot be read. Restore it to its original location, or remove its library entry and import it again.');
    }
  }
  async setEmulator(filePath) {
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      if (!absolutePath(filePath, this.platform) || this.paths.extname(filePath).toLowerCase() !== '.exe') {
        throw new Error('Choose the mGBA .exe executable from your installed mGBA folder.');
      }
      const realPath = await this._regularFile(filePath, 'mGBA');
      if (this.paths.extname(realPath).toLowerCase() !== '.exe') throw new Error('The selected file must resolve to an .exe executable.');
      const settings = { ...this.settings, emulatorPath: realPath };
      await this._persist(this._document(this.games, settings));
      this.settings = settings;
      this.error = null;
      return this.getState();
    });
  }
  async importGames(filePaths) {
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      if (!Array.isArray(filePaths) || filePaths.length > 10000) throw new Error('Select up to 10,000 game files at a time.');
      const known = new Set(this.games.map(game => canonicalPath(game.path, this.platform)));
      const additions = [];
      let duplicates = 0;
      for (const filePath of filePaths) {
        if (!absolutePath(filePath, this.platform) || !SYSTEMS[this.paths.extname(filePath).toLowerCase()]) {
          throw new Error('Renew supports uncompressed .gba, .gbc, and .gb files. Extract ZIP or 7z archives before importing.');
        }
        const realPath = await this._regularFile(filePath, 'game');
        const extension = this.paths.extname(realPath).toLowerCase();
        if (!SYSTEMS[extension]) throw new Error('The selected game must resolve to an uncompressed .gba, .gbc, or .gb file.');
        const key = canonicalPath(realPath, this.platform);
        if (known.has(key)) { duplicates++; continue; }
        known.add(key);
        const title = this.paths.basename(realPath, this.paths.extname(realPath)).replace(/[_]+/g, ' ').trim().slice(0, 160) || 'Untitled game';
        additions.push({ id: this.idFactory(), title, path: realPath, system: SYSTEMS[extension],
          favorite: false, playSeconds: 0, lastPlayed: null, addedAt: new Date(this.now()).toISOString(),
          art: ART[(this.games.length + additions.length) % ART.length] });
      }
      const games = [...this.games, ...additions];
      if (games.length > 50000) throw new Error('This library has reached the 50,000-game limit. Remove unused entries before importing more.');
      if (additions.length) await this._persist(this._document(games));
      this.games = games;
      // Duplicate-only imports do not write, so they cannot clear an unsaved-session warning.
      if (!this._unsavedSession) {
        this.warning = duplicates ? `${duplicates} game${duplicates === 1 ? ' was' : 's were'} already in your library and skipped.` : null;
      }
      this.error = null;
      return this.getState();
    });
  }
  async updateSettings(patch) {
    assertKeys(patch, ['fullscreen', 'returnToLauncher'], 'Settings');
    for (const value of Object.values(patch)) {
      if (typeof value !== 'boolean') throw new Error('Fullscreen and return-to-launcher settings must be true or false.');
    }
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      const settings = { ...this.settings, ...patch };
      await this._persist(this._document(this.games, settings));
      this.settings = settings;
      return this.getState();
    });
  }
  async updateGame(id, patch) {
    assertKeys(patch, ['favorite', 'title'], 'Game details');
    if ('favorite' in patch && typeof patch.favorite !== 'boolean') throw new Error('Favorite must be true or false.');
    if ('title' in patch && (!validString(patch.title, 160) || !patch.title.trim())) {
      throw new Error('Give this game a title between 1 and 160 characters.');
    }
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      this._game(id);
      const changes = { ...patch };
      if ('title' in changes) changes.title = changes.title.trim();
      const games = this.games.map(game => game.id === id ? { ...game, ...changes } : game);
      await this._persist(this._document(games));
      this.games = games;
      return this.getState();
    });
  }
  _game(id) {
    if (typeof id !== 'string') throw new Error('Choose a game from your library.');
    const game = this.games.find(entry => entry.id === id);
    if (!game) throw new Error('This game is no longer in your library.');
    return game;
  }
  async removeGame(id) {
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      this._game(id);
      if (this._active?.gameId === id) throw new Error('Close this game in mGBA before removing its library entry.');
      const games = this.games.filter(game => game.id !== id);
      await this._persist(this._document(games));
      this.games = games;
      return this.getState();
    });
  }
  async launchGame(id) {
    // This lock is acquired before the first await, including while files are checked.
    if (this._launchPending || this._active) throw new Error('A game is already starting or running. Close it in mGBA before launching another.');
    this._launchPending = true;
    try {
      await this.initialize();
      return await this._enqueue(async () => {
        this._writable();
        const game = this._game(id);
        if (!this.settings.emulatorPath) throw new Error('Choose your mGBA executable in Settings before playing.');
        if (this.paths.extname(this.settings.emulatorPath).toLowerCase() !== '.exe') throw new Error('Choose a valid mGBA .exe in Settings.');
        const executable = await this._regularFile(this.settings.emulatorPath, 'mGBA');
        if (this.paths.extname(executable).toLowerCase() !== '.exe') throw new Error('The mGBA path no longer resolves to an .exe executable.');
        if (!SYSTEMS[this.paths.extname(game.path).toLowerCase()]) throw new Error('This game must be an uncompressed .gba, .gbc, or .gb file.');
        const rom = await this._regularFile(game.path, 'game');
        if (!SYSTEMS[this.paths.extname(rom).toLowerCase()]) throw new Error('This game no longer resolves to a supported ROM file.');
        const record = { gameId: game.id, child: null, spawned: false, finalized: false,
          startMs: null, creditedSeconds: 0, startedAt: new Date(this.now()).toISOString() };
        this._active = record;
        this.error = null;
        this.session = { gameId: game.id, status: 'launching', startedAt: record.startedAt };
        this._notify();
        // No shell, interpolation, user-supplied flags, or command strings.
        const args = [...(this.settings.fullscreen ? ['-f'] : ['-C', 'fullscreen=0']), '--', rom];
        try {
          const child = this.spawn(executable, args, { shell: false, windowsHide: true,
            detached: true, stdio: 'ignore', cwd: this.paths.dirname(executable) });
          record.child = child;
          child.once('spawn', () => this._spawned(record));
          child.once('error', error => this._finished(record, null, null, error));
          child.once('close', (code, signal) => this._finished(record, code, signal, null));
          // Closing Renew leaves an already running emulator alone.
          child.unref?.();
        } catch (error) {
          this._finished(record, null, null, error);
        }
        return this.getState();
      });
    } catch (error) {
      this.error = { message: error.message };
      this._notify();
      throw error;
    } finally {
      this._launchPending = false;
    }
  }
  _spawned(record) {
    if (record.finalized || record !== this._active || record.spawned) return;
    record.spawned = true;
    record.startMs = this.now();
    record.startedAt = new Date(record.startMs).toISOString();
    this._enqueue(async () => {
      this.games = this.games.map(game => game.id === record.gameId ? { ...game, lastPlayed: record.startedAt } : game);
      this.session = { gameId: record.gameId, status: 'running', startedAt: record.startedAt };
      if (!record.finalized) {
        try { this.onRunning(); } catch { /* Window may already be closed. */ }
      }
      await this._saveSessionState();
      this._notify();
    });
  }
  _finished(record, code, signal, error) {
    // Node may emit error and then close. Claim terminal ownership synchronously.
    if (record.finalized || record !== this._active) return;
    record.finalized = true;
    const endedAt = this.now();
    this._enqueue(async () => {
      if (record.spawned) this._creditTime(record, endedAt);
      if (error) {
        const hint = error.code === 'ENOENT' ? 'The executable may have moved. Choose mGBA again in Settings.' :
          ['EACCES', 'EPERM'].includes(error.code) ? 'Check the executable permissions and that this is a working mGBA installation.' :
            'Check that your selected executable is a working mGBA installation.';
        this.error = { message: `mGBA could not start. ${hint}` };
      } else if (code !== 0 && code !== null) {
        this.error = { message: `mGBA closed with exit code ${code}. Check your mGBA installation and that this game file is supported, then try again.` };
      } else if (signal) {
        this.error = { message: `mGBA was stopped (${signal}). Your elapsed play time has been recorded.` };
      }
      this.session = null;
      await this._saveSessionState();
      this._active = null;
      if (this.settings.returnToLauncher) {
        try { this.onFinished(); } catch { /* Window may already be closed. */ }
      }
      this._notify();
    });
  }
  _creditTime(record, time) {
    const totalSeconds = Math.max(0, Math.floor((time - record.startMs) / 1000));
    const delta = Math.max(0, totalSeconds - record.creditedSeconds);
    this.games = this.games.map(game => game.id === record.gameId ?
      { ...game, playSeconds: Math.min(Number.MAX_SAFE_INTEGER, game.playSeconds + delta) } : game);
    // A system-clock rollback must never make already-credited time eligible again.
    record.creditedSeconds = Math.max(record.creditedSeconds, totalSeconds);
  }
  hasActiveSession() { return Boolean(this._active || this._launchPending); }
  async checkpointSession() {
    await this.initialize();
    return this._enqueue(async () => {
      if (this._active?.spawned && !this._active.finalized) {
        this._creditTime(this._active, this.now());
        this._unsavedSession = true;
      }
      // A finished session can also have an unsaved final write. Closing must
      // retry that data, not just inspect whether a process is currently active.
      if (this._unsavedSession) await this._saveSessionState({ strict: true });
      return this.getState();
    });
  }
  async flush({ requireSaved = false } = {}) {
    await this._queue;
    if (requireSaved && this._unsavedSession) {
      throw new Error(this._persistenceWarning || 'Your session has not been saved. Keep Renew open and try again.');
    }
  }
}

module.exports = { LauncherService, canonicalPath, validateDocument, DEFAULT_SETTINGS, SYSTEMS };
