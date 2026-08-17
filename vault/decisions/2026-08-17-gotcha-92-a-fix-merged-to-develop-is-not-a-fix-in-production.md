---
type: decision
date: 2026-08-17
status: accepted
tags: [decision, gotcha, process, nextjs, deployment]
related:
  [
    "[[2026-08-14-0808-agent-runtime-spec-2a]]",
    "[[2026-06-18-1128-gotcha-16-use-server-sync-export]]",
    "[[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]",
    "[[2026-08-02-decision-32-production-runs-the-dev-database]]",
  ]
---

# Gotcha 92 — a fix merged to `develop` is not a fix in production

## What happened

PR #96 promoted the Spec 2a agent runtime to `main` on **2026-08-14 16:45**. It carried
`export type { PendingProposal };` in `src/lib/agents/proposal-actions.ts`, a `"use server"`
module. Next's server-actions transform enumerates a module's export **clauses** without regard
for TypeScript's `type` modifier, so that line compiled to
`registerServerReference(PendingProposal, …)` against a binding the type pass had already erased.
Evaluating the module threw `ReferenceError: PendingProposal is not defined` at import time,
taking down **every route whose action graph includes it** — the boards page, `/settings/agents`
and the ask thread.

The diagnosis and fix were fast: committed to `develop` at **17:27**, forty-two minutes later.
The type moved to `proposal-display.ts`, which is neither `"use server"` nor `server-only` and was
already the client-safe seam the card and the action share.

**The fix was then promoted on 2026-08-17 18:50 — three days later.** Production ran the broken
build for that entire window.

## The two lessons, in order of how much they cost

### 1. `develop` never deploys, so a hotfix landed there is still an open outage

This is the expensive one, and it is not a code lesson. Working agreement #1 states the rule
plainly — "**`develop` never deploys to production**"; only a `develop → main` promotion PR does.
That is correct and deliberate. But the reflex it competes with is strong: for every ordinary task
in this repo, `finish-task.sh` merging to `develop` genuinely **is** "done".

For a fix to a **live** outage it is not. The work item is not "fix the bug", it is "stop serving
the break", and only `/promote` does that. Forty-two minutes of debugging bought nothing for three
days because the last step was never taken.

**The rule:** when the bug being fixed is already in production, the definition of done moves from
_merged_ to _promoted and deployed_ — verify the Vercel production deployment is `Ready` and
aliased to `www.monolith.works`, then confirm the surface. Nothing in `finish-task.sh` knows the
difference between a feature and a hotfix, so this one is on the human or the agent to notice.

Note also that the promotion is what makes the fix real **even though the deployment runs the DEV
database** ([[2026-08-02-decision-32-production-runs-the-dev-database]]) — the data was never the
problem here; the served build was.

### 2. `export type { … }` in a `"use server"` file is the hazard; `export type Foo = …` is not

The distinction is exact, and getting it backwards is why this shipped:

| Form                            | In a `"use server"` module            |
| ------------------------------- | ------------------------------------- |
| `export type Foo = { … }`       | **Fine** — a declaration, not a clause; used widely in this repo |
| `export type { Foo };`          | **Breaks at runtime** — an export clause, enumerated by the transform |
| `export { type Foo };`          | **Breaks at runtime** — same hazard wearing an inline modifier |

No gate catches it. `pnpm build` exits 0 because nothing type-checks a generated bare identifier;
`tsc --noEmit` sees valid TypeScript; no unit test imports a compiled server-action chunk. The
guard is therefore a **source-level** test — `src/test/use-server-exports.test.ts` scans every
`"use server"` module for both clause forms, and pins its own detector against matching nothing.

The fix is never to delete the type. Put it in a module that is neither `"use server"` nor
`server-only`, and let both sides import it from there.

## Why gotcha-16 did not prevent this — and has been corrected

[[2026-06-18-1128-gotcha-16-use-server-sync-export]] is the ADR for exactly this family. Its
"Decision" section read:

> Keep `"use server"` action files to **async server actions only** (plus type exports, which are
> erased).

That parenthetical is true of type alias **declarations** and false of type **re-export clauses**.
The ADR written to prevent this class of failure told a reader, in its normative sentence, that
the precise thing which broke production was safe. It has been amended to draw the distinction and
to point here.

The transferable point: an ADR's reassurances carry the same authority as its prohibitions. A
"this part is fine" clause that was never tested is a latent defect in the guardrail itself — and
unlike code, no gate will ever contradict it.
