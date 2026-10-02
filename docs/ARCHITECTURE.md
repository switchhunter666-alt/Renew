# Renew architecture

Renew has one desktop application, one supported emulator, and a narrow renderer API. The modules below are local CommonJS modules, with no plugin framework or additional runtime dependencies.

## Desktop boundaries

| Module | Owns | Dependencies and contract |
| --- | --- | --- |
| `main.cjs` | Electron startup, the window, native pickers, sender-checked IPC, and the close confirmation | Calls `LauncherService`. A close waits for a strict checkpoint and flush; a save failure keeps the window open. It never terminates mGBA. |
| `preload.cjs` | The renderer capability boundary | Exposes the fixed `renewAPI` methods and sanitized session updates. No Node, filesystem, or general IPC API reaches the renderer. |
| `services.cjs` | Application command ordering, library edits, public state, persistence-warning priority, and window callback policy | Injects filesystem, spawn, clock, ID factory, and UI callbacks into its collaborators. Commands are queued so edits and session results cannot overwrite each other. Existing public API and exported validation helpers are preserved. |
| `library-store.cjs` | Saved schema, shared path/type rules, read protection, and atomic file replacement | `LibraryStore` accepts a state-file path, filesystem, platform, and temporary-ID factory. `load()` validates saved data; unreadable data blocks writes. `write({games, settings})` snapshots and serializes writes, enforces the 10 MiB UTF-8 limit before writing, and replaces through a synced temporary file. Runtime session/error state is not persisted. |
| `mgba-session.cjs` | Executable/ROM resolution, fixed mGBA arguments, single-process lifecycle, and elapsed-time deltas | `MGBASession` accepts filesystem, spawn, platform, clock, and three synchronous callbacks: starting, running, finished. It reports game IDs, timestamps, elapsed deltas, and actionable errors. It does not edit library records, persist files, control windows, or kill processes. It imports only shared schema/path helpers from `library-store.cjs`. |

## State flow

1. The renderer requests an allowed action through `renewAPI`
2. `main.cjs` verifies the calling frame and invokes the service
3. The service queues the command and delegates file storage or emulator work
4. Session callbacks immediately enqueue application updates in that same command queue
5. The service returns or publishes a copied state object

The service retains unsaved session data in memory if persistence fails. That warning takes priority over duplicate-import feedback. A subsequent successful write clears it. Strict checkpoint/flush prevents closing while session data remains unsaved, including after the emulator exits.

`MGBASession.checkpoint()` and its terminal result report only newly credited seconds. The internal credited total never decreases when the wall clock moves backward. A terminal process event is handled once even when Node emits both `error` and `close`.

## Verification boundaries

- `backend-modules.test.cjs` exercises storage and session contracts without Electron or the service
- `backend.test.cjs` covers the complete service behavior and data-loss regressions
- `backend-security.test.cjs` verifies the preload surface, IPC/frame checks, native-picker constraints, and safe-close orchestration
- Frontend and browser tests exercise UI behavior separately

Mocked process tests do not establish compatibility with a particular installed mGBA build or replace native Windows smoke testing.

## Frontend boundaries

- `model.js`: escaped text, sorting/filtering, display formatting
- `view.js`: pure HTML rendering from explicit state; no native calls or persistence
- `visuals.js`: local artwork selection and SVG icons
- `app.js`: event coordination, pending/disabled state, dialog lifetimes and focus restoration
- `preferences.js`: one presentation-only localStorage key for the collapsed menu; storage failure is safe and reported
- `preview.js`: explicit HTTP preview adapter, sample data and in-memory behavior, with no native program execution

The desktop bridge must exist for a file-based app load. A missing preload fails clearly instead of substituting demonstration data. All real library/executable state remains behind the narrow native API.
