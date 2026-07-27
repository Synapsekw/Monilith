---
type: spec
status: approved
date: 2026-06-18
phase: 5b-2
title: Automations — date-based (scheduled) triggers (Phase 5b-2)
tags: [project/monolith, spec, phase-5, automations, scheduler]
related:
  - "[[2026-06-18-phase-5b1-automations-design]]"
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-14-pulse-design]]"
  - "[[00-north-star]]"
---

# Phase 5b-2 — Automations: date-based (scheduled) triggers

## 1. Goal & context

Phase 5 (master spec §7, PRD F-9) is no-code **When / If / Then** automations. **5a** shipped the
in-DB engine (`status_changed` → notify / set*option). **5b-1** added the `item_created` +
`person_assigned` triggers and the optional multi-condition **"If"** gate — all \_reactive* (fired
by row-level triggers on `cell_values` / `items`).

This slice (**5b-2**) adds the one trigger family that is **not** reactive: **date-based** triggers
— "when a date column is reached / is N days away / is N days overdue." These need a **scheduler**:
something must wake up on a clock (not a row write) and look for items whose date has arrived.

**Key correction to the 5b-1 spec's forward-note:** it assumed "there is currently no `pg_cron`."
That is wrong — **`pg_cron` 1.6.4 is available** in this Supabase project (listed,
`installed_version: null` — i.e. installable via `create extension`). `pg_net` and `pgmq` are also
available. So 5b-2 stays **entirely in-DB**, identical in execution/security model to 5a/5b-1, with
**no Edge Functions, no Vercel deploy, no external cron, no new secrets** — just one scheduled
Postgres sweep that reuses the existing `_automation_run` action runner.

### Decisions locked in brainstorming

- **Trigger semantics:** a single flexible **offset-from-date-column** trigger (`date_reached`),
  not recurring board schedules and not exact-date-only. Covers "due date arrives" (offset 0),
  "3 days before due" (offset −3), "2 days overdue" (offset +2).
- **Cadence + "today":** **org-local** timezone (not UTC). An **hourly** `pg_cron` sweep fires each
  org once per local day at a **fixed 08:00 local** target hour. Per-org target hour is deferred.
- **Timezone UX:** a **minimal `/settings` page** (the first real org-settings surface) with a
  timezone select; default `UTC`.
