# Art-led console integration

Local integration prepared on 2026-10-02 and applied cleanly to verified native-recovery baseline `99fd214`, preserving its three native-test/document changes and the previously approved robot-greenhouse composition. The initial UI adaptation came from source baseline `67d12a1`. This document distinguishes source/DOM validation from rendered and Windows results.

## Changes

- Full-bleed original orchard artwork, restrained blue actions, a cinematic selected-game area and horizontal cover shelf.
- Collapsible navigation with persistent presentation-only preference; search, platform filters, favorites, sort, list view, import, details and window controls remain available.
- Settings use a category rail for the two existing groups: Emulator and Launch. Large descriptive launch rows retain only the existing fullscreen and return-to-launcher preferences. Choosing an emulator retains the existing picker/API contract.
- Category navigation supports click, arrow keys, Home/End, correct panel visibility and responsive ARIA orientation. Close/Done/Escape keep the existing dialog lifecycle and return-focus behavior.
- Filtered selection is reconciled before rendering. The selected card, hero, scene artwork, Details, Play and body-level Enter agree. A zero-result view has no selected-game Play action; resetting filters selects a visible game.
- The preview uses the fictional title “The Last Orchard” and the approved original art. Desktop still starts with an empty real library. No ROM or emulator is included.

No runtime backend, IPC, persistence, native process launch or package configuration changed. No networking, overlay or theme system was added. The browser test configuration explicitly starts a separate headless server on `PORT` (default 4173) and does not reuse another running preview.

## Validation

- JavaScript syntax and full service/security/model/DOM suite: **139 passed, 0 failed, 0 skipped**.
- Focused actual-frontend control suite: **70 passed, 0 failed**.
- All five filtered-selection regressions were integrated, including zero matches and pending/running launch guards.
- Six console-settings regressions cover category state, keyboard navigation, responsive orientation, pending-operation locking/dismissal, failed-write rollback, and later dialogs clearing settings-only styling.
- Historical overview-only checks were updated for the new hero/details/scene structure. The removed duplicate empty-overview import is no longer counted; remaining import entry points retain their tests. The control inventory now includes the two category tabs.
- Static review checked the source diff and corrected a long-title favorite-badge positioning issue and responsive tab-orientation mismatch.
- Original source worktrees were left untouched; integration happened in a separate snapshot.

## Rendering and native limits

The local browser test command was attempted. The initial five cases could not start because the pinned Playwright Chromium headless executable was absent; the documented official browser installer then returned invalid/truncated archives. The installed system Chromium (154.0.8037.57) was verified and selected through a local `RENEW_TEST_CHROMIUM` override. All seven current cases still failed before rendering because Chromium’s required process-singleton Unix socket was denied (`Operation not permitted`). A reviewed execution retry with an isolated test profile had the same result. The rendered suite therefore remains unverified; these are environment startup failures rather than observed UI assertion failures.

The cloud browser also rejected the loopback preview with `net::ERR_BLOCKED_BY_CLIENT`. No alternate network route was used. Local Electron had no installed binary. Therefore:

- No rendered browser pass, screenshot, pixel-fidelity assessment or visual hit-target verification is claimed.
- The source reference art was inspected, but a design reference is not a screenshot of this implementation.
- Windows desktop smoke selectors were updated for the Library heading and Launch category. The Windows smoke, actual mGBA tests, packaging and CI were **not run against this snapshot**.
- No private game content was used, and no source publication or merge occurred during this integration.

## Next validation gate

On an environment with the project’s official Playwright browser installed, run `npm run verify` and `npm run test:e2e`. The rendered suite captures library, settings, empty, zero-result, narrow-window and expanded/collapsed navigation images. Inspect these images before claiming the visual adaptation is complete. Then run the Windows smoke/native gates against the exact integrated revision; use those results rather than earlier native-only commits to assess readiness.
