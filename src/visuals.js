import { artForId } from './model.js';
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
export function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.game}</svg>`; }
export function artwork(game) {
  const name = {aurora: 'citadel-v1', ember: 'ember-v1', ocean: 'ocean-v1', violet: 'violet-v1'}[game.art || artForId(game.id)] || 'citadel-v1';
  return `./art/${name}.png`;
}
