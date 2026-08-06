---
type: session
date: 2026-08-04-2222
branch: develop
trigger: wrapup
status: complete
tags: [session, promote, ai-write]
related:
  - "[[2026-08-04-2140-carryover-repairs]]"
  - "[[2026-06-30-gotcha-32-squash-merge-breaks-develop-main-ancestry]]"
---

# Promote #84 — the AI write path reaches the deployment

## What changed

- **PR #84 merged, `main` @ `82c5a89a`** — 29 commits: `query_items` item ids, the `BoardEffect`
  render-without-reload path, the board-thread org composite FK, and the three tooling repairs
  from [[2026-08-04-2140-carryover-repairs]].
- **Squash divergence healed** (`f7e6f975`, `-s ours`) — tree byte-identical, `origin/main` is an
  ancestor of `origin/develop` again, so the next promotion PR opens clean ([[2026-06-30-gotcha-32-squash-merge-breaks-develop-main-ancestry]]).
- **Verified live, not assumed:** main CI green in 375s, Vercel production `state=success`,
  `www.monolith.works` → **200**.
- Earlier in the session: a `/whats-next` triage that became a carryover sweep — three tooling
  repairs shipped in `c04dfce9`, and two "owed — production" claims re-tested and found stale.

## Why

The three AI-write follow-ups had been sitting on `develop` since the morning, which meant the
assistant's write path worked for anyone running a `develop` build and was still **dead on the
deployment** — `propose_move_item` could not be reached in production because the `query_items`
id fix wasn't on `main`. Promotion was the difference between "fixed" and "fixed for users".

## How to test (for the user)

1. Open **https://www.monolith.works** and go to any board with more than one group.
2. Open the **board dock** (right side) and ask: _"move &lt;an item on this board&gt; to
   &lt;another group on this board&gt;"_.
3. Expect a **confirm card** naming the item and both groups — not "I don't have a tool that can
   move an item", which is what production said before this promotion.
4. Click **Approve**. The item should move **on the board immediately, with no page reload**.
5. Ask it to create a task in a group, then approve — same no-reload behaviour.
6. Multi-org only: switch to another org and try the dock on the first org's board — expect a
   refusal, not a cross-org write.

## Open threads

- **`/sync-prod` deliberately not chained.** Its data phase would copy the two Tier-2 fixture
  accounts — whose passwords are committed to this repo — into production. Needs a fixture-excluding
  run, not the default.
- **commitlint fails over the full promotion range** (7 Phase 6/7-era commits: `subject-case`,
  one `security(db)` `type-enum`). CI skips the job on `base_ref == main` by design, so nothing was
  bypassed — but `/promote` step 3 says "stop on any failure", which would block **every** future
  promotion on commits already in production. The command's rule needs narrowing to the
  since-last-promotion range, or an explicit grandfather note.
- Prod still has **no `RESEND_API_KEY`** — digest and briefing runs file in-app notifications only.
- 8 dependabot branches unmerged; the npm ones contend with E6's Stripe SDK over the lockfile.
- `e2e/ai-write-visibility.spec.ts` still never executed (needs a live model + `E2E_AI_WRITES=1`).

## Next session entry point

Production and `develop` are level. The next real choice is **Report Builder v2** — which needs
`brainstorming` → `writing-plans` first, since the charts spec explicitly defers roll-ups and org
templates and **no spec or plan exists** — or the **E6 Stripe track** (spec written, needs a plan,
**no migration**, which makes it the safe partner for a parallel batch alongside a
migration-bearing task).
