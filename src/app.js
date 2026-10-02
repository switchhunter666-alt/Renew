import { escapeHTML as esc, formatTime, selectGames, platformName } from './model.js';
import { createPreviewAPI } from './preview.js';
import {renderShell} from './view.js';
import {icon, artwork} from './visuals.js';
import {readSidebarPreference, writeSidebarPreference} from './preferences.js';
const previewRequested = ['http:', 'https:'].includes(window.location.protocol) && new URLSearchParams(window.location.search).get('preview') === '1';
const api = window.renewAPI || (previewRequested ? createPreviewAPI() : null);
const isPreview = Boolean(api?.preview);
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
let state, selectedId, busy = false, toastTimer;
let dialogGeneration = 0, dialogReturnFocus = null, dialogGameId = null;
const ui = { view: 'library', system: 'all', query: '', sort: 'recent', layout: 'grid', sidebarCollapsed: readSidebarPreference(window) };
function notify(message) {
  toast.textContent = message; toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}
function announce(message) { document.querySelector('#announcer').textContent = message; }
function applyState(next) {
  state = next;
  if (!state.games.some(game => game.id === selectedId)) selectedId = state.games[0]?.id;
  render();
}
function render() {
  const visibleGames = selectGames(state.games, ui);
  if (!visibleGames.some(game => game.id === selectedId)) selectedId = visibleGames[0]?.id;
  const focus = document.activeElement?.dataset.focus;
  const rowScroll = app.querySelector('.game-grid')?.scrollLeft || 0;
  const selection = document.activeElement?.id === 'search' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  app.classList.toggle('menu-collapsed', ui.sidebarCollapsed);
  app.innerHTML = renderShell({state, ui, selectedId, busy, isPreview});
  const nextRow = app.querySelector('.game-grid');
  if (nextRow) nextRow.scrollLeft = rowScroll;
  if (focus) app.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  if (selection) { const input = document.querySelector('#search'); input.setSelectionRange?.(...selection); }
  bind();
}
function syncDialogState() {
  if (!dialog.open) return;
  dialog.querySelectorAll('input, select, button:not([data-close])').forEach(control => { control.disabled = busy; });
  if (busy) dialog.setAttribute('aria-busy', 'true'); else dialog.removeAttribute('aria-busy');
  if (!busy) {
    for (const setting of ['fullscreen', 'returnToLauncher']) {
      const control = dialog.querySelector(`#${setting}`);
      if (control) control.checked = state.settings[setting];
    }
    const game = state.games.find(entry => entry.id === dialogGameId);
    const titleField = dialog.querySelector('#game-title');
    if (game && titleField) {
      if (titleField.value === titleField.dataset.loadedTitle) titleField.value = game.title;
      titleField.dataset.loadedTitle = game.title;
      dialog.querySelector('#dialog-title').textContent = game.title;
      const favorite = dialog.querySelector('#detail-favorite');
      if (favorite) favorite.innerHTML = `${icon('heart')} ${game.favorite ? 'Unfavorite' : 'Favorite'}`;
    }
    const emulator = dialog.querySelector('.emulator-path span');
    if (emulator) emulator.textContent = state.settings.emulatorPath || 'No emulator selected';
  }
}
async function run(operation, success, originGeneration = null) {
  if (busy) return;
  busy = true;
  if (originGeneration === dialogGeneration) dialog.querySelector('[data-operation-error]')?.remove();
  syncDialogState();
  render();
  let succeeded = false;
  try {
    const next = await operation();
    if (next?.games) applyState(next);
    if (success) notify(success);
    succeeded = true;
  } catch (error) {
    if (originGeneration === null) showError(error);
    else if (originGeneration === dialogGeneration && dialog.open) {
      const feedback = document.createElement('div');
      feedback.className = 'notice warning';
      feedback.setAttribute('role', 'alert');
      feedback.dataset.operationError = 'true';
      feedback.textContent = error.message || String(error);
      dialog.append(feedback);
    } else notify(error.message || String(error));
  } finally {
    busy = false;
    syncDialogState();
    render();
  }
  return succeeded;
}
function closeDialog() {
  dialogGeneration++;
  dialog.close();
  const returnTarget = (dialogReturnFocus && app.querySelector(`[data-focus="${CSS.escape(dialogReturnFocus)}"]`)) || app.querySelector('[data-focus="import"]');
  returnTarget?.focus({ preventScroll: true });
}
function showDialog(content, kind = '') {
  if (!dialog.open) dialogReturnFocus = document.activeElement?.dataset.focus || dialogReturnFocus;
  dialogGeneration++;
  if (dialog.open) dialog.close();
  dialog.removeAttribute('aria-busy');
  dialogGameId = null;
  dialog.className = kind;
  dialog.innerHTML = content;
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeDialog));
  syncDialogState();
  return dialogGeneration;
}
function showError(error) {
  showDialog(`<div class="dialog-top"><span class="dialog-icon warning-icon">${icon('warning')}</span><button class="icon-button" data-close aria-label="Close message">${icon('close')}</button></div><div class="eyebrow">LET’S GET YOU BACK TO PLAY</div><h2 id="dialog-title">${isPreview ? 'You’re in the visual preview' : 'Something needs attention'}</h2><p class="dialog-description">${esc(error.message || error)}</p><div class="dialog-actions"><button class="button primary" data-close>Got it</button></div>`);
}
function syncSettingsOrientation() {
  const tabs = dialog.querySelector('.settings-nav');
  if (tabs) tabs.setAttribute('aria-orientation', window.innerWidth <= 600 ? 'horizontal' : 'vertical');
}
window.addEventListener('resize', syncSettingsOrientation);
function showSettings(category = 'emulator') {
  const generation = showDialog(`<header class="settings-header"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h2 id="dialog-title">Settings</h2><p>A little setup. Then play.</p></div><button class="icon-button" data-close aria-label="Close settings">${icon('close')}</button></header>
    <div class="settings-layout"><div class="settings-nav" role="tablist" aria-label="Settings categories" aria-orientation="vertical">
      <button id="settings-tab-emulator" role="tab" data-settings-tab="emulator" aria-controls="settings-panel-emulator" aria-selected="true">${icon('game')}<span>Emulator</span>${icon('chevron')}</button>
      <button id="settings-tab-launch" role="tab" data-settings-tab="launch" aria-controls="settings-panel-launch" aria-selected="false" tabindex="-1">${icon('play')}<span>Launch</span>${icon('chevron')}</button>
      <div class="settings-local">${icon('folder')}<span>Stored on this computer<small>Your games stay where they are.</small></span></div>
    </div><div class="settings-content">
      <section id="settings-panel-emulator" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-emulator"><div class="settings-section-title"><div><h3>Your emulator</h3><p>Connect your existing mGBA installation.</p></div><span class="tag">mGBA</span></div>
        <div class="emulator-setting"><div><strong>mGBA executable</strong><p>Choose the application Renew will use to open your games.</p></div><div class="emulator-picker"><div class="emulator-path">${icon('folder')}<span>${esc(state.settings.emulatorPath || 'No emulator selected')}</span></div><button class="button subtle" id="choose-emulator" aria-label="Choose mGBA executable">Browse…</button></div><p class="field-hint">Use an existing mGBA installation from mgba.io. Renew does not download or bundle emulators.</p></div>
        <div class="settings-explainer">${icon('game')}<div><strong>Made for your handheld favorites</strong><p>Game Boy Advance, Game Boy Color and Game Boy.</p></div></div>
      </section>
      <section id="settings-panel-launch" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-launch" hidden><div class="settings-section-title"><div><h3>Launch behavior</h3><p>A smooth way into your game, and back.</p></div></div>
        <label class="setting-row"><span><strong>Start games fullscreen</strong><small id="fullscreen-description">Go straight into your game</small></span><input type="checkbox" id="fullscreen" role="switch" aria-label="Start games fullscreen" aria-describedby="fullscreen-description" ${state.settings.fullscreen ? 'checked' : ''}></label>
        <label class="setting-row"><span><strong>Come back to Renew</strong><small id="return-description">Restore the launcher when mGBA exits</small></span><input type="checkbox" id="returnToLauncher" role="switch" aria-label="Come back to Renew" aria-describedby="return-description" ${state.settings.returnToLauncher ? 'checked' : ''}></label>
        <p class="field-hint">Close your game using mGBA’s own controls. Renew stays ready for your next session.</p>
      </section>
    </div></div>
    ${isPreview ? '<div class="settings-preview"><p>Preview settings last for this tab only. Native launch and Windows focus behavior are not measured here.</p><button class="text-button" id="clear-preview">Explore the empty-library state</button></div>' : ''}
    <footer class="dialog-actions settings-footer"><span>${isPreview ? 'Preview changes apply automatically' : 'Settings save automatically'}</span><button class="button primary" data-close>Done</button></footer>`, 'console-settings');
  const selectCategory = (next, focus = false) => {
    category = next;
    for (const tab of dialog.querySelectorAll('[data-settings-tab]')) {
      const selected = tab.dataset.settingsTab === category;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      dialog.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
      if (selected && focus) tab.focus();
    }
  };
  selectCategory(category);
  syncSettingsOrientation();
  for (const tab of dialog.querySelectorAll('[data-settings-tab]')) {
    tab.addEventListener('click', () => selectCategory(tab.dataset.settingsTab));
    tab.addEventListener('keydown', event => {
      const arrows = window.innerWidth <= 600 ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      if (![...arrows, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      selectCategory(event.key === 'Home' ? 'emulator' : event.key === 'End' ? 'launch' : category === 'emulator' ? 'launch' : 'emulator', true);
    });
  }
  dialog.querySelector('#choose-emulator').addEventListener('click', async () => { const ok = await run(() => api.chooseEmulator(), null, generation); if (ok && generation === dialogGeneration && dialog.open) { showSettings(category); dialog.querySelector('#choose-emulator')?.focus(); } });
  for (const setting of ['fullscreen','returnToLauncher']) dialog.querySelector(`#${setting}`).addEventListener('change', async event => { const value = event.target.checked; const ok = await run(() => api.updateSettings({ [setting]: value }), null, generation); if (ok) announce('Setting saved'); });
  dialog.querySelector('#clear-preview')?.addEventListener('click', async () => { applyState(await api.clearPreview()); if (generation === dialogGeneration) closeDialog(); });
}
function showDetails(id, draft = null) {
  const game = state.games.find(item => item.id === id); if (!game) return;
  const generation = showDialog(`<div class="dialog-top"><span class="tag">${esc(platformName(game.system))}</span><button class="icon-button" data-close aria-label="Close game details">${icon('close')}</button></div><img class="detail-art" src="${artwork(game)}" alt=""><h2 id="dialog-title">${esc(game.title)}</h2><p class="dialog-description">${esc(formatTime(game.playSeconds))}${game.sample ? ' · Fictional preview title' : ''}</p><label class="field-label" for="game-title">Display name</label><input class="text-input" id="game-title" maxlength="160" value="${esc(draft?.title ?? game.title)}"><p class="field-hint">${game.sample ? 'Sample content, no ROM attached.' : `File: ${esc(game.path)}`}</p><div class="detail-actions"><button class="button subtle" id="save-title">Save name</button><button class="button subtle" id="detail-favorite">${icon('heart')} ${game.favorite ? 'Unfavorite' : 'Favorite'}</button></div><div class="remove-row"><span>Remove from library<br><small>Your original game file stays untouched</small></span><button class="text-button danger" id="remove-game">Remove</button></div>`);
  dialogGameId = id;
  dialog.querySelector('#game-title').dataset.loadedTitle = game.title;
  dialog.querySelector('#save-title').addEventListener('click', async () => { const title = dialog.querySelector('#game-title').value.trim(); if (!title) { dialog.querySelector('#game-title').setCustomValidity('Enter a display name.'); dialog.querySelector('#game-title').reportValidity(); return; } const ok = await run(() => api.updateGame(id,{title}), 'Game name updated', generation); if (ok && generation === dialogGeneration && dialog.open) closeDialog(); });
  dialog.querySelector('#game-title').addEventListener('input', event => event.target.setCustomValidity(''));
  dialog.querySelector('#detail-favorite').addEventListener('click', async () => { const draft = { title: dialog.querySelector('#game-title').value }; const ok = await run(() => api.updateGame(id,{favorite:!state.games.find(entry => entry.id === id).favorite}), null, generation); if (ok && generation === dialogGeneration && dialog.open) { showDetails(id, draft); dialog.querySelector('#detail-favorite')?.focus(); } });
  dialog.querySelector('#remove-game').addEventListener('click', () => { const confirmationGeneration = showDialog(`<div class="dialog-top"><span class="dialog-icon">${icon('folder')}</span><button class="icon-button" data-close aria-label="Cancel removal">${icon('close')}</button></div><h2 id="dialog-title">Remove ${esc(game.title)}?</h2><p class="dialog-description">This removes its library entry and play history. Your original game file will not be deleted.</p><div class="dialog-actions"><button class="button subtle" data-close>Keep game</button><button class="button danger-button" id="confirm-remove">Remove from library</button></div>`); dialog.querySelector('#confirm-remove').addEventListener('click', async () => { const ok = await run(() => api.removeGame(id),'Removed from library. Your file is safe.', confirmationGeneration); if (ok && confirmationGeneration === dialogGeneration && dialog.open) closeDialog(); }); });
}
function bind() {
  app.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const { action, id } = button.dataset;
    if (action === 'toggle-menu') { ui.sidebarCollapsed = !ui.sidebarCollapsed; if (!writeSidebarPreference(window, ui.sidebarCollapsed)) notify('Menu changed for this session. This device could not save the preference.'); render(); }
    if (action === 'nav') { ui.view = button.dataset.view; ui.system = 'all'; ui.query = ''; render(); }
    if (action === 'system') { ui.system = ui.system === button.dataset.system && ui.system !== 'all' ? 'all' : button.dataset.system; render(); announce(`${selectGames(state.games, ui).length} games shown`); }
    if (action === 'select') { selectedId = id; render(); announce(`${state.games.find(game => game.id === id)?.title} selected`); }
    if (action === 'layout') { ui.layout = button.dataset.layout; render(); }
    if (action === 'favorite') await run(() => api.updateGame(id, { favorite: !state.games.find(game => game.id === id).favorite }));
    if (action === 'play') await run(() => api.launchGame(id));
    if (action === 'import') await run(() => api.importGames());
    if (action === 'settings') showSettings();
    if (action === 'details') showDetails(id);
    if (action === 'window') api.windowControl(button.dataset.command);
    if (action === 'reset-filters') { ui.query = ''; ui.system = 'all'; render(); }
  }));
  document.querySelector('#search').addEventListener('input', event => { ui.query = event.target.value; render(); });
  document.querySelector('#sort').addEventListener('change', event => { ui.sort = event.target.value; render(); });
  app.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); ui.view = 'library'; ui.system = 'all'; ui.query = ''; render(); });
}
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
document.addEventListener('keydown', event => {
  const editing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if (event.key === '/' && !editing && !dialog.open) { event.preventDefault(); document.querySelector('#search')?.focus(); }
  if (event.key === 'Escape' && !dialog.open && ui.query) { ui.query = ''; render(); }
  if (event.key === 'Enter' && !editing && !dialog.open && document.activeElement === document.body && selectedId && !state.session && !busy) { event.preventDefault(); run(() => api.launchGame(selectedId)); }
});
api?.onSession(next => { applyState(next); if (next.error) showError(next.error); });
try {
  if (!api) throw new Error('The desktop connection did not load. Close and reopen Renew. To use the separate visual preview, open the preview server with ?preview=1.');
  applyState(await api.getState());
}
catch(error) { app.innerHTML = '<main class="fatal"><h1>Renew couldn’t open your library</h1><p id="fatal-message"></p><p>Close and reopen the app. Your original game files have not been changed.</p></main>'; document.querySelector('#fatal-message').textContent = error.message; }
