---
type: development
title: GitHub Actions workflows
description: CI, release, vouch, wiki-update, auto-manage, and oh-my-pi agent
  automation (triage, label, code review, fix-issue, /omp comments), including
  the chronova-agent GitHub App token used for elevated operations.
tags:
  [
    development,
    workflows,
    ci,
    release,
    vouch,
    wiki,
    github-actions,
    code-review
  ]
last_updated: 2026-09-04T18:42:34.326Z
updated_by: wiki-agent
---

# GitHub Actions workflows

All repository automation lives under `.github/workflows`. Most write operations use a chronova-agent GitHub App token (`secrets.APP_CLIENT_ID` / `secrets.APP_PRIVATE_KEY`) generated via `actions/create-github-app-token@v3`, rather than the default `GITHUB_TOKEN`.

The `update-wiki.yml` workflow can also publish with a dedicated `WIKI_PUSH_TOKEN` secret, falling back to the app token or `GITHUB_TOKEN`.

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
3. Installs dependencies with `npm ci` and verifies package signatures with `npm audit signatures`.
4. Captures the latest tag before release.
5. Invokes `npx semantic-release` to bump `package.json`/`package-lock.json`, write `CHANGELOG.md`, publish to npm, and create a GitHub release.
6. Rebuilds the release body from the full commit range between the previous tag and the new tag. If the tag did not change, the step exits early; if the body exceeds 120,000 bytes, it is truncated at the last complete line and links to `CHANGELOG.md`.

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
- Sets up Bun and Node 25, installs `@chronova/wiki-agent` globally, and runs `wiki --update --print --verbose --wiki`. The agent runs in Ollama Cloud mode (`WIKI_OLLAMA_MODE: cloud`) using `secrets.WIKI_OLLAMA_API_KEY`, with the model taken from the `WIKI_MODEL` repo variable (default `glm-5.3-flash`, set by `WIKI_MODEL: ${{ vars.WIKI_MODEL || 'glm-5.3-flash' }}`).
- If wiki content changed (excluding `.wiki/.last-update-report.md` and `.wiki/.last-updated.json`), flattens `.wiki/` with `wiki-flatten` and pushes to the repository's wiki git repo via the token in `secrets.WIKI_PUSH_TOKEN` (falling back to the app token or `GITHUB_TOKEN`).
- Also opens a staging pull request on the source repo with the `.wiki/` changes, using branch `wiki/staging-<timestamp>`.
- Warns and skips the wiki push if the wiki git repo has not been initialized yet.

## Auto manage (`auto-manage.yml`)

Runs on issue and pull request open/reopen events.

- Tags newly opened/reopened issues with `needs-triage`.
- Auto-assigns new issues and PRs to `niklasschaeffer`.
- Uses the chronova-agent app token for label and assignee edits.
- Note: `auto-manage.yml` only handles the GitHub-side pass (adds the `needs-triage` label and assigns `niklasschaeffer`) on `issues: opened`. `omp-ci.yml` separately runs the omp `triage-issue` path, which may add type/priority labels and post a triage summary comment before dispatching `omp-fix-issue.yml`.

## oh-my-pi agent workflows

The repository also ships agent automation for the oh-my-pi runtime. All are driven by `.omp/commands/*.md` prompt files and are not part of the extension package itself. They install OMP from `https://omp.sh/install`, seed an Ollama Cloud API key into `~/.omp/agent/agent.db` from `secrets.OLLAMA_API_KEY` (an `auth_credentials` row for provider `ollama-cloud`, inserted via `sqlite3`), run `omp models refresh ollama-cloud`, and then invoke `omp -p --model ollama-cloud/glm-5.3-flash:max --mode json` with the expanded prompt (piped through `.omp/stream-log.py`).

- `omp-ci.yml` — triages issues and labels PRs using the oh-my-pi coding agent.
- `omp-code-review.yml` — reviews pull requests using the oh-my-pi coding agent (dependency PRs and code PRs are separate jobs).
- `omp-fix-issue.yml` — triggered by `repository_dispatch` with `event_type: issue-triaged`. It clones the repo, configures the agent, runs `fix-issue.md`, and creates a PR from the resulting branch via `create-pull-request`.
- `omp.yml` — general oh-my-pi integration workflow triggered by `/omp` (or `/oc`) comments on issue and PR review comments.

### `omp-ci.yml`

