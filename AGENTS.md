# Repository Conventions

Conventions for human contributors and AI agents working on this repository.

This is a fork of `code-yeongyu/pi-comment-checker` v0.1.0, retargeted at
`can1357/oh-my-pi` (`@oh-my-pi/pi-coding-agent`). The fork keeps upstream
checker behavior and adds the omp self-heal loop: warnings are persisted
as session entries and re-injected into context on the next
`session_compact` event.

## Style

- Terse technical prose. No emojis in commits, issues, PR comments, or code.
- TypeScript strict mode. No `any`, no `unknown` casts where avoidable, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in import paths.
- Tabs for indentation. Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Commands

- `bun install` — install dependencies.
- `bun run test` — run vitest once.
- `bun run type-check` — strict TypeScript check.
- `bun run check` — type check + oxlint + oxfmt.
- `npm pack --dry-run` — release package smoke test.
- `omp -e ./src/index.ts` — load the extension into a local oh-my-pi session for manual smoke testing.
- `pi -e ./src/index.ts` — load the extension into a local pi session for manual smoke testing.

## Constraints

- No Bun APIs. Runtime is Node only.
- No dependency on pi-coding-agent internal modules outside the documented public extension API in `@oh-my-pi/pi-coding-agent` or `@mariozechner/pi-coding-agent`.
- Keep `write`, `edit`, `multiedit`, `apply_patch`, and omp edit modes (`hashline`, `patch`, `replace`) covered by tests.
- `apply_patch` must support OMO-compatible metadata and raw Codex patch fallback.
- omp edit-tool details (`EditToolDetails.perFileResults`) must also be supported.
- The self-heal path must be a no-op when the host does not provide `pi.appendEntry`, `pi.sendMessage`, or `pi.on("session_compact", ...)`.
- The extension does not render TUI widgets or footer status lines; warnings are surfaced to the LLM via tool result content and `pi.sendMessage` only.

## Don'ts

- No `git add -A` or `git add .`. Stage only the files you changed.
- No `git commit --no-verify`. No force pushes. No history rewriting on shared branches.
- Do not couple this package back to omo or senpi internal source paths.
- Do not hard-require `@oh-my-pi/pi-coding-agent`; the host may be plain pi.
