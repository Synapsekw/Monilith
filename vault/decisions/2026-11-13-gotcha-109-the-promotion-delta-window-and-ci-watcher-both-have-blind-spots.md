# gotcha-109 — The promotion delta window and the CI watcher both have blind spots

**Date:** 2026-11-13
**Surfaced by:** promoting a one-line `vercel.json` change (PR #147) and the performance batch (PR #149)
**Class:** tooling that reports less than what ships
**Session:** [[2026-11-13-1232-performance-audit-region-and-quick-wins]]

## 1. `PROMO_BASE` hides commits that landed before the last heal

`/promote` computes its delta from the most recent "heal squash divergence" commit on `develop` ([[2026-08-09-gotcha-82-squash-plus-ours-heal-makes-the-main-develop-range-grow-forever]]). Anything merged into `develop` **after** the previous promotion PR was cut but **before** its heal sits behind that watermark: it is not in the delta, not linted, not in the PR body — and it ships.

On 2026-11-13 the delta read "1 commit, config only". The squash merge changed three files: `vercel.json`, plus `package.json` and `pnpm-lock.yaml` from five Dependabot PRs (#139–#143, two of them major-version bumps). CI was green and production was fine, but the owner approved a description that was not what deployed. The command's own text calls this "a narrow race that under-reports"; Dependabot merging straight into `develop` makes it routine.

**Rule:** before writing the PR body, compare trees, not commit ranges: `git diff --stat origin/main origin/develop`. If it names files the delta does not explain, find the commits and describe them. The second promotion of the day did this and the two views agreed.

## 2. `scripts/watch-ci.sh` can report green for the wrong run

Two separate misfires, both exit `0`:

- `watch-ci.sh pr <n>` started seconds after `gh pr create` sees only the checks from the **push** run on the same SHA, finds them all passed, and exits before the `pull_request` run has registered. The PR's required `verify` was still pending and GitHub showed the PR as blocked.
- `watch-ci.sh branch develop` follows the newest run on the branch of **any workflow**. A "Dependabot Updates" run finished successfully while the real `CI` run was still in progress.

**Rule until the script is fixed:** after a watcher exits `0`, confirm with `gh run list --branch <b> --workflow ci.yml -L 1` (head SHA and conclusion) or `gh pr checks <n>` filtered to the PR-triggered run, and `gh pr view <n> --json mergeStateStatus` (`CLEAN`, not `BLOCKED`). The fix is to filter `branch` mode to `ci.yml` and make `pr` mode wait for a run whose event is `pull_request`.

## 3. A lazily imported module makes the first test that touches it slow

Two tests waiting on a `next/dynamic` calendar passed locally and timed out at 5 s on CI: the cold import of `react-day-picker` and `date-fns` exceeded the test budget on the runner. `finish-task.sh` was green, `develop` CI was red, and the promotion stopped.

**Rule:** a test file that renders a code-split component imports the real module once in `beforeAll` with a generous hook timeout. The lazy boundary still shows its fallback for a tick, so the test of the fallback keeps working.
