# Plan — make the first weekly digest backlog-safe (and a skipped run observable)

**Status:** implemented 2026-07-27 · branch `task/digest-backlog-safe`

## The problem, measured

The weekly health digest shipped 2026-07-03. In **production it has never fired once**:
`digest_runs` has 0 rows ever. `vault.secrets` holds `app_url` and `ai_pgnet_hmac_secret` but
**not `digest_secret`**, so `public._health_digest_ping()` takes its early-return branch every
morning. That branch does `raise notice` — a NOTICE is not persisted anywhere queryable, and
`cron.job_run_details` records the job as **`succeeded`**. The gap is therefore structurally
invisible: nothing to read, nothing to alert on. `/sync-prod` pushes schema, never Vault secrets,
so it can never close this gap either.

### What the first run would actually send today

Two separate things get conflated as "three weeks of backlog". Only one of them is real:

1. **There is no "period since last run" window, and no catch-up loop.** `runWeeklyDigest`
   hardcodes `since = now − 7 days`. `currentDigestPeriod` computes the current Mon..Sun UTC week
   and is used **only** as the `digest_runs` idempotency key. With `digest_runs` empty the run
   claims the _current_ week for each org and stops — it does **not** iterate the weeks since
   2026-07-03. So the first tick is **one** digest per org, not three.

2. **The content of that one digest is unbounded.** `_org_health_digest` delegates counting to
   `_board_health_counts`, which applies `p_since` to **`new_items` only**. `overdue_items`,
   `incomplete_items` and `incomplete_sample` are **all-time, current-state** figures. So the email
   headed "Weekly plan health / Week of <Monday>" would in fact announce every overdue and
   structurally-incomplete item accumulated since the org was created.

Production numbers on 2026-07-27 (read-only, via `supabase-prod` MCP):

| Signal                                      | Value                         |
| ------------------------------------------- | ----------------------------- |
| top-level items, all orgs                   | 229 (largest org: 202)        |
| items created in the trailing 7 days        | **0** — across every org      |
| past-due item dates, all-time               | 51, oldest due **2026-06-17** |
| past-due item dates that fell inside 7 days | **7**                         |

So the first email would have read **"0 new activities · <all-time incomplete> structurally
incomplete · 51 overdue"**, with per-board "Incomplete: …" name lists up to 6 weeks stale — a
weekly digest whose entire body is backlog and whose current-period content is zero. That is the
real hazard, and it is _not_ fixed by delaying the first send.

## Decision

**Bound the digest's content to the period it claims to cover.** `_org_health_digest` becomes
genuinely period-scoped:

| Column                       | Before                  | After                                             |
| ---------------------------- | ----------------------- | ------------------------------------------------- |
| `new_items`                  | created ≥ `p_since`     | unchanged                                         |
| `overdue_items`              | **all-time** overdue    | became overdue **inside** the window              |
| `incomplete_items`           | **all-time** incomplete | created inside the window **and** incomplete      |
| `incomplete_sample`          | **all-time**, newest 5  | window-scoped, newest 5                           |
| `total_items` / `done_items` | board totals            | unchanged (context columns, no names, no backlog) |

`_board_health_flags` gains one output column, `overdue_since text` — the earliest past-due date
among the item's date cells, `null` when the item is not overdue. It is the single place the
overdue predicate lives, so the "newly overdue" test is derived from it rather than duplicated.

### Why this mechanism, and not the alternatives

- **Rejected — seed a baseline `digest_runs` row per org.** It suppresses exactly one tick. Next
  Monday's digest still carries the identical all-time backlog, because the backlog lives in the
  _content_, not in the _schedule_. It defers the incident by seven days and adds a data migration
  that has to be re-run for every future org.
- **Rejected — a "since last run" window with a sane default.** This is the mechanism the brief
  anticipated, but the code has no such window to fix: `since` is already a fixed 7 days. Adding
  last-run derivation would _introduce_ the replay hazard it was meant to prevent.
- **Chosen — period-scope the content.** It needs no seed data, no first-run special case and no
  per-org state, so it is **correct for a genuinely fresh org by construction**: a brand-new org's
  first digest covers its first week because that is all that exists. Nothing anywhere can widen
  the window, so no run — first or thousandth — can replay history. It also makes the
  implementation match the contract the code already documented ("the digest's stats window is a
  trailing 7 days at send time") and matches what a _weekly_ digest should say: what changed this
  week. Standing totals remain available in-app — `dashboard_health_summary` (the health widget)
  is deliberately **left untouched** and still reports all-time state.

Effect on prod's first run: 0 new items and 7 newly-overdue dates across all orgs, so most orgs
finalize `skipped` with no email at all, and no org receives a backlog dump.

### Guard: a skipped run must be observable

`digest_runs` gains a **`blocked`** status and a nullable `org_id` (a run blocked before any org is
considered belongs to no org). A partial unique index `(period_start) where org_id is null` bounds
it to one row per ISO week, so a permanently-unprovisioned deployment writes 52 rows a year, not
365 — and an unauthenticated POST to the route cannot spam it.

Both provisioning gates now record:

| Gate                                                | Before                                | After                                                                           |
| --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| DB: `vault.decrypted_secrets` lacks `digest_secret` | `raise notice`, cron says `succeeded` | `raise warning` **and** a `blocked` `digest_runs` row naming the missing secret |
| App: `DIGEST_SECRET` env unset (route 503)          | silent 503                            | `console.warn` **and** a `blocked` `digest_runs` row                            |

One query answers "has the digest ever been blocked?":

```sql
select period_start, status, error, created_at
from public.digest_runs where status = 'blocked' order by period_start desc;
```

## Performance & data-fetching budget (working agreement #5)

No UI. The hot path is the daily cron pass, unchanged in shape: ≤200 orgs, ≤200 boards/org,
≤200 recipients/org, all pre-existing caps. `_board_health_flags` is now called twice per board
instead of three times (counts + samples, was counts + 2 samples via `_board_health_counts`), over
the same `items_board_id_idx` / `items_parent_id_idx` / `cell_values` PK access paths. The blocked
row is one bounded insert per week.

## Execution DAG (working agreement #6)

Single-agent task; the units are dependency-ordered rather than parallel.

- **T1** window helper (`period.ts`) + `run.ts` wiring — Consumes: nothing. Produces:
  `digestWindowStart`, `DIGEST_WINDOW_DAYS`.
- **T2** blocked-run recorder + route guard — Consumes: `currentDigestPeriod` (T1 file, no new
  symbol). Produces: `recordDigestBlocked`.
- **T3** migration (flags column, period-scoped digest, `blocked` status, ping guard) — Consumes:
  T2's `blocked` status contract. Produces: schema + regenerated types.

Graph: T1 → (nothing); T2 → T3. Batches: **{T1, T2}** then **{T3}**. Critical path T2 → T3.
Wall-clock floor is T3 (migration + DEV verification + type regen).

## Verification

- Unit tests (`pnpm test`): first-run window with `digest_runs` empty; window independent of run
  history; blocked row + warn on the DB-unprovisioned and app-unprovisioned paths.
- DEV: migration applied via `supabase-dev` MCP at the same version+name; period-scoping proven
  against seeded fixture data inside a transaction that is rolled back; `_health_digest_ping()`
  executed with no `digest_secret` present and the `blocked` row asserted; `pnpm db:ledger-check`.
- **No production Vault write and no email to any real user** — prod was read-only throughout.
