---
type: quickstart
title: Quickstart
description: Install and verify the @chronova/omp-comment-checker extension in oh-my-pi or pi, and confirm the comment-checker binary is available.
tags: [quickstart, install, omp, pi, comment-checker]
---

# Quickstart

This page covers installing the extension into an agent session, loading it for a one-shot test, and confirming it can reach the native checker binary.

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

After installation, restart the agent or run `/reload` in the interactive session.

## Dev / one-shot load

For local development or debugging, point the agent directly at `src/index.ts`:

```bash
# oh-my-pi
omp -e /path/to/omp-comment-checker/src/index.ts

# upstream pi
pi -e /path/to/omp-comment-checker/src/index.ts
```

The package entry is declared in `package.json` under the `"pi"` key:

```json
"pi": {
  "extensions": [
    "./src/index.ts"
  ]
}
```

## Verify the checker binary

The extension depends on the native binary shipped by `@code-yeongyu/comment-checker`. If the binary is missing, the hook is a no-op and the command prints setup guidance.

Run the built-in status command inside an interactive session:

```text
/omp-comment-checker
```

If the binary is present and there are no pending warnings, it prints:

```text
omp-comment-checker: no pending warnings.
```

If the binary is missing, it prints:

```text
omp-comment-checker binary missing; reinstall @code-yeongyu/comment-checker.
```

## Quick smoke test

1. Load the extension with one of the methods above.
2. Ask the agent to write a file that contains a suspicious comment such as `// todo: fix this later`.
3. The tool call should be blocked before the file is written, or the tool result should be marked as an error with the checker warning appended.

The exact behavior depends on the tool. See [Tool hook behavior](./behavior/tool-hooks.md) for the matrix.
