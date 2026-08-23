---
type: development
title: Development setup
description: Build, test, lint, and release the package using the commands defined in package.json.
tags: [development, build, test, lint, contribute]
---

# Development setup

This is a strict TypeScript / ESM Node package. It uses vitest for tests, Biome v2.5.10 for linting, and semantic-release for publishing.

## Install

```bash
npm install
```

No Bun APIs are used; runtime is Node only. The CI matrix covers Node 24 and 25 on Ubuntu and macOS; see `ci.yml`.

## Common commands

| Command | What it does |
|---------|--------------|
| `npm test` | Run vitest once. |
| `npm run typecheck` | Strict TypeScript check with `tsgo --noEmit`. |
| `npm run lint` | Run Biome check. |
| `npm run lint:fix` | Run Biome check with auto-fixes. |
| `npm run check` | `typecheck` followed by `biome check .`. |
| `npm run semantic-release` | Run `semantic-release` locally (used by CI). |
| `npm pack --dry-run` | Release package smoke test. |
| `npm run test:watch` | Run vitest in watch mode. |
| `omp -e ./src/index.ts` | Load the extension into a local oh-my-pi session. |
| `pi -e ./src/index.ts` | Load the extension into a local pi session. |

## Code style

From `AGENTS.md`:

- TypeScript strict mode, no `any`, no `unknown` casts where avoidable, no `@ts-ignore`, no `@ts-expect-error`, no enums.
- ESM modules with `.js` suffix in import paths.
- Tabs for indentation.
- Double quotes for strings.
- Tests use vitest with `#given .. #when .. #then` descriptions or plain `// given / // when / // then` body comments.

## Project layout

```
src/
  index.ts      — extension entrypoint, registers hooks and commands
  core.ts       — tool/request extraction and normalization
  cli.ts        — comment-checker binary resolution and execution
  omp.ts        — oh-my-pi backend capability detection and warning record types
  self-heal.ts  — in-memory warning store

public/
  banner.png    — README banner asset

test/
  *.test.ts     — vitest coverage for the corresponding src modules
```

## Release

Releases run automatically on pushes to `main`; `.releaserc.json` also declares `beta` and `alpha` release branches, but the workflow trigger is currently scoped to `main` only. The `.github/workflows/release.yml` workflow first runs `npm run typecheck` and `npm run lint` with `npm ci`, generates a chronova-agent GitHub App token, verifies installed package signatures with `npm audit signatures`, captures the previous tag, and invokes `npx semantic-release` to bump `package.json`/`package-lock.json`, write `CHANGELOG.md`, publish to npm, and create a GitHub release. The workflow's follow-up release-body step rebuilds the body from the commit range since the previous tag, exits early when the tag did not change, and truncates at 120,000 bytes while linking to `CHANGELOG.md`. The package is configured for npm provenance in `package.json`.

The package `files` list in `package.json` includes `src`, `LICENSE`, `NOTICE`, `README.md`, and `CHANGELOG.md`; the `pi` extension entry is `./src/index.ts`.

For details on the full workflow set, including the vouch gate, wiki update, and auto-manage jobs, see [GitHub Actions workflows](workflows.md).
