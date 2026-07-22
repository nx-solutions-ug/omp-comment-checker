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
5. On exit code `2` (warning), the call is blocked and a `reason` is returned.

The host aborts the tool call before the file is written. The rejection reason is fed back to the LLM so it can self-correct on the next turn.

```ts
return {
  block: true,
  reason: "omp-comment-checker blocked 1 file(s): ...",
};
```

## Post-exec result mutation (`tool_result`)

For all intercepted tools:

1. The extension extracts the affected files and final text from the tool result.
2. The checker runs against that text.
3. On exit code `2`, the warning message is appended to the result content and `isError` is set to `true`.

```ts
return {
  content: [
    ...event.content,
    { type: "text", text: "\n\n<checker warning>" },
  ],
  isError: true,
};
```

This makes the tool result look like a failure, forcing the LLM to react even though the file was already mutated.

## Opt-out

Pass `skipCommentCheck: true` in the tool input to bypass the pre-exec check for that call. Post-exec checks do not currently honor this flag.

## Checker exit-code handling

| Exit code | Meaning | Effect |
|-----------|---------|--------|
| `0` | pass | no change to tool result |
| `2` | warning | block pre-exec, or mark post-exec result as error |
| other / missing | error / missing | leave output unchanged, no self-heal entry |

If the binary is missing or exits unexpectedly, the extension leaves the tool output untouched. This avoids false-positive tool failures.
