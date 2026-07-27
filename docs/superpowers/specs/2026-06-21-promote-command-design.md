# `/promote` — promote-and-watch `develop → main`

**Date:** 2026-06-21
**Status:** Design — approved for planning
**Type:** Workflow automation (slash command)

## Summary

A slash command (`.claude/commands/promote.md`, alongside `/whats-next` and `/wrapup`) that takes
work **already integrated on `develop`** and ships it to production. It validates the delta, opens
the `develop → main` promotion PR, **stops for explicit confirmation before the merge**, then merges
and watches both GitHub Actions CI and the Vercel production deploy, ending in a formatted, bulleted
report.

It deliberately does **not** merge task branches (that is `scripts/finish-task.sh`) and does **not**
build features. It fills the one real gap in the current workflow: the `develop → main` promotion,
which AGENTS.md describes as manual today ("open a develop→main PR, merge once CI passes").

**Promotion is all-or-nothing — the whole `develop` branch as one bundle.** Monolith builds many
features on `develop` and ships them together, never cherry-picked. The command always promotes the
**complete** `origin/main..origin/develop` delta (whole branch → whole branch via one PR); there is
no subset/feature-selection mode. Work that should not yet reach production simply must not be merged
into `develop`.

## Context (verified against the live repo)

- **Repo slug:** `Synapsekw/Monilith` (note the spelling — it is the real remote, not a typo to fix).
- **CI:** GitHub Actions `.github/workflows/ci.yml` — jobs `verify` (typecheck/lint/test/build),
  `commitlint` (PRs only, enforces Conventional Commits, skips Dependabot), `changelog` drift
  (develop). Runs on push + PR to `develop`/`main`.
- **Production deploy:** Vercel deploys prod **only from `main`** (Synapsekw account). There is **no
  `vercel` CLI** installed locally, and none is needed: Vercel posts a **commit status**
  (context `"Vercel"`, state `pending`/`success`/`failure`, with a `target_url` to the deploy) and a
  `Vercel Preview Comments` check-run. Both are observable via
  `gh api repos/Synapsekw/Monilith/commits/<sha>/status`.
- **`gh`** is authenticated as `Synapsekw`.
- **History style:** main advances via merge-commit PRs titled
  `Promote develop → main: <themes> (#NN)` (e.g. `#17`, `#18`, `#19`).
- **Existing automations** (`/whats-next`, `/wrapup`) live as markdown in `.claude/commands/*.md`.

## Scope decisions (from brainstorming)

| Decision             | Choice                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Entry/exit           | **Promote + watch.** Assumes work is on `develop`; ends after the deploy report.                       |
| Gating               | **Gate the merge only.** Read-only work + opening the PR is autonomous; explicit confirm before merge. |
| "Properly described" | **Validate + author PR text.** Pre-flight commitlint on the delta AND auto-compose the PR title/body.  |
| Name / format        | **`/promote`**, a markdown slash command in `.claude/commands/`.                                       |
| Stale `task/*`       | **Report only** (do not auto-clean).                                                                   |
| Testing              | **`--dry-run` + manual walkthrough** (no extracted script unless it earns it).                         |

## Preconditions

- Runs from the **main checkout** parked on `develop`. If invoked from a task worktree, it **stops**.
- A **dirty working tree is not a stop** — promotion ships only what is on `origin/develop`
  (committed **and pushed**), so uncommitted local edits never reach `main`. Dirty paths are reported
  as a note, with `.obsidian/*` ignored (perpetual editor-config noise). The hard stop is **un-pushed
  local `develop` commits** — that work genuinely won't be promoted.
- Requires `gh` authenticated and network reachable. If not, it stops early with a clear message.

## Flow (8 steps, each a TodoWrite item)