- **Mechanism:** `pg_cron` in-DB sweep (chosen over a scheduled Edge Function or Vercel Cron — both
  add infra that doesn't exist yet, for no benefit until 5c needs outbound HTTP).

### Non-goals (5b-2)

- **Recurring board-level schedules** ("every Monday 9am → create item") — no firing item, needs new
  action semantics (create-item) and a separate builder path. Deferred.
- **Per-org target hour** (orgs fire at a fixed 08:00 local for v1).
- **Per-user timezones** (org-level only).
- **Time-of-day precision / sub-day offsets** (day granularity only; "N days").
- **Business-day offsets** (calendar days only).
- **External/HTTP actions, Edge Functions, run-history UI** (→ 5c). The `automation_date_fires`
  ledger is engine-internal here; a 5c run-history can read it later.
- New **action** types beyond the existing notify / set_option.

## 2. Data model

Reuse the `automations` table (5a/5b-1). All changes additive; jsonb shapes stay open so 5c extends
without further `automations` DDL.

**(a) New `trigger` union member** (jsonb — Zod is the integrity guard, no DDL):

| `type`                     | shape                      | fires when                                                   |
| -------------------------- | -------------------------- | ------------------------------------------------------------ |
| `status_changed` _(5a)_    | `{ columnId, toOptionId }` | a status/dropdown cell changes                               |
| `item_created` _(5b-1)_    | `{}`                       | a new item is inserted on the board                          |
| `person_assigned` _(5b-1)_ | `{ columnId }`             | a People cell gains a user                                   |
| `date_reached` _(new)_     | `{ columnId, offsetDays }` | the date cell at `columnId` = org-local `today − offsetDays` |

- `columnId` must be a **date**-kind column on the board.
- `offsetDays` is a **signed** int: **negative = fires _before_** the date (`-3` = 3 days before),
  `0` = on the date, **positive = fires _after_** (`+2` = 2 days overdue). Range-bounded
  `[-365, 365]`.
- **Match rule (the sign in one line):** on the firing day, the rule matches items where
  `date_cell = today − offsetDays`. (`offsetDays = -3` → `today − (−3) = today + 3`, i.e. the date
  is 3 days out. `offsetDays = +2` → `today − 2`, i.e. the date was 2 days ago.)

**(b) `organizations.timezone`** — `text not null default 'UTC'`, an **IANA** name (e.g.
`Europe/Belgrade`). Validated server-side against the IANA set (and a DB `CHECK`/domain against
`pg_timezone_names` where practical). Existing orgs backfill to `'UTC'`.

**(c) New `automation_date_fires` ledger** — the once-only guard:

```
automation_date_fires (
  automation_id uuid not null references automations(id)    on delete cascade,
  item_id       uuid not null references items(id)          on delete cascade,
  org_id        uuid not null references organizations(id)  on delete cascade,
  fire_date     date not null,                 -- the org-local date the rule fired for
  fired_at      timestamptz not null default now(),
  primary key (automation_id, item_id, fire_date)
)
```

- **RLS enabled.** Org-scoped `select` policy (mirrors `columns`/`automations` — `is_org_member` /
  `board_in_org` patterns) so a future 5c run-history can read it. **No client insert/update/delete
  policy** — rows are written only by the `SECURITY DEFINER` sweep.
- The PK gives free idempotency: the sweep does `insert … on conflict do nothing` and runs actions
  **only when a row was actually inserted**.

**Indexes:**

- `automations_date_reached_idx on automations (board_id) where enabled and trigger->>'type' = 'date_reached'`
  (partial; mirrors 5b-1's `item_created` index).
- A **functional index on `cell_values ((value->>'date'))`** — ideally
  `(column_id, (value->>'date'))` — so the per-rule date match is an indexed lookup, not a scan.

RLS on `organizations` is unchanged except for the new column.

## 3. Execution: the scheduler + sweep (Postgres, in-DB)

**Extension + schedule** (versioned migration):

```sql
create extension if not exists pg_cron;   -- installs into the `cron` schema on Supabase
select cron.schedule(
  'automations-date-sweep',
  '0 * * * *',                            -- top of every hour
  $$ select public._automation_date_sweep() $$
);
```

`cron.schedule(jobname, …)` upserts by name → the migration is idempotent / re-runnable.

**`public._automation_date_sweep(p_now timestamptz default now())`** —
`language plpgsql security definer set search_path = ''`. `p_now` defaults to `now()` in production
but is injectable for deterministic tests. Logic:

1. For each **org** (`id`, `timezone`):
   - `local_now := p_now AT TIME ZONE org.timezone` (wall-clock in that org; DST-correct).
   - **Skip unless `extract(hour from local_now) = 8`** — the fixed **08:00 local** target hour.
     Thus each org fires exactly once per local day at its own 8am, though cron ticks hourly.
   - `today := local_now::date`.
2. For each **enabled `date_reached` automation** on that org's boards:
   - Find items whose date cell matches: `(cv.value->>'date')::date = today − offsetDays`, where
     `cv.column_id = trigger->>'columnId'` (the column already scopes to the board).
   - For each matched `item_id`:
     ```sql
     insert into public.automation_date_fires (automation_id, item_id, org_id, fire_date)
     values (rule.id, item_id, org.id, today)
     on conflict do nothing;
     -- if inserted (FOUND / row count = 1):
     perform public._automation_run(
       rule.id, rule.actions, rule.condition, item_id, org.id, rule.board_id, /* actor */ null);
     ```

**Reuse `_automation_run` (5b-1) verbatim:** it already does the **condition gate** +
notify/set_option loop. The single new wrinkle is **`actor := null`** (system-initiated; no human to
self-exclude from notifications). Confirm during build that `_automation_run` / the notify path
handle a null actor cleanly (no self-exclusion; the unread-dupe guard still applies). If the current
signature self-excludes on a non-null actor only, null already does the right thing.

**Idempotency & edge behavior:**

- PK `(automation_id, item_id, fire_date)` + `on conflict do nothing` ⇒ **exactly once** per
  rule/item/local-day. The hourly cron is safe to over-run; a manual sweep invocation is safe.
- **No backfill:** matching is **exact** (`date_cell = today − offsetDays` on the firing day), so a
  missed sweep day is simply skipped — never a notification storm when cron resumes.
- **Date moved:** changing the date cell makes it match on a different day → fires again for the new
  date (a new `fire_date`; desirable). `set_option` actions re-enter the `cell_values` trigger and
  stay bounded by the existing depth-cap loop guard (`pulse.aut_depth`, gotcha-17 GUC fix preserved).
- **Disabled / deleted:** disabled rules are excluded by the partial index predicate; deleting a
  rule or item cascade-cleans its ledger rows.

## 4. Server Actions + validation

**Validation** (`src/lib/validations/automations.ts`) — extend the discriminated union:

```ts
z.object({
  type: z.literal("date_reached"),
  columnId: z.string().uuid(),
  offsetDays: z.number().int().min(-365).max(365),
});
```

`createAutomationSchema` / `updateAutomationSchema` already pass `trigger` through — **no change**.

**Org timezone** — new `updateOrgTimezoneSchema` (`{ timezone: string }`, validated against the IANA
set) and a Server Action `updateOrgTimezone` in `src/lib/org/actions.ts` (or the existing org lib):

- Re-validate the timezone server-side against `Intl.supportedValuesOf('timeZone')` (never trust the
  client).
- Derive `org_id` from the caller's membership; write `organizations.timezone`.
- **Authorization:** gated to org **admins** (role check + RLS). Confirm the `org_members.role` model
  during planning and mirror the existing admin-gating pattern; if no admin concept exists yet, fall
  back to "any member" and note the gap.

No new **automation** Server Actions; `getAutomations` / `listAutomations` return the new trigger
shape once types are regenerated.

## 5. Client

**Settings page** (`pulse-ui` skill):

- New `/settings` route — RSC page, authed + org-member guarded; the first real org-settings home.
  For 5b-2 it holds a **General** card: org name (read-only ok) + a **timezone** control. Linked
  from the app shell (sidebar footer or user menu → "Settings").
- `TimezoneForm` (client) — searchable `<Select>` populated from
  **`Intl.supportedValuesOf('timeZone')`** (full IANA list, zero DB round-trip), defaulting to the
  org's current value; saving calls `updateOrgTimezone`.

**Automation builder** (`AutomationBuilder`):

- The trigger-type selector gains **"Date reached."** Selecting it renders a **date-column** picker
  (only `date`-kind columns) + an **offset control**:
  `[ On the date ▾ | N days before | N days after ]` + a number input → mapped to the signed
  `offsetDays` (before → negative, after → positive, on → 0).
- The **If** condition section and **Then** action list (notify / set_option) are unchanged. Unlike
  `item_created`, date triggers fire on items that already have their cells, so **notify/owner**
  (first assignee) and cell-conditions behave normally here.

**Dialog summaries** (`AutomationsDialog`): render the new trigger —
_"When **Due date** is reached / is in 3 days / is 3 days overdue, [if …,] notify the owner."_

**Recipes** — add two:

- "When **Due date** is in 3 days → notify owner" (`offsetDays: -3`, notify/owner).
- "When **Due date** is reached → set Status → _(pick)_" (`offsetDays: 0`, set_option).

Only date columns appear in the `date_reached` column picker; the rest of the builder (condition
columns status/text/numbers/date, action pickers) is unchanged.

## 6. Realtime

No new wiring. `notify` inserts flow through the per-user `notifications` Realtime → inbox bell;
`set_option` writes flow through the existing `cell_values` Realtime → board. The rules list stays
optimistic-update + refetch-on-open.

## 7. Testing

The sweep is exercised by calling **`_automation_date_sweep(p_now)` directly with an injected
clock** — deterministic; we never wait on wall-clock cron.

**Integration (cloud RLS + engine; extend the existing engine integration suite):**

- Fires when `date_cell = today − offsetDays` across **before / on / after** offsets.
- **Org-local correctness:** the same `p_now` instant fires org-A (timezone where it's 08:00 local)
  but **not** org-B (where it isn't).
- **Idempotency:** running the sweep twice for the same local day fires **once** (ledger
  `on conflict`).
- **No-backfill:** a sweep on a later day does **not** fire a date that was missed.
- **Date-moved → re-fires** for the new date (new `fire_date`).
- **Condition gate** passes/blocks (reuses 5b-1 machinery); **disabled** rules silent;
  **cross-org isolation**; RLS denies cross-org access to `automation_date_fires` and to
  `organizations.timezone` updates by non-admins.
- **Regressions:** 5a/5b-1 triggers + depth-cap loop guard unchanged.
- **Cron registration:** assert the `automations-date-sweep` job exists in `cron.job`.

**Unit:** discriminated-union schema (valid + out-of-range `offsetDays`); builder offset↔`offsetDays`
mapping; sentence summaries; recipe prefills; `updateOrgTimezoneSchema` validation; `TimezoneForm`.

**e2e (Playwright):** settings page changes + persists a timezone; build "When Due date reached →
set Status," set a due date = today, invoke the sweep, assert the cell updates.

## 8. Non-functional

- **Performance & data-fetching budget:** settings page = one-shot RSC read (org row); the timezone
  form + builder are **pure client state** — 0 new server round-trips on interaction; saves are
  Server Actions with targeted revalidation (no `<Link>`/router nav, no RSC re-run). The sweep uses
  **indexed** lookups only (partial index on `date_reached` rules; functional date index on
  `cell_values`) — bounded, no scans, no unbounded `select *`.
- **Security:** RLS is the boundary — `automation_date_fires` default-deny (org-scoped `select`,
  definer-only insert); the `pg_cron` job, `_automation_date_sweep`, and `_automation_run` are all
  `SECURITY DEFINER set search_path = ''`; timezone validated server-side; settings admin-gated;
  actions write only within the firing row's `org_id`/`board_id`.
- **Schema discipline:** all changes via versioned migrations in `supabase/migrations/`
  (`create extension if not exists pg_cron`; `cron.schedule` upsert; `organizations.timezone`; the
  ledger; indexes; `_automation_date_sweep`). After applying: regenerate
  `src/types/database.types.ts` (`pnpm db:types`, filtering the PostHog telemetry line), run
  advisors, **pin `search_path`** on every new function. (`pg_cron` installs into the `cron` schema —
  keeps `public` clean.)
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + the integration
  - e2e evidence in §7, before any completion claim.

## 9. Risks / notes

- **`pg_cron` is a new project dependency** — installed via migration. Verify the job runs in the
  `postgres` database and is visible in `cron.job`; tests drive the sweep function directly (not the
  cron tick) so CI never waits on a clock.
- **DST** is handled correctly by `AT TIME ZONE` (the sweep recomputes local time each run).
- **Fixed 08:00 local hour** means orgs can't choose their send time yet (deferred). An org in an
  exotic offset still fires once/day at its local 8am.
- **`actor := null`** path through `_automation_run` must not self-exclude or NULL-deref — verified
  in build + tested.
- **No org-settings surface exists today** — `/settings` is new; confirm app-shell nav + the
  `org_members.role` admin model during planning.
- **Migrations (suggested split):** (1) `organizations.timezone` column + backfill + the
  `automation_date_fires` ledger + RLS + indexes + the `date_reached` partial index; (2) the engine —
  `_automation_date_sweep` + `create extension pg_cron` + `cron.schedule`. Keep jsonb shapes open so
  5c (external actions + run-history) extends without further `automations` DDL.
  </content>
  </invoke>
