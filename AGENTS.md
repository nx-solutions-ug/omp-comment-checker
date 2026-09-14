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

## Structural code search (ast-grep)

Use `ast-grep` — not `grep`/`rg` — for anything **structural**: finding call
sites, function/class/JSX shapes, or code matching a pattern rather than a
string. Use it for **every multi-file rewrite**. Text search also hits
comments, strings and unrelated identifiers; ast-grep matches AST nodes.

Fall back to `rg` only for literal text, non-code files (Markdown, JSON, lock
files), or languages ast-grep cannot parse.

```bash
# Search — single-node patterns. Always single-quote: "$A" is shell-expanded.
ast-grep run -p 'console.log($ARG)' -l ts src/
ast-grep run -p 'useEffect($CB, $DEPS)' -l tsx --json src/ | jq -r '.[].file'

# Search — relational / composite queries
ast-grep scan --inline-rules 'id: await-in-loop
language: TypeScript
rule:
  kind: for_in_statement
  has:
    pattern: await $E
    stopBy: end' src/

# Rewrite — prints a diff by default; -i reviews each edit, -U applies all
ast-grep run -p 'var $N = $V' -r 'let $N = $V' -l ts -i src/
```

Non-obvious rules, in the order they bite:

- Invoke it as `ast-grep`, never the `sg` alias — `sg` collides with
  shadow-utils' setgid tool on Linux.
- **Single-quote patterns.** `"$PROP && $PROP()"` reaches ast-grep as `" && ()"`
  after shell expansion.
- In relational rules (`has`, `inside`, `precedes`, `follows`) set
  `stopBy: end`, or the search stops at the first non-matching node.
- **Write inline rules in block YAML, not flow maps.** `has: { pattern: f() { $$$B }, stopBy: end }`
  fails to parse — the pattern's `}` closes the flow mapping. Indented keys
  always work.
- **Zero matches ≠ code absent.** Patterns match whole AST nodes, so
  `-p 'log($MSG)'` does _not_ match `console.log("hello")`. Before concluding
  something isn't there, inspect the parse: `--debug-query=pattern` shows how
  ast-grep read your pattern, `--debug-query=ast` shows the named nodes.
- `--inline-rules` works in any directory; bare `ast-grep scan` (project rule
  dirs) requires an `sgconfig.yml` at the repo root.
- Not on `PATH` — CI runners included: `bun add -g @ast-grep/cli`.

Full reference: <https://ast-grep.github.io/llms-full.txt>
