<p align="center">
  <img src="public/banner.png" alt="omp-comment-checker — Self-Healing Comment Verification Hook for oh-my-pi" width="850" />
</p>

# omp-comment-checker

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Comment checker hook for
[oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) and the upstream
[pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).
Forked from
[`code-yeongyu/pi-comment-checker`](https://github.com/code-yeongyu/pi-comment-checker)
v0.1.0 and retargeted at the omp extension API.

Runs [`@code-yeongyu/comment-checker`](https://github.com/code-yeongyu/go-claude-code-comment-checker)
before and after every mutation tool, surfaces the warning back into the
tool result so the agent must react, and **self-heals** the warning across
the next session compaction so the LLM sees it again on the next turn.

## Why this fork

Pi and omp share the same extension shape, but omp ships two extra
capabilities this checker uses to recover from comment-detected output:

| Capability | What the checker does with it |
| --- | --- |
| `pi.appendEntry(customType, data)` | Persists each unfired warning to the session file. |
| `pi.sendMessage(content, options)` | Re-injects unresolved warnings as a custom message on `session_compact`. |

The fork detects the host at load time. If `appendEntry` / `sendMessage`
are absent (plain pi), the self-heal loop is a no-op and behavior matches
upstream 0.1.0 exactly.

## Behavior

| Case | Result |
|------|--------|
| `write` / `edit` called (pre-exec) | blocks the call when the checker flags the proposed content; the LLM sees the rejection reason and self-corrects on the next turn |
| `write` succeeds | checks the written `content` |
| `edit` succeeds | checks `oldString` / `newString` |
| `multiedit` succeeds | checks the complete `edits` payload |
| `apply_patch` succeeds with OMO metadata | checks each metadata file using `before` / `after`, skips deletes |
| `apply_patch` succeeds without metadata | falls back to raw Codex patch parsing |
| omp `edit` tool (any mode: `hashline` / `patch` / `replace` / `apply_patch`) | reads `details.perFileResults` for `oldText` / `newText` per affected file |
| checker exits `2` (post-exec) | appends the warning message to the tool result, marks the result `isError: true`, and fires the self-heal path |
| checker binary missing | leaves tool output unchanged, no self-heal, pre-exec passes through |
| checker exits unexpectedly | leaves tool output unchanged, no self-heal |

## Self-heal flow

```
1. Mutation tool (write / edit / multiedit / apply_patch) is about to run.
2. omp-comment-checker inspects the proposed content, runs the
   @code-yeongyu/comment-checker binary, exit code 2.
3. If the binary flags the content, return { block: true, reason } so
   the host aborts the tool call before the file is written. The
   rejection reason is fed back to the LLM so it can self-correct on
   the next turn.
4. If the binary passes, let the tool run. On the matching tool_result,
   re-run the checker against the post-mutation content for modes we
   could not pre-check (apply_patch, hashline). Append the warning to
   the existing tool result content AND mark isError:true so the LLM
   treats the result as a failed tool call.
5. Persist each warning via pi.appendEntry("omp-comment-checker:warning", …).
6. On the next session_compact event, re-inject any unfired warnings
   via pi.sendMessage(...) so the LLM sees them again as fresh
   context. The store is cleared on session_start.
```

The `session_compact` listener only fires under omp. Under plain pi, the
listener registration is skipped and the store is local-only.
Per-call overrides: pass `skipCommentCheck: true` in the tool input to
opt out of the pre-exec check for that call.

## Installation

The package targets both the omp extension loader and the upstream pi
extension loader.

```bash
# 1. From npm
omp install npm:@chronova/omp-comment-checker
pi  install npm:@chronova/omp-comment-checker

# 2. From git
omp install git:github:nx-solutions-ug/omp-comment-checker
pi  install git:github:nx-solutions-ug/omp-comment-checker

# 3. omp settings.json (~/.omp/settings.json)
{
  "packages": [
    "git:github:nx-solutions-ug/omp-comment-checker"
  ]
}

# 4. Dev / one-shot test
omp -e /path/to/omp-comment-checker/src/index.ts
pi  -e /path/to/omp-comment-checker/src/index.ts
```

After installation, restart the agent or run `/reload` inside an
interactive session.

## Command

### `/omp-comment-checker`

Shows binary availability, the current warning count, and the list of
unfired warnings. If the binary is missing, the command prints setup
guidance.

## Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
omp -e ./src/index.ts
pi  -e ./src/index.ts
```

## Origin

Ported from
[`code-yeongyu/pi-comment-checker`](https://github.com/code-yeongyu/pi-comment-checker)
v0.1.0 and adapted to the public oh-my-pi extension API. Upstream
checker behavior is preserved; the fork adds the omp self-heal loop
and the omp edit-tool `details.perFileResults` extraction path.

## License

[MIT](LICENSE).

## Related

- [oh-my-pi](https://github.com/can1357/oh-my-pi) — the target runtime.
- [pi coding agent](https://github.com/badlogic/pi-mono) — the upstream
  runtime this fork also supports.
- [pi-comment-checker](https://github.com/code-yeongyu/pi-comment-checker) — the upstream
  package this fork is based on.
- [senpi](https://github.com/code-yeongyu/senpi) — the original
  runtime these extensions were extracted for.
- [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) — the
  native checker binary.

## Acknowledgements

- **Mario Zechner** ([@badlogic](https://github.com/badlogic)) — author
  of `pi-mono` and the pi-coding-agent extension API.
- **Can Bölük** ([@can1357](https://github.com/can1357)) — author of
  `oh-my-pi` and the self-heal / session_compact contract this fork
  uses.
- **Yeongyu Kim** ([@code-yeongyu](https://github.com/code-yeongyu)) —
  author of the upstream extension and the comment-checker binary.
