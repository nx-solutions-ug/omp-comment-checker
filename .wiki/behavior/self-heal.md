---
type: behavior
title: Self-heal loop
description: How unfired comment-checker warnings are persisted to the session and re-injected into context after the next session compaction under oh-my-pi.
tags: [behavior, self-heal, omp, session_compact, appendEntry, sendMessage]
---

# Self-heal loop

When a warning fires on a post-exec tool result, the file has already been written. The extension therefore persists the warning and re-injects it later so the LLM cannot lose track of it.

This only works under oh-my-pi. On plain pi the self-heal path is a no-op and behavior matches the upstream v0.1.0 fork.

## Lifecycle

1. **Warning detected** — `tool_result` handler finds a warning for `write`, `edit`, `multiedit`, `apply_patch`, or the omp `edit` tool.
2. **Record warning** — `SelfHealStore.record()` creates a `WarningRecord` with a random UUID and timestamp.
3. **Persist to session** — `OmpBackend.appendEntry("omp-comment-checker:warning", record)` stores the warning as a custom session entry.
4. **Session compaction** — when the host fires `session_compact`, the extension reads all unfired warnings from the store.
5. **Re-inject context** — `OmpBackend.sendMessage(..., { triggerTurn: false })` sends a custom message summarizing the unfired warnings.
6. **Mark fired** — the store marks those warnings as fired so they are not sent again.
7. **Session start** — on `session_start`, the in-memory store is cleared.

## Store semantics

`SelfHealStore` keeps warnings in a `Map<string, WarningRecord>` keyed by UUID. A warning is considered:

- **unfired** until `markFired(ids)` is called with its id.
- **cleared** on `session_start` (memory only; persisted session entries may remain on disk depending on the host).

`unfired()` returns warnings sorted by ascending timestamp, so re-injected messages stay in the order the warnings originally occurred.

## Host capability detection

`createOmpBackend(pi)` checks whether `pi` has `appendEntry`, `sendMessage`, or `on`. If none are present, `available` is `false` and every backend method is a no-op. This makes the self-heal path safe on plain pi.

## Re-injected message format

```text
omp-comment-checker self-heal: 2 warning(s) still need addressing:
• src/index.ts: avoid vague comments like "TODO"
• src/core.ts: ...
```

The message uses `triggerTurn: false` so it only adds context rather than forcing a new LLM turn immediately.
