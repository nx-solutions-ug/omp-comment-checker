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

The extension only uses three host APIs:

| Method | Purpose |
|--------|---------|
| `pi.on(event, handler)` | Subscribe to `session_start`, `tool_call`, `tool_result`, and `session_compact`. |
| `pi.registerCommand(name, spec)` | Register the `/omp-comment-checker` status command. |
| `pi` optionally exposes `appendEntry`, `sendMessage`, and `on("session_compact", ...)` for the omp self-heal path. |

The extension detects omp capabilities at runtime. If `appendEntry` / `sendMessage` / `session_compact` are absent, the self-heal path is a no-op.

## Event handlers

### `tool_call`

Only `write` and `edit` are handled. The handler may return `{ block: true, reason }` to abort the tool call before execution.

### `tool_result`

Handles `write`, `edit`, `multiedit` / `multi_edit`, `apply_patch`, and omp `edit` modes via `details.perFileResults`. The handler may return mutated `content` and `isError: true`.

### `session_start`

Clears the in-memory `SelfHealStore`.

### `session_compact`

Under omp, re-injects unfired warnings through `sendMessage` with `triggerTurn: false`.

## Type definitions

The extension internally defines lightweight "like" types so it does not hard-depend on either `@oh-my-pi/pi-coding-agent` or `@mariozechner/pi-coding-agent` internal module shapes:

- `ExtensionApiLike` — the host API surface.
- `ExtensionContextLike` — `cwd`, optional `sessionManager`, and `ui.notify`.
- `ToolCallLike` / `ToolResultLike` — minimal tool event shapes.
- `CommentCheckerHookInput` — the JSON payload sent to the native checker binary.

These types are kept minimal to avoid coupling the package back to host internals.

## Native checker contract

`cli.ts` spawns the `comment-checker` binary with:

```bash
comment-checker check [--prompt <custom>]
```

The checker receives the `CommentCheckerHookInput` as JSON on stdin and exits:

- `0` — no comment problems.
- `2` — warning; stderr/stdout contains the message.
- anything else — treated as an error by the extension.

Process output is capped at 64 KiB and the process times out after 30 seconds.