1. **Preflight (read-only, autonomous).** Confirm `gh` auth + repo; `git fetch origin develop main`;
   compute the delta `origin/main..origin/develop`. **Nothing to promote → friendly stop** ("main is
   already up to date with develop"). Collect branch-hygiene **notes** (not stops): stale `task/*`
   branches and a dirty working tree (excluding `.obsidian/*`). **Hard stop:** local `develop` commits
   not pushed to `origin/develop` (that work won't be promoted).
2. **Validate `develop` is green.** Resolve `origin/develop` HEAD SHA; check its `verify` CI run via
   `gh run list`/check-runs. Still running → watch it (`gh run watch`). **Red → stop** with the
   failing-run link. (No promotion of an un-green develop.)
3. **Commit quality ("properly described").** Run
   `pnpm exec commitlint --from origin/main --to origin/develop`. Any malformed commit → **list the
   offenders + reasons and stop** (the PR's commitlint job would fail anyway). Then **auto-compose**
   the promotion PR: title `Promote develop → main: <themes>` and a body bulleted by type
   (feat/fix/docs/…), derived from the Conventional-Commit subjects in the delta.
4. **Open the promotion PR (autonomous — reversible).** `gh pr create --base main --head develop`
   with the composed title/body; **reuse** an existing open `develop → main` PR if present. Watch its
   checks (`verify`, `commitlint`, `changelog`) via `gh pr checks --watch`. **Red → stop** with the
   link.
5. **🚦 GATE — confirm the merge.** Present the delta summary + all-green evidence + PR link, then ask
   **explicit confirmation**: "Merge develop→main now? This deploys production via Vercel." Only an
   explicit `yes` proceeds. Anything else stops cleanly (PR stays open for later).
6. **Merge (the irreversible step).** `gh pr merge --merge` (merge commit, matching history). Capture
   the new `main` HEAD SHA.
7. **Watch production.** (a) `main`'s `verify` CI run on the new SHA (`gh run watch`); (b) the
   **Vercel** commit status polled to `success`/`failure` via
   `gh api repos/Synapsekw/Monilith/commits/<sha>/status` (context `"Vercel"`), with a **bounded
   timeout**. Surface the deploy `target_url` (inspect link) and the production URL.
8. **Report.** Formatted, bulleted, scannable (see below).

## Final report format

On success:

```
## 🚀 Promotion report — develop → main
**Result:** ✅ Shipped to production

### What shipped (8 commits)
- feat — workspace management: create/rename/delete
- fix — board share dialog focus trap
- …

### Checks
- ✅ develop CI (verify) — passed
- ✅ Promotion PR #20 — verify · commitlint · changelog green
- ✅ main CI (verify) — passed

### Production deploy (Vercel)
- ✅ Live — https://<prod-url>   ·   Inspect: https://vercel.com/…

### Notes
- 🧹 Stale branch `task/old-thing` — consider deleting
```

On any stop, the same shape reports **⛔ Stopped: `<reason>`** with the relevant link and **no false
success claim**.

## Error handling (always honest, never hangs)

Each of these is an explicit stop with a link, never a silent pass:

- Nothing to promote (`main == develop`).
- `gh` unauthenticated or network unreachable.
- `develop` CI red or absent.
- Malformed commit(s) in the delta (commitlint failures).
- PR not mergeable (conflict / behind base).
- Promotion PR checks red.
- Vercel production deploy `failure`.

CI/deploy watches are **bounded** — on timeout the report says "still running after N min, here's the
link" rather than blocking indefinitely.

## Testing approach

The command is prose orchestration, so verification is:

1. **`--dry-run` flag** — runs steps 1–4 read-only and stops **before** the merge gate. Safe to run
   anytime; it never mutates `main`. (Opening/refreshing the PR under `--dry-run` is also skipped — it
   stops at "would open PR with this title/body" and prints the composed text.)
2. **Manual walkthrough** — run against current state where `main == develop` (exercises the
   nothing-to-promote path), and against a real delta (stops at the gate without merging).

If true unit tests are later warranted, extract the deterministic preflight (delta computation +
commitlint + status JSON) into a small `scripts/`-style helper and test that. Not done up front —
only if it earns it.

## Out of scope (YAGNI)

- Merging `task/*` branches into `develop` (owned by `finish-task.sh`).
- Auto-deleting stale branches (reported only).
- Version tags / release notes / changelog authoring (the `changelog` CI job already governs drift).
- A standalone `scripts/promote.sh` (revisit only if tests demand it).
