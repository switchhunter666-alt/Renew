import {selectGames} from './model.js';
import {selectHomeCollections, selectHomeGames} from './home.js';

// Every selected game must have a visible card, or the visible current-session
// strip. Home's capped shelves must never select a hidden seventh entry.
export function visibleGames(state, ui) {
  if (ui.view === 'home') {
    const games = selectHomeGames(state.games, {...ui, session: state.session});
    const current = sessionGame(state, ui);
    return current && !games.some(game => game.id === current.id) ? [current, ...games] : games;
  }
  if (['recent', 'unplayed'].includes(ui.view)) {
    const group = selectHomeCollections(state.games, {...ui, session: state.session, limit: Number.MAX_SAFE_INTEGER}).find(group => group.id === ui.view);
    return selectGames(group.games, {...ui, view: 'library'});
  }
  return selectGames(state.games, ui);
}

export function sessionGame(state, ui) {
  const current = state.games.find(game => game.id === state.session?.gameId);
  return current && (ui.system === 'all' || current.system === ui.system) && current.title.toLocaleLowerCase().includes(ui.query.trim().toLocaleLowerCase()) ? current : null;
}

export function viewTitle(view) {
  return ({home: 'Home', library: 'Library', favorites: 'Favorites', recent: 'Recently played', unplayed: 'Unplayed in Renew'})[view] || 'Library';
}
