# Released Windows preview verification

This test targets the **already released** `v0.1.0-preview.1` portable built from
`af421c2be2baa73830e254102ebb0b90188e1a99`. A newer harness commit does not imply a
newer app binary. Read the completed runtime receipt before claiming a pass.

The separate `Verify released Windows preview` workflow downloads the exact
public release asset and checks its 112,122,105-byte size and SHA-256:

- ZIP: `bc7603bd37555c5017c3bc0cf8379d3d6d4b2d4e21ceafce23b9219995d9522e`
- Portable EXE: `30ff74860e7bd3808b8e09f8fb51047651f50855f7d9fa6203fd9742e9cdd1c4`
- Running `app.asar`: `dde2994d917993cabe7451c76e65370c6f6c6c6bf7558f688ea526035f838285`

The last hash was measured from that exact release package. The harness launches
the outer portable EXE directly, then attaches Playwright to temporary
loopback-only CDP and Node inspector ports. It verifies the packaged main
process is the exact portable wrapper's child. No source entry point, bootstrap,
injected preload, or repository Electron binary is used.
`npm ci --ignore-scripts` deliberately does not install that Electron binary.
The launched app must report `app.isPackaged === true`, Renew version `0.1.0`,
Electron `44.5.1`, its real packaged renderer URL and preload path under the exact
hashed ASAR. Process path, arguments and both wrapper/main PIDs are recorded.
The NSIS wrapper need not forward child stderr; endpoint discovery uses only
these newly allocated loopback ports. Playwright attaches using debugging flags; this is instrumented packaged
execution, not an uninstrumented double-click or SmartScreen qualification.

## Bounded exercised scope

- Empty startup, genuine preload and packaged resources, then supported
  schemaVersion 1 library data seeded **while closed** in a unique temporary
  app-data directory. Native file pickers are explicitly not exercised
- Home selection and scene color, Library search/no-results, system filters,
  keyboard selection without launch, invalid/valid rename, favorites, sorting,
  grid/list views, sidebar persistence, settings tab keyboard navigation,
  actual fullscreen/return-setting IPC, repeated dismissals and focus
- Power user defaults, enable/reload, actual runtime device information,
  enabled Power/sidebar persistence across a full portable restart, command
  palette keyboard navigation, pick-unplayed without launch, no-result
  search, Escape dismissal, master-disable behavior and reset isolation
- Cancel/confirm library removal with the original authored ROM still on disk;
  restart persistence of library, favorite, renamed title, settings and reset
- Clicking Play launches official mGBA 0.10.5 from the **packaged app's** actual
  main process. All red/green/blue frames of the original logo-free test ROM must
  be seen while the exact emulator process owns OS foreground, fills the monitor
  and Renew is minimized. Graceful WM_CLOSE must result in actual emulator exit,
  Renew's exact HWND regaining foreground, no session error and saved play time

The original fixture and existing Windows probe are reused from
`tests/native/fixtures/renew-smoke-rom.cjs` and `tests/native/windows-probe.ps1`.
No commercial ROM, BIOS, personal save, credentials or private asset is used,
committed or uploaded. The isolated mGBA copy uses the documented software
renderer and disables audio/video synchronization solely for the bounded pixel
gate. It does not establish normal audio or real-time game speed.

## Evidence and exclusions

`artifacts/packaged/result.json` checkpoints every phase and retains individual
check flags, executable/resource hashes, runtime facts, foreground samples,
frame-color observations and errors. PNGs show the actual packaged UI and
emulator screen. The workflow uploads these even after failure and requires an
explicit final `PASS`; a blocked/skipped foreground test is not a green gate.
Cleanup force-kills only a test-owned emulator if necessary and marks the run
failed. Neither a spawn event nor a screenshot alone qualifies the test.

Still unrun: native file-picker interactions, physical PC/handheld/controller
input, audio/synchronization, default OpenGL display, commercial-game behavior,
user-download Mark-of-the-Web/SmartScreen, high-DPI and multi-monitor behavior.
No security warning is bypassed, and no antivirus, credentials, permissions or
system security settings are changed.

For local use, this harness is only for an authorized isolated Windows test
machine. Set `RENEW_RELEASE_EXE` to the hash-verified released outer portable and
`RENEW_MGBA_EXE` to official extracted mGBA, then run
`node --test tests/native/packaged-release.test.cjs`. Foreground screenshots must
not be collected on an unrelated user's desktop.
