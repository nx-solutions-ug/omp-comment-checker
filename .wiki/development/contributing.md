---
type: development
title: Contributing
description: How to become a vouched contributor, the PR gating rules, and the verification checklist expected for pull requests.
tags: [development, contributing, vouch, pr]
---

# Contributing

Pull requests are accepted from vouched contributors, bots, and collaborators with write access. The repository uses a lightweight vouch system backed by GitHub Discussions and two workflow files.

## Who can open pull requests

- **Vouched users** listed in `.github/VOUCHED.td`.
- **Bots** whose handles end with `[bot]`.
- **Collaborators** with repository write access.

`VOUCHED.td` is managed automatically by `.github/workflows/vouch-manage.yml` and checked on every PR by `.github/workflows/vouch-pr.yml`.

## Becoming vouched

1. Open a discussion in the repository's **Discussions** tab.
2. Describe the contribution you intend to make.
3. A maintainer comments `!vouch` on the discussion to add you to the vouched list.

After you are vouched, you can open pull requests normally.

## Maintainer vouch commands

Maintainers with admin, maintain, or write role can run these commands in any discussion comment:

| Command | Effect |
| --- | --- |
| `!vouch` | Vouch the discussion author. |
| `!vouch @user [reason]` | Vouch a specific user. |
| `!denounce @user [reason]` | Block a user from contributing. |
| `!unvouch @user` | Remove a user from the vouched list. |

`vouch-manage.yml` updates `.github/VOUCHED.td` and commits the change when one of these commands is recognized.

## PR gating

`vouch-pr.yml` runs on `pull_request_target` for `opened`, `reopened`, and `ready_for_review` events. It closes pull requests from unvouched or denounced users and applies the `vouched` label to PRs that pass the gate.

Because the workflow uses `pull_request_target`, the gate can act on pull requests opened from forks.

## Pull request template

The PR template in `.github/pull_request_template.md` asks contributors to confirm:

- `npm run check` passes (typecheck + Biome).
- `npm test` passes (vitest).
- `npm pack --dry-run` passes (release sanity).
- Local smoke tests with `pi -e ./src/index.ts` and `senpi -e ./src/index.ts` when behavior changed.

It also asks for confirmation that the `write`, `edit`, `multiedit`, and `apply_patch` paths, plus OMO-compatible `apply_patch` metadata support, remain covered by tests, and that a `CHANGELOG` entry is added for user-facing changes.

## Issue management

`.github/workflows/auto-manage.yml` tags new and reopened issues with `needs-triage` and auto-assigns new issues and pull requests to `niklasschaeffer`. It runs using a GitHub App token generated from repository secrets.
