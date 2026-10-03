'use strict';

const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { LibraryStore, canonicalPath, validateDocument, DEFAULT_SETTINGS, SYSTEMS,
  ART, pathApi, assertKeys, validString } = require('./library-store.cjs');
const { MGBASession } = require('./mgba-session.cjs');

class LauncherService {
  constructor({ statePath, fsImpl = fs, spawnImpl = spawn, platform = process.platform,
    now = () => Date.now(), idFactory = randomUUID, onState = () => {},
    onRunning = () => {}, onFinished = () => {} } = {}) {
    if (!statePath) throw new Error('A library storage path is required.');
    this.store = new LibraryStore({ statePath, fsImpl, platform });
    this.emulator = new MGBASession({ fsImpl, spawnImpl, platform, now,
      onStarting: session => { this.error = null; this.session = session; this._notify(); },
      onRunning: session => this._sessionRunning(session),
      onFinished: result => this._sessionFinished(result) });
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
    this._launchPending = false;
    this._persistenceWarning = null;
    this._unsavedSession = false;
  }

  initialize() {
    if (!this._initialization) this._initialization = this._load();
    return this._initialization;
  }
  async _load() {
    const loaded = await this.store.load();
    this.games = loaded.games;
    this.settings = loaded.settings;
    this.warning = loaded.warning;
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
  _writable() { this.store.assertWritable(); }
  _document(games = this.games, settings = this.settings) { return { games, settings }; }
  async _persist(document) {
    await this.store.write(document);
    this._unsavedSession = false;
    if (this.warning === this._persistenceWarning) this.warning = null;
    this._persistenceWarning = null;
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
  async setEmulator(filePath) {
    await this.initialize();
    return this._enqueue(async () => {
      this._writable();
      const realPath = await this.emulator.resolveEmulator(filePath);
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
        const realPath = await this.emulator.resolveGame(filePath);
        const extension = this.paths.extname(realPath).toLowerCase();
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
      if (this.emulator.isGameActive(id)) throw new Error('Close this game in mGBA before removing its library entry.');
      const games = this.games.filter(game => game.id !== id);
      await this._persist(this._document(games));
      this.games = games;
      return this.getState();
    });
  }
  async launchGame(id) {
    // This lock is acquired before the first await, including while files are checked.
    if (this._launchPending || this.emulator.hasActiveSession()) throw new Error('A game is already starting or running. Close it in mGBA before launching another.');
    this._launchPending = true;
    try {
      await this.initialize();
      return await this._enqueue(async () => {
        this._writable();
        const game = this._game(id);
        await this.emulator.launch(game, this.settings);
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
  _sessionRunning(session) {
    this._enqueue(async () => {
      this.games = this.games.map(game => game.id === session.gameId ? { ...game, lastPlayed: session.startedAt } : game);
      this.session = session;
      if (this.emulator.isRunning(session.gameId)) {
        try { this.onRunning(); } catch { /* Window may already be closed. */ }
      }
      await this._saveSessionState();
      this._notify();
    });
  }
  _sessionFinished(result) {
    this._enqueue(async () => {
      this._applyPlayTime(result);
      if (result.error) this.error = result.error;
      this.session = null;
      await this._saveSessionState();
      if (this.settings.returnToLauncher) {
        try { this.onFinished(); } catch { /* Window may already be closed. */ }
      }
      this._notify();
    });
  }
  _applyPlayTime({ gameId, seconds }) {
    this.games = this.games.map(game => game.id === gameId ?
      { ...game, playSeconds: Math.min(Number.MAX_SAFE_INTEGER, game.playSeconds + seconds) } : game);
  }
  hasActiveSession() { return this._launchPending || this.emulator.hasActiveSession(); }
  async checkpointSession() {
    await this.initialize();
    return this._enqueue(async () => {
      const checkpoint = this.emulator.checkpoint();
      if (checkpoint) {
        this._applyPlayTime(checkpoint);
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
