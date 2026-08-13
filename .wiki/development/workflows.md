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

- Matrix: `ubuntu-latest` and `macos-latest` × Node `24` and `25`.
- Steps: `npm ci`, `npm run check` (tsgo + biome), `npm test`, `npm pack --dry-run`.
- Concurrency group per workflow/ref; `cancel-in-progress: true`.

This is the only workflow that does not need an app token; it only reads repository contents.

## Release (`release.yml`)

Runs on every push to `main`. The `.releaserc.json` configuration also declares `beta` and `alpha` release branches, but the workflow trigger is currently scoped to `main` only.

1. Runs `npm run typecheck` and `npm run lint`.
2. Generates an app token for `semantic-release`.
3. Captures the latest tag before release.
4. Invokes `npx semantic-release` to bump `package.json`/`package-lock.json`, write `CHANGELOG.md`, publish to npm, and create a GitHub release.
5. Rebuilds the release body from the full commit range between the previous tag and the new tag. If the tag did not change, the step exits early; if the body exceeds 120,000 bytes, it is truncated at the last complete line and links to `CHANGELOG.md`.

The workflow declares the top-level permissions `contents: write` and `id-token: write`; the `id-token: write` permission is required for npm provenance attestation. The package is configured for npm provenance in `package.json`.

## Vouch gate (`vouch-pr.yml`)

Runs on `pull_request_target` events (`opened`, `reopened`, `ready_for_review`). It enforces the repository's vouch policy:

- Generates the chronova-agent app token.
- Runs `mitchellh/vouch/action/check-pr@v1` with `auto-close: true` and `require-vouch: true`.
- Adds the `vouched` label when a PR passes the gate.
- Uses `permissions: pull-requests: write, issues: write`.

## Vouch management (`vouch-manage.yml`)

Runs when a discussion comment is created.

- Generates the chronova-agent app token.
- Runs `mitchellh/vouch/action/manage-by-discussion@v1` against the discussion.
- Recognizes `!vouch`, `!denounce`, and `!unvouch` keywords from users with `admin`, `maintain`, or `write` roles.
- Maintains `.github/VOUCHED.td`.

## Wiki update (`update-wiki.yml`)

Runs on pushes to `main`, on a daily schedule at 08:00 UTC, and on manual dispatch.

- Generates the chronova-agent app token.
- Sets up Bun and Node 25, installs `@chronova/wiki-agent` globally, and runs `wiki --update --print --verbose --wiki`.
- If wiki content changed (excluding `.wiki/.last-update-report.md` and `.wiki/.last-updated.json`), flattens `.wiki/` with `wiki-flatten` and pushes to the repository's wiki git repo via the token in `secrets.WIKI_PUSH_TOKEN` (falling back to the app token or `GITHUB_TOKEN`).
- Also opens a staging pull request on the source repo with the `.wiki/` changes, using branch `wiki/staging-<timestamp>`.
- Warns and skips the wiki push if the wiki git repo has not been initialized yet.

## Auto manage (`auto-manage.yml`)

Runs on issue and pull request open/reopen events.

- Tags newly opened/reopened issues with `needs-triage`.
- Auto-assigns new issues and PRs to `niklasschaeffer`.
- Uses the chronova-agent app token for label and assignee edits.

## `/omp` PR comment handling (`omp.yml`)

`omp.yml` listens for issue and PR review comments starting with `/omp` (or `/oc`). It expands either a named command file from `.omp/commands/<command>.md` or treats the remainder as a freeform prompt. It does not run any extension code itself; it is part of the repository's agent automation and ships under `.omp/`, not under `src/`. See `AGENTS.md` for the conventions governing these command prompts.

## oh-my-pi agent workflows

The repository also ships agent automation for the oh-my-pi runtime. All are driven by `.omp/commands/*.md` prompt files and are not part of the extension package itself. They install OMP from `https://omp.sh/install`, configure an Ollama Cloud API key from `secrets.OLLAMA_API_KEY`, and run `omp -p --model ollama-cloud/minimax-m3 --mode json` with the expanded prompt.

- `omp-ci.yml` — triages issues and labels/reviews PRs using the oh-my-pi coding agent.
- `omp-fix-issue.yml` — attempts to fix an issue via the oh-my-pi agent and opens a PR.
- `omp.yml` — general oh-my-pi integration workflow triggered by `/omp` (or `/oc`) comments on issues and PR review comments.

### `omp-ci.yml`

- **triage-issue** runs on `issues: opened` or manual dispatch. It reacts to the issue with an `eyes` reaction, runs `triage-issue.md`, and then dispatches `issue-triaged` to `omp-fix-issue.yml`.
- **label-pr** runs when a PR is opened, synchronized, or marked ready for review. It checks whether the PR already has a type label (`bug`, `feature`, `enhancement`, `docs`, `chore`) and a priority label; if so, the job skips.
- **review-pr** runs on PR open/synchronize/ready_for_review or manual dispatch. It uses `gh extension install agynio/gh-pr-review --force` to enable review submissions. On `synchronize`, a `re-review-check` job skips the review if the new commit was authored by an agent (`opencode-agent`, `opencode`, `github-actions`, `omp-agent`, or `chronova-agent`). It also prefixes the prompt with `dep:` for Dependabot/Renovate PRs and `bot:` for bot/agent-authored PRs. The job reacts to the PR with an `eyes` reaction before running the agent.
- **cancel-review-on-close / cancel-label-on-close** run when a PR is `closed`. Each acquires the concurrency group of the matching live job (`omp-review-<n>` or `omp-label-<n>`) with `cancel-in-progress: true`, forcing any in-progress agent run for that PR to cancel.

### `/omp` PR comment handling (`omp.yml`)

`omp.yml` listens for issue and PR review comments starting with `/omp` (or `/oc`). It expands either a named command file from `.omp/commands/<command>.md` or treats the remainder as a freeform prompt. The job reacts to the trigger comment with an `eyes` reaction and installs the `gh-pr-review` extension before running the agent.

For freeform prompts posted on PR comments, the workflow appends `.omp/commands/_pr-commit-push.md`. This instructs the agent to check out the PR branch, apply the requested changes, run relevant quality gates, and **commit and push the result back to the PR branch** before finishing. It prevents the agent from leaving changes staged only in the runner (added in PR #57, closing nx-solutions-ug/chronova#637).

### `omp-fix-issue.yml`

Triggered by `repository_dispatch` with `event_type: issue-triaged`. It clones the repo, configures the agent, runs `fix-issue.md`, and creates a PR from the resulting branch via `create-pull-request`.