- **triage-issue** runs on `issues: opened` or manual dispatch. It reacts to the issue with an `eyes` reaction, runs `triage-issue.md` (which may add type/priority labels and a triage summary comment), and then dispatches `issue-triaged` to `omp-fix-issue.yml` (the dispatch runs with `if: always()`, even if triage fails). It uses the `glm-5.3-flash:max` model.
- **label-pr** runs when a PR is opened or marked ready for review. It checks whether the PR already has a type label (`bug`, `feature`, `enhancement`, `docs`, `chore`) and a priority label (`priority: critical|high|medium|low`); if both are present, the job skips. Otherwise it runs `label-pr.md`.
- **cancel-label-on-close** runs when a PR is `closed`. It acquires the concurrency group of the live label job (`omp-label-<n>`) with `cancel-in-progress: true`, forcing any in-progress agent run for that PR to cancel.

### `omp-code-review.yml`

Dedicated PR-review workflow, split out of `omp-ci.yml`. It reacts to the PR with an `eyes` reaction, installs the `gh-pr-review` extension pinned to `v1.6.2` (`gh extension install agynio/gh-pr-review --pin v1.6.2 --force`) to enable review submissions, and uses the `glm-5.3-flash:max` model. It has two mutually exclusive jobs:

- **dependency-review** runs only for PRs authored by `renovate[bot]` or `dependabot[bot]`. It runs `dependency-review.md`, which fetches the PR diff, researches changelogs/release notes, assesses breaking changes, and posts a review. After the agent finishes, a verification step fails the job if the agent posted neither a review nor a comment.
- **code-review** runs for all other PRs on `opened`/`synchronize`/`ready_for_review`/`review_requested`, on `workflow_dispatch` with a `pr_number` input, and on `pull_request_review` / `pull_request_review_comment` events whose author contains `jules` (Google's Jules bot). It checks out with `fetch-depth: 0` so `git diff` against the base branch works for large diffs. A `jules-detect` step classifies Jules involvement (Jules-authored PR, Jules-submitted review, or Jules review comment) and passes `IS_JULES`/`JULES_CONTEXT` into the run. On `synchronize`, a `re-review-check` step skips the review if the new head commit was authored by an agent (`opencode-agent`, `opencode`, `github-actions`, `omp-agent`, or `chronova-agent`); `review_requested` is treated as an explicit human retrigger and never skips. It runs `review-pr.md`. A verification step fails the job if the agent posted no review and the PR has no existing threads — unless the PR modifies `omp-code-review.yml` itself, in which case verification is skipped by design (the workflow under review cannot be trusted to verify itself).

The concurrency group is `omp-code-review-<pr number>` with a conditional `cancel-in-progress`: only `pull_request` and `workflow_dispatch` events may cancel an in-flight run. Review-triggered runs (`pull_request_review` / `pull_request_review_comment`) queue behind it instead. This avoids a race where the agent's own submitted review cancels the required `code-review` check mid-flight while the replacement review-triggered run is skipped by the job conditions (review triggers are gated to Jules-authored activity), leaving the check permanently `CANCELLED` and affected PRs `UNSTABLE` (fixed in 040ac00).

### `/omp` comment handling (`omp.yml`)

`omp.yml` listens for issue comments and PR review comments starting with `/omp` (or `/oc`). It expands either a named command file from `.omp/commands/<command>.md` or treats the remainder as a freeform prompt. It does not run any extension code itself; it is part of the repository's agent automation and ships under `.omp/`, not under `src/`. The job reacts to the trigger comment with an `eyes` reaction, authenticates `gh`, configures git for push, installs OMP, and installs the `gh-pr-review` extension pinned to `v1.6.2` before running the agent. See `AGENTS.md` for the conventions governing these command prompts.

For freeform prompts posted on PR comments, the workflow appends `.omp/commands/_pr-commit-push.md` with the PR number substituted. This instructs the agent to check out the PR branch, apply the requested changes, run relevant quality gates, and **commit and push the result back to the PR branch** before finishing. It prevents the agent from leaving changes staged only in the runner (added in PR #57, closing nx-solutions-ug/chronova#637).

## Branch protection

`.github/branch-ruleset.json` enforces the main-branch rules: linear history, no force pushes, required PR review (one approval including code-owner review), required review thread resolution, and required status checks.

The branch ruleset applies to the default branch (`main`). It requires linear history, no force pushes, at least one approving review including a code-owner review, resolved review threads, and four status checks that still reference Node 20/22 (`test (ubuntu-latest · node 20)`, etc.). CI currently runs Node 24/25, so the required checks will not match the job names until the ruleset or CI matrix is updated.

## Workflow tool pins

- `gh-pr-review` is installed with `--pin v1.6.2` in both `omp-ci.yml` (review-pr job) and `omp.yml` so PR review submissions use a fixed, reproducible extension version.
