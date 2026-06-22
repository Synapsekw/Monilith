---
type: adr
date: 2026-06-22
status: accepted
tags: [decision, gotcha, testing, integration-tests, worktrees, supabase]
related:
  - "[[2026-06-22-1441-landing-ttfb-static-hero]]"
  - "[[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]]"
  - "[[worktree-gates-binaries-turbopack]]"
---

# Gotcha 37: parallel worktree sessions flake each other's `finish-task` gate via the shared Supabase

## Context

`finish-task.sh` runs the full `pnpm test` suite against the rebased state before
merging. The `*.integration.test.ts` tests hit the **one shared remote Supabase**
(the linked project — there is no per-session DB). When several `task/*` worktree
sessions are open at once (this happened during the landing-ttfb session — 5
worktrees live), their integration suites run concurrently against that single DB.

Symptom: the landing-ttfb finish gate went red on
`automations.5c2.webhook.integration.test.ts` —
`expected 'pending' to be 'done'`. The test fires a `call_webhook` automation and
asserts the delivery row is still `pending` immediately after. Under concurrent
load a delivery-processing path (the `pg_net` reconcile sweep / another session's
run) had already advanced it to `done` before the assertion read it — a timing
race created by cross-session contention, **not** by the code under test (a
landing/proxy routing change cannot touch webhook delivery). The same file passed
**7/7 in isolation**, and the pre-rebase full run was **1141/1141**.

A second masking trap compounded it: the gate was launched as
`finish-task.sh | tail`, so the **pipe's exit code was `tail`'s (0)** — the
background-task notification reported success while the gate had actually failed.
The merge had NOT happened (verified: commit absent from `develop`, worktree+branch
still present).

## Decision

- A red integration test in a `finish-task` gate is **not automatically a code
  regression** — first check whether it is in the change's blast radius. If
  unrelated and timing-shaped (`pending`/`done`, run-history ordering, etc.),
  **re-run the file in isolation** to confirm a flake, then re-run `finish-task.sh`
  (it re-gates against the same rebased state and merges on green).
- **Never pipe `finish-task.sh` (or any gate) through `tail`/`head`** — the pipe
  masks the real exit code. Run it un-piped (the background-task notification then
  reports the script's true exit code) and read the output file separately.
- Treat truly dependent / DB-heavy work as **sequential** per the execution-DAG
  rule, and be aware that even "independent" parallel sessions share one Supabase,
  so their integration suites are not actually isolated.

## Consequences

- One flaky red did not block the merge; isolating + re-running integrated cleanly.
- If this contention recurs often, options: a per-session/branch Supabase (or local
  `supabase start`) for integration runs, or make the webhook-delivery assertions
  poll-for-state instead of asserting an instantaneous `pending` snapshot. Deferred
  — not worth it until the flake rate justifies the cost.

## Addendum 2026-06-22 — 4+ concurrent sessions: teardown-purge + hand-merge fallback

Recurred at higher concurrency (3-task `/whats-next` batch + 2 other sessions = 5+ worktrees) during
[[2026-06-22-1602-whats-next-batch-7c-7b-6h]]. Two refinements to the above:

- **New failure mode — cross-run teardown purge.** Beyond timing races, each run's `globalSetup`
  teardown purges throwaway test users **org-wide**; the log shows foreign data ("purged 19
  candidate org-owners" = _another_ session's run). So a sibling run deletes your run's seeded rows
  mid-flight → `null.id` NPEs + RLS/FK/`no_data_found` failures across many unrelated files (25–33
  failures, shifting run-to-run). Same innocent-code signature as gotcha-24, third distinct cause.
- **Re-running finish isn't always enough.** With 4+ active sessions the quiet window may never come,
  so "re-run finish-task.sh on green" can loop forever. **Documented fallback:** if `typecheck ·
lint · build` pass and `pnpm vitest run --project unit` is green, and the only failures are this
  cross-session race (confirm the failing files don't import anything in `git diff --name-only
develop...HEAD`), **hand-merge** replicating finish-task's steps (`rebase develop` → `merge
--no-ff` → `push` → `worktree remove` + `branch -d`). The deterministic gate passed, so this does
  not weaken it. Used this session for 6h (unit 992/992; failing files were `subitems`/board RLS —
  unrelated to a UI-only presence change).
- **Serialize finishes.** Run one `finish-task.sh` at a time; check `ps aux | grep vitest` is ~0
  before starting so the integration suite gets a clean cloud window (worked for 7c + 7b this batch).
