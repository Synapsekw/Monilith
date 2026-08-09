---
type: adr
date: 2026-08-07
status: accepted
tags: [decision, gotcha, testing, security]
related: ["[[2026-08-07-2032-mcp-column-metadata-and-attachments]]"]
---

# Gotcha 81 — a plan can prescribe a test run a guard forbids

## Context

The MCP attachments plan closed with Task 7: a cross-org RLS integration suite, and a Step 3 that
said to run it with `PULSE_TEST_DB=1` against DEV and expect 4 passing tests. Written that way, the
step reads as a routine verification.

It cannot pass, and should not. `src/test/integration-env.ts` gates every integration suite on
`integrationTargetReady()`, which requires **two independent conditions**: the positive
`PULSE_TEST_DB === "1"` marker (which only lives in a `.env.test` that does not exist here) **and**
a URL that is neither the DEV nor the PROD project ref — both are deny-listed by constant. So
forcing the marker on the command line changes nothing: the suite still skips, and the destructive
global-teardown purge stays disarmed for the same reason.

That deny-list is deliberate (decision-25). This suite provisions users, orgs, boards, items and
real Storage objects — and DEV holds the live, user-facing data.

## Decision

Write the suite, ship it skipped, and **say plainly that its assertions have never executed**. Do
not relax the marker, point `.env.test` at DEV, or otherwise route around the guard to satisfy a
plan step. Where the plan and the codebase's own safety guard disagree, the guard wins and the plan
is wrong.

Compensating evidence was gathered instead, read-only against DEV, and recorded:

- `items` SELECT → `board_id IN (SELECT readable_board_ids())` — a foreign org's item is invisible,
  so `resolveItemScope` returns null and both handlers answer `"Item not found."`
- `attachments` INSERT WITH CHECK → `is_org_member(org_id) AND can_edit_board(board_id) AND
board_in_org(board_id, org_id) AND item_in_org(item_id, org_id)`
- `storage.objects` `attachments_obj_insert` → `can_edit_board((storage.foldername(name))[2]::uuid)`
  — the independent second layer, on the board segment of the path.

## Rationale

The tempting alternative — set `PULSE_TEST_DB=1` in `.env.local` — is exactly the failure the
deny-list was built to stop, and `integration-env.ts` says so in a comment: DEV is listed
"belt-and-suspenders so that even a mis-set `PULSE_TEST_DB=1` in `.env.local` can't aim the purge at
DEV." Weakening a guard to make a test run inverts the point of the test.

The subtler failure is silent: had the run been reported without reading the skip count, "4 skipped"
would have been filed as "4 passed" — a suite that skips proves nothing but looks identical to
success in a summary line. Same shape as [[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]].

## Consequences

- Positive: the guard is intact, DEV is unpolluted, and the security claim rests on live policy
  evidence rather than an unexecuted assertion.
- Negative: the four assertions are unverified until a throwaway Supabase project + `.env.test`
  exists. They typecheck and lint; nothing more is known about them.
- Open follow-ups: provision that test project — it would unblock this suite and the other ~70
  `*.integration.test.ts` files that skip for the same reason. Until then, treat "integration
  coverage" in any plan as aspirational, and have plans state the target project a suite needs
  rather than assuming DEV.

## Related

- [[2026-08-07-2032-mcp-column-metadata-and-attachments]]
- [[2026-08-04-gotcha-75-a-zero-row-repair-reports-success]]
