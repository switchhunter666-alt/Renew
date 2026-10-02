# Renew control audit

Audited on 2026-10-02 against the current working-tree implementation of concept C. This is a control-behavior audit, **not a claim that every Windows interaction has been proven**. It must be rerun after source changes.

## Result and reproducible evidence

- `node --test tests/frontend-controls.test.cjs`: **60 passed, 0 failed**
- `npm run verify`: **JavaScript syntax checks passed; 128 passed, 0 failed, 0 skipped**
- Control inventory: **49 distinct visible controls/entry points** across populated, empty, filtered, Settings, details, removal, error, and preview states. Repeated game cards count once per control type; the search/name inputs and sort select count as controls. Keyboard shortcuts and native OS dialog choices are described separately.
- The inventory regression walks every `button`, `input`, `select`, and link in those generated app/dialog states. Each must match an audited entry, and every inventory selector must be encountered. Adding a new unmatched control fails the test rather than silently extending a blanket coverage claim.

Final local run completed at approximately 18:26 UTC. The tested `src/app.js` SHA-256 was `506e7230f2acfaea62efcde6c343740b445154aea5e1cd70b081f0601484a674`; `src/view.js` was `13134793c721b9c0dda330a2e1e818f1e9ab4316001d197384e25f0245174b10`. These identify the working-tree sources, not a published commit.

Evidence lives in [`tests/frontend-controls.test.cjs`](../tests/frontend-controls.test.cjs). These tests import the **actual** frontend modules, invoke their actual DOM listeners, and assert resulting state, DOM content, accessibility attributes, focus where explicitly handled, and exact API calls. Desktop API results are injected fixtures with call counters. No desktop process, OS file picker, or real game is substituted into that claim.

### Reproduced issues repaired during this audit

The initial expanded run had 6 failing regressions. All now pass:

1. The hero Favorite button stayed enabled while a mutation was pending. Repeated clicks were silently ignored by the busy guard. It now visibly disables.
2. The empty collection's Add games and empty overview's Add a game buttons stayed enabled during import. Both now disable with the other import buttons.
3. The body-level Enter shortcut dispatched another launch while a game session was already active, although Play was disabled. It now respects session and pending-operation guards.
4. Dismissing dialogs opened through quick Settings, overview Configure, and selected-game Details returned focus to Add games. Stable focus keys now restore those three originating controls.

These are application fixes verified by regressions, not native Windows or gameplay findings.

## Unique visible control inventory

“DOM + adapter” below means actual app handler and resulting DOM tested with injected desktop API responses. “Real preview code” means the in-memory browser-preview adapter was also executed, with synthetic file events where needed. Neither means a rendered/native runtime pass.

| Area | Distinct controls/entry points | Evidence and asserted outcome |
| --- | --- | --- |
| Navigation (8) | Expand/collapse menu; Renew brand link; Library; Favorites; sidebar GBA, GBC, GB; sidebar Settings | Collapse/expand state, accessible names and stored value; preference read in a fresh DOM; denied-storage feedback; navigation resets query/system; favorites composition; each sidebar system filters and toggles off; Settings opens |
| Native titlebar (3) | Minimize; Maximize or restore; Close Renew | DOM + adapter: each dispatches exactly its intended `windowControl` command. Actual OS effects remain unmeasured by this suite |
| Import placements (5) | Page-heading Add games; quick-actions Add games; empty hero Add your first game; empty collection Add games; empty selected-game panel Add a game | Each calls import once and displays returned entries; all empty-state placements disable while pending; cancellation keeps the library; repeat calls coalesce; failures are dismissible and recoverable |
| Other Settings entry points (2) | Quick-actions Settings; local-setup Configure | Open the actual Settings dialog; Done/cancel dismiss; focus returns to the originating control |
| Hero (2) | Play game; Favorite/Unfavorite heart | Selected ID is dispatched; pending and running states disable Play; session exit re-enables; failed launch shows retryable feedback; heart sends exact state patches, updates counts/pressed state, and disables while pending |
| Selected-game overview (1) | Details | Opens the selected game's actual details; dismissal restores trigger focus |
| Collection tools (9) | Search; Sort; Grid view; List view; All games; filter-chip GBA, GBC, GB; Clear filters | Search, empty-input clear, all three sort options and exact order, grid/list classes and pressed state, each chip's toggle behavior, composed Favorites filtering, and no-result recovery |
| Each game card (3) | Artwork selection; title selection; Details menu | Both selection controls update hero/overview/pressed state without launching; menu opens the correct title/path in details |
| Settings dialog (5) | Choose mGBA executable; Start games fullscreen; Come back to Renew; Close settings; Done | DOM + adapter: chosen path/cancellation; each toggle persists both directions via the exact patch; reopen displays returned values; close remains usable while busy; late completion cannot reopen a dismissed dialog; failed writes revert to persisted state and offer retry |
| Game details (5) | Display name input; Save name; Favorite/Unfavorite; Remove; Close game details | Blank-name validation and clearing validity on edit; trimming and saving; favorite preserves unsaved draft; Remove opens confirmation; Close discards unsaved edits; original suite also verifies escaped names and interrupted saves |
| Removal confirmation (3) | Cancel removal X; Keep game; Remove from library | Both cancellation controls avoid API mutation; confirmation sends only the ID, disables/coalesces repeats, removes the returned entry, and restores fallback focus if its card disappeared; error retains the game and offers retry |
| Error dialog (2) | Close message X; Got it | Import/launch/session error text is displayed; both buttons dismiss; primary import trigger focus is restored in the tested import-error flow |
| Preview-only Settings action (1) | Explore the empty-library state | Mock-adapter dispatch and real preview adapter both clear entries and close Settings; a fresh preview adapter starts its own samples again |

