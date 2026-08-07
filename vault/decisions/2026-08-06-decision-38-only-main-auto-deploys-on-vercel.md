---
type: adr
status: accepted
date: 2026-08-06
tags: [project/monolith, adr, decision, operations, vercel, deploy, ci]
related:
  - "[[00-north-star]]"
  - "[[operations]]"
  - "[[2026-08-02-decision-32-production-runs-the-dev-database]]"
---

# Decision 38 — Only `main` auto-deploys on Vercel (no preview build per `develop` push)

> If you pushed to `develop` and no Vercel deployment appeared: **that is this decision working**,
> not a broken Git integration. Do not "fix" it by re-enabling all branches.

## Context

Vercel's Git integration deploys **every push to every branch** by default — non-production branches
get a Preview deployment, the production branch gets Production. That default cost us a full build on
every `develop` push, and `develop` is an integration branch that never serves users
(only `main` deploys production — working agreement #1).

Each of those preview builds was redundant three ways:

- `.github/workflows/ci.yml` already runs `typecheck → lint → test → build` on every `develop` push,
  so the same build ran twice on two providers.
- A large share of `develop` commits are docs-only (`docs(spec)`, `docs(vault)`, session notes) — full
  ~2 min production-grade builds for markdown.
- Open `dependabot/*` branches built on every push as well.

Measured before the change: **~16 preview builds vs 4 production builds over three days.**

## Decision

**`vercel.json` disables Git-triggered deployments for every branch except `main`.**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": { "**": false, "main": true } }
}
```

Two details that are easy to get wrong:

- **`**`, not `*`.** The patterns are minimatch, where `*` does not cross `/` — `dependabot/npm_and_yarn/…`
  would still have built. Vercel's rule is _"if a branch matches multiple patterns and at least one is
  `true`, it deploys"_, so `main` wins its own exception.
- **`git.deploymentEnabled`, not `ignoreCommand`.** `ignoreCommand` (exit `0` = skip, exit `1` = build)
  still **creates** a deployment and then cancels it, cluttering the list. `deploymentEnabled` stops it
  before a deployment exists.

## Consequences — what this means for an agent

1. **A `develop` push produces no Vercel deployment at all.** The gate on `develop` is GitHub Actions
   (`verify`), not a Vercel build. Verify with `gh run list --branch develop`, not the Vercel dashboard.

2. **The `develop → main` promotion PR gets no preview URL.** CI still runs the full build on that PR.
   If the `main` build ever fails after merge, the previous production deployment stays live — Vercel
   does not swap the alias to a failed build.

3. **Previews are on demand, not automatic.** `deploymentEnabled` governs only Git-triggered builds;
   `vercel` (or `vercel --prebuilt`) from a worktree still deploys a preview whenever you actually want
   a URL to click through. That is now the intended way to get one.

4. **Merging the promotion PR still builds production on `main`** — the one deploy that matters is
   untouched. Nothing here changes which database the deployment talks to; see
   [[2026-08-02-decision-32-production-runs-the-dev-database]].

5. **`vercel.json` is read from the pushed commit**, so a change to this file takes effect on the very
   push that introduces it.

## Known remaining duplication

`ci.yml` runs `pnpm build` **twice** per push — once in `verify` and again in `lighthouse (perf budget)`,
on separate runners (~8 min of runner time per `develop` push). Scoping the lighthouse job to `main` and
PRs is the obvious follow-up; not done in this pass.

## Status

**Accepted and current as of 2026-08-06.** To restore per-push previews on `develop`, add
`"develop": true` to the map — but record why, because it re-introduces the duplicate build above.
