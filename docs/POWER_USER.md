# Optional Power user tools

This is a deliberately small, testable extension to Renew's Home and Library. In Settings → Power user, **Power user tools** and **Command palette** both default off. Turning the master switch off suspends the remembered palette choice. Reset turns both off and removes only the Power user preference. Library data, emulator/launch settings, and the navigation-menu choice are independent.

The versioned local preference stores two booleans, without library or device data. Missing/unknown versions, corrupt JSON, and unavailable storage fail safely. A failed write or reset is reported as session-only instead of claiming persistence. Browser preview preferences belong to that browser profile; native app preferences belong to Renew's app profile.

## Command palette

Opting into both switches reveals a named **Commands** button and enables **Ctrl+K** outside editing fields and existing dialogs. IME composition, repeat events, and unrelated modifier combinations cannot open or activate it. The search shows at most 12 matches; the complete library remains searchable. It uses native buttons with named actions, Arrow keys, Home/End, Enter and Escape.

Commands are a fixed allowlist: Home, Library, Favorites, Settings, This device, Add games, Pick an unplayed game, and Play for an existing library game. There are no scripts, shell commands, executable arguments, downloads, plugins, or power controls. Add games and Play route through the existing operations. Play checks game existence, pending work and every non-null session both when rendering and when activating; the backend remains the final validator.

**Pick an unplayed game** uses the same truthful, uncapped Home-history selector, excludes the current session, clears filters and selects a visible card in the complete Library. It never launches. Enter activation is consumed before dismissal so it cannot fall through to the body launch shortcut. Closing returns meaningful focus; asynchronous state changes reconcile or remove stale commands without re-enabling a session-blocked Play action.

## This device

The panel reads on demand through `renewAPI.getDeviceInfo()` and the same trusted-main-frame check as existing IPC. Its five fields are:

- Runtime platform: `process.platform`
- Runtime architecture: `process.arch`
- Reported system version: `os.release()`
- Renew version: `app.getVersion()`
- Electron version: `process.versions.electron`

Each value has a fixed source and reported/unavailable status. Every string is bounded to 120 characters and excludes control characters; field failures do not expose raw errors. These are runtime facts. A value such as `win32` can be reported under Wine and does not establish the physical host, brand, device model or device-specific compatibility.

Hardware model is **Not identified**. Hardware integrations are **Not included in this build**. The visual preview explicitly reports native information unavailable and never fabricates a native snapshot. No username, hostname, serial, environment, memory inventory, filesystem paths or other identifying details are collected. There is no networking. The snapshot is transient; closing, leaving the panel, disabling the master switch, or resetting it invalidates outstanding responses and clears the view. Reads are coalesced while pending and can be retried after failure.

## Module boundaries

- `src/power.js` owns pure command/eligibility selectors, versioned preference helpers and escaped fact rendering.
- `src/power-ui.js` owns only Power user dialog presentation and event handling. Its device dependency is a single read-only function. Other actions are callbacks; it has no launch, filesystem or library-write capability.
- `src/app.js` integrates those modules with the existing dialog generation, busy state, navigation and guarded launch path.
- `desktop/device-info.cjs` is an injectable read-only collector. The existing main/preload boundary adds one fixed method.

No runtime dependency, library schema, emulator-session implementation, artwork, hardware integration, network permission, or plugin system is added. The existing 980×680 native minimum remains; this is not handheld/small-screen qualification.

## Verification gates

Local source checks on the completed implementation: `npm run verify` passes **214 tests**, with no failures or skips. These include preference defaults, malformed/denied storage, reset isolation, uncapped unplayed selection, escaping, bounded matches, source text contrast, pending/session/stale command guards, focus, IME/repeat, device errors, stale responses and trusted IPC. jsdom and injected collector tests are source/contract checks, not native-device qualification.

`npm run test:e2e -- --list` discovers **14 Chromium cases** (10 existing plus 4 Power user cases). Discovery is not a browser pass. New real-browser cases exercise actual switches, reload persistence, command search and keyboard activation, preview launch errors, select-only picking, every scene palette at 980×680, reset and explicitly unavailable preview information. The known local browser restriction was not bypassed; exact-revision CI must run these and the screenshots must be inspected.

The authored Windows source-app smoke reads the **actual** sandboxed preload → trusted main endpoint and compares all five returned values against the running Electron process and OS. It writes `artifacts/native/renew-device-info.json`, including source hashes, and a screenshot of the actual runtime panel. It also checks opt-in persistence and select-only picking after restart. This is not a fixture endpoint test, a packaged-executable run, or a hardware/controller/audio test. Run it on Windows CI after authorized publication before calling this slice verified.

Existing real-mGBA CI and package-build gates remain unchanged. Successful source-app smoke or packaging does not establish that the unsigned packaged executable was exercised.
