import { selectGames } from './model.js';

const DEFAULT_LIMIT = 6;

function lastPlayedTime(value) {
  // The preview uses millisecond numbers, with zero meaning no play history.
  if (typeof value === 'number') {
    return value !== 0 && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  if (typeof value !== 'string') return null;
  // Desktop history is an ISO timestamp. Do not let Date.parse interpret a
  // malformed value such as "1" as a real session, or normalize February 30.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , offsetHour = '0', offsetMinute = '0'] = match;
  const leapYear = Number(year) % 4 === 0 && (Number(year) % 100 !== 0 || Number(year) % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days[Number(month) - 1] ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function hasNoRecordedLastPlayed(value) {
  return value == null || value === 0 || (typeof value === 'string' && value.trim() === '');
}

function byTitleAndId(a, b) {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * Derive Home shelves from the same game state as Library. Totals are measured
 * after system/search filters but before each shelf's limit. Returned games are
 * the original objects; neither their fields nor the input array are changed.
 */
export function selectHomeCollections(games, { system = 'all', query = '', session = null, limit = DEFAULT_LIMIT } = {}) {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : DEFAULT_LIMIT;
  const filtered = selectGames(games, { system, query, sort: 'title' });
  const recent = filtered.map(game => ({ game, time: lastPlayedTime(game.lastPlayed) }))
    .filter(entry => entry.time !== null)
    .sort((a, b) => b.time - a.time || byTitleAndId(a.game, b.game))
    .map(entry => entry.game);
  const favorites = filtered.filter(game => game.favorite === true);
  const unplayed = filtered.filter(game => game.id !== session?.gameId && hasNoRecordedLastPlayed(game.lastPlayed) &&
    !(Number.isFinite(game.playSeconds) && game.playSeconds > 0));
  return [
    { id: 'recent', title: 'Recently played', games: recent.slice(0, cap), total: recent.length },
    { id: 'favorites', title: 'Favorites', games: favorites.slice(0, cap), total: favorites.length },
    { id: 'unplayed', title: 'Unplayed in Renew', games: unplayed.slice(0, cap), total: unplayed.length }
  ];
}

/** Flatten only the visible shelf cards, in shelf order, deduplicated by ID. */
export function selectHomeGames(games, options = {}) {
  const seen = new Set();
  return selectHomeCollections(games, options).flatMap(collection => collection.games).filter(game => {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
}
