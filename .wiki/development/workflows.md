---
type: development
title: GitHub Actions workflows
description: CI, release, vouch, wiki-update, and auto-manage automation, including the chronova-agent GitHub App token used for elevated operations.
tags: [development, workflows, ci, release, vouch, github-actions]
---

# GitHub Actions workflows

All repository automation lives under `.github/workflows`. Most write operations use a chronova-agent GitHub App token (`secrets.APP_CLIENT_ID` / `secrets.APP_PRIVATE_KEY`) generated via `actions/create-github-app-token@v3`, rather than the default `GITHUB_TOKEN`.

## CI (`ci.yml`)

Runs on pushes and pull requests to `main`, plus manual dispatch.

- Matrix: `ubuntu-latest` and `macos-latest` × Node `20` and `22`.
- Steps: `npm ci`, `npm run check` (typecheck + Biome), `npm test`, `npm pack --dry-run`.

This is the only workflow that does not need an app token; it only reads repository contents.

## Release (`release.yml`)

Runs on every push to `main`.

1. Runs `npm run typecheck` and `npm run lint`.
2. Generates an app token for `semantic-release`.
3. Invokes `npx semantic-release` to bump `package.json`/`package-lock.json`, write `CHANGELOG.md`, publish to npm, and create a GitHub release.
4. Rebuilds the release body from the full commit range between the previous tag and the new tag, truncating at 120,000 bytes and linking to `CHANGELOG.md` if longer.

The package is configured for npm provenance in `package.json`.

## Vouch gate (`vouch-pr.yml`)

Runs on `pull_request_target` events (`opened`, `reopened`, `ready_for_review`). It enforces the repository's vouch policy:

- Generates the chronova-agent app token.
- Runs `mitchellh/vouch/action/check-pr@v1` with `auto-close: true` and `require-vouch: true`.
- Adds the `vouched` label when a PR passes the gate.

## Vouch management (`vouch-manage.yml`)

Runs when a discussion comment is created.

- Generates the chronova-agent app token.
- Runs `mitchellh/vouch/action/manage-by-discussion@v1` against the discussion.
- Recognizes `!vouch`, `!denounce`, and `!unvouch` keywords from users with `admin`, `maintain`, or `write` roles.
- Maintains `.github/VOUCHED.td`.

## Wiki update (`update-wiki.yml`)

Runs on pushes to `main`, on a daily schedule, and on manual dispatch.

- Generates the chronova-agent app token.
- Installs and runs the `@chronova/wiki-agent` on the repository.
- If wiki content changed, flattens `.wiki/` and pushes to the repository's wiki git repo.
- Also opens a staging pull request on the source repo with the `.wiki/` changes.

## Auto manage (`auto-manage.yml`)

Runs on issue and pull request open events.

- Tags newly opened/reopened issues with `needs-triage`.
- Auto-assigns new issues and PRs to `niklasschaeffer`.
- Uses the chronova-agent app token for label and assignee edits.

## oh-my-pi agent workflows

The repository also ships agent automation for the oh-my-pi runtime:

- `omp-ci.yml` — triages issues and reviews PRs using the oh-my-pi coding agent.
- `omp-fix-issue.yml` — attempts to fix an issue via the oh-my-pi agent and opens a PR.
- `omp.yml` — general oh-my-pi integration workflow.

These are driven by `.omp/commands/*.md` prompt files and are not part of the extension package itself.

### `/omp` PR comment handling (`omp.yml`)

`omp.yml` listens for issue and PR review comments starting with `/omp` (or `/oc`). It expands either a named command file from `.omp/commands/<command>.md` or treats the remainder as a freeform prompt.

For freeform prompts posted on PR comments, the workflow appends `.omp/commands/_pr-commit-push.md`. This instructs the agent to check out the PR branch, apply the requested changes, run relevant quality gates, and **commit and push the result back to the PR branch** before finishing. It prevents the agent from leaving changes staged only in the runner (added in PR #636).
