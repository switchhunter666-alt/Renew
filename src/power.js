import {escapeHTML as esc} from './model.js';
import {selectHomeCollections} from './home.js';

// UI preferences only: never part of library.json, and never implicit opt-in.
export const POWER_PREFERENCE_KEY = 'renew.power.v1';
export const DEFAULT_POWER_PREFERENCES = Object.freeze({version: 1, enabled: false, commandPalette: false});
export function normalizePowerPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) return {...DEFAULT_POWER_PREFERENCES};
  return {version: 1, enabled: value.enabled === true, commandPalette: value.commandPalette === true};
}
export function readPowerPreferences(host) {
  try { return normalizePowerPreferences(JSON.parse(host.localStorage.getItem(POWER_PREFERENCE_KEY))); }
  catch { return {...DEFAULT_POWER_PREFERENCES}; }
}
export function writePowerPreferences(host, preferences) {
  try { host.localStorage.setItem(POWER_PREFERENCE_KEY, JSON.stringify(normalizePowerPreferences(preferences))); return true; }
  catch { return false; }
}
export function resetPowerPreferences(host) {
  try { host.localStorage.removeItem(POWER_PREFERENCE_KEY); return true; }
  catch { return false; }
}
export function paletteEnabled(preferences) { return preferences.enabled === true && preferences.commandPalette === true; }
export function unplayedCandidates(state) {
  return selectHomeCollections(state.games, {session: state.session, limit: state.games.length}).find(group => group.id === 'unplayed').games;
}
export function canLaunchGame(state, id, busy) { return !busy && !state.session && state.games.some(game => game.id === id); }

// A fixed command vocabulary, not a command runner. No paths or arguments enter it.
export function paletteCommands(state, busy, query = '') {
  const blocked = busy ? 'Wait for the current operation' : state.session ? 'A game is already open in mGBA' : '';
  const commands = [
    {id: 'home', label: 'Go to Home', hint: 'Navigation'},
    {id: 'library', label: 'Open Library', hint: 'Navigation'},
    {id: 'favorites', label: 'Open Favorites', hint: 'Navigation'},
    {id: 'settings', label: 'Open Settings', hint: 'Emulator and launch preferences'},
    {id: 'device', label: 'This device', hint: 'Read-only runtime information'},
    {id: 'import', label: 'Add games', hint: 'Open the existing file picker', disabled: busy, reason: busy ? blocked : ''},
    {id: 'pick-unplayed', label: 'Pick an unplayed game', hint: 'Select only · Nothing launches', disabled: busy || !unplayedCandidates(state).length, reason: busy ? blocked : !unplayedCandidates(state).length ? 'No unplayed games in Renew' : ''},
    ...[...state.games].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).map(game => ({id: `play:${game.id}`, gameId: game.id, label: `Play ${game.title}`, hint: game.system, disabled: !canLaunchGame(state, game.id, busy), reason: blocked}))
  ];
  const term = query.slice(0, 160).trim().toLocaleLowerCase();
  return commands.filter(command => !term || `${command.label} ${command.hint}`.toLocaleLowerCase().includes(term)).slice(0, 12);
}
export function renderPaletteResults(commands) {
  return commands.length ? `<ul class="palette-results" aria-label="Commands">${commands.map(command => `<li><button class="palette-command" data-power-command="${esc(command.id)}" ${command.disabled ? 'disabled' : ''}><span>${esc(command.label)}<small>${esc(command.reason || command.hint)}</small></span><span aria-hidden="true">↵</span></button></li>`).join('')}</ul>` : '<p class="palette-empty" role="status">No matching commands.</p>';
}
export const DEVICE_FIELDS = Object.freeze([
  ['runtimePlatform', 'Runtime platform', 'process.platform'],
  ['runtimeArchitecture', 'Runtime architecture', 'process.arch'],
  ['reportedSystemVersion', 'Reported system version', 'os.release()'],
  ['renewVersion', 'Renew version', 'app.getVersion()'],
  ['electronVersion', 'Electron version', 'process.versions.electron']
]);
export function renderDeviceInfo(snapshot) {
  if (snapshot?.version !== 1) return '<p class="notice warning" role="alert">Device information is unavailable. Try reading it again.</p>';
  return `<dl class="device-facts">${DEVICE_FIELDS.map(([key, label, source]) => {
    const field = snapshot[key];
    const valid = field?.status === 'reported' && typeof field.value === 'string' && field.value.length > 0 && field.value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(field.value);
    return `<div><dt>${label}<small>Source: ${source}</small></dt><dd>${valid ? esc(field.value) : 'Unavailable'}<small>${valid ? 'Reported by this runtime' : 'No runtime value available'}</small></dd></div>`;
  }).join('')}<div><dt>Hardware model<small>Source: no hardware detection</small></dt><dd>Not identified<small>Not included in this build</small></dd></div></dl><p class="field-hint">Runtime values do not identify your hardware or prove the host operating system. Compatibility layers such as Wine can report win32. This snapshot lasts only while this panel is open.</p>`;
}
