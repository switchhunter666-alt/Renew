const { test } = require('node:test');
const assert = require('node:assert/strict');
const home = import('../src/home.js');
const game = (id, patch = {}) => ({ id, title: id, system: 'GBA', favorite: false, playSeconds: 0, lastPlayed: null, addedAt: '2026-10-02T00:00:00.000Z', ...patch });
const ids = games => games.map(entry => entry.id);

test('Home always returns three named shelves, including an empty library', async () => {
  const { selectHomeCollections, selectHomeGames } = await home;
  assert.deepEqual(selectHomeCollections([]), [
    { id: 'recent', title: 'Recently played', games: [], total: 0 },
    { id: 'favorites', title: 'Favorites', games: [], total: 0 },
    { id: 'unplayed', title: 'Unplayed in Renew', games: [], total: 0 }
  ]);
  assert.deepEqual(selectHomeGames([]), []);
});

test('Recently played uses verified desktop and preview play timestamps, never import dates', async () => {
  const { selectHomeCollections } = await home;
  const games = [
    game('imported-today'),
    game('old-session-new-import', { lastPlayed: '2025-01-01T00:00:00.000Z' }),
    game('latest-session', { lastPlayed: '2026-10-01T00:00:00.000Z', addedAt: '2020-01-01T00:00:00.000Z' }),
    game('preview-session', { lastPlayed: 100, playSeconds: 5 }),
    game('preview-unplayed', { lastPlayed: 0 }),
    game('positive-time-unknown-session', { playSeconds: 30 })
  ];
  const [recent, , unplayed] = selectHomeCollections(games);
  assert.deepEqual(ids(recent.games), ['latest-session', 'old-session-new-import', 'preview-session']);
  assert.equal(recent.total, 3);
  assert.deepEqual(ids(unplayed.games), ['imported-today', 'preview-unplayed']);
});

test('timestamp ties, Favorites and Unplayed have deterministic title then ID order', async () => {
  const { selectHomeCollections } = await home;
  const timestamp = '2026-10-01T00:00:00.000Z';
  const played = [game('c', { title: 'Zulu' }), game('b', { title: 'Alpha' }), game('a', { title: 'Alpha' })]
    .map(entry => ({ ...entry, favorite: true, lastPlayed: timestamp }));
  for (const input of [played, [...played].reverse()]) {
    const [recent, favorites] = selectHomeCollections(input);
    assert.deepEqual(ids(recent.games), ['a', 'b', 'c']);
    assert.deepEqual(ids(favorites.games), ['a', 'b', 'c']);
  }
  const unplayed = played.map(entry => ({ ...entry, lastPlayed: null }));
  assert.deepEqual(ids(selectHomeCollections(unplayed)[2].games), ['a', 'b', 'c']);
});

test('system and case-insensitive trimmed search apply before shelf totals and caps', async () => {
  const { selectHomeCollections } = await home;
  const games = [
    game('a', { title: 'Green World', favorite: true, lastPlayed: 100 }),
    game('b', { title: 'Green Moon', system: 'GB', favorite: true, lastPlayed: 200 }),
    game('c', { title: 'Other', favorite: true }),
    game('d', { title: 'Green Grove', favorite: true })
  ];
  const [recent, favorites, unplayed] = selectHomeCollections(games, { system: 'GBA', query: ' GREEN ', limit: 1 });
  assert.deepEqual(ids(recent.games), ['a']);
  assert.deepEqual(ids(favorites.games), ['d']);
  assert.deepEqual(ids(unplayed.games), ['d']);
  assert.deepEqual([recent.total, favorites.total, unplayed.total], [1, 2, 1]);
  assert.ok(selectHomeCollections(games, { query: 'missing' }).every(shelf => shelf.total === 0 && shelf.games.length === 0));
});

test('every shelf is capped independently and flattened selection contains only visible unique games', async () => {
  const { selectHomeCollections, selectHomeGames } = await home;
  const games = Array.from({ length: 8 }, (_, index) => game(`game-${index}`, { favorite: true, lastPlayed: 100 - index }));
  const [recent, favorites, unplayed] = selectHomeCollections(games);
  assert.deepEqual([recent.games.length, favorites.games.length, unplayed.games.length], [6, 6, 0]);
  assert.deepEqual([recent.total, favorites.total, unplayed.total], [8, 8, 0]);
  assert.deepEqual(ids(selectHomeGames(games)), games.slice(0, 6).map(entry => entry.id));
  assert.ok(!selectHomeGames(games).some(entry => entry.id === 'game-6'));
  assert.deepEqual(ids(selectHomeGames(games, { limit: 2 })), ['game-0', 'game-1']);
  assert.equal(selectHomeCollections(games, { limit: Number.MAX_SAFE_INTEGER })[0].games.length, 8);
  assert.equal(selectHomeGames(games, { limit: Number.MAX_SAFE_INTEGER }).length, 8);
  assert.equal(selectHomeCollections(games, { limit: 0 })[0].total, 8);
  assert.deepEqual(selectHomeGames(games, { limit: 0 }), []);
  assert.deepEqual(selectHomeGames(games, { limit: -1 }), []);
  assert.equal(selectHomeGames(games, { limit: 2.9 }).length, 2);
  for (const limit of [NaN, Infinity, -Infinity, '2', null]) assert.equal(selectHomeGames(games, { limit }).length, 6);
});

