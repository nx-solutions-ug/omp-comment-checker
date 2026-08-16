---
type: quickstart
title: Quickstart
description: Install and verify the @chronova/omp-comment-checker extension in oh-my-pi or pi, and confirm the comment-checker binary is available.
tags: [quickstart, install, omp, pi, comment-checker]
---

# Quickstart

This page covers installing the extension into an agent session, loading it for a one-shot test, and confirming it can reach the native checker binary.

The package is published as [`@chronova/omp-comment-checker`](https://www.npmjs.com/package/@chronova/omp-comment-checker) on npm, released under the MIT license, and ships with CI and release automation via GitHub Actions. The repository README displays npm version, CI, release, and license badges.

## Install the package

The package is published as `@chronova/omp-comment-checker`.

```bash
# oh-my-pi
omp install npm:@chronova/omp-comment-checker

# upstream pi
pi install npm:@chronova/omp-comment-checker

# From git
omp install git:github:nx-solutions-ug/omp-comment-checker
pi install git:github:nx-solutions-ug/omp-comment-checker
```

You can also pin it in `~/.omp/settings.json`:

```json
{
  "packages": [
    "git:github:nx-solutions-ug/omp-comment-checker"
  ]
}
```

After installation, restart the agent or run `/reload` in an interactive session.

The package entry is declared in `package.json` under the `"pi"` key:

```json
"pi": {
  "extensions": [
    "./src/index.ts"
  ]
}
```

## Dev / one-shot load

For local development or debugging, point the agent directly at `src/index.ts`:

```bash
# oh-my-pi
omp -e /path/to/omp-comment-checker/src/index.ts

# upstream pi
pi -e /path/to/omp-comment-checker/src/index.ts
```

## Verify the checker binary

The extension depends on the native binary shipped by `@code-yeongyu/comment-checker`. If the binary is missing, the hook is a no-op and the slash command surfaces setup guidance through the host's notification UI.

Run the built-in status command inside an interactive session:

```text
/omp-comment-checker
```

If the binary is present and there are no pending warnings, the host is notified:

```text
omp-comment-checker: no pending warnings.
```

If there are unfired self-heal warnings, the command shows the count and the list of affected files:

```text
2 pending warning(s):
src/index.ts: avoid vague comments like "TODO"
src/core.ts: ...
```

If the binary is missing, it notifies:

```text
omp-comment-checker binary missing; reinstall @code-yeongyu/comment-checker.
```

The command is registered via `pi.registerCommand("omp-comment-checker", ...)` in `src/index.ts`.

## Quick smoke test

1. Load the extension with one of the methods above.
2. Ask the agent to write a file that contains a suspicious comment such as `// todo: fix this later`.
3. The `write` tool call should be blocked before the file is written, and the rejection reason should appear in the LLM context.
4. If a tool that cannot be pre-checked (e.g. `apply_patch`, `multiedit`, omp `edit` modes) succeeds, its tool result is marked `isError: true` with the checker warning appended, and the warning is persisted for the next `session_compact` re-injection.

The exact behavior depends on the tool. See [Tool hook behavior](./behavior/tool-hooks.md) for the matrix and [Self-heal loop](./behavior/self-heal.md) for how warnings survive across turns.
