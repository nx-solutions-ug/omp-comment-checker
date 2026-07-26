---
type: development
title: OMP stream log formatter
description: The .omp/stream-log.py helper that formats OMP JSONL output into human-readable CI log lines.
tags: [development, omp, ci, stream-log, jsonl, python]
---

# OMP stream log formatter

`.omp/stream-log.py` is a small Python helper used in the oh-my-pi CI workflows. It reads the JSONL stream produced by `omp -p --mode json ...` and prints a compact, human-readable log line for each event.

## Why it exists

OMP can emit events where `args` is not a dictionary or where text content is not a string (for example `null`, numbers, lists, or dicts). Issue #76 showed that the original formatter crashed with a non-zero exit code in those cases, which broke the pipeline because the pipe from `omp` stopped.

The current formatter coerces every value to a safe string before concatenation so malformed events never abort the CI run.

## Usage in workflows

Both `.github/workflows/omp.yml` and `.github/workflows/omp-ci.yml` pipe the OMP agent output through the script:

```bash
omp -p --model ollama-cloud/minimax-m3 --mode json "$(cat /tmp/omp-prompt.txt)" | python3 .omp/stream-log.py
```

## Event handling

| Event type | Output |
|---|---|
| `agent_start` | Agent started |
| `turn_start` | Increments internal turn counter |
| `tool_execution_start` | Tool name, path, command, or compact argument summary |
| `tool_execution_end` | Tool result summary, error state, or line count |
| `message_end` | Assistant message text |
| `agent_end` | Final summary with turn count and token usage |

Malformed JSON lines are skipped without aborting the stream.

## Safe coercion

The `_as_str` helper converts any JSON-decoded value into a string:

- `null` becomes `""`.
- Strings pass through unchanged.
- Lists and dicts are serialized as compact JSON.
- Numbers and other scalar types are converted with `str()`.

This coercion is applied to `text` fields inside `tool_execution_end`, `message_end`, and `agent_end`, and to `args` payloads inside `tool_execution_start`.

## Path extraction

For `read`, `write`, and `edit` tools the formatter tries to extract a display path from `args`:

1. `args.path` if it is a string.
2. `args.input.path` if `input` is a dict and `path` is a string.
3. Otherwise it falls back to a brief summary of the whole `args` payload.

If `args` itself is not a dict, the formatter still prints a tool invocation line instead of crashing.

## Tests

`test/stream-log.test.ts` drives the script as a subprocess and guards against the issue #76 regressions:

- Non-string `text` values (`null`, numbers, lists, dicts) do not crash.
- Non-dict `args` values (`string`, `null`, lists) do not crash.
- Malformed JSON lines are skipped.
- The canonical happy-path event flow still formats correctly.

Run the tests with the rest of the suite:

```bash
npm test
```
