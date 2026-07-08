# Architecture

The extension is intentionally small — five TypeScript modules with one responsibility each. This page walks through the request flow, then each module's contract and the tests that pin its behavior.

## Table of contents

- [Request flow](#request-flow)
- [Module map](#module-map)
- [src/index.ts — the entrypoint](#srcindexts--the-entrypoint)
- [src/core.ts — request extraction and apply_patch parser](#srccorets--request-extraction-and-apply_patch-parser)
- [src/cli.ts — checker process and binary resolution](#srcclits--checker-process-and-binary-resolution)
- [src/omp.ts — host detection and self-heal backend](#srcompts--host-detection-and-self-heal-backend)
- [src/self-heal.ts — per-session warning store](#srcself-healts--per-session-warning-store)
- [Test layout](#test-layout)
- [Change-oriented guidance](#change-oriented-guidance)

## Request flow

A mutation tool triggers two passes through the extension:

1. **Pre-exec (`tool_call`)** — only for `write` and `edit`. Runs the checker on the proposed content, blocks the call if the checker exits 2, and feeds the rejection reason back to the LLM.
2. **Post-exec (`tool_result`)** — for all mutation tools. Re-runs the checker against the post-mutation content (matters for `apply_patch` and omp `edit`, which can't be pre-checked), appends any warning to the tool result, sets `isError: true`, and persists the warning via `OmpBackend.appendEntry`.

Detected warnings are stored in `SelfHealStore`. On the next `session_compact` event, the extension calls `OmpBackend.sendMessage` with a summary of unfired warnings and marks them fired.

```
tool_call(write|edit) ─▶ pre-exec checker ─▶ block? ─▶ record
                                                       │
                                                       ▼
                                                SelfHealStore
                                                       ▲
tool_result ─▶ extract requests ─▶ post-exec checker ──┘
                                                       │
                                                       ▼
                                          OmpBackend.appendEntry
                                                       ▲
session_compact ─▶ unfired() ─▶ sendMessage ────────────┘
```

## Module map

| Module | Responsibility | Public exports |
| --- | --- | --- |
| [`src/index.ts`](/src/index.ts) | Extension registration, command, glue between store and backend. | `default` (the extension), `createCommentCheckerToolCallHandler`, `createCommentCheckerToolResultHandler`, `ExtensionContextLike`, `CommentCheckerHandlerDeps`, `ToolResultHandlerResult`. |
| [`src/core.ts`](/src/core.ts) | Convert `ToolCallLike` / `ToolResultLike` events into hook inputs the checker understands. | `extractCommentCheckRequests`, `extractFromOmpEditDetails`, `parseApplyPatchRequests`, `toHookInput`, `isToolFailureOutput`, and the `CommentCheckRequest` / `CheckerToolInput` / `CommentCheckerHookInput` / `OmpPerFileEditResult` types. |
| [`src/cli.ts`](/src/cli.ts) | Locate the checker binary, spawn it as a child process, bound the output, surface a structured result. | `runCommentChecker`, `resolveCommentCheckerBinary`, `spawnProcess`, `RunCommentCheckerOptions`, `CommentCheckerRunResult`, `ProcessExecutor`. |
| [`src/omp.ts`](/src/omp.ts) | Adapt the pi/omp host to a typed backend. Detects omp-only affordances. | `createOmpBackend`, `OmpBackend`, `WarningRecord`, `OMP_WARNING_ENTRY_TYPE`. |
| [`src/self-heal.ts`](/src/self-heal.ts) | Per-session in-memory map of pending warnings. | `SelfHealStore`. |

## src/index.ts — the entrypoint

The default export is `ompCommentCheckerExtension(pi)`. It:

1. Builds an `OmpBackend` and a `SelfHealStore`.
2. Defines `onWarning(warning)`, which records the warning in the store and forwards it to `backend.appendEntry(OMP_WARNING_ENTRY_TYPE, …)`.
3. Registers four `api.on(...)` handlers — `session_start`, `tool_call`, `tool_result`, `session_compact`.
4. Registers the `/omp-comment-checker` command that prints binary status + unfired count via `ctx.ui.notify`.

`createCommentCheckerToolCallHandler` and `createCommentCheckerToolResultHandler` are exported so unit tests can call them in isolation (see `test/index.test.ts`). Both take a `CommentCheckerHandlerDeps` object — `run` is an injectable checker so tests can substitute a fake; `onWarning` is the callback that records and persists each warning.

The tool_call handler short-circuits if:

- the tool is not `write` / `edit` (case-insensitive),
- the binary is missing,
- the call input contains `skipCommentCheck: true`,
- `extractCommentCheckRequests` returns no requests,
- the checker reports missing / error / zero warnings.

If the checker reports one warning, the block reason is just the warning message; multiple warnings are joined with a `omp-comment-checker blocked N file(s):` header and bullets.

The tool_result handler always appends each warning as a `text` content block and sets `isError: true`. It also early-returns when the result already has `isError: true` or when the text content looks like a tool failure (see `isToolFailureOutput` in core).

## src/core.ts — request extraction and apply_patch parser

`extractCommentCheckRequests(event)` is the central routing function. It dispatches on `event.toolName` (case-insensitive):

| `toolName` | Extraction |
| --- | --- |
| `write` | `extractWriteRequest` — requires `filePath` and `content`. |
| `edit` | If the event has result fields, `extractFromOmpEditDetails(event.details)` first (omp path). If that returns no requests, falls back to `extractEditRequest` (plain path). |
| `multiedit` / `multi_edit` | `extractMultiEditRequest` — collects `edits: [{old_string, new_string}]`. |
| `apply_patch` | `extractApplyPatchMetadataRequests` first (OMO metadata path). Falls back to `parseApplyPatchRequests(input.patch, …)`. |
| anything else | `[]`. |

The function bails out early when the event is not an object, has no `toolName`, has no `input`, is already marked `isError`, or has content text that looks like a tool failure (`error` / `error:` / `failed to` / `could not` prefix match in `isToolFailureOutput`).

`extractFromOmpEditDetails` reads either `details.perFileResults` or `details.files` (whichever the host provides). Each entry is normalized to `{filePath, oldText, newText, success, op}` and converted to one or more `CommentCheckRequest` records:

- If `oldText` is empty, op is `write` → `toolName: "Write"` with `content: newText`.
- Otherwise op is `edit` → `toolName: "Edit"` with `old_string` / `new_string`.

`parseApplyPatchRequests(patch, sourceToolName)` is a line-oriented parser for the Codex patch format. It walks `*** Begin Patch` … `*** End Patch` blocks, tracking an `ApplyPatchAccumulator` per file:

- `*** Add File: <path>` followed by `+…` lines → `toolName: "Write"`.
- `*** Update File: <path>` followed by `+…` / `-…` lines → `toolName: "Edit"` with `old_string` (joined `-` lines) and `new_string` (joined `+` lines).
- `*** Delete File:` → skipped.
- `*** Move to: <new>` inside an `update` block → renames the result.
- `@@` lines are noise from Codex hunks and are skipped.

A delete-only file produces no request; an add or update with empty content also produces no request.

The OMO metadata path in `extractApplyPatchMetadataRequests` reads `details.files` / `details.result.files` / `details.metadata.files` (the first one with content wins) and maps each file to either a `Write` (when `before` is empty) or an `Edit` (when both `before` and `after` are present). Deletes (`type === "delete"`) are skipped.

`toHookInput` wraps a `CommentCheckRequest` into the shape the checker binary expects: `{session_id, tool_name, transcript_path, cwd, hook_event_name: "PostToolUse", tool_input}`. The `transcript_path` is always `""` here — the extension runs the checker as a pre/post tool-call hook, not a real transcript-driven Claude Code hook.

## src/cli.ts — checker process and binary resolution

`runCommentChecker(input, options)` is the single entry point used by the handlers. It:

1. Resolves the binary via `options.binaryPath` → `options.resolveBinary?.()` → `resolveCommentCheckerBinary()`. If none found, returns `{status: "missing", message: …}`.
2. Builds `["check", "--prompt", <customPrompt>]` args.
3. Calls the executor (default `spawnProcess`) with `JSON.stringify(input)` on stdin.
4. Maps the exit code: `0` → `pass`, `2` → `warning`, anything else → `error`. The message is `stderr || stdout`.

`resolveCommentCheckerBinary()` tries two strategies in order:

1. **Package API** — `require("@code-yeongyu/comment-checker")` and call its `getBinaryPath()` export. Used when the package exposes the API.
2. **Direct path** — `require.resolve("@code-yeongyu/comment-checker/package.json")` and look for `bin/comment-checker` (`comment-checker.exe` on Windows) next to it. Used as a fallback.

`spawnProcess(command, args, stdin, maxOutputBytes, processTimeoutMs)` runs the child with `stdio: ["pipe", "pipe", "pipe"]`, streams stdout/stderr into bounded `OutputAccumulator`s, and resolves with `{exitCode, stdout, stderr}`. Two important guards:

- `MAX_PROCESS_OUTPUT_BYTES` (64 KiB) caps each stream. Once the cap is reached the accumulator is marked `truncated` and a `[stream truncated after N bytes]` marker is appended. `truncateUtf8Prefix` walks code points so a multi-byte UTF-8 character is never split.
- `PROCESS_TIMEOUT_MS` (30 s) kills the process with `SIGTERM`, then `SIGKILL` after 1 s. On timeout the `exitCode` resolves to `null` and a `timed out after N ms` message is written to stderr.

Both limits are configurable per call. Tests in `test/cli.test.ts` pin the truncation behavior and the timeout / non-zero-exit paths.

## src/omp.ts — host detection and self-heal backend

`createOmpBackend(pi)` probes the host and returns a typed `OmpBackend`:

- `available: boolean` — true if any of `appendEntry`, `sendMessage`, or `on` is a function.
- `appendEntry(customType, data)` — calls `api.appendEntry?.(customType, data)`.
- `sendMessage(content, options?)` — calls `api.sendMessage?.(content, options)`.
- `onSessionCompact(handler)` — registers `api.on("session_compact", handler)` and returns the cleanup function if the host provided one, else a no-op.

The host probe is intentionally permissive (any of the three methods qualifies) because different omp versions may expose only a subset. The actual error handling lives in `src/index.ts` — when the host doesn't expose `on`, `session_compact` simply never fires and the self-heal path stays local.

`OMP_WARNING_ENTRY_TYPE` is the constant `"omp-comment-checker:warning"` used as the custom entry type when persisting warnings through the session file.

## src/self-heal.ts — per-session warning store

`SelfHealStore` is a thin `Map<string, WarningRecord>` wrapper:

- `record({filePath, message, sourceToolName})` → assigns `id = crypto.randomUUID()`, `ts = Date.now()`, `fired: false`, stores and returns the record.
- `unfired()` → records with `fired === false`, sorted ascending by `ts`.
- `markFired(ids)` → flips `fired = true` for each id.
- `clear()` → empties the map (called from `session_start`).
- `size()` → current size, useful for the `/omp-comment-checker` command.

The store is in-process only — persistence to the session file is handled by `OmpBackend.appendEntry` in the `onWarning` callback.

## Test layout

| File | Pins |
| --- | --- |
| [`test/cli.test.ts`](/test/cli.test.ts) | `runCommentChecker` exit-code mapping, `spawnProcess` output truncation (single-byte and UTF-8 multibyte), timeout path. |
| [`test/core.test.ts`](/test/core.test.ts) | `extractCommentCheckRequests` for `write` / `edit` / `multiedit` / `apply_patch` (metadata + raw), `parseApplyPatchRequests` (add / update / delete / move / hunk noise), `isToolFailureOutput` short-circuits. |
| [`test/index.test.ts`](/test/index.test.ts) | `createCommentCheckerToolCallHandler` (block on pre-exec warning, pass-through on missing binary / no warnings / `skipCommentCheck`), `createCommentCheckerToolResultHandler` (append text, set `isError: true`). |
| [`test/omp.test.ts`](/test/omp.test.ts) | `SelfHealStore` (record / unfired / markFired / clear / ts ordering), `OmpBackend` (host probe, no-op when methods absent), `ompCommentCheckerExtension` registration smoke test. |

All test files use vitest with `// given / // when / // then` body comments or `#given … #when … #then` `it` titles — see `AGENTS.md` for the convention.

## Change-oriented guidance

- **Adding a new tool** to the checker coverage: extend `extractCommentCheckRequests` in `src/core.ts` with a new branch and add specs in `test/core.test.ts`. If the new tool needs pre-exec coverage, the `tool_call` handler in `src/index.ts` also needs a branch (currently it short-circuits anything that isn't `write` / `edit`).
- **Changing exit-code mapping** (e.g. a new warning level): update `runCommentChecker` in `src/cli.ts` and the corresponding `cli.test.ts` cases. Handlers do not interpret exit codes directly.
- **Adding a new omp-only affordance**: add a method to `OmpBackend` in `src/omp.ts`, probe it in `isPiHost`, and add a `omp.test.ts` case that confirms it's a no-op under plain pi.
- **Changing the warning storage shape** (`WarningRecord`): update `OMP_WARNING_ENTRY_TYPE` consumers, the `onWarning` callback in `src/index.ts`, and any tests that assert on the persisted entry payload.
- **Releasing a new version**: semver-driven; the release pipeline (see [agent-automation.md](agent-automation.md)) reads commits via `@semantic-release/commit-analyzer` and publishes to npm + GitHub releases. Update `CHANGELOG.md` is automated through the `@semantic-release/changelog` plugin in `.releaserc.json`.
