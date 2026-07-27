---
type: session
date: 2026-07-27-0659
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-27-decision-30-conformance-probes-third-test-tier]]"
  - "[[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]]"
  - "[[2026-07-25-1620-group-1-closeout-security-and-deletion]]"
---

# Batch A built and merged, plus a conformance test tier that needs no infrastructure

## What changed

- **Drift reconciled first (`7491412`).** `/whats-next` found §3 materially stale: promotion #73 and
  `/sync-prod` had _both_ already shipped, so "PROD IS STILL EXPOSED" was false — prod verifies at
  114 definers, 0 anon-executable. Also corrected the stale "38 suites" comments (there are 69).
- **Four merges, no schema change** (ledger stays 115 = 115 = 115): `6a5aa0e` anon conformance
  probes · `ad5fb8a` F1 MCP assigned-notification · `4436350` Report Builder v2 charts · `c58e890`
  Ask Monolith Phase 2 write actions. 70 files, +12,479 lines.
- **F1** hoisted `upsertCellCore(supabase, input, actorId)` into its own non-`"use server"` module so
  MCP writes inherit the `assigned` fan-out. Explicit actor, no `auth.getUser()` in the core — which
  also drops a GoTrue round-trip per UI people-write and N per `bulkSetCell`.
- **Report charts** are hand-rolled static SVG/CSS after a spike proved recharts 3.x renders a
  127-char empty wrapper under `renderToStaticMarkup` (it builds geometry in effects; the PDF page
  runs no JS). `REPORT_CONFIG_VERSION` stays at `1` — bumping would 500 the reports list for every
  existing report.
- **Ask Monolith Phase 2** ends the turn at the confirm card, persists proposals in the existing
  `ai_messages.tool_trace`, and appends an outcome turn on Approve/Cancel because `ai_messages` has
  no UPDATE policy.
- **Two ADRs:** [[2026-07-27-decision-30-conformance-probes-third-test-tier]] and
  [[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]].

## Why

The security boundary had no gate. 43 RLS suites and the definer-ACL regression test have never run,
because every integration suite is coupled to a destructive teardown that requires a sacrificial
Supabase project. With a third project and Docker both ruled out, the fix was to notice the deny-list
protects against _writes_, not _reads_ — so a read-only, anon-key-only probe suite gets most of the
value for nothing. Batch A itself was the roadmap unblocking after the Group-1 closeout.

## How to test

1. Pull `develop`, `pnpm dev`. **F1:** from Claude Desktop, assign a teammate to an item via MCP;
   that teammate should now get an "assigned you" notification (previously none). Assign yourself —
   no notification. Disable their `assigned` pref and repeat — nothing arrives.
2. **Charts:** open a board with a status column of ≥3 values → Reports. An existing report shows a
   new **Chart** row, unchecked, preview unchanged. Tick it → donut. Switch to Bars → zero new
   network requests. Save → Export PDF → compare against the preview segment for segment, then view
   in grayscale.
3. **Ask Monolith:** at `/ask`, ask _"create a task called Ship v2 in Backlog on \<board\>, due Friday"_
   → lead-in streams, then a **Proposed action** card; nothing is written yet. Reload — the card
   survives. Approve → "Applied." plus an outcome turn. Cancel on another → "nothing was changed."
   Approve the same proposal in two tabs → the second reports it already resolved.
4. **Conformance:** `pnpm test:conformance` (aims at DEV). For prod, set `CONFORMANCE_TARGET_URL` +
   `CONFORMANCE_TARGET_ANON_KEY`. Both currently report 0 reachable, 0 readable.

## Open threads

- **A dropped `/ask` stream renders as total silence** — no error, no "reload to see the reply", even
  though the turn succeeded and persisted. Real user-facing bug on flaky connections; own task.
- **Tier 2 not built:** the `authenticated` half of the security boundary is still ungated. Plan is
  two permanent fixture users/orgs seeded once in DEV, never mutated, making isolation assertions
  read-only. Ask Monolith Phase 2 shipped 2 RLS tests that have never executed.
- **The 69 integration suites still report "skipped"** every run — coverage theatre until quarantined
  or deleted.
- **Report Builder v2 remainder:** roll-ups + org templates, both blocked by `reports.board_id NOT NULL`,
  sharing one migration.
- Unchanged and still needing the owner: prod `digest_secret` (digest has never fired), E5 embeddings
  backfill + Vercel env var, MCP end-to-end connection test, E6 Stripe creds.
- Contention artifacts when running 3 heavy builds at once: `finish-task.sh` had two output-less
  `pnpm test` failures, and `AiDashboardWizard.test.tsx` flaked once. Stagger next time.

## Next session entry point

Promote `develop → main` — it carries all four merges with no schema change, so `/sync-prod` is not
required first (the inverse of last session's ordering constraint). After that: the silent-dropped-stream
fix, Tier 2 fixtures, or Report Builder v2 roll-ups.
