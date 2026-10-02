// Sample content is confined to the browser preview. Desktop starts empty.
import { artForId } from './model.js';
const demoGames = [
  { id: 'sample-verdant', title: 'The Verdant Trail', system: 'GBA', art: 'aurora', favorite: true, playSeconds: 5238 },
  { id: 'sample-solstice', title: 'Solstice Valley', system: 'GBA', art: 'ember', favorite: false, playSeconds: 2700 },
  { id: 'sample-tides', title: 'Between the Tides', system: 'GBC', art: 'ocean', favorite: true, playSeconds: 0 },
  { id: 'sample-moon', title: 'Moonlit Letters', system: 'GB', art: 'violet', favorite: false, playSeconds: 916 },
  { id: 'sample-dawn', title: 'Another Dawn', system: 'GBA', art: 'ember', favorite: false, playSeconds: 0 },
  { id: 'sample-wander', title: 'Wanderlight', system: 'GBC', art: 'aurora', favorite: false, playSeconds: 301 }
].map((game, index) => ({ ...game, path: '', addedAt: 100 - index, lastPlayed: game.playSeconds ? 100 - index : 0, sample: true }));
export function createPreviewAPI() {
  let state = { games: structuredClone(demoGames), settings: { emulatorPath: '', fullscreen: true, returnToLauncher: true }, session: null, warning: null, error: null };
  const copy = () => structuredClone(state);
  return {
    preview: true,
    getState: async () => copy(),
    chooseEmulator: async () => { throw new Error('Choose your mGBA executable in the Windows desktop app. This browser preview cannot access or run programs.'); },
    importGames: async () => new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.gba,.gbc,.gb'; input.multiple = true;
      input.addEventListener('change', () => {
        for (const file of input.files) {
          const ext = file.name.split('.').pop().toLowerCase();
          if (!['gba', 'gbc', 'gb'].includes(ext)) continue;
          if (state.games.some(game => game.path === file.name)) continue;
          const id = crypto.randomUUID();
          state.games.push({ id, title: file.name.replace(/\.[^.]+$/, ''), path: file.name, system: ext.toUpperCase(), favorite: false, playSeconds: 0, lastPlayed: 0, addedAt: Date.now(), art: artForId(id), sample: false });
        }
        resolve(copy());
      }, { once: true });
      input.addEventListener('cancel', () => resolve(copy()), { once: true });
      input.click();
    }),
    updateSettings: async patch => { state.settings = { ...state.settings, ...patch }; return copy(); },
    updateGame: async (id, patch) => { const game = state.games.find(item => item.id === id); if (!game) throw new Error('Game no longer exists.'); Object.assign(game, patch); return copy(); },
    removeGame: async id => { state.games = state.games.filter(game => game.id !== id); return copy(); },
    launchGame: async () => { throw new Error('Native launch is available in the Windows desktop app. This visual preview does not launch an emulator or measure gameplay.'); },
    onSession: () => () => {},
    windowControl: () => {},
    clearPreview: async () => { state.games = []; return copy(); }
  };
}
