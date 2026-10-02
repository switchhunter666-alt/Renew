import { escapeHTML as esc, formatTime, selectGames, platformName, artForId } from './model.js';
import { createPreviewAPI } from './preview.js';
const previewRequested = ['http:', 'https:'].includes(window.location.protocol) && new URLSearchParams(window.location.search).get('preview') === '1';
const api = window.renewAPI || (previewRequested ? createPreviewAPI() : null);
const isPreview = Boolean(api?.preview);
const app = document.querySelector('#app');
const dialog = document.querySelector('#dialog');
const toast = document.querySelector('#toast');
let state, selectedId, busy = false, toastTimer;
let dialogGeneration = 0, dialogReturnFocus = null;
const ui = { view: 'library', system: 'all', query: '', sort: 'recent', layout: 'grid' };
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  home: '<path d="m3 10 9-7 9 7v10H4V10"/><path d="M9 21v-8h6v8"/>',
  star: '<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  settings: '<path d="m9 3 6 0 .7 3 2.5 1.4 2.8-1 3 5-2 2 0 3 2 2-3 5-2.8-1-2.5 1.4-.7 3H9l-.7-3-2.5-1.4-2.8 1-3-5 2-2v-3l-2-2 3-5 2.8 1L8.3 6z" transform="translate(2 0) scale(.8)"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  folder: '<path d="M3 7V5h7l2 3h9v12H3z"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  leaf: '<path d="M20 4C7 2 1 9 6 16s15 2 14-12Z"/><path d="m5 20 9-10"/>',
  game: '<path d="M7 8h10c3 0 5 11 2 12-2 1-4-3-4-3H9s-2 4-4 3C2 19 4 8 7 8Z"/><path d="M7 11v4m-2-2h4M16 12h.01M18 14h.01M9 8l1-4h4"/>',
  heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15Z"/>',
  warning: '<path d="m12 3 10 18H2zM12 9v5m0 3h.01"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"/>'
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.game}</svg>`; }
function artwork(game) { return `./art/${['aurora','ember','ocean','violet'].includes(game.art) ? game.art : artForId(game.id)}.svg`; }
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
function counts(system) { return state.games.filter(game => !system || game.system === system).length; }
function render() {
  const focus = document.activeElement?.dataset.focus;
  const selection = document.activeElement?.id === 'search' ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const games = selectGames(state.games, ui);
  const selected = state.games.find(game => game.id === selectedId) || games[0];
  app.innerHTML = `<aside class="sidebar">
    <a class="brand" href="#library" aria-label="Renew library"><span class="brand-mark">${icon('leaf')}</span>renew<span class="brand-dot">.</span></a>
    <div class="sidebar-section">YOUR SPACE</div>
    <nav aria-label="Main navigation">
      <button class="nav-item ${ui.view === 'library' ? 'active' : ''}" data-action="nav" data-view="library" data-focus="nav-library" aria-label="Library">${icon('grid')}<span>Library</span><span class="nav-count">${counts()}</span></button>
      <button class="nav-item ${ui.view === 'favorites' ? 'active' : ''}" data-action="nav" data-view="favorites" data-focus="nav-favorites" aria-label="Favorites">${icon('heart')}<span>Favorites</span><span class="nav-count">${state.games.filter(g => g.favorite).length}</span></button>
    </nav>
    <div class="sidebar-section systems-label">YOUR SYSTEMS</div>
    <nav aria-label="Filter by system">
      ${[['GBA','Game Boy Advance','gba'],['GBC','Game Boy Color','gbc'],['GB','Game Boy','gb']].map(([key,label,cls]) => `<button class="system-item ${ui.system === key ? 'selected' : ''}" data-action="system" data-system="${key}" data-focus="system-${key}" aria-label="${label}" aria-pressed="${ui.system === key}"><span class="system-device ${cls}"><i></i></span><span>${label}</span><span class="system-count">${counts(key)}</span></button>`).join('')}
    </nav>
    <div class="sidebar-bottom">
      <div class="local-note"><span class="status-dot"></span><div>Made for your games<small>Local library. No account needed.</small></div></div>
      <button class="nav-item" data-action="settings" data-focus="settings" aria-label="Settings">${icon('settings')}<span>Settings</span></button>
      <div class="build-label">FIRST LIGHT <span>v0.1.0</span></div>
    </div>
  </aside>
  <div class="workspace">
    <header class="topbar"><div class="breadcrumb">Your space ${icon('chevron')} <span>${ui.view === 'favorites' ? 'Favorites' : 'Library'}</span></div>
      <div class="topbar-right">${isPreview ? '<span class="preview-pill">INTERACTIVE PREVIEW</span>' : '<span class="desktop-pill">WINDOWS · mGBA</span>'}
      ${!isPreview ? `<div class="window-controls"><button data-action="window" data-command="minimize" aria-label="Minimize">${icon('minimize')}</button><button data-action="window" data-command="maximize" aria-label="Maximize or restore">${icon('maximize')}</button><button data-action="window" data-command="close" aria-label="Close Renew">${icon('close')}</button></div>` : '<span class="profile-mark" aria-label="Local library">r.</span>'}</div>
    </header>
    <main id="main">
      <section class="page-heading"><div><div class="eyebrow">GOOD GAMES. GREAT TO COME BACK TO.</div><h1>${ui.view === 'favorites' ? 'The ones you love.' : 'Your next little escape.'}</h1><p>A familiar world, one play away.</p></div><button class="button primary add-button" data-action="import" data-focus="import" ${busy ? 'disabled' : ''}>${icon('plus')} Add games</button></section>
      ${state.warning ? `<div class="notice warning" role="alert">${icon('warning')}<span>${esc(state.warning)}</span></div>` : ''}
      ${state.error ? `<div class="notice warning" role="alert">${icon('warning')}<span>${esc(state.error.message || state.error)}</span></div>` : ''}
      ${isPreview ? '<div class="preview-note">Visual preview · Original sample titles and artwork · Native gameplay is not running</div>' : ''}
      ${selected ? hero(selected) : emptyHero()}
      <section class="collection" aria-labelledby="collection-title"><div class="collection-header"><div class="section-title"><h2 id="collection-title">${ui.view === 'favorites' ? 'Your favorites' : 'Your collection'}</h2><span>${games.length} ${games.length === 1 ? 'game' : 'games'}</span></div><div class="collection-tools"><label class="search-box">${icon('search')}<input id="search" data-focus="search" type="search" placeholder="Find a game" aria-label="Find a game" value="${esc(ui.query)}"><kbd>/</kbd></label><label class="sort-label"><span class="sr-only">Sort games</span><select id="sort" data-focus="sort"><option value="recent" ${ui.sort === 'recent' ? 'selected' : ''}>Recently played</option><option value="title" ${ui.sort === 'title' ? 'selected' : ''}>Title A–Z</option><option value="played" ${ui.sort === 'played' ? 'selected' : ''}>Most played</option></select></label><div class="layout-switch" aria-label="View style"><button data-action="layout" data-layout="grid" data-focus="layout-grid" aria-label="Grid view" aria-pressed="${ui.layout === 'grid'}">${icon('grid')}</button><button data-action="layout" data-layout="list" data-focus="layout-list" aria-label="List view" aria-pressed="${ui.layout === 'list'}">${icon('list')}</button></div></div></div>
        <div class="filter-bar"><button data-action="system" data-system="all" data-focus="filter-all" class="filter-chip ${ui.system === 'all' ? 'active' : ''}" aria-pressed="${ui.system === 'all'}">All games <span>${counts()}</span></button>${['GBA','GBC','GB'].map(s => `<button data-action="system" data-system="${s}" data-focus="filter-${s}" class="filter-chip ${ui.system === s ? 'active' : ''}" aria-pressed="${ui.system === s}">${s} <span>${counts(s)}</span></button>`).join('')}<span class="library-caption">YOUR LIBRARY, YOUR PACE</span></div>
        ${games.length ? `<div class="game-grid ${ui.layout === 'list' ? 'list-layout' : ''}">${games.map(game => card(game)).join('')}</div>` : emptyCollection()}
      </section>
      <footer class="page-footer"><span>${icon('leaf')} A little less setup. A little more play.</span><div><kbd>/</kbd> Search <kbd>Esc</kbd> Close ${icon('keyboard')}</div></footer>
    </main>
  </div>`;
  if (focus) app.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus({ preventScroll: true });
  if (selection) { const input = document.querySelector('#search'); input.setSelectionRange?.(...selection); }
  bind();
}
function hero(game) {
  const session = state.session?.gameId === game.id;
  return `<section class="hero art-${game.art || artForId(game.id)}" aria-labelledby="hero-title"><img class="hero-art" src="${artwork(game)}" alt=""><div class="hero-shade"></div><div class="hero-copy"><span class="hero-kicker"><i></i>${session ? 'YOUR GAME IS RUNNING' : game.lastPlayed ? 'PICK UP A FAVORITE' : 'SOMETHING GOOD AWAITS'}</span><div class="hero-system">${esc(platformName(game.system))}${game.sample ? ' <span>· SAMPLE</span>' : ''}</div><h2 id="hero-title">${esc(game.title)}</h2><p>${session ? 'Enjoy the moment. Renew will be here when you return.' : 'Take the scenic route. Your next adventure is right here.'}</p><div class="hero-actions"><button class="button play-button" data-action="play" data-id="${esc(game.id)}" data-focus="hero-play" ${busy || state.session ? 'disabled' : ''}>${icon('play')} ${session ? 'Playing' : 'Play game'} ${!session ? '<span class="key-hint">↵</span>' : ''}</button><button class="hero-favorite ${game.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${esc(game.id)}" data-focus="hero-favorite" aria-label="${game.favorite ? 'Remove from' : 'Add to'} favorites" aria-pressed="${game.favorite}">${icon('heart')}</button></div><div class="hero-meta">${icon('clock')} ${esc(formatTime(game.playSeconds))}<span></span>${game.sample ? 'Original preview artwork' : 'Artwork by Renew'}</div></div><div class="art-caption"><span>EXPLORE A LITTLE</span><div>${icon('leaf')} RENEW ORIGINALS</div></div></section>`;
}
function emptyHero() { return `<section class="hero empty-hero"><img class="hero-art" src="./art/aurora.svg" alt=""><div class="hero-shade"></div><div class="hero-copy"><span class="hero-kicker"><i></i>A FRESH START</span><h2>A new home for<br>old favorites.</h2><p>Add the games you own. Pick your mGBA emulator.<br>Make a little time for yourself.</p><button class="button play-button" data-action="import" data-focus="empty-import" ${busy ? 'disabled' : ''}>${icon('plus')} Add your first game</button><div class="hero-meta">GBA, Game Boy Color & Game Boy</div></div><div class="art-caption"><span>EVERY ADVENTURE STARTS SOMEWHERE</span><div>${icon('leaf')} RENEW ORIGINALS</div></div></section>`; }
function card(game) { return `<article class="game-card ${selectedId === game.id ? 'selected-card' : ''}"><button class="game-art-button" data-action="select" data-id="${esc(game.id)}" data-focus="select-${esc(game.id)}" aria-label="Select ${esc(game.title)}" aria-pressed="${selectedId === game.id}"><img src="${artwork(game)}" alt="" loading="lazy"><span class="cover-system">${esc(game.system)}</span><span class="cover-wordmark">${esc(game.title)}</span><span class="cover-select">${icon(selectedId === game.id ? 'check' : 'chevron')}</span></button><div class="card-info"><div><button class="card-title" data-action="select" data-id="${esc(game.id)}" data-focus="title-${esc(game.id)}">${esc(game.title)}</button><p>${esc(formatTime(game.playSeconds))}${game.sample ? ' · Sample' : ''}</p></div><button class="card-menu" data-action="details" data-id="${esc(game.id)}" data-focus="details-${esc(game.id)}" aria-label="Details for ${esc(game.title)}">${icon('more')}</button></div>${game.favorite ? `<span class="card-favorite" aria-label="Favorite">${icon('heart')}</span>` : ''}</article>`; }
function emptyCollection() { return `<div class="empty-collection">${icon(ui.query ? 'search' : ui.view === 'favorites' ? 'heart' : 'game')}<h3>${ui.query ? 'No games found' : ui.view === 'favorites' ? 'Make room for your favorites' : ui.system !== 'all' ? 'No games for this system yet' : 'A good collection starts with one.'}</h3><p>${ui.query ? 'Try a different name or clear your filters.' : ui.view === 'favorites' ? 'Tap the heart on a game to keep it close.' : 'Add uncompressed .gba, .gbc or .gb files from your computer.'}</p>${ui.query || ui.system !== 'all' ? '<button class="button subtle" data-action="reset-filters">Clear filters</button>' : ui.view !== 'favorites' ? '<button class="button subtle" data-action="import">Add games</button>' : ''}</div>`; }
async function run(operation, success, originGeneration = null) {
  if (busy) return;
  busy = true;
  const locked = originGeneration === dialogGeneration && dialog.open
    ? [...dialog.querySelectorAll('input, select, button:not([data-close])')].filter(control => !control.disabled) : [];
  locked.forEach(control => { control.disabled = true; });
  if (locked.length) dialog.setAttribute('aria-busy', 'true');
  render();
  let succeeded = false;
  try {
    const next = await operation();
    if (next?.games) applyState(next);
    if (success) notify(success);
    succeeded = true;
  } catch (error) {
    if (originGeneration === null || (originGeneration === dialogGeneration && dialog.open)) showError(error);
    else notify(error.message || String(error));
  } finally {
    busy = false;
    locked.forEach(control => { if (control.isConnected) control.disabled = false; });
    if (originGeneration === dialogGeneration) dialog.removeAttribute('aria-busy');
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
function showDialog(content) {
  if (!dialog.open) dialogReturnFocus = document.activeElement?.dataset.focus || dialogReturnFocus;
  dialogGeneration++;
  if (dialog.open) dialog.close();
  dialog.removeAttribute('aria-busy');
  dialog.innerHTML = content;
  dialog.showModal();
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeDialog));
  return dialogGeneration;
}
function showError(error) {
  showDialog(`<div class="dialog-top"><span class="dialog-icon warning-icon">${icon('warning')}</span><button class="icon-button" data-close aria-label="Close message">${icon('close')}</button></div><div class="eyebrow">LET’S GET YOU BACK TO PLAY</div><h2 id="dialog-title">${isPreview ? 'You’re in the visual preview' : 'Something needs attention'}</h2><p class="dialog-description">${esc(error.message || error)}</p><div class="dialog-actions"><button class="button primary" data-close>Got it</button></div>`);
}
function showSettings() {
  const generation = showDialog(`<div class="dialog-top"><span class="dialog-icon">${icon('settings')}</span><button class="icon-button" data-close aria-label="Close settings">${icon('close')}</button></div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h2 id="dialog-title">A little setup. Then play.</h2><p class="dialog-description">Renew keeps your library on this computer. Your games and emulator stay exactly where you put them.</p><section class="settings-section"><div class="setting-heading"><h3>Your emulator</h3><span class="tag">mGBA</span></div><div class="emulator-path">${icon('folder')}<span>${esc(state.settings.emulatorPath || 'No emulator selected')}</span></div><button class="button subtle full-width" id="choose-emulator">${icon('folder')} Choose mGBA executable</button><p class="field-hint">Use an existing mGBA installation from mgba.io. Renew does not download or bundle emulators.</p></section><section class="settings-section"><label class="setting-row"><span><strong>Start games fullscreen</strong><small>Go straight into your game</small></span><input type="checkbox" id="fullscreen" role="switch" ${state.settings.fullscreen ? 'checked' : ''}></label><label class="setting-row"><span><strong>Come back to Renew</strong><small>Restore the launcher when mGBA exits</small></span><input type="checkbox" id="returnToLauncher" role="switch" ${state.settings.returnToLauncher ? 'checked' : ''}></label></section>${isPreview ? '<div class="notice">These preview settings last for this tab only. Native launch and Windows focus behavior are not measured here.</div><button class="text-button" id="clear-preview">Explore the empty-library state</button>' : ''}<div class="dialog-actions"><button class="button primary" data-close>Done</button></div>`);
  dialog.querySelector('#choose-emulator').addEventListener('click', async () => { const ok = await run(() => api.chooseEmulator(), null, generation); if (ok && generation === dialogGeneration && dialog.open) showSettings(); });
  for (const setting of ['fullscreen','returnToLauncher']) dialog.querySelector(`#${setting}`).addEventListener('change', async event => { const value = event.target.checked; try { applyState(await api.updateSettings({ [setting]: value })); announce('Setting saved'); } catch (error) { if (generation === dialogGeneration && dialog.open) showError(error); else notify(error.message); } });
  dialog.querySelector('#clear-preview')?.addEventListener('click', async () => { applyState(await api.clearPreview()); if (generation === dialogGeneration) closeDialog(); });
}
function showDetails(id, draft = null) {
  const game = state.games.find(item => item.id === id); if (!game) return;
  const generation = showDialog(`<div class="dialog-top"><span class="tag">${esc(platformName(game.system))}</span><button class="icon-button" data-close aria-label="Close game details">${icon('close')}</button></div><img class="detail-art" src="${artwork(game)}" alt=""><h2 id="dialog-title">${esc(game.title)}</h2><p class="dialog-description">${esc(formatTime(game.playSeconds))}${game.sample ? ' · Fictional preview title' : ''}</p><label class="field-label" for="game-title">Display name</label><input class="text-input" id="game-title" maxlength="160" value="${esc(draft?.title ?? game.title)}"><p class="field-hint">${game.sample ? 'Sample content, no ROM attached.' : `File: ${esc(game.path)}`}</p><div class="detail-actions"><button class="button subtle" id="save-title">Save name</button><button class="button subtle" id="detail-favorite">${icon('heart')} ${game.favorite ? 'Unfavorite' : 'Favorite'}</button></div><div class="remove-row"><span>Remove from library<br><small>Your original game file stays untouched</small></span><button class="text-button danger" id="remove-game">Remove</button></div>`);
  dialog.querySelector('#save-title').addEventListener('click', async () => { const title = dialog.querySelector('#game-title').value.trim(); if (!title) { dialog.querySelector('#game-title').setCustomValidity('Enter a display name.'); dialog.querySelector('#game-title').reportValidity(); return; } const ok = await run(() => api.updateGame(id,{title}), 'Game name updated', generation); if (ok && generation === dialogGeneration && dialog.open) closeDialog(); });
  dialog.querySelector('#game-title').addEventListener('input', event => event.target.setCustomValidity(''));
  dialog.querySelector('#detail-favorite').addEventListener('click', async () => { const draft = { title: dialog.querySelector('#game-title').value }; const ok = await run(() => api.updateGame(id,{favorite:!game.favorite}), null, generation); if (ok && generation === dialogGeneration && dialog.open) { showDetails(id, draft); dialog.querySelector('#detail-favorite')?.focus(); } });
  dialog.querySelector('#remove-game').addEventListener('click', () => { const confirmationGeneration = showDialog(`<div class="dialog-top"><span class="dialog-icon">${icon('folder')}</span><button class="icon-button" data-close aria-label="Cancel removal">${icon('close')}</button></div><h2 id="dialog-title">Remove ${esc(game.title)}?</h2><p class="dialog-description">This removes its library entry and play history. Your original game file will not be deleted.</p><div class="dialog-actions"><button class="button subtle" data-close>Keep game</button><button class="button danger-button" id="confirm-remove">Remove from library</button></div>`); dialog.querySelector('#confirm-remove').addEventListener('click', async () => { const ok = await run(() => api.removeGame(id),'Removed from library. Your file is safe.', confirmationGeneration); if (ok && confirmationGeneration === dialogGeneration && dialog.open) closeDialog(); }); });
}
function bind() {
  app.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const { action, id } = button.dataset;
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
  if (event.key === 'Enter' && !editing && !dialog.open && document.activeElement === document.body && selectedId) { event.preventDefault(); run(() => api.launchGame(selectedId)); }
});
api?.onSession(next => { applyState(next); if (next.error) showError(next.error); });
try {
  if (!api) throw new Error('The desktop connection did not load. Close and reopen Renew. To use the separate visual preview, open the preview server with ?preview=1.');
  applyState(await api.getState());
}
catch(error) { app.innerHTML = '<main class="fatal"><h1>Renew couldn’t open your library</h1><p id="fatal-message"></p><p>Close and reopen the app. Your original game files have not been changed.</p></main>'; document.querySelector('#fatal-message').textContent = error.message; }
