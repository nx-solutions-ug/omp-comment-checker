# Claude Code instructions

@AGENTS.md

## CI automation

The `.github/workflows/claude-*.yml` workflows run Claude Code through
`anthropics/claude-code-action@v1` and invoke the project commands in
`.claude/commands/` as slash commands, e.g. `/review-pr 42`. `$ARGUMENTS` is
expanded by Claude Code itself.

Tool permissions for those runs are declared centrally per job via
`claude_args: --allowedTools ...` in the workflow — deliberately not in command
frontmatter, so there is one place to look.

## Conventions

- `gh label create` is not idempotent: it exits 422 when the label already
  exists. Always append `|| true`.

## Structural search

`AGENTS.md` requires `ast-grep` over `grep`/`rg` for structural queries and
multi-file rewrites. When a query needs a real YAML rule rather than a
one-line pattern, invoke the `ast-grep:ast-grep` skill (rule syntax,
relational/composite rules, debugging checklist); `ast-grep:outline` gives a
file's structure. Both ship with the `ast-grep` plugin; when it isn't
installed (CI runners), fall back to the reference linked above rather than
reconstructing rule syntax from memory.
