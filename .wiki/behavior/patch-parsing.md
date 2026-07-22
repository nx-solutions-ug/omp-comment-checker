---
type: behavior
title: Patch and edit parsing
description: How apply_patch, multiedit, and the omp edit-tool details are translated into comment-checker inputs.
tags: [behavior, parsing, apply_patch, multiedit, edit, perFileResults, codex]
---

# Patch and edit parsing

The extension does not check raw tool inputs blindly. It normalizes each intercepted tool into one or more `CommentCheckRequest` objects, then runs the checker against the final text that will exist (or did exist) on disk.

## `write`

Directly reads `filePath`/`file_path`/`path` and `content`.

```ts
{
  sourceToolName: "write",
  toolName: "Write",
  filePath,
  toolInput: { file_path: filePath, content },
}
```

## `edit`

Directly reads `filePath`/`file_path`/`path`, `oldString`/`old_string`, and `newString`/`new_string`.

If the tool result contains `details.perFileResults` (or `details.files`), the omp edit-tool path is used instead of the top-level input. This handles `hashline`, `patch`, `replace`, and `apply_patch` modes.

```ts
{
  sourceToolName: "edit",
  toolName: "Edit",
  filePath,
  toolInput: { file_path: filePath, old_string: oldText, new_string: newText },
}
```

For `perFileResults`, `oldText` is looked up under `oldText`, `old_text`, `oldString`, or `old_string`. `newText` uses the `new*` variants. If `oldText` is empty, the request is treated as a `Write`.

## `multiedit` / `multi_edit`

Reads `filePath`/`file_path`/`path` and the `edits` array. Each edit must contain `oldString`/`old_string` and `newString`/`new_string`.

```ts
{
  sourceToolName: "multiedit",
  toolName: "MultiEdit",
  filePath,
  toolInput: {
    file_path: filePath,
    edits: [{ old_string, new_string }, ...],
  },
}
```

## `apply_patch`

`apply_patch` is the most complex case. The extension tries, in order:

1. **OMO-compatible metadata** in `details.files`, `details.result.files`, or `details.metadata.files`.
2. **Raw Codex patch** fallback from `input.input` or `input.patch`.

### OMO metadata

Each metadata item must have `filePath`/`file_path`/`path`, `before`/`old`/`oldString`/`old_string`, and `after`/`new`/`newString`/`new_string`. Optional fields include `movePath`/`move_path` and `type`/`operation`.

- `type === "delete"` is skipped.
- If `before` is empty, the request becomes a `Write` with `content = after`.
- Otherwise it becomes an `Edit` with `old_string = before` and `new_string = after`.

### Raw Codex patch

The fallback parser scans lines for:

- `*** Add File: <path>` — turns into a `Write` with all `+` lines joined as content.
- `*** Update File: <path>` — turns into an `Edit` with `-` lines as `old_string` and `+` lines as `new_string`.
- `*** Delete File: <path>` — ignored.
- `*** Move to: <path>` — updates `movePath` for the current accumulator.
- `@@` lines and `*** Begin/End Patch` markers are ignored.

The parser joins collected lines with newlines and emits a trailing newline, matching the checker binary's expected shape.

## Failure detection

Post-exec checks are skipped when the tool result already looks like a failure. `isToolFailureOutput` returns `true` for text starting with "error", containing "error:", "failed to", or "could not". This avoids piling comment warnings on top of an already-broken tool call.
