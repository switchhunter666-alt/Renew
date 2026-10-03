# First Light handoff

## Keep the scope tight

The first milestone is a Windows/mGBA local launcher: manual add, library, settings, Play, clear errors, and return after the tracked process exits. Preserve the existing architecture until that loop is verified on Windows. No streaming, multi-PC mesh, cloud saves, emulator download manager, custom runtime or framework rewrite is needed to validate this loop.

## Immediate validation

1. Read the exact-commit CI jobs; repair reproducible failures before adding features
2. Inspect Chromium screenshot artifacts for actual layout, clipping and legibility
3. Run the unsigned Windows artifact on a real desktop using a lawful test ROM and existing mGBA installation
4. Follow the native gate in `VERIFICATION.md` and save source-bound evidence
5. Keep the pull request in draft until those limitations are understood; do not merge merely because unit tests pass

## Known deliberate limits

- Only uncompressed Game Boy family files; no archives or automatic library scan
- The emulator picker checks an existing `.exe`, not a cryptographic identity or version. The user must choose trusted mGBA. The launch error explains invalid selections; Renew never downloads executables
- One tracked emulator child per Renew instance. A wrapper executable that starts another process and exits is not supported
- No emulator process is killed when Renew closes. A confirmation explains that later play time cannot be tracked
- Session time is based on elapsed wall time with monotonic credited seconds, not active-play or foreground time
- A crash/power loss can lose the current unsaved session interval. Atomic storage prevents partial replacement but is not a backup service
- The 10 MiB persisted-library ceiling is enforced before writes; the 50,000-entry count ceiling is an additional upper bound, not a promised usable capacity
- Procedural landscape artwork is a tasteful fallback, not automatic matching box art
- Full library rerender is intentionally simple for this milestone. Profile with real libraries before choosing virtualization
- The browser preview is opt-in and in-memory, and cannot start mGBA
- Portable builds are unsigned; distribution signing and automatic updates are deferred

## Suggested later backlog, after the native gate

Assess controller navigation, tested drag/drop import, per-game artwork, recovery/export UX, and performance with measured user libraries. Implement only the next validated need; keep network and account features out of the core loop.
