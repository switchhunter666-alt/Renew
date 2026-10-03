'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
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

// Owns the persisted schema and atomic file replacement. Runtime session state
// and presentation warnings stay with LauncherService.
class LibraryStore {
  constructor({ statePath, fsImpl = fs, platform = process.platform, tempIdFactory = randomUUID } = {}) {
    if (!statePath) throw new Error('A library storage path is required.');
    this.statePath = statePath;
    this.fs = fsImpl;
    this.platform = platform;
    this.tempIdFactory = tempIdFactory;
    this._blockedWarning = null;
    this._writes = Promise.resolve();
  }

  async load() {
    const empty = { games: [], settings: { ...DEFAULT_SETTINGS }, warning: null };
    try {
      const stats = await this.fs.stat(this.statePath);
      if (!stats.isFile() || stats.size > MAX_LIBRARY_BYTES) throw new Error('The library file is invalid or too large.');
      const raw = await this.fs.readFile(this.statePath, 'utf8');
      return { ...validateDocument(JSON.parse(raw), this.platform), warning: null };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this._blockedWarning = 'Your saved library could not be read safely. It has been kept unchanged. ' +
          'Close Renew, back up library.json in its app data folder, and repair or rename it before restarting. ' +
          'Changes are paused to protect your data.';
        empty.warning = this._blockedWarning;
      }
      return empty;
    }
  }

  assertWritable() {
    if (this._blockedWarning) throw new Error(this._blockedWarning);
  }

  async write({ games, settings }) {
    this.assertWritable();
    const serialized = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, games, settings }, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_LIBRARY_BYTES) {
      throw new Error('This change would exceed the 10 MiB library storage limit. Import fewer games or remove unused entries, then try again. Your saved library is unchanged.');
    }
    // Snapshot before queuing, so later caller edits cannot change this write.
    const result = this._writes.then(() => this._replace(serialized));
    this._writes = result.catch(() => {});
    return result;
  }

  async _replace(serialized) {
    const temp = `${this.statePath}.${process.pid}.${this.tempIdFactory()}.tmp`;
    let handle;
    try {
      await this.fs.mkdir(path.dirname(this.statePath), { recursive: true });
      handle = await this.fs.open(temp, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await this.fs.rename(temp, this.statePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await this.fs.unlink(temp).catch(() => {});
      const friendly = new Error('Renew could not save your library. Check that its app data folder is writable and that your disk has space.');
      friendly.cause = error;
      throw friendly;
    }
  }
}

module.exports = { LibraryStore, canonicalPath, validateDocument, DEFAULT_SETTINGS, SYSTEMS,
  ART, pathApi, absolutePath, assertKeys, validString };
