export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Not played yet';
  if (seconds < 60) return 'Less than a minute';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min played`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m played`;
}
export function selectGames(games, { query = '', system = 'all', view = 'library', sort = 'recent' } = {}) {
  const normalized = query.trim().toLocaleLowerCase();
  return games.filter(game => (view !== 'favorites' || game.favorite) && (system === 'all' || game.system === system) && game.title.toLocaleLowerCase().includes(normalized)).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sort === 'played') return (b.playSeconds || 0) - (a.playSeconds || 0) || a.title.localeCompare(b.title);
    const time = value => typeof value === 'number' ? value : (Date.parse(value) || 0);
    return time(b.lastPlayed || b.addedAt) - time(a.lastPlayed || a.addedAt) || a.title.localeCompare(b.title);
  });
}
export function platformName(system) {
  return ({ GBA: 'Game Boy Advance', GBC: 'Game Boy Color', GB: 'Game Boy' })[system] || system;
}
export function artForId(id) {
  return ['aurora', 'ember', 'ocean', 'violet'][[...String(id)].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4];
}