**Total: 49 controls/entry points.** Decorative artwork, status text, section headings, keyboard hints, card favorite badges, and the preview profile mark are not buttons and are not counted as actions.

## Keyboard, interrupted actions, and error coverage

- `/` focuses search; it does not steal focus while a dialog is open
- Search input stays focused through filtering; Escape clears the query without changing library data
- The custom Enter shortcut launches only from the document body and does not launch from editable controls, an open dialog, or an active session
- Dialog `cancel` events exercise the app's Escape handler and trigger-focus restoration. jsdom does not synthesize a browser's native Escape behavior
- The outside-click handler is tested with an explicit rectangle fixture, including an inside click that must not dismiss. Real geometry/hit testing is not measured
- Delayed launch/import/emulator/remove operations verify busy states and duplicate suppression
- Failed import/launch operations produce dismissible errors; failed Settings/emulator/removal operations remain retryable in their dialogs
- [`tests/frontend-dom.test.cjs`](../tests/frontend-dom.test.cjs) also covers delayed settings/title/favorite responses, newer-dialog protection, draft preservation, save-lock state, removal focus fallback, and markup escaping

## What ran for real, what was mocked, and what remains unmeasured

### Real code executed in this audit

- `src/app.js`, `src/view.js`, `src/model.js`, `src/preferences.js`, and their actual event handlers
- The real preview adapter for import selection/cancel, duplicate and unsupported extensions, explicit native-action error messages, and clearing/restarting samples
- jsdom's DOM/input/focus APIs and in-memory localStorage. Preference “reload” checks transfer the saved preference into a fresh DOM; this is not evidence of packaged-app persistence across OS restarts

### Explicitly mocked/synthetic

- All desktop `renewAPI` return values in the control suite, including chosen paths, imported records, settings persistence, sessions and errors
- `dialog.showModal()`/`close()` via an `open`-attribute polyfill; no Chromium top layer or modal focus trap
- File objects, file-input selection/cancel events, and outside-click rectangles
- Native command dispatch. Existing [`tests/backend-security.test.cjs`](../tests/backend-security.test.cjs) separately exercises mocked Electron IPC validation, picker filters/cancellation, and closing choices/checkpoint failures; it does not make those real OS interactions

### Not established by this audit

- Chromium/CSS rendering, actual visibility, pointer hit targets, hover behavior, screenshot fidelity, high-DPI sizing, native button Enter/Space activation, tab order, focus trapping, or the browser's built-in search-clear affordance. The equivalent empty-input event is tested
- Real OS file-picker interaction, executable validity, Windows minimize/maximize/restore/close behavior, close-confirmation UI, or screen-reader announcements
- mGBA gameplay, audio/input/controllers, foreground focus, fullscreen behavior, return-to-launcher behavior, actual timing, or large-library performance
- A new Windows smoke-test or CI result. [`tests/native/desktop-smoke.test.cjs`](../tests/native/desktop-smoke.test.cjs) is a separate gate and must be checked for the exact tested revision. Even a passing smoke test does not prove real mGBA gameplay or file-picker use

The supported cloud browser had previously blocked the local preview address. This audit did not open a browser or bypass that restriction. No new browser-rendered screenshot or native runtime pass is claimed. See [`VERIFICATION.md`](VERIFICATION.md) for the remaining native acceptance work.
