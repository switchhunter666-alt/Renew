'use strict';

const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { SYSTEMS, pathApi, absolutePath } = require('./library-store.cjs');

function terminalError(code, signal, error) {
  if (error) {
    const hint = error.code === 'ENOENT' ? 'The executable may have moved. Choose mGBA again in Settings.' :
      ['EACCES', 'EPERM'].includes(error.code) ? 'Check the executable permissions and that this is a working mGBA installation.' :
        'Check that your selected executable is a working mGBA installation.';
    return { message: `mGBA could not start. ${hint}` };
  }
  if (code !== 0 && code !== null) {
    return { message: `mGBA closed with exit code ${code}. Check your mGBA installation and that this game file is supported, then try again.` };
  }
  if (signal) return { message: `mGBA was stopped (${signal}). Your elapsed play time has been recorded.` };
  return null;
}

// Owns one emulator process and its elapsed-time ledger. It never writes the
// library, changes windows, exposes a child process, or stops a running game.
class MGBASession {
  constructor({ fsImpl = fs, spawnImpl = spawn, platform = process.platform,
    now = () => Date.now(), onStarting = () => {}, onRunning = () => {}, onFinished = () => {} } = {}) {
    this.fs = fsImpl;
    this.spawn = spawnImpl;
    this.platform = platform;
    this.paths = pathApi(platform);
    this.now = now;
    this.onStarting = onStarting;
    this.onRunning = onRunning;
    this.onFinished = onFinished;
    this._active = null;
    this._pending = false;
  }

  async _regularFile(filePath, kind) {
    if (!absolutePath(filePath, this.platform)) throw new Error(`Choose a valid absolute ${kind} file path.`);
    try {
      const stats = await this.fs.stat(filePath);
      if (!stats.isFile()) throw new Error('NOT_FILE');
      return await this.fs.realpath(filePath);
    } catch {
      if (kind === 'mGBA') throw new Error('The mGBA executable is missing or cannot be read. Choose your mGBA .exe again in Settings.');
      throw new Error('This game file is missing or cannot be read. Restore it to its original location, or remove its library entry and import it again.');
    }
  }

  async resolveEmulator(filePath) {
    if (!absolutePath(filePath, this.platform) || this.paths.extname(filePath).toLowerCase() !== '.exe') {
      throw new Error('Choose the mGBA .exe executable from your installed mGBA folder.');
    }
    const realPath = await this._regularFile(filePath, 'mGBA');
    if (this.paths.extname(realPath).toLowerCase() !== '.exe') throw new Error('The selected file must resolve to an .exe executable.');
    return realPath;
  }

  async resolveGame(filePath) {
    if (!absolutePath(filePath, this.platform) || !SYSTEMS[this.paths.extname(filePath).toLowerCase()]) {
      throw new Error('Renew supports uncompressed .gba, .gbc, and .gb files. Extract ZIP or 7z archives before importing.');
    }
    const realPath = await this._regularFile(filePath, 'game');
    if (!SYSTEMS[this.paths.extname(realPath).toLowerCase()]) {
      throw new Error('The selected game must resolve to an uncompressed .gba, .gbc, or .gb file.');
    }
    return realPath;
  }

  async launch(game, settings) {
    if (this.hasActiveSession()) throw new Error('A game is already starting or running. Close it in mGBA before launching another.');
    this._pending = true;
    try {
      if (!settings.emulatorPath) throw new Error('Choose your mGBA executable in Settings before playing.');
      if (this.paths.extname(settings.emulatorPath).toLowerCase() !== '.exe') throw new Error('Choose a valid mGBA .exe in Settings.');
      const executable = await this._regularFile(settings.emulatorPath, 'mGBA');
      if (this.paths.extname(executable).toLowerCase() !== '.exe') throw new Error('The mGBA path no longer resolves to an .exe executable.');
      if (!SYSTEMS[this.paths.extname(game.path).toLowerCase()]) throw new Error('This game must be an uncompressed .gba, .gbc, or .gb file.');
      const rom = await this._regularFile(game.path, 'game');
      if (!SYSTEMS[this.paths.extname(rom).toLowerCase()]) throw new Error('This game no longer resolves to a supported ROM file.');
      const record = { gameId: game.id, spawned: false, finalized: false,
        startMs: null, creditedSeconds: 0, startedAt: new Date(this.now()).toISOString() };
      this._active = record;
      this.onStarting({ gameId: game.id, status: 'launching', startedAt: record.startedAt });
      // No shell, interpolation, user-supplied flags, or command strings.
      const args = [...(settings.fullscreen ? ['-f'] : ['-C', 'fullscreen=0']), '--', rom];
      try {
        const child = this.spawn(executable, args, { shell: false, windowsHide: true,
          detached: true, stdio: 'ignore', cwd: this.paths.dirname(executable) });
        child.once('spawn', () => this._spawned(record));
        child.once('error', error => this._finished(record, null, null, error));
        child.once('close', (code, signal) => this._finished(record, code, signal, null));
        child.unref?.();
      } catch (error) {
        this._finished(record, null, null, error);
      }
    } finally {
      this._pending = false;
    }
  }

  _spawned(record) {
    if (record.finalized || record !== this._active || record.spawned) return;
    record.spawned = true;
    record.startMs = this.now();
    record.startedAt = new Date(record.startMs).toISOString();
    this.onRunning({ gameId: record.gameId, status: 'running', startedAt: record.startedAt });
  }

  _finished(record, code, signal, error) {
    // Node may emit error followed by close. Claim terminal ownership first.
    if (record.finalized || record !== this._active) return;
    record.finalized = true;
    const seconds = record.spawned ? this._creditTime(record, this.now()) : 0;
    this._active = null;
    this.onFinished({ gameId: record.gameId, seconds, error: terminalError(code, signal, error) });
  }

  _creditTime(record, time) {
    const total = Math.max(0, Math.floor((time - record.startMs) / 1000));
    const delta = Math.max(0, total - record.creditedSeconds);
    record.creditedSeconds = Math.max(record.creditedSeconds, total);
    return delta;
  }

  checkpoint() {
    const record = this._active;
    if (!record?.spawned || record.finalized) return null;
    return { gameId: record.gameId, seconds: this._creditTime(record, this.now()) };
  }

  hasActiveSession() { return Boolean(this._active || this._pending); }
  isGameActive(id) { return this._active?.gameId === id; }
  isRunning(id) { return this.isGameActive(id) && this._active.spawned && !this._active.finalized; }
}

module.exports = { MGBASession };
