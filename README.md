# Renew

**A new home for old favorites.** A focused, Windows-first mGBA launcher with a local game library, a blue/charcoal console-inspired interface, and original landscape artwork.

## First Light · v0.1.0

- Manually add uncompressed `.gba`, `.gbc`, and `.gb` files you own
- Search, filter by system, sort, choose row/list view, rename and favorite games
- Expand or collapse the navigation rail; Renew remembers this presentation choice
- Choose an existing mGBA `.exe`; launch with literal arguments and no shell
- Track the launched child process, prevent overlapping launches, and restore Renew on exit when enabled
- Store the library atomically in the app's user-data folder; preserve corrupt data and refuse unsafe writes
- Keep files in their original locations; removing an entry never deletes its ROM

No ROMs, emulator downloads, copyrighted game artwork, accounts, telemetry, streaming, or cloud-save service are bundled. The scenic artwork and fictional sample titles in the visual preview are original demonstration content.

## Run on Windows

Requires Node.js 24, npm, and your own installed [mGBA](https://mgba.io/).

```sh
npm ci
npm start
```

Open **Settings**, choose the mGBA executable, then **Add games**. Start with a legally obtained homebrew/test ROM. Use the mGBA window's own controls to exit the game. Closing Renew during gameplay asks whether to leave the emulator running; time after Renew closes is not tracked.

```sh
npm run package:win -- --publish never
```

The portable executable is created in `dist/`. It is **unsigned** in this milestone. Packaging success is not evidence of real mGBA compatibility or Windows foreground-focus behavior.

## Visual preview

```sh
npm run preview
```

Open `http://127.0.0.1:4173/?preview=1`. The preview runs the real frontend with clearly labeled sample content and a separate in-memory adapter. It cannot launch programs, verify Windows behavior, or persist a real native library. Opening without explicit preview opt-in fails clearly rather than silently substituting samples for a missing desktop bridge.

## Verify

```sh
npm run verify
npm run test:e2e
```

`verify` runs syntax, service/security tests and jsdom DOM interaction tests. The browser tests additionally require Playwright Chromium (`npx playwright install chromium`). CI runs unit/DOM checks on Linux and Windows, renders the preview in Chromium, saves screenshot/trace artifacts, and builds an unsigned Windows package. See [verification boundaries](docs/VERIFICATION.md) before interpreting results.

## Architecture

- `desktop/services.cjs`: ordered application commands and copied UI state
- `desktop/library-store.cjs`: validated, atomic local storage
- `desktop/mgba-session.cjs`: safe executable launch and process/time tracking
- `desktop/main.cjs`: Electron window, trusted IPC handlers and native dialogs
- `desktop/preload.cjs`: narrow, isolated renderer capabilities
- `src/app.js`: UI interactions and dialog lifecycle
- `src/view.js`, `src/model.js`, `src/visuals.js`: pure view/model/artwork helpers
- `src/preferences.js`: presentation-only menu preference
- `src/preview.js`: explicit visual-preview-only sample adapter
- `tests/`: regression tests; `tests/e2e/`: rendered browser interactions

Read [the handoff](docs/HANDOFF.md) for the bounded next validation steps. This is a review milestone, not a claim of production readiness.
