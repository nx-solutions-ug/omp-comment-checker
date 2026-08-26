---
type: development
title: GitHub Actions workflows
description: CI, release, vouch, wiki-update, and auto-manage automation, including the chronova-agent GitHub App token used for elevated operations.
tags: [development, workflows, ci, release, vouch, wiki, github-actions]
---

# GitHub Actions workflows

All repository automation lives under `.github/workflows`. Most write operations use a chronova-agent GitHub App token (`secrets.APP_CLIENT_ID` / `secrets.APP_PRIVATE_KEY`) generated via `actions/create-github-app-token@v3`, rather than the default `GITHUB_TOKEN`.

The `update-wiki.yml` workflow can also publish with a dedicated `WIKI_PUSH_TOKEN` secret, falling back to the app token or `GITHUB_TOKEN`.

Repository governance files include `.github/CODEOWNERS` (assigns `@code-yeongyu` as code owner for workflows, package manifests, and top-level project files), `.github/VOUCHED.td` (documents the vouch policy), `.github/branch-ruleset.json` (main-branch protection), and `.github/pull_request_template.md` (verification checklist).

## CI (`ci.yml`)

Runs on pushes and pull requests to `main`, plus manual dispatch.

- Matrix: `ubuntu-latest` and `macos-latest` × Node `24` and `25`.
- Steps: `npm ci`, `npm run check` (`npm run typecheck` then `npm run lint`), `npm test`, `npm pack --dry-run`.
- Concurrency group per workflow/ref; `cancel-in-progress: true`.

This is the only workflow that does not need an app token; it only reads repository contents.

## Release (`release.yml`)

Runs on every push to `main`. The `.releaserc.json` configuration also declares `beta` and `alpha` release branches, but the workflow trigger is currently scoped to `main` only.

1. Runs `npm run typecheck` and `npm run lint`.
2. Generates an app token for `semantic-release`.
3. Installs dependencies with `npm ci` and verifies package signatures with `npm audit signatures`.
4. Captures the latest tag before release.
5. Invokes `npx semantic-release` to bump `package.json`/`package-lock.json`, write `CHANGELOG.md`, publish to npm, and create a GitHub release.
6. Rebuilds the release body from the full commit range between the previous tag and the new tag. If the tag did not change, the step exits early; if the body exceeds 120,000 bytes, it is truncated at the last complete line and links to `CHANGELOG.md`.

The `.releaserc.json` release body template also truncates notes at 120,000 bytes and links to `CHANGELOG.md` as a fallback, so truncation is applied both by semantic-release and by the workflow's follow-up edit step.

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
- Stops and reports an error if the wiki push fails, so silent publish failures are visible in the workflow logs.

## Auto manage (`auto-manage.yml`)

Runs on issue `opened`/`reopened` events and pull request `opened` events.

- Tags newly opened/reopened issues with `needs-triage`.
- Auto-assigns new issues and PRs to `niklasschaeffer`.
- Uses the chronova-agent app token for label and assignee edits.
- Note: `auto-manage.yml` and `omp-ci.yml` both run `triage-issue` paths on `issues: opened`; the omp path also labels, classifies, and posts a triage summary comment before dispatching `omp-fix-issue.yml`.
- Note: `auto-manage.yml` only handles the GitHub-side pass (adds the `needs-triage` label and assigns `niklasschaeffer`) on `issues: opened`. `omp-ci.yml` separately runs the omp `triage-issue` path, which may add type/priority labels and post a triage summary comment before dispatching `omp-fix-issue.yml`.

## oh-my-pi agent workflows

The repository also ships agent automation for the oh-my-pi runtime. All are driven by `.omp/commands/*.md` prompt files and are not part of the extension package itself. They install OMP from `https://omp.sh/install`, configure an Ollama Cloud API key from `secrets.OLLAMA_API_KEY`, and run `omp -p --model ollama-cloud/minimax-m3 --mode json` with the expanded prompt.

