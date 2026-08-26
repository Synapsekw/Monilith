---
type: session
date: 2026-08-17-2154
branch: develop
trigger: wrapup
status: complete
tags: [session, vault, process]
related:
  [
    "[[2026-08-14-0808-agent-runtime-spec-2a]]",
    "[[2026-08-17-gotcha-92-a-fix-merged-to-develop-is-not-a-fix-in-production]]",
    "[[2026-06-18-1128-gotcha-16-use-server-sync-export]]",
  ]
---

# Stale handover triage and vault cleanup

## What changed

- **A Spec 2a handover was triaged as fully stale and discarded.** The session opened with a
  detailed handover claiming Task 6's review never ran, Tasks 7–10 were not started, and the branch
  was unmerged at `39a5e551`. **All of it was already done.** Task 7 is `49eeb7db`, 8 is `c8580d4b`,
  9 is `08937b7f`, 10 is `56452497`; the branch merged as `939b0c1d` and promoted via PR #96. Both
  items the handover said to "raise with the owner" were also already closed — the refresh route
  carries `ts` + `nonce` via `verifyFreshSignedBody`, and the `readSweepCredential` `user_id`
  tiebreak now has a test that seeds the tie deliberately (`credentials.test.ts:318`).
- **The handover's forward plan was superseded, in the opposite direction.** It said "then Spec 3,
  confirm the ordering with the owner". That confirmation had already happened and resolved to
  **Spec 2b (agent knowledge) first**, owner-chosen for depth before breadth.
- **Production verified healthy.** The 08-17 18:50 deployment is `Ready` and aliased to
  `www.monolith.works`, created four seconds after the promotion commit `20dadd1e`.
- **New ADR: [[2026-08-17-gotcha-92-a-fix-merged-to-develop-is-not-a-fix-in-production]].** The
  Spec 2a `"use server"` hotfix was committed to `develop` 42 minutes after PR #96 shipped the
  break — and promoted **three days later**. Production served the broken build the whole time.
- **gotcha-16 corrected.** Its normative sentence read "async server actions only (plus type
  exports, which are erased)". That parenthetical licensed the exact construct that broke
  production. Amended to separate type alias **declarations** (safe) from type **re-export clauses**
  (not), with a pointer to gotcha-92 and to the `use-server-exports` guard.
- **`/updates` coverage flags triaged as noise.** Recorded in north-star §3 so they stop reading as
  debt.
- **Four `_draft-*.md` stubs deleted** (two duplicate 2a stubs, two from the 08-17 hotfix day);
  their content is superseded by the 2a note and this one.

## Why

Two failure modes met here, and they are the same failure mode. A handover asserted state that
`git log` contradicted on every point; an ADR asserted a safety property that production
contradicted. In both cases the prose was confident, internally coherent, and wrong — and in both
cases thirty seconds of checking the artefact settled it. This is the
[[verify-codebase-before-trusting-vault]] discipline applied to a handover instead of the vault.

The `/updates` triage matters for the same reason. "2026-08-10 uncovered" had been carried forward
as owed work across sessions; it was never real. The check compares **ship dates**, so any
build-day date is flagged whenever its announcement legitimately rides the next day's promotion.
Left unexplained, a permanent false positive trains a reader to ignore the check that exists to
catch real gaps.

## How to test

No user-facing behavior to test — vault and ADR documentation only, no code touched. Production was
verified independently (deploy `Ready`, aliased, carrying `20dadd1e`).

## Open threads

- **Spec 2b (agent knowledge — reference templates + memory) is next**, and there is no spec yet:
  start with `superpowers:brainstorming`. Spec 3 (orchestration, `@handle` addressing, the
  renameable built-in assistant, and the deferred `agent.create`/`schedule.create`) follows it. The
  discarded handover's Spec 3 forward-constraints are still worth keeping: agents-as-tools means
  nested runs and nested spend, so `runAi`'s ledger needs a parent-run correlation id, and
  `record_ai_usage`'s drop-and-recreate precedent (`20260801092356`) **does not carry its grants**.
- **`gotcha-55` fires on every migration** (4 of 4 in the 2a session) — budget the version reconcile.
- **The 2a note's own open threads are untouched and still open**: the HMAC residual is 300s and
  reasoned rather than measured, the second cache breakpoint is deferred, and ~15 triaged
  follow-up minors remain (quote-lookalike stripping, bidi/zero-width in `oneLine`,
  `Object.freeze` on `DEFAULT_ORG_AI_SETTINGS`, no test of the `(run_id, tool_call_id)` redelivery
  defence, org-level keys outside the sweep).
- **Worth a sweep now that gotcha-92 exists:** are there other ADR "this part is fine"
  reassurances that were never tested? gotcha-16's was load-bearing and wrong for two months.
- Unrelated and still open from before: the `number`/`battery`/`completion`/`health` dashboard
  widgets calling `SECURITY DEFINER` RPCs through the service client, where `auth.uid()` is null
  and `can_read_board` denies — possibly raising `42501` for real users since 2026-07-04. Verify in
  the running app before "fixing" the guard.

## Next session entry point

Brainstorm **Spec 2b — agent knowledge** (reference templates + memory) with
`superpowers:brainstorming`. No spec exists yet.
