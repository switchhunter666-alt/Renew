# Verification boundaries

## Evidence available before the first implementation commit

`npm run verify` passed 52 tests after an independent source review and reproduced-fault repairs. The suite covers:

- Safe argument arrays for Windows paths with spaces and metacharacters; no shell
- Missing/moved executable and ROM handling, invalid extensions and duplicate imports
- Concurrent launch guard, spawn errors, nonzero exits, exactly-once session finalization
- Atomic-write failure rollback, corrupt state preservation, capacity limits and strict close-time save retry
- Clock rollback without double-counting play time
- Sandbox/isolation configuration, trusted main-frame IPC, permission/navigation denial
- Search/filter state, title escaping, favorites, removal confirmation, settings, repeat clicks
- Interrupted dialogs, late async responses, dirty title drafts and visible pending controls
- Native ISO-date sorting and stable model behavior

Service/process tests use injected filesystem/process fixtures. Main/preload tests use a mocked Electron environment. jsdom tests exercise DOM behavior with an injected native adapter and dialog polyfill. These do **not** verify Chromium layout, native dialogs, executable validity, rendering performance, mGBA gameplay, controller support, audio, or foreground focus.

The source review also requested fail-closed handling for a missing preload bridge and stable keyboard focus after removing the originating card. Those are included in this milestone.

## Local cloud rendering limit

The supported cloud browser rejected the local preview address with `net::ERR_BLOCKED_BY_CLIENT`. That restriction was not bypassed. No locally rendered UI screenshot or Windows runtime pass was claimed. The preview server and source are available, but starting a server alone is not a visual pass.

## CI evidence

The repository workflow defines Linux + Windows unit/DOM checks, a separate Chromium visual/interaction job with screenshot artifacts, and an unsigned Windows portable packaging job. Their status must be read for the **exact commit**. Merely committing the workflow is not a pass. Browser screenshots label their content as a visual preview with fictional sample games.

## Native Windows gate: still unmeasured

On a real Windows desktop, validate all of the following before calling the launcher ready:

1. Clean install/start of the generated portable executable
2. Settings file picker cancellation, valid mGBA selection and invalid/non-mGBA selection
3. Import/reimport a lawful test ROM, including a Unicode path and a path with spaces
4. Launch mGBA, visually confirm the expected ROM is actually running, then confirm audio/input
5. Verify foreground handoff, fullscreen/windowed setting, exit return, and minimized state
6. Repeated launch clicks, Alt+Tab, crash/nonzero exit, missing/moved executable and ROM
7. Close Renew while a game is running; confirm cancel/leave-running choices and persistence
8. Restart and verify library/favorites/settings/play-time survive
9. Keyboard-only navigation, dialogs, high-DPI scaling, long titles and large library performance

Record OS version, mGBA version, exact commit, artifact hash, reproduction steps and observed result. Never promote a mock, jsdom check or headless screenshot into native gameplay proof.
