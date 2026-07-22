# Agent automation

In addition to the npm extension, this repository uses [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`) to automate issue and PR triage. The automation lives in two places: `.omp/` for the agent config, slash-command prompts, and rules; and `.github/workflows/` for the GitHub-side triggers and runners.

This page is purely about the automation surface — see [quickstart.md](quickstart.md) and [architecture.md](architecture.md) for the comment-checker extension itself.

## Table of contents

- [.omp/ — agent config, commands, and rules](#omp--agent-config-commands-and-rules)
- [GitHub workflows — what runs and when](#github-workflows--what-runs-and-when)
- [omp-ci.yml — issue triage, PR labeling, PR review](#omp-ciyml--issue-triage-pr-labeling-pr-review)
- [omp-fix-issue.yml — automatic issue fixer](#omp-fix-issueyml--automatic-issue-fixer)
- [omp.yml — ad-hoc slash-command from PR/issue comments](#ompyml--ad-hoc-slash-command-from-prissue-comments)
- [openwiki-update.yml — scheduled OpenWiki refresh](#openwiki-updateyml--scheduled-openwiki-refresh)
- [ci.yml, release.yml, auto-manage.yml — classical CI/CD](#ciyml-releaseyml-auto-manageyml--classical-cicd)
- [Branch protection](#branch-protection)
- [Change-oriented guidance](#change-oriented-guidance)

## .omp/ — agent config, commands, and rules

```
.omp/
├── agent/
│   └── config.yml          # omp model roles + github/inspect_image flags
├── commands/
│   ├── fix-issue.md        # $ARGUMENTS = issue number
│   ├── label-pr.md         # $ARGUMENTS = PR number
│   ├── review-pr.md        # $ARGUMENTS = PR number
│   └── triage-issue.md     # $ARGUMENTS = issue number
├── rules/
│   ├── gh-label-idempotent.md
│   └── tool-paths-must-be-arrays.md
└── stream-log.py           # pipe omp JSON output to a readable log
```

### agent/config.yml

[`agent/config.yml`](/.omp/agent/config.yml) is the omp agent config consumed by the workflows. It pins the ollama-cloud models used by every role:

| Role | Model |
| --- | --- |
| `default`, `task`, `commit` | `ollama-cloud/minimax-m3` |
| `plan`, `designer` | `ollama-cloud/kimi-k2.6` |
| `vision` | `ollama-cloud/qwen3.5:397b` |
| `smol` | `ollama-cloud/devstral-2:123b` |
| `slow` | `ollama-cloud/qwen3.5:397b` |

It also sets `github.enabled: true` and `inspect_image.enabled: true` so the agent can use the GitHub and image-inspection tools.

### commands/

The four prompt files are templates that take `$ARGUMENTS` and replace it with the issue/PR number. The workflows expand them with `sed` before piping into `omp -p`. Each prompt follows the same pattern:

1. Resolve the repo slug from `GH_REPO` (fall back to `gh repo view`).
2. Read the target issue or PR (title, body, labels, type, priority, comments).
3. Apply a dedup / skip check before doing any work.
4. Execute the relevant action with the right `gh` commands.

| File | What it produces |
| --- | --- |
| [`fix-issue.md`](/.omp/commands/fix-issue.md) | Reads the issue, sets up git auth, runs `npm ci`, and works on the issue in the runner. |
| [`label-pr.md`](/.omp/commands/label-pr.md) | Applies one type label (`bug` / `feature` / `enhancement` / `docs` / `chore`) and one priority label. Idempotent — uses `|| true` on every `gh label create`. |
| [`review-pr.md`](/.omp/commands/review-pr.md) | Posts a review with suggested changes. Skips if the bot already posted. Has a special path for renovate/dependabot dependency-update PRs. |
| [`triage-issue.md`](/.omp/commands/triage-issue.md) | Sets the issue type, priority, and `needs-triage` label. Skips issues that already have type + priority fields or the `accepted` label. |

### rules/

Two short rule files injected into the agent's prompt:

- [`gh-label-idempotent.md`](/.omp/rules/gh-label-idempotent.md) — When running `gh label create`, always append `|| true` so a 422 (label exists) is not treated as a failure.
- [`tool-paths-must-be-arrays.md`](/.omp/rules/tool-paths-must-be-arrays.md) — When calling `find` or `search` tools, `paths` must be an array, never a single string.

### stream-log.py

[`.omp/stream-log.py`](/.omp/stream-log.py) is invoked as `omp -p … | python3 .omp/stream-log.py` to turn the JSON streaming output into a readable GitHub Actions log. Every workflow that runs omp pipes its output through this script.

## GitHub workflows — what runs and when

| File | Trigger | Purpose |
| --- | --- | --- |
| [`omp-ci.yml`](/.github/workflows/omp-ci.yml) | New / updated issues and PRs, or manual dispatch with `issue_number` / `pr_number` | Three jobs: `triage-issue`, `label-pr`, `review-pr`. |
| [`omp-fix-issue.yml`](/.github/workflows/omp-fix-issue.yml) | `repository_dispatch` of type `issue-triaged`, or manual dispatch with `issue_number` | Runs omp against the `fix-issue` command to actually fix the issue. |
| [`omp.yml`](/.github/workflows/omp.yml) | Issue / PR comments containing `/omp` or `/oc` | Ad-hoc agent invocation — maps a slash command to a `.omp/commands/<name>.md` file. |
| [`openwiki-update.yml`](/.github/workflows/openwiki-update.yml) | Push to `main`, schedule (08:00 UTC daily), or `workflow_dispatch` | Builds the OpenWiki fork and opens a PR to refresh `openwiki/`. |
| [`ci.yml`](/.github/workflows/ci.yml) | Push / PR to `main` | Runs `npm run check` + `npm test` + `npm pack --dry-run` on a matrix of ubuntu/macos × node 20/22. |
| [`release.yml`](/.github/workflows/release.yml) | Push to `main` | Runs `npm run typecheck` + `npm run lint`, then `npx semantic-release`. |
| [`auto-manage.yml`](/.github/workflows/auto-manage.yml) | New / reopened issues, new PRs | Tags issues with `needs-triage` and auto-assigns to `niklasschaeffer`. |

Every omp workflow uses the same bootstrap pattern:

1. Generate a GitHub App token via `actions/create-github-app-token@v3` (secrets: `APP_CLIENT_ID`, `APP_PRIVATE_KEY`).
2. `gh auth login --with-token` and `gh auth setup-git` so push / API calls work as the app.
3. Install Bun (`oven-sh/setup-bun@v2`) and omp (`curl -fsSL https://omp.sh/install | sh -s -- --source`).
4. Insert the `ollama-cloud` API key into `~/.omp/agent/agent.db` from `secrets.OLLAMA_API_KEY`.
5. `omp models refresh ollama-cloud` to populate the model catalog.
6. Expand the relevant `.omp/commands/*.md` with `sed 's/\$ARGUMENTS/<n>/g'` and run `omp -p --model ollama-cloud/minimax-m3 --mode json "<prompt>" | python3 .omp/stream-log.py`.

## omp-ci.yml — issue triage, PR labeling, PR review

[`omp-ci.yml`](/.github/workflows/omp-ci.yml) is a multi-job workflow with three independent jobs:

- **`triage-issue`** — runs on `issues: opened` and on `workflow_dispatch` with `issue_number`. Concurrency group `omp-triage-<n>` (cancel-in-progress). Reacts with `eyes`, runs `triage-issue.md` against the issue, then dispatches a `issue-triaged` event so `omp-fix-issue.yml` can pick it up.
- **`label-pr`** — runs on PR `opened` / `synchronize` / `ready_for_review`. Concurrency group `omp-label-<n>` (cancel-in-progress). Pre-checks existing labels with `gh pr view --json labels` and **skips** if both a type and a priority label are already present (idempotency, see `.omp/rules/gh-label-idempotent.md`).
- **`review-pr`** — runs on any non-closed PR transition or `workflow_dispatch` with `pr_number`. Concurrency group `omp-review-<n>` (cancel-in-progress **disabled** so the full review runs once). On `synchronize`, a `re-review-check` step looks at the PR's existing bot comments to decide whether a fresh review is needed.

## omp-fix-issue.yml — automatic issue fixer

[`omp-fix-issue.yml`](/.github/workflows/omp-fix-issue.yml) consumes the `issue-triaged` event from `triage-issue` and runs `fix-issue.md` against the issue number. It uses full git history (`fetch-depth: 0`) because the fix PR may need to reference earlier commits. Concurrency group `omp-fix-issue-<n>` (cancel-in-progress **disabled**).

## omp.yml — ad-hoc slash-command from PR/issue comments

[`omp.yml`](/.github/workflows/omp.yml) lets any non-bot user trigger omp by commenting `/omp <prompt>` (or `/oc <prompt>`) on an issue or PR review thread. The comment is parsed:

- The first token after `/omp` is matched against `.omp/commands/<name>.md`. If a file exists, the prompt is expanded with `sed "s/\\\$ARGUMENTS/<args>/g"` and run. If not, the raw prompt text is run.
- The job always runs against `ollama-cloud/minimax-m3` and pipes through `stream-log.py`.

## openwiki-update.yml — scheduled OpenWiki refresh

[`openwiki-update.yml`](/.github/workflows/openwiki-update.yml) is the workflow that maintains the `openwiki/` directory:

1. Clone `niklasschaeffer/openwiki` from the `feat/ollama-provider` branch.
2. `pnpm install --no-frozen-lockfile` and `pnpm run build`.
3. Run `node /tmp/openwiki/dist/cli.js --update --print` with `OPENWIKI_MODEL_ID=minimax-m3`, `OPENWIKI_PROVIDER=ollama`, and the relevant LangSmith + Ollama env vars.
4. Open a PR titled `docs: update OpenWiki` against `openwiki/update` with `add-paths: openwiki`.

It runs on push to `main`, daily at 08:00 UTC, and on `workflow_dispatch`.

## ci.yml, release.yml, auto-manage.yml — classical CI/CD

- [`ci.yml`](/.github/workflows/ci.yml) — matrix of `ubuntu-latest` + `macos-latest` × `node 20` + `node 22`. Runs `npm ci`, `npm run check` (tsgo + biome), `npm test`, and `npm pack --dry-run`. Uses `concurrency: cancel-in-progress: true` so superseded runs are killed.
- [`release.yml`](/.github/workflows/release.yml) — runs `npm run typecheck` and `npm run lint`, then `npx semantic-release` with the GitHub App token and `NPM_TOKEN`. Triggered on push to `main`. `.releaserc.json` configures `main` + `beta` + `alpha` branches and emits `CHANGELOG.md` + `package.json` + `package-lock.json` in the release commit. GitHub release notes are capped at 120 KB and fall back to `CHANGELOG.md` if exceeded.
- [`auto-manage.yml`](/.github/workflows/auto-manage.yml) — two jobs: `tag-issue` adds `needs-triage` to new / reopened issues, and `assign` adds `niklasschaeffer` as the assignee on new issues and PRs.

## Branch protection

[`.github/branch-ruleset.json`](/.github/branch-ruleset.json) defines an active `main` ruleset that:

- Blocks deletion and non-fast-forward pushes.
- Requires a linear history.
- Requires a PR with at least 1 approving review, code-owner review, and resolved review threads.
- Requires the four CI contexts `test (ubuntu-latest · node 20)`, `test (ubuntu-latest · node 22)`, `test (macos-latest · node 20)`, `test (macos-latest · node 22)`.

[`.github/CODEOWNERS`](/.github/CODEOWNERS) assigns `@code-yeongyu` as the default code owner for the repo, with explicit ownership for `.github/workflows/*`, `package.json`, `package-lock.json`, `LICENSE`, `NOTICE`, `README.md`, and `CHANGELOG.md`. The Renovate config ([`renovate.json`](/renovate.json)) updates npm + GitHub Actions dependencies weekly; the repo no longer carries a Dependabot config.

## Change-oriented guidance

- **Adding a new omp command** — drop a new `*.md` into `.omp/commands/`, use `$ARGUMENTS` as the placeholder, and have a workflow expand it with `sed 's/\$ARGUMENTS/<value>/g'`. Keep the prompt self-contained; the runner is sandboxed and the prompt must explicitly run `npm ci`, `gh auth setup-git`, etc.
- **Changing the model** — update `.omp/agent/config.yml` and verify the new model is in the ollama-cloud catalog. The bootstrap step `omp models refresh ollama-cloud` will re-pull the catalog on each run.
- **Adjusting the OMP model ID or provider** — the `omp.yml`, `omp-ci.yml`, and `omp-fix-issue.yml` workflows hardcode `--model ollama-cloud/minimax-m3`. The `openwiki-update.yml` workflow uses the `OPENWIKI_*` env vars instead. Change all four places if you want consistent defaults.
- **Skipping the agent on a PR** — `label-pr` already skips when type + priority labels are present. `review-pr` will not run again on `synchronize` once a review has been posted unless the re-review script allows it. The `gh-label-idempotent.md` rule is what keeps re-runs safe.
- **Releasing** — the only release branch is `main`. The `beta` and `alpha` branches in `.releaserc.json` are prerelease channels if you want to cut a preview; just push a commit to one of them.
