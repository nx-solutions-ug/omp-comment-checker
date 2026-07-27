---
type: automation
title: PR review automation
description: How the oh-my-pi agent reviews pull requests with inline comments using the gh-pr-review extension.
tags: [automation, pr, review, gh-pr-review, omp, workflow]
---

# PR review automation

Pull requests are reviewed by an oh-my-pi agent triggered from GitHub comments. The agent posts inline review comments via the `gh-pr-review` extension, because the standard `gh pr review` CLI cannot attach comments to specific diff lines.

## Trigger

`.github/workflows/omp.yml` runs on:

- `issue_comment.created` — comments on issues or pull requests.
- `pull_request_review_comment.created` — review comments on PR diffs.

The job fires only for non-bot comments whose body starts with `/omp` or contains ` /omp`. The comment is parsed into a command name and arguments. If `.omp/commands/{cmd}.md` exists, the prompt file is expanded with `$ARGUMENTS`; otherwise the raw text after `/omp` is used.

Example:

```text
/omp /review-pr 42
```

## Agent run

The workflow:

1. Generates a GitHub App token.
2. Installs the `agynio/gh-pr-review` extension.
3. Configures git for push.
4. Installs oh-my-pi from `https://omp.sh/install`.
5. Authenticates OMP against the Ollama Cloud provider.
6. Refreshes the model list.
7. Runs `omp -p --model ollama-cloud/minimax-m3 --mode json "<expanded prompt>"`, streaming output through `.omp/stream-log.py`.

## Review command

`.omp/commands/review-pr.md` instructs the agent to:

1. Resolve the owner/repo slug from `GH_REPO` or `gh repo view`.
2. Install `gh-pr-review`.
3. Check for prior reviews from `chronova-agent` or `omp-agent`. If unresolved inline threads still apply to the current diff, the agent re-reviews and posts only new findings.
4. Read PR metadata (`gh pr view`) and the diff (`gh pr diff`).
5. Classify the PR author:
   - `renovate[bot]` / `dependabot[bot]` → dependency PR summary only.
   - Any other `[bot]` → bot-authored PR review.
   - Human → standard human-authored PR review.
6. Map each finding to a diff line (`--side RIGHT/LEFT`, `--line`, optional `--start-line` for ranges).
7. Submit the review state:
   - `APPROVE` for clean changes.
   - `REQUEST_CHANGES` for bugs, security, or type-safety issues.

## Deduplication

Before posting, the agent fetches existing unresolved inline threads from the same reviewer and skips any finding that already exists at the same `path` + `line`. This prevents duplicate comments when the PR is re-reviewed after new commits.

## Dependency PRs

Dependency updates do not use inline review submission. The agent posts a single `## Dependency Update Summary` issue comment with a table of changed packages, their change type (patch/minor/major), and a recommendation (`SAFE`, `REVIEW`, `ACTION REQUIRED`). Existing dependency summary comments from the bot are deleted before posting a fresh one.
