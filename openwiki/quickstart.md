# omp-comment-checker

Comment-checker hook extension for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) and the upstream [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

The extension is a fork of [`code-yeongyu/pi-comment-checker`](https://github.com/code-yeongyu/pi-comment-checker) v0.1.0 retargeted at the omp extension API. It runs [`@code-yeongyu/comment-checker`](https://github.com/code-yeongyu/go-claude-code-comment-checker) before and after every mutation tool, surfaces the warning back into the tool result so the agent must react, and **self-heals** the warning across the next session compaction so the LLM sees it again on the next turn.

The package is published as `@chronova/omp-comment-checker` (see [`package.json`](/package.json)) and is loaded by omp/pi via the `pi.extensions` field.

## Table of contents

- [What it does](#what-it-does)
- [How the host is detected](#how-the-host-is-detected)
- [Behavior matrix](#behavior-matrix)
- [Install](#install)
- [Command](#command)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Where to go next](#where-to-go-next)

## What it does

The package is a single `pi` extension that registers four event handlers and one slash command:

| Registration | File | Purpose |
| --- | --- | --- |
| `pi.on("session_start", ...)` | [`src/index.ts`](/src/index.ts) | Clears the in-memory self-heal store at the start of every session. |
| `pi.on("tool_call", ...)` | [`src/index.ts`](/src/index.ts) | Pre-execution guard. For `write` / `edit`, runs the checker against proposed content and blocks the call if the checker exits 2. |
| `pi.on("tool_result", ...)` | [`src/index.ts`](/src/index.ts) | Post-execution guard. For `write` / `edit` / `multiedit` / `apply_patch` / omp `edit`, re-runs the checker on the written content, appends warnings to the tool result, and sets `isError: true`. |
| `pi.on("session_compact", ...)` | [`src/index.ts`](/src/index.ts) | Re-injects any unfired warnings back into context as a `pi.sendMessage` call. |
| `pi.registerCommand("omp-comment-checker", ...)` | [`src/index.ts`](/src/index.ts) | Status command — shows binary availability, warning count, and unfired warning list. |

Every detected warning flows through `SelfHealStore` ([`src/self-heal.ts`](/src/self-heal.ts)) and is persisted as a `omp-comment-checker:warning` session entry via `OmpBackend.appendEntry` ([`src/omp.ts`](/src/omp.ts)). The self-heal path is what differentiates the omp fork from upstream 0.1.0.

## How the host is detected

[`createOmpBackend(pi)`](/src/omp.ts) inspects the host at load time. If the host exposes any of `appendEntry`, `sendMessage`, or `on`, the backend is marked `available: true`; otherwise every method is a no-op. The self-heal path only fires under omp — under plain pi the `session_compact` listener and `sendMessage` call silently do nothing, so behavior matches upstream 0.1.0 exactly.

## Behavior matrix

| Case | Result |
| --- | --- |
| `write` / `edit` called (pre-exec) | Blocks the call when the checker flags the proposed content; the LLM sees the rejection reason and self-corrects on the next turn. |
| `write` succeeds | Checks the written `content`. |
| `edit` succeeds | Checks `oldString` / `newString`. |
| `multiedit` succeeds | Checks the complete `edits` payload. |
| `apply_patch` succeeds with OMO metadata | Checks each metadata file using `before` / `after`, skips deletes. |
| `apply_patch` succeeds without metadata | Falls back to raw Codex patch parsing via [`parseApplyPatchRequests`](/src/core.ts). |
| omp `edit` tool (any mode: `hashline` / `patch` / `replace` / `apply_patch`) | Reads `details.perFileResults` for `oldText` / `newText` per affected file. |
| Checker exits `2` (post-exec) | Appends the warning message to the tool result, marks the result `isError: true`, and fires the self-heal path. |
| Checker binary missing | Leaves tool output unchanged, no self-heal, pre-exec passes through. |
| Checker exits unexpectedly | Leaves tool output unchanged, no self-heal. |

Per-call opt-out: pass `skipCommentCheck: true` in the tool input to skip the pre-exec check for that call.

## Install

The package targets both the omp extension loader and the upstream pi extension loader.

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

After installation, restart the agent or run `/reload` inside an interactive session.

## Command

`/omp-comment-checker` — Shows binary availability, the current warning count, and the list of unfired warnings. If the binary is missing, the command prints setup guidance via `ctx.ui.notify` (see [`src/index.ts`](/src/index.ts)).

## Development

```bash
npm install
npm test                 # vitest --run
npm run typecheck        # tsgo --noEmit
npm run check            # typecheck + biome
npm run lint             # biome check .
npm run lint:fix         # biome check --write .
npm pack --dry-run       # release package smoke test
omp -e ./src/index.ts    # load the extension into a local oh-my-pi session
pi  -e ./src/index.ts    # load the extension into a local pi session
```

The Node engine is `>=20.0.0` (see `engines` in [`package.json`](/package.json)). The repo is strict-mode TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and tabs-only formatting (see [`tsconfig.json`](/tsconfig.json) and [`biome.json`](/biome.json)).

## Repository layout

```
.
├── src/                    # extension source
│   ├── index.ts            # entrypoint: registers the four events + command
│   ├── core.ts             # request extraction + apply_patch parser
│   ├── cli.ts              # comment-checker process spawn, binary resolution, output truncation
│   ├── omp.ts              # OmpBackend (appendEntry / sendMessage / onSessionCompact)
│   └── self-heal.ts        # SelfHealStore (per-session warning record)
├── test/                   # vitest specs
│   ├── cli.test.ts         # process spawn, output truncation, timeout
│   ├── core.test.ts        # extractCommentCheckRequests, parseApplyPatchRequests
│   ├── index.test.ts       # tool_call + tool_result handlers
│   └── omp.test.ts         # SelfHealStore, OmpBackend, extension registration
├── .omp/                   # omp agent config + slash-command prompts (see agent-automation.md)
├── .github/workflows/      # CI, release, omp agent automations (see agent-automation.md)
├── .releaserc.json         # semantic-release config (main + beta + alpha branches)
├── biome.json              # formatter + linter config
├── tsconfig.json           # strict TypeScript config
├── vitest.config.ts        # vitest config (node environment, test/**/*.test.ts)
└── package.json            # @chronova/omp-comment-checker
```

## Where to go next

- [Architecture notes](architecture.md) — module-by-module walkthrough of the extension, including the request-extraction algorithm and the omp backend contract.
- [Agent automation](agent-automation.md) — `.omp/` slash-command prompts, OMP GitHub workflows (CI, fix-issue, label-pr, review-pr, triage), and the release pipeline.
- Top-level conventions: [`AGENTS.md`](/AGENTS.md), [`README.md`](/README.md), [`CHANGELOG.md`](/CHANGELOG.md).
