---
type: development
title: Development setup
description: Build, test, lint, and release the package using the commands defined in package.json.
tags: [development, build, test, lint, contribute]
---

# Development setup

This is a strict TypeScript / ESM Node package. It uses vitest for tests, Biome for linting, and semantic-release for publishing.

## Install

```bash
npm install
```

No Bun APIs are used; runtime is Node only.

## Common commands

| Command | What it does |
|---------|--------------|
| `npm test` | Run vitest once. |
| `npm run test:watch` | Run vitest in watch mode. |
| `npm run typecheck` | Strict TypeScript check with `tsgo --noEmit`. |
| `npm run lint` | Run Biome check. |
| `npm run lint:fix` | Run Biome check with auto-fixes. |
| `npm run check` | `typecheck` followed by `biome check .`. |
| `npm pack --dry-run` | Release package smoke test. |
| `omp -e ./src/index.ts` | Load the extension into a local oh-my-pi session. |
| `pi -e ./src/index.ts` | Load the extension into a local pi session. |

## Code style

From `AGENTS.md`:

- TypeScript strict mode, no `any`, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in import paths.
- Tabs for indentation.
- Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Project layout

```
src/
  index.ts    — extension entrypoint, registers hooks and commands
  core.ts     — tool/request extraction and normalization
  cli.ts      — comment-checker binary resolution and execution
  omp.ts      — oh-my-pi backend capability detection
  self-heal.ts — in-memory warning store

test/
  *.test.ts   — vitest coverage for the corresponding src modules
```

## Release

Releases run automatically on pushes to `main` (and `beta`/`alpha` prerelease branches configured in `.releaserc.json`).

The `.github/workflows/release.yml` workflow has two jobs:

1. **Test** — runs `npm ci`, `npm run typecheck`, and `npm run lint`.
2. **Release** — runs after tests pass:
   - Generates a GitHub App token for write access.
   - Runs `npm audit signatures` to verify dependency provenance.
   - Invokes `npx semantic-release` to bump the version, publish to npm, and create a GitHub release.
   - Rebuilds the release body from the full commit history between the previous tag and the new tag. If the body exceeds 120,000 bytes it is truncated at the last complete line and links to `CHANGELOG.md` for the full list.

`.releaserc.json` configures the `@semantic-release/git` plugin to commit `CHANGELOG.md`, `package.json`, and `package-lock.json` with a `chore(release): ${nextRelease.version} [skip ci]` message, and uses a `releaseBodyTemplate` that applies the same 120,000-byte truncation logic. The package is configured for npm provenance in `package.json`.
