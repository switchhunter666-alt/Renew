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

- JavaScript syntax and full service/security/model/DOM suite: **140 passed, 0 failed, 0 skipped**.
- Focused actual-frontend control suite: **71 passed, 0 failed**.
- All five filtered-selection regressions were integrated, including zero matches and pending/running launch guards.
- Six console-settings regressions cover category state, keyboard navigation, responsive orientation, pending-operation locking/dismissal, failed-write rollback, and later dialogs clearing settings-only styling.
- Historical overview-only checks were updated for the new hero/details/scene structure. The removed duplicate empty-overview import is no longer counted; remaining import entry points retain their tests. The control inventory now includes the two category tabs.
- Static review checked the source diff and corrected a long-title favorite-badge positioning issue and responsive tab-orientation mismatch.
- Original source worktrees were left untouched; integration happened in a separate snapshot.

## First integrated CI milestone

The first integrated revision `f83115a` completed [workflow run 37068724714](https://github.com/switchhunter666-alt/Renew/actions/runs/37068724714) successfully: Linux and Windows unit/DOM checks, all seven Chromium cases, Windows Electron smoke, the authored-ROM mGBA gate, and unsigned portable packaging. Its eight browser screenshots were downloaded, their archive digest checked, and actual pixels inspected. The Library and Emulator/Launch settings screenshots showed the intended art-led layout.

The native receipt reports PASS, red/blue/green frames, foreground/fullscreen handoff, normal emulator exit, restored Renew focus and 14 seconds of persisted play time. CI used synthetic PR merge `8dac4f9`, whose Git tree `152527d140d9bde4354b08bde7e25d6a7cf51af9` exactly matches the published head. Its nine source hashes match the Windows CRLF checkout of that tree. This remains a hosted-VM software-display, unsynchronized test fixture; audio, controller/input, physical-PC behavior and the packaged executable itself are excluded.

The synthetic 160-character title screenshot revealed excessive vertical wrapping. A bounded follow-up caps visible hero/cover/card-title lines while retaining full DOM/accessibility text, tooltips and the editable full name. Rendered geometry assertions now cover that case. This follow-up requires its own exact-revision CI result; the earlier green milestone is not reused as a pass for changed code.

## Local rendering and native limits

The local browser test command was attempted. The initial five cases could not start because the pinned Playwright Chromium headless executable was absent; the documented official browser installer then returned invalid/truncated archives. The installed system Chromium (154.0.8037.57) was verified and selected through a local `RENEW_TEST_CHROMIUM` override. All seven current cases still failed before rendering because Chromium’s required process-singleton Unix socket was denied (`Operation not permitted`). A reviewed execution retry with an isolated test profile had the same result. The rendered suite therefore remains unverified; these are environment startup failures rather than observed UI assertion failures.

The cloud browser also rejected the loopback preview with `net::ERR_BLOCKED_BY_CLIENT`. No alternate network route was used. Local Electron had no installed binary. Therefore:

- No local rendered browser pass or local screenshot is claimed; the CI milestone above supplies separate rendered evidence.
- The source reference art was inspected, but a design reference is not a screenshot of this implementation.
- Windows desktop smoke selectors were updated for the Library heading and Launch category. The Windows smoke, actual mGBA tests and packaging ran in the CI milestone described above; each subsequent source revision still needs its own CI gate.
- No private game content was used. The integrated source was published to the existing draft PR by a nonforce update; no PR merge occurred.

## Next validation gate

On an environment with the project’s official Playwright browser installed, run `npm run verify` and `npm run test:e2e`. The rendered suite captures library, settings, empty, zero-result, narrow-window and expanded/collapsed navigation images. Inspect these images before claiming the visual adaptation is complete. Then run the Windows smoke/native gates against the exact integrated revision; use those results rather than earlier native-only commits to assess readiness.
