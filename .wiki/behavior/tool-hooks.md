---
type: behavior
title: Tool hook behavior
description: Which mutation tools are intercepted, when the comment checker runs, and how warnings are surfaced back to the LLM.
tags: [behavior, hooks, tool_call, tool_result, write, edit, multiedit, apply_patch]
---

# Tool hook behavior

The extension registers two extension hooks: `tool_call` and `tool_result`. It only pays attention to file-mutation tools. Other tools pass through unchanged.

## Intercepted tools

| Tool | Pre-exec check (`tool_call`) | Post-exec check (`tool_result`) |
|------|-----------------------------|--------------------------------|
| `write` | yes | yes |
| `edit` | yes | yes |
| `multiedit` / `multi_edit` | no | yes |
| `apply_patch` | no | yes |
| omp `edit` (any mode: `hashline`, `patch`, `replace`, `apply_patch`) | no | yes, via `details.perFileResults` |

Pre-exec checks can only block `write` and `edit` because their inputs are self-contained (`filePath`, `content` or `oldString`/`newString`). Patch and multi-edit inputs are either too large to pre-validate or require the tool result before the final text is known.

## Pre-exec blocking (`tool_call`)

For `write` and `edit` only:

1. The extension resolves the comment-checker binary.
2. If the binary is missing, the tool call proceeds unchanged.
3. If the input contains `skipCommentCheck: true`, the check is skipped for that call.
4. The checker runs against the proposed content.
5. Empty warning messages are ignored.
6. On exit code `2` (warning), the call is blocked and a `reason` is returned.

The host aborts the tool call before the file is written. The rejection reason is fed back to the LLM so it can self-correct on the next turn. The reason explicitly names the blocked tool, the file path, states that the file was NOT modified, and shows the checker warning plus the override hint:

```text
omp-comment-checker blocked the write for src/example.ts; the file was NOT modified.
Reason: <checker warning>

To override for this call, re-run the tool with `skipCommentCheck: true` in its input.
```

When a single call would produce warnings for multiple files, the reason lists each file with its tool name and warning:

```text
omp-comment-checker blocked 2 file(s); none were modified:
• src/a.ts (write): <checker warning>
• src/b.ts (edit): <checker warning>

To override for this call, re-run the tool with `skipCommentCheck: true` in its input.
```

```ts
return {
  block: true,
  reason:
    "omp-comment-checker blocked the write for src/example.ts; the file was NOT modified.\n" +
    "Reason: <checker warning>\n" +
    "\n" +
    "To override for this call, re-run the tool with `skipCommentCheck: true` in its input.",
};
```

## Post-exec result mutation (`tool_result`)

For all intercepted tools:

1. The extension extracts the affected files and final text from the tool result.
2. If the result is already marked `isError` or its text looks like a tool failure (e.g. text starting with "error" or containing "error:", "failed to", or "could not"), the check is skipped.
3. The checker runs against that text.
4. Empty warning messages are ignored.
5. On exit code `2`, each warning message is appended to the result content and `isError` is set to `true`.

```ts
return {
  content: [
    ...event.content,
    ...outcome.warnings.map((w) => ({ type: "text" as const, text: `\n\n${w.message}` })),
  ],
  isError: true,
};
```

This makes the tool result look like a failure, forcing the LLM to react even though the file was already mutated.

## Opt-out

Pass `skipCommentCheck: true` in the tool input to bypass the comment check for that call. Both the pre-exec (`tool_call`) and post-exec (`tool_result`) checks honor this flag. Post-exec checks are also skipped when the result is already marked `isError` or its text looks like a tool failure.

## `session_compact` re-injection

When post-exec produces a warning, the `onWarning` callback persists it to the session. On the next `session_compact` event, all unfired warnings are summarized and sent to the LLM via `backend.sendMessage(..., { triggerTurn: false })`, then marked as fired. See [Self-heal loop](self-heal.md) for full details.

## Checker exit-code handling

| Exit code | Meaning | Effect |
|-----------|---------|--------|
| `0` | pass | no change to tool result |
| `2` | warning | block pre-exec, or mark post-exec result as an error |
| other / missing | error / missing | leave output unchanged, no self-heal entry |

If the binary is missing or exits unexpectedly, the extension leaves the tool output untouched. This avoids false-positive tool failures. Process output is bounded at 64 KiB and killed after 30 seconds; timeout output is surfaced as the failure reason so the host can react. When a post-exec check does produce a warning, the checker warning is appended as plain text to the existing tool result content and `isError` is set to `true`; the same happens for each additional warning in multi-file calls.