test('flattening keeps shelf order and includes a game visible in a later shelf', async () => {
  const { selectHomeGames } = await home;
  const games = [
    game('recent', { lastPlayed: 100, favorite: true }),
    game('favorite', { favorite: true, playSeconds: 30 }),
    game('unplayed')
  ];
  assert.deepEqual(ids(selectHomeGames(games)), ['recent', 'favorite', 'unplayed']);
});

test('malformed dates are neither Recent nor mislabeled Unplayed', async () => {
  const { selectHomeCollections } = await home;
  const invalid = ['not-a-date', '1', '2026-02-30T12:00:00.000Z', '2025-02-29T12:00:00Z', '2026-13-01T00:00:00Z',
    '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00+01:60', '2026-01-01', NaN, Infinity, -Infinity, Number.MAX_VALUE, {}, [], true];
  const games = invalid.map((lastPlayed, index) => game(String(index), { lastPlayed }));
  const [recent, , unplayed] = selectHomeCollections(games);
  assert.equal(recent.total, 0);
  assert.equal(unplayed.total, 0);
});

test('valid leap-day, timezone and millisecond timestamps are compared by actual time', async () => {
  const { selectHomeCollections } = await home;
  const games = [
    game('z-leap', { lastPlayed: '2024-02-29T00:00:00Z' }),
    game('b-utc', { title: 'Same', lastPlayed: '2026-10-01T12:30:00.000Z' }),
    game('a-offset', { title: 'Same', lastPlayed: '2026-10-01T14:30:00+02:00' }),
    game('c-numeric', { title: 'Same', lastPlayed: Date.parse('2026-10-01T12:30:00.000Z') })
  ];
  assert.deepEqual(ids(selectHomeCollections(games)[0].games), ['a-offset', 'b-utc', 'c-numeric', 'z-leap']);
});

test('Unplayed excludes positive finite history even when its timestamp is missing or invalid', async () => {
  const { selectHomeCollections } = await home;
  const games = [
    game('none', { lastPlayed: undefined, playSeconds: undefined }),
    game('zero-preview', { lastPlayed: 0 }),
    game('blank', { lastPlayed: '' }),
    game('played-null', { playSeconds: 1 }),
    game('played-undefined', { lastPlayed: undefined, playSeconds: 0.5 }),
    game('played-invalid', { lastPlayed: 'invalid', playSeconds: 30 }),
    game('played-zero', { lastPlayed: 0, playSeconds: 10 }),
    game('recorded-short-session', { lastPlayed: 100, playSeconds: 0 })
  ];
  assert.deepEqual(ids(selectHomeCollections(games)[2].games), ['blank', 'none', 'zero-preview']);
  for (const playSeconds of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(ids(selectHomeCollections([game('nonfinite', { playSeconds })])[2].games), ['nonfinite']);
  }
});

test('all current session statuses exclude the session game from Unplayed without altering favorites', async () => {
  const { selectHomeCollections } = await home;
  const games = [game('active', { favorite: true }), game('untouched')];
  for (const status of ['pending', 'launching', 'paused', 'running', 'unknown', undefined]) {
    const [, favorites, unplayed] = selectHomeCollections(games, { session: { gameId: 'active', status } });
    assert.deepEqual(ids(favorites.games), ['active']);
    assert.deepEqual(ids(unplayed.games), ['untouched']);
  }
  assert.equal(selectHomeCollections(games, { session: { gameId: 'another' } })[2].total, 2);
});

test('Favorites reflect boolean state, independent of whether play history is known', async () => {
  const { selectHomeCollections } = await home;
  const games = [game('favorite', { favorite: true, playSeconds: 30 }), game('false'), game('bad', { favorite: 'false' })];
  assert.deepEqual(ids(selectHomeCollections(games)[1].games), ['favorite']);
});

test('Home selectors do not mutate game state, session, options or the input array', async () => {
  const { selectHomeCollections, selectHomeGames } = await home;
  const games = Object.freeze([
    Object.freeze(game('b', { lastPlayed: 100, favorite: true })),
    Object.freeze(game('a', { lastPlayed: 100, favorite: true })),
    Object.freeze(game('unplayed'))
  ]);
  const session = Object.freeze({ gameId: 'b', status: 'running' });
  const options = Object.freeze({ session, system: 'all', query: '', limit: 6 });
  const before = structuredClone({ games, options });
  const shelves = selectHomeCollections(games, options);
  const visible = selectHomeGames(games, options);
  assert.deepEqual({ games, options }, before);
  assert.equal(shelves[0].games[0], games[1]);
  assert.equal(visible[0], games[1]);
  shelves[0].games.pop();
  assert.equal(selectHomeCollections(games, options)[0].games.length, 2);
  assert.equal(games.length, 3);
});
