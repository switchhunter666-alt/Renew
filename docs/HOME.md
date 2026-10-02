# Personal Home

Home is the default landing view. Library remains a direct, named navigation action with the existing full search, system filter, sort, row/list, details, favorite, import and Play controls.

## Shelves and selection

- **Recently played** shows up to six games with valid recorded `lastPlayed` timestamps, newest first. Import dates never create a session or place a game in this shelf. Desktop ISO timestamps and the explicit preview's numeric timestamps are supported.
- **Favorites** shows up to six games whose favorite state is true, alphabetically.
- **Unplayed in Renew** shows up to six games with no recorded timestamp and no positive finite recorded playtime, alphabetically. Its description explicitly scopes that claim to Renew on this computer. It is not a claim about the player's history elsewhere. The active session is excluded, including its starting phase.
- Ties are stable by title and ID. Counts represent each filtered collection before the six-card cap. A game can appear in more than one shelf, with distinct focus identifiers for each copy.
- **See all** opens the complete chosen collection and keeps its system filter. Library opens the complete library. Typing in Home search opens the complete Library search, keeping the current system filter and input focus.
- A selected game must be represented by a visible shelf card or the current-session strip. A hidden seventh card cannot remain the hero or keyboard launch target. The strip keeps a just-started game selectable until recorded history arrives. On return from a successful game, its new recorded history updates Recent without fabricating playtime in the frontend.
- Positive playtime with no usable timestamp is not labeled unplayed or assigned an invented Recent position. Such games remain reachable in the full Library and Favorites when applicable.

## Appearance and keyboard

The artwork remains the repository's original local landscapes. Four restrained accent palettes follow the selected game's assigned local scene. They are authored palette choices, not extracted commercial artwork or a new artwork provider. Unknown art keys use the same deterministic, allowlisted fallback for the scene and palette. Empty selection uses a neutral accent.

Normal Tab/Enter/Space behavior remains native. Home shelf cover buttons additionally support Left/Right and Home/End to move focus without selecting or launching. Each shelf retains its horizontal scroll across rerenders. When a focused Home-only control disappears, focus moves to an equivalent card or the destination collection heading, rather than leaving the body-level Enter launch shortcut armed. Closing Details restores the exact originating shelf control when it still exists.

White-text action fills have source-calculated contrast above 4.5:1. Existing reduced-motion rules disable transitions. Rendered layout and actual native focus remain separate validation gates.

## Scope and validation

This slice changes frontend presentation/selection and tests only. Backend services, IPC, state schema, process tracking, emulator arguments, authored test ROM, Windows probe, package settings, dependencies and bundled artwork are unchanged. The native smoke test now enters Library explicitly after checking that Home booted.

Local checks against the completed slice:

- `npm run verify`: syntax plus **184 tests passed**, none failed or skipped.
- `npm run test:e2e -- --list`: all **10 browser tests** discovered; this is discovery, not a browser pass.
- New coverage includes empty groups, capped/uncapped collections, invalid or missing history, filters, duplicate-card selection/focus, independent shelf scroll, search routing, stale selected IDs, starting/paused/running session guards, return from a game, failed launch history, disappearing controls, keyboard navigation, saved settings/menu preference and palette safety/contrast.
- Three browser cases add Home, selected-scene, narrow expanded-navigation and empty-Home screenshots, plus native keyboard activation and reduced-motion checks.

This cloud environment's local browser is blocked before rendering. No browser pass, Home screenshot, Windows run, or packaged-executable execution is claimed here. Run the existing exact-revision Chromium and Windows CI gates after authorized publication, then inspect the new screenshots. Earlier green revisions are not evidence for this changed frontend.