- `omp-ci.yml` — triages issues and labels/reviews PRs using the oh-my-pi coding agent.
- `omp-fix-issue.yml` — triggered by `repository_dispatch` with `event_type: issue-triaged`. It clones the repo, configures git and the agent, runs `fix-issue.md`, and lets the agent create and push a fix branch. It does **not** create the PR itself; that is left to the agent or a follow-up step.
- `omp.yml` — general oh-my-pi integration workflow triggered by `/omp` (or `/oc`) comments on issue and PR review comments.

### `omp-ci.yml`

- **triage-issue** runs on `issues: opened` or manual dispatch. It reacts to the issue with an `eyes` reaction, runs `triage-issue.md` (which may set the GitHub issue type and priority fields, add type/priority/status labels, and post a triage summary comment), and then dispatches `issue-triaged` to `omp-fix-issue.yml`.
- **label-pr** runs when a PR is opened, synchronized, or marked ready for review. It checks whether the PR already has a type label (`bug`, `feature`, `enhancement`, `docs`, `chore`) and a priority label; if so, the job skips. Dependency update PRs (Renovate/Dependabot) are still labeled when missing these labels.
- **review-pr** runs on PR open/synchronize/ready_for_review or manual dispatch. It uses `gh extension install agynio/gh-pr-review --force` to enable review submissions. On `synchronize`, a `re-review-check` job skips the review if the new commit was authored by an agent (`opencode-agent`, `opencode`, `github-actions`, `omp-agent`, or `chronova-agent`). It also prefixes the prompt with `dep:` for Dependabot/Renovate PRs and `bot:` for bot/agent-authored PRs. The job reacts to the PR with an `eyes` reaction before running the agent. The `review-pr.md` prompt deduplicates findings, resolves prior bot review threads once all findings are addressed, and submits an `APPROVE` review in that case.
- **cancel-review-on-close / cancel-label-on-close** run when a PR is `closed`. Each acquires the concurrency group of the matching live job (`omp-review-<n>` or `omp-label-<n>`) with `cancel-in-progress: true`, forcing any in-progress agent run for that PR to cancel.

### `/omp` comment handling (`omp.yml`)

`omp.yml` listens for issue comments and PR review comments starting with `/omp` (or `/oc`), excluding bot-authored comments. It expands either a named command file from `.omp/commands/<command>.md` or treats the remainder as a freeform prompt. It does not run any extension code itself; it is part of the repository's agent automation and ships under `.omp/`, not under `src/`. The job reacts to the trigger comment with an `eyes` reaction, authenticates `gh`, configures git for push, installs OMP, and installs the `gh-pr-review` extension before running the agent. See `AGENTS.md` for the conventions governing these command prompts.

For freeform prompts posted on PR comments, the workflow appends `.omp/commands/_pr-commit-push.md` with the PR number substituted. This instructs the agent to check out the PR branch, apply the requested changes, run relevant quality gates, and **commit and push the result back to the PR branch** before finishing. It prevents the agent from leaving changes staged only in the runner (added in PR #636).

## Branch protection

`.github/branch-ruleset.json` enforces the main-branch rules: deletion protection, no force pushes, required linear history, required PR review (one approval including code-owner review, stale-review dismissal, and required review thread resolution), and required status checks.

The branch ruleset applies to the default branch (`main`). It requires linear history, no force pushes, at least one approving review including a code-owner review, resolved review threads, and four status checks referencing Node 20/22 (`test (ubuntu-latest · node 20)`, etc.). CI currently runs Node 24/25, so the required checks will not match the job names until the ruleset or CI matrix is updated.

Repository administrators (`RepositoryRole` actor id 5) can bypass the rules in `always` mode.

## Issue and PR templates

`.github/ISSUE_TEMPLATE/bug.yml` and `.github/ISSUE_TEMPLATE/feature.yml` are the repository's issue forms. `.github/pull_request_template.md` asks contributors to confirm `npm run check`, `npm test`, `npm pack --dry-run`, and local smoke tests, plus comment-checker test coverage and changelog impact.
