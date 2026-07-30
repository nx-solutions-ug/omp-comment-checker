---
type: development
title: Extension API surface
description: The pi/omp extension API methods consumed by the extension and the shape of the events it handles.
tags: [development, api, extension, oh-my-pi, pi, hooks]
---

# Extension API surface

The extension is a default-exported function that receives the host `pi` object and registers event handlers and a slash command.

```ts
export default function ompCommentCheckerExtension(pi: unknown): void;
```

## Required host API

The extension consumes these host APIs:

| API | Purpose |
|-----|---------|
| `pi.on(event, handler)` | Subscribe to `session_start`, `tool_call`, `tool_result`, and `session_compact`. |
| `pi.registerCommand(name, spec)` | Register the `/omp-comment-checker` status command. |
| `ctx.cwd` | Resolve relative paths for the checker input. |
| `ctx.sessionManager` | Optional; supplies the session id via `getSessionId()` or `getHeader().id`. |
| `ctx.ui.notify` | Optional; used by the `/omp-comment-checker` slash command to surface status. |
| `pi.appendEntry` / `pi.sendMessage` | Optional omp-only APIs used by the self-heal path. |

The extension detects omp capabilities at runtime in `createOmpBackend(pi)`. If `appendEntry` and `sendMessage` are absent, the self-heal path is a no-op.

## Event handlers

### `tool_call`

Only `write` and `edit` are handled. The handler may return `{ block: true, reason }` to abort the tool call before execution. It also skips the check when the input contains `skipCommentCheck: true`.

### `tool_result`

Handles `write`, `edit`, `multiedit` / `multi_edit`, `apply_patch`, and omp `edit` modes via `details.perFileResults`. The handler may return mutated `content` and `isError: true`. It skips checking when the result is already marked `isError` or its text looks like a tool failure.

### `session_start`

Clears the in-memory `SelfHealStore`.

### `session_compact`

Under omp, re-injects unfired warnings through `sendMessage` with `triggerTurn: false`. The handler is registered via `backend.onSessionCompact`, which only subscribes to `session_compact` when the host supports it.

## Type definitions

The extension internally defines lightweight "like" types so it does not hard-depend on either `@oh-my-pi/pi-coding-agent` or `@mariozechner/pi-coding-agent` internal module shapes:

- `ExtensionApiLike` — the host API surface (`on`, `registerCommand`).
- `ExtensionContextLike` — `cwd`, optional `sessionManager`, and optional `ui.notify`.
- `ToolCallLike` / `ToolResultLike` — minimal tool event shapes; `ToolResultLike` also carries an optional `details` object for omp edit-tool metadata.
- `OmpPerFileEditResult` — shape extracted from `details.perFileResults` / `details.files`, with `filePath`, optional `movePath`, `oldText`, `newText`, and `success`.
- `ApplyPatchFileMetadata` — shape extracted from OMO-compatible metadata for `apply_patch`.
- `CommentCheckerHookInput` — the JSON payload sent to the native checker binary.

These types are kept minimal to avoid coupling the package back to host internals.

## Native checker contract

`cli.ts` resolves the `comment-checker` binary in two steps:

1. Call the `@code-yeongyu/comment-checker` package export `getBinaryPath()` if it exists.
2. Fall back to `node_modules/@code-yeongyu/comment-checker/bin/comment-checker` (with `.exe` on Windows).

If neither resolves, the run returns `status: "missing"` and the extension leaves the tool output unchanged.

Once resolved, `cli.ts` spawns the binary with:

```bash
comment-checker check [--prompt <custom>]
```

The optional `--prompt` argument is only used when a caller passes a custom prompt via `RunCommentCheckerOptions.customPrompt`; the extension itself does not currently pass one. The checker receives the `CommentCheckerHookInput` as JSON on stdin and exits:

- `0` — no comment problems.
- `2` — warning; stderr/stdout contains the message.
- anything else — treated as an error by the extension.

Process output is capped at `MAX_PROCESS_OUTPUT_BYTES` (64 KiB) and the process times out after `PROCESS_TIMEOUT_MS` (30 seconds). Truncation is UTF-8 aware and preserves whole characters, and a timeout reason is written to stderr even if the output limit is reached.
