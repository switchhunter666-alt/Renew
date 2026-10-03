# Packaged Windows verification

## Original release result and candidate boundary

The exact published `v0.1.0-preview.1` portable from
`af421c2be2baa73830e254102ebb0b90188e1a99` was downloaded and run on a GitHub
Windows runner. It reproducibly failed to open its library: the sender guard
compared serialized URLs literally. Node wrote a Windows short-path tilde as
`RUNNER%7E1`; Chromium reported `RUNNER~1`. Both decoded to the identical fixed
packaged document path. The guard rejected the genuine initial IPC request.

Original evidence: runs `37084448466` (including clean repeat) and `37085014585`
(path diagnosis). Original unchanged bytes:

- ZIP: `bc7603bd37555c5017c3bc0cf8379d3d6d4b2d4e21ceafce23b9219995d9522e`
- Outer EXE: `30ff74860e7bd3808b8e09f8fb51047651f50855f7d9fa6203fd9742e9cdd1c4`
- ASAR: `dde2994d917993cabe7451c76e65370c6f6c6c6bf7558f688ea526035f838285`

The narrow correction compares the parsed, decoded path to the one exact fixed
entry path. It retains exact webContents and main-frame ownership, rejects other
files, origins, queries and fragments, and does not case-fold or broadly trust a
directory. Unit and actual main-handler regressions cover the observed spelling,
spaces, percent/hash characters, Unicode, malformed URLs and untrusted senders.

The current `Verify packaged Windows candidate` workflow builds an **unsigned
candidate from the exact checked-out commit** and records its EXE/ASAR hashes.
It does not replace or repair the original release. A newer harness or green
source test does not establish candidate success: inspect its completed receipt.
The candidate download artifact is uploaded only after the full packaged gate
passes. Candidate artifact names include the checked-out commit.

## What actually runs

The harness spawns the outer portable EXE directly and attaches through temporary
loopback-only CDP and Node-inspector ports. NSIS need not forward child stderr.
The packaged main process must be the exact wrapper child, and its
`PORTABLE_EXECUTABLE_FILE` must identify the launched outer EXE. The app must
report `app.isPackaged`, Renew `0.1.0`, Electron `44.5.1`, the expected renderer
file path and exact hashed ASAR. Packaged preload bytes are hashed and its actual
isolated API is used; Electron 44 does not expose a `preload` property in the
observed `getLastWebPreferences()` result. Isolation/security preferences remain
asserted, and renderer `require` must be absent. No source bootstrap, substitute
service or injected API responses are used.

The app is extracted beneath a test-owned path containing spaces, tilde, hash,
percent and Unicode characters. Data, emulator configuration and generated ROMs
stay in a unique temporary root. The debugger endpoints are temporary and
loopback-only; no firewall, credential or security policy changes are made.
This is instrumented packaged execution, not SmartScreen/double-click qualification.

## Bounded exercised scope

- Empty startup, supported schemaVersion 1 library data seeded **while closed**,
  Home selection/colors, Library search/no-results and system filters
- Home/Library keyboard selection without launch, invalid/valid rename,
  favorites, asserted two-item sort order, grid/list views and sidebar persistence
- Settings tab keyboard navigation, actual fullscreen/return-setting IPC,
  repeated dismissal and focus
- Power defaults, enable/reload, genuine device information, enabled Power/sidebar
  across a full portable restart, palette navigation, pick-unplayed, no-result
  search and Escape; master disable and reset isolation
- Cancel/confirm library removal while the authored ROM remains intact;
  restart persistence of library, favorite, renamed title, settings and reset
- Play launches official mGBA 0.10.5 from the packaged main process. All three
  original ROM colors must be observed with exact process/ROM identity, fullscreen
  OS foreground and minimized Renew. Graceful WM_CLOSE must produce actual exit,
  Renew foreground return, no session error and persisted play time

The logo-free original fixture is generated from
`tests/native/fixtures/renew-smoke-rom.cjs`. No commercial ROM, BIOS, personal
save, credentials or private asset is used or uploaded. The isolated mGBA copy
uses its software renderer and disables audio/video synchronization for the
bounded pixel gate. This does not establish normal audio or real-time game speed.

## Evidence, failures and remaining gaps

`artifacts/packaged/result.json` checkpoints phases and retains check flags,
source/build identity, hashes, runtime facts, foreground samples, colors and
errors. `build-receipt.json` binds candidate bytes to checkout and PR head. PNGs
show the actual packaged UI and emulator. Known prior screenshots are removed
before reruns. The workflow uploads evidence on failure and requires explicit
final `PASS`; skipped/blocked foreground execution cannot count as success.
Any forced cleanup marks the run failed. Owned wrapper-tree cleanup is bounded;
unconfirmed cleanup retains temporary data for diagnosis.

Still unrun: native file pickers, physical-PC/handheld/controller input,
audio/synchronization, default OpenGL display, commercial games, browser-download
Mark-of-the-Web/SmartScreen, high DPI and multiple monitors. Each measured check
must be reported separately from these gaps. A spawn or screenshot alone is not
acceptance evidence. No security warning is bypassed.

The same harness retains explicit released mode when `RENEW_PACKAGE_KIND` is
unset, using the original pinned hashes above. Candidate mode requires supplied
EXE and ASAR hashes from the actual build receipt. Use only an authorized isolated
Windows test machine: foreground screenshots must not capture another user's desktop.
