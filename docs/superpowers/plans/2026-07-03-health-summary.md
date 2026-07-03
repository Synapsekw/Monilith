# Health Summary + Alerts + Weekly Email Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-config `health` dashboard widget (overall progress + overdue / structurally
incomplete / new-this-week counts), a weekly `health_digest` in-app notification, and a weekly
email digest to org members — pg_cron → authenticated app route → Resend HTTP API, with
idempotent send tracking and a per-user opt-out.

**Architecture:** Two migrations (rule core `_board_health_flags`/`_board_health_counts` + widget
RPC; digest infra: `digest_runs` ledger, `_org_health_digest`, cron ping via pg_net + Vault). The
widget rides the Phase 9.3b widget-aggregation cache and the batched `getWidgetsData` action
(completion-widget template, verbatim). The digest route composes everything in TS (period, HMAC
unsubscribe tokens, HTML render, Resend batch send via plain `fetch` — no new dependency) and
degrades to in-app-only when `RESEND_API_KEY` is absent.

**Tech Stack:** Next.js 16 (App Router, Server Actions, route handlers, `use cache`), Supabase
(Postgres RPC, RLS, pg_cron, pg_net, Vault), Zod, TanStack Query, Vitest + RTL, Tailwind v4
tokens (pulse-ui), Resend HTTP API.

**Spec:** `docs/superpowers/specs/2026-07-03-health-summary-design.md` — read it first; it holds
the rule semantics, the email-mechanism decision, and the perf budget this plan implements.

## Global Constraints

- Commit identity: `Danijel Jovanovic <info@synapse-solutions.ai>`; commit subjects lowercase
  after `type(scope):`; every commit gets a descriptive body + trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Stage explicitly by path (`git add <paths>`) — never `git add -A` / `-a`.
- **Migrations are applied to cloud dev manually by the user** (agent tooling is blocked from
  `db push` / DDL). Tasks 1 and 2 have explicit STOP-and-hand-off steps; `pnpm db:types` runs
  only after the user confirms the SQL is applied.
- **Migration version slots are owned:** this branch uses `20260703120000` and `20260703121000`
  ONLY (gotcha-43 — parallel siblings mint other slots; never re-timestamp).
- This branch owns a schema change → it regenerates `src/types/database.types.ts`; per gotcha-43
  the regen may pull sibling branches' enum values from the shared dev DB — commit the union.
- TypeScript strict, no `any`. Semantic tokens only in UI (`bg-muted`, `text-destructive`, …) —
  no raw Tailwind colors.
- Never write arbitrary-value Tailwind classes (square-bracket `var(...)` form) as literals in
  **markdown docs** (Tailwind scans committed `.md`; known build-breaker). In `.tsx` they're fine.
- New server env vars are **optional** in `src/lib/env.server.ts` (CI has no secrets — the
  env-boot-validation gotcha); the digest feature self-disables without them.
- All four gates must pass at the end: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## File structure (what exists / what changes)

| File                                                          | Change                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `supabase/migrations/20260703120000_health_summary.sql`       | **Create** — enum values, `notifications.payload`, rule core, widget RPC        |
| `supabase/migrations/20260703121000_health_digest.sql`        | **Create** — opt-out column, `digest_runs`, digest RPC, cron ping               |
| `src/types/database.types.ts`                                 | Regenerated (`pnpm db:types`) — never hand-edit                                 |
| `src/lib/digest/period.ts` (+ `.test.ts`)                     | **Create** — `currentDigestPeriod`                                              |
| `src/lib/digest/token.ts` (+ `.test.ts`)                      | **Create** — unsubscribe HMAC sign/verify                                       |
| `src/lib/digest/render.ts` (+ `.test.ts`)                     | **Create** — `renderDigestHtml` / `renderDigestText`                            |
| `src/lib/validations/digest.ts` (+ `.test.ts`)                | **Create** — digest payload/row Zod schemas                                     |
| `src/lib/validations/dashboards.ts` (+ `.test.ts`)            | Add `"health"` kind + `healthConfigSchema`                                      |
| `src/lib/dashboards/widget-data.ts` (+ `.test.ts`)            | Add `HealthCounts` / `shapeHealth`                                              |
| `src/lib/dashboards/queries-cached.ts`                        | Add `getWidgetHealthCached`                                                     |
| `src/lib/dashboards/actions.ts` (+ `.test.ts`)                | `resolveWidgetAggregate` health branch; payload gains `health?`                 |
| `src/lib/dashboards/use-widget-data.tsx` (+ `.test.tsx`)      | Batch includes health kind; `WidgetData.health`                                 |
| `src/components/dashboards/widgets/HealthWidget.tsx` (+ test) | **Create** — widget body                                                        |
| `src/components/dashboards/DashboardWidget.tsx`               | Render switch gains health                                                      |
| `src/components/dashboards/WidgetConfigSheet.tsx`             | Preview switch gains health                                                     |
| `src/components/dashboards/WidgetConfigForm.tsx` (+ test)     | `health` option + helper-text branch + `defaultConfig`                          |
| `src/components/notifications/NotificationsList.tsx` (+ test) | `health_digest` label case                                                      |
| `src/components/notifications/NotificationsBell.tsx`          | `health_digest` click-through → `/dashboards`                                   |
| `src/lib/env.server.ts` (+ existing test if present)          | Optional `DIGEST_SECRET`, `RESEND_API_KEY`, `APP_BASE_URL`, `DIGEST_FROM_EMAIL` |
| `.env.example`                                                | Document the four new vars                                                      |
| `src/lib/digest/run.ts` (+ `.test.ts`)                        | **Create** — `runWeeklyDigest` orchestration                                    |
| `src/app/api/digest/run/route.ts`                             | **Create** — POST handler (cron target)                                         |
| `src/app/api/digest/unsubscribe/route.ts`                     | **Create** — GET one-click unsubscribe                                          |
| `src/lib/settings/digest-actions.ts` (+ `.test.ts`)           | **Create** — `setEmailDigestOptOut` Server Action                               |
| `src/components/settings/DigestPreferenceForm.tsx` (+ test)   | **Create** — Settings toggle                                                    |
| `src/app/(app)/settings/page.tsx`                             | Mount the preference form                                                       |
| `src/lib/dashboards/health-summary.integration.test.ts`       | **Create** — RPC semantics + auth contract                                      |

---

### Task 1: Migration A — enum values, `notifications.payload`, rule core, widget RPC + types regen

**Files:**

- Create: `supabase/migrations/20260703120000_health_summary.sql`
- Modify (generated): `src/types/database.types.ts`

**Interfaces:**

- Consumes: existing tables `items` (`parent_id`, `created_at`, `items_board_id_idx`,
  `items_parent_id_idx`, `items_board_created_idx`), `columns` (`kind`, `position`,
  `settings.options`), `cell_values` (PK `(item_id, column_id)`), `boards`, `notifications`;
  helper `public.is_org_member(uuid)`.
- Produces:
  - enum `public.widget_kind` gains `'health'`; enum `public.notification_kind` gains
    `'health_digest'`; `public.notifications.payload jsonb` (nullable).
  - `public._board_health_flags(p_board_id uuid) returns table (item_id uuid, item_name text,
item_created_at timestamptz, is_done boolean, is_overdue boolean, is_incomplete boolean)` —
    internal (no authenticated grant). **The single rule implementation** — Task 2's digest RPC
    reuses it.
  - `public._board_health_counts(p_board_id uuid, p_since timestamptz) returns table
(total_items int, done_items int, overdue_items int, incomplete_items int, new_items int)` —
    internal aggregate over the flags.
  - `public.dashboard_health_summary(p_board_id uuid)` — same five columns, member-guarded,
    granted to `authenticated`. After regen, TS callers get
    `supabase.rpc("dashboard_health_summary", { p_board_id })` → one row
    `{ total_items, done_items, overdue_items, incomplete_items, new_items }`, and
    `Tables<"notifications">` gains `payload: Json | null`.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260703120000_health_summary.sql`:

```sql
-- Health summary widget + digest vocabulary (MVP Final item 8).
-- Rule semantics mirror src/lib/boards/overdue.ts exactly (the shipped tint):
--   done      ⇔ first status column's option label ~* '(done|complete)'
--   overdue   ⇔ any date-kind cell with coalesce(end, date) < today, and not done
--   incomplete⇔ not done AND (owner missing in first people column OR date missing
--               in first date column); each criterion skipped when the board has
--               no column of that kind. Top-level items only (parent_id is null).
-- NOTE: added enum values must NOT be used later in this same migration
-- (PG allows ADD VALUE in a transaction only if unused within it) — they aren't.

alter type public.widget_kind add value if not exists 'health';
alter type public.notification_kind add value if not exists 'health_digest';

-- Digest notifications carry their numbers inline (rendered client-side without a
-- join). Written only by the service-role digest path; the existing insert policy
-- (actor_id = auth.uid()) is unchanged.
alter table public.notifications add column if not exists payload jsonb;

-- Per-item rule evaluation — THE single implementation of the structural-
-- completeness + overdue predicates. Internal: no grant to authenticated.
create or replace function public._board_health_flags(p_board_id uuid)
returns table (
  item_id uuid,
  item_name text,
  item_created_at timestamptz,
  is_done boolean,
  is_overdue boolean,
  is_incomplete boolean
)
language sql stable security definer set search_path = '' as $$
  with cols as (
    select
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_col,
      (select c.settings from public.columns c
        where c.board_id = p_board_id and c.kind = 'status'
        order by c.position asc limit 1) as status_settings,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'people'
        order by c.position asc limit 1) as people_col,
      (select c.id from public.columns c
        where c.board_id = p_board_id and c.kind = 'date'
        order by c.position asc limit 1) as date_col
  ),
  base as (
    select
      i.id,
      i.name,
      i.created_at,
      exists (
        select 1
        from public.cell_values cv,
             jsonb_array_elements(
               coalesce(cols.status_settings -> 'options', '[]'::jsonb)) opt
        where cv.item_id = i.id
          and cv.column_id = cols.status_col
          and opt ->> 'id' = cv.value ->> 'optionId'
          and opt ->> 'label' ~* '(done|complete)'
      ) as is_done,
      exists (
        select 1
        from public.cell_values cv
        join public.columns c on c.id = cv.column_id and c.kind = 'date'
        where cv.item_id = i.id
          and coalesce(cv.value ->> 'end', cv.value ->> 'date')
              < current_date::text
      ) as has_past_due,
      (cols.people_col is not null) as has_people_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.people_col
          and jsonb_array_length(coalesce(cv.value -> 'userIds', '[]'::jsonb)) > 0
      ) as has_owner,
      (cols.date_col is not null) as has_date_col,
      exists (
        select 1 from public.cell_values cv
        where cv.item_id = i.id and cv.column_id = cols.date_col
          and cv.value ->> 'date' is not null
      ) as has_date
    from public.items i
    cross join cols
    where i.board_id = p_board_id and i.parent_id is null
  )
  select
    id,
    name,
    created_at,
    is_done,
    (has_past_due and not is_done) as is_overdue,
    (not is_done and (
      (has_people_col and not has_owner) or (has_date_col and not has_date)
    )) as is_incomplete
  from base
$$;

revoke execute on function public._board_health_flags(uuid)
  from public, anon, authenticated;

-- Aggregate for the widget + digest counts. Internal.
create or replace function public._board_health_counts(
  p_board_id uuid,
  p_since timestamptz
) returns table (
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer
)
language sql stable security definer set search_path = '' as $$
  select
    count(*)::int,
    count(*) filter (where f.is_done)::int,
    count(*) filter (where f.is_overdue)::int,
    count(*) filter (where f.is_incomplete)::int,
    count(*) filter (where f.item_created_at >= p_since)::int
  from public._board_health_flags(p_board_id) f;
$$;

revoke execute on function public._board_health_counts(uuid, timestamptz)
  from public, anon, authenticated;

-- Widget RPC: member-guarded single-row read, trailing-7-day "new" window.
create or replace function public.dashboard_health_summary(p_board_id uuid)
returns table (
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.boards where id = p_board_id;
  if v_org_id is null then
    raise exception 'board not found' using errcode = 'P0002';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  return query
    select * from public._board_health_counts(p_board_id, now() - interval '7 days');
end; $$;

grant execute on function public.dashboard_health_summary(uuid) to authenticated;

-- Access paths: items_board_id_idx (board filter), items_parent_id_idx (top-level
-- predicate), cell_values PK (item_id, column_id) for the per-item lookups,
-- items_board_created_idx for the new-items window. Output: one row.
```

- [ ] **Step 2: STOP — hand the SQL to the user for manual apply**

Agent tooling cannot push migrations or run DDL against cloud dev (classifier-blocked). Post
the full file content and ask the user to run it against the **dev** project (SQL editor), then
confirm. Do not proceed until confirmed. Remind: the same file ships in the repo so
`supabase/migrations/` stays the source of truth; if applied under a different version string,
note the `migration repair` gotcha (memory: supabase migration ledger drift).

- [ ] **Step 3: Verify and regenerate types**

Verify (read-only, via MCP `execute_sql` or ask the user):
`select proname from pg_proc where proname in ('dashboard_health_summary','_board_health_flags','_board_health_counts');` → 3 rows.

Run: `pnpm db:types`
Expected: `database.types.ts` diff shows `widget_kind` gaining `"health"`,
`notification_kind` gaining `"health_digest"`, `notifications.payload: Json | null`, and a
`dashboard_health_summary` entry under `Functions`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (enum widening is additive; `NotificationsList`'s `label()` has a `default`
branch; the widget render chain has a fallback branch).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703120000_health_summary.sql src/types/database.types.ts
git commit -m "feat(db): health rule core + dashboard_health_summary rpc"
```

(Body: rule semantics + parity with overdue.ts, manual-apply note, internal-function revokes.
Trailer per Global Constraints.)

---

### Task 2: Migration B — opt-out column, `digest_runs`, digest RPC, cron ping + types regen

**Files:**

- Create: `supabase/migrations/20260703121000_health_digest.sql`
- Modify (generated): `src/types/database.types.ts`

**Interfaces:**

- Consumes: Task 1's `_board_health_flags` / `_board_health_counts` (deployed); existing
  `profiles`, `organizations`, `boards`; extensions `pg_cron`, `pg_net`; Supabase Vault.
- Produces:
  - `public.profiles.email_digest_opt_out boolean not null default false`.
  - table `public.digest_runs` (`id`, `org_id`, `period_start date`, `period_end date`,
    `status text` in `pending|sent|skipped|failed`, `stats jsonb`, `email_sent_count int`,
    `error text`, `created_at`, `completed_at`, **unique `(org_id, period_start)`**) — RLS
    enabled, zero policies (service-role only). Tasks 8/10 rely on these exact column names.
  - `public._org_health_digest(p_org_id uuid, p_since timestamptz) returns table (board_id
uuid, board_name text, total_items int, done_items int, overdue_items int,
incomplete_items int, new_items int, new_sample jsonb, incomplete_sample jsonb)` —
    internal; only boards with a nonzero overdue/incomplete/new count return rows.
  - cron job `health-digest-ping` (daily 07:00 UTC) → `public._health_digest_ping()` →
    `net.http_post` to `<vault:app_url>/api/digest/run` with `Bearer <vault:digest_secret>`;
    safe no-op (`raise notice`) until the two Vault secrets exist.

- [ ] **Step 1: Write the migration file**

`supabase/migrations/20260703121000_health_digest.sql`:

```sql
-- Weekly health digest infrastructure (MVP Final item 8).
-- pg_cron pings the app route daily; the route is idempotent per (org, week) via
-- digest_runs, so a failed Monday send retries automatically all week.

alter table public.profiles
  add column if not exists email_digest_opt_out boolean not null default false;

comment on column public.profiles.email_digest_opt_out is
  'Opt-out for the weekly health digest EMAIL only; in-app digest notifications are unaffected.';

create table if not exists public.digest_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'failed')),
  stats jsonb,
  email_sent_count integer,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (org_id, period_start)
);

-- Service-role only: RLS on, no policies (default deny for authenticated).
alter table public.digest_runs enable row level security;
create index if not exists digest_runs_org_id_idx on public.digest_runs (org_id);

-- Per-org digest payload: per-board counts + bounded name samples for the email.
-- Boards where overdue = incomplete = new = 0 are dropped. Bounded: 200 boards,
-- 5 sample names per list. Internal (service-role caller; no authenticated grant).
create or replace function public._org_health_digest(
  p_org_id uuid,
  p_since timestamptz
) returns table (
  board_id uuid,
  board_name text,
  total_items integer,
  done_items integer,
  overdue_items integer,
  incomplete_items integer,
  new_items integer,
  new_sample jsonb,
  incomplete_sample jsonb
)
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  c record;
begin
  for b in
    select bd.id, bd.name
    from public.boards bd
    where bd.org_id = p_org_id
    order by bd.created_at asc
    limit 200
  loop
    select * into c from public._board_health_counts(b.id, p_since);
    if c.total_items = 0
       or (c.overdue_items = 0 and c.incomplete_items = 0 and c.new_items = 0) then
      continue;
    end if;
    board_id := b.id;
    board_name := b.name;
    total_items := c.total_items;
    done_items := c.done_items;
    overdue_items := c.overdue_items;
    incomplete_items := c.incomplete_items;
    new_items := c.new_items;
    new_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.item_created_at >= p_since
        order by f.item_created_at desc
        limit 5
      ) x
    );
    incomplete_sample := (
      select coalesce(jsonb_agg(x.item_name), '[]'::jsonb)
      from (
        select f.item_name, f.item_created_at
        from public._board_health_flags(b.id) f
        where f.is_incomplete
        order by f.item_created_at desc
        limit 5
      ) x
    );
    return next;
  end loop;
end; $$;

revoke execute on function public._org_health_digest(uuid, timestamptz)
  from public, anon, authenticated;

-- Cron target: read app_url + digest_secret from Vault, POST the ping.
-- Fire-and-forget: the app route is the reliability boundary (idempotent claim +
-- daily retry); no pg_net response reconcile needed.
create or replace function public._health_digest_ping()
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'app_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'digest_secret';
  if v_url is null or v_secret is null then
    raise notice 'health digest: vault secrets app_url/digest_secret missing; skipping';
    return;
  end if;
  perform net.http_post(
    url := v_url || '/api/digest/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb
  );
end; $$;

revoke execute on function public._health_digest_ping()
  from public, anon, authenticated;

-- Daily at 07:00 UTC; job name is the upsert key (re-runnable migration).
select cron.schedule(
  'health-digest-ping',
  '0 7 * * *',
  $cron$ select public._health_digest_ping() $cron$
);
```

- [ ] **Step 2: STOP — hand the SQL to the user for manual apply + Vault provisioning**

Post the full file content; ask the user to run it against the **dev** project, and (when
they want email/cron live) to provision the two Vault secrets in the dashboard or SQL editor:

```sql
select vault.create_secret('<production origin, e.g. https://pulse.example.com>', 'app_url');
select vault.create_secret('<random 32+ byte secret — same value as DIGEST_SECRET env>', 'digest_secret');
```

Until provisioned, the cron job runs and no-ops with a notice — safe. Do not proceed until the
migration itself is confirmed applied.

- [ ] **Step 3: Verify and regenerate types**

Verify: `select jobname from cron.job where jobname = 'health-digest-ping';` → 1 row;
`select proname from pg_proc where proname in ('_org_health_digest','_health_digest_ping');` → 2 rows.

Run: `pnpm db:types`
Expected: diff shows `digest_runs` under `Tables` and `profiles` gaining
`email_digest_opt_out: boolean`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260703121000_health_digest.sql src/types/database.types.ts
git commit -m "feat(db): weekly digest infra (digest_runs, org rpc, cron ping)"
```

(Body: idempotency design, Vault provisioning note, service-role-only RLS stance. Trailer per
Global Constraints.)

---

### Task 3: Pure digest lib — period, unsubscribe token, Zod, email render

**Files:**

- Create: `src/lib/digest/period.ts`, `src/lib/digest/period.test.ts`
- Create: `src/lib/digest/token.ts`, `src/lib/digest/token.test.ts`
- Create: `src/lib/validations/digest.ts`, `src/lib/validations/digest.test.ts`
- Create: `src/lib/digest/render.ts`, `src/lib/digest/render.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks (pure TS + `node:crypto`).
- Produces (Tasks 7/8/9 import these exact names):

```ts
// src/lib/digest/period.ts
export type DigestPeriod = { periodStart: string; periodEnd: string }; // ISO dates (UTC week, Mon..Sun)
export function currentDigestPeriod(now?: Date): DigestPeriod;

// src/lib/digest/token.ts
export function unsubscribeSignature(secret: string, userId: string): string; // hex HMAC-SHA256("unsub:"+userId)
export function verifyUnsubscribeSignature(
  secret: string,
  userId: string,
  sig: string,
): boolean; // constant-time

// src/lib/validations/digest.ts
export const digestBoardRowSchema: z.ZodType<DigestBoardRow>; // camelCased _org_health_digest row
export type DigestBoardRow = {
  boardId: string;
  boardName: string;
  totalItems: number;
  doneItems: number;
  overdueItems: number;
  incompleteItems: number;
  newItems: number;
  newSample: string[];
  incompleteSample: string[];
};
export const digestNotificationPayloadSchema; // { newCount, incompleteCount, overdueCount, periodStart }
export type DigestNotificationPayload = z.infer<
  typeof digestNotificationPayloadSchema
>;

// src/lib/digest/render.ts
export type DigestEmailInput = {
  orgName: string;
  periodStart: string;
  totals: { newCount: number; incompleteCount: number; overdueCount: number };
  boards: DigestBoardRow[];
  appBaseUrl: string;
  unsubscribeUrl: string;
};
export function renderDigestHtml(input: DigestEmailInput): string;
export function renderDigestText(input: DigestEmailInput): string;
```

- [ ] **Step 1: Write the failing tests**

`src/lib/digest/period.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { currentDigestPeriod } from "@/lib/digest/period";

describe("currentDigestPeriod", () => {
  it("returns the Monday..Sunday UTC week containing now", () => {
    // Wednesday 2026-07-01 12:00 UTC → week Mon 2026-06-29 .. Sun 2026-07-05
    const p = currentDigestPeriod(new Date("2026-07-01T12:00:00Z"));
    expect(p).toEqual({ periodStart: "2026-06-29", periodEnd: "2026-07-05" });
  });

  it("a Monday maps to itself", () => {
    const p = currentDigestPeriod(new Date("2026-06-29T07:00:00Z"));
    expect(p.periodStart).toBe("2026-06-29");
  });

  it("a Sunday maps back to the preceding Monday", () => {
    const p = currentDigestPeriod(new Date("2026-07-05T23:59:59Z"));
    expect(p).toEqual({ periodStart: "2026-06-29", periodEnd: "2026-07-05" });
  });
});
```

`src/lib/digest/token.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  unsubscribeSignature,
  verifyUnsubscribeSignature,
} from "@/lib/digest/token";

describe("unsubscribe token", () => {
  const secret = "test-secret";
  const uid = "11111111-1111-1111-1111-111111111111";

  it("round-trips", () => {
    const sig = unsubscribeSignature(secret, uid);
    expect(verifyUnsubscribeSignature(secret, uid, sig)).toBe(true);
  });

  it("rejects a tampered user id", () => {
    const sig = unsubscribeSignature(secret, uid);
    expect(
      verifyUnsubscribeSignature(
        secret,
        "22222222-2222-2222-2222-222222222222",
        sig,
      ),
    ).toBe(false);
  });

  it("rejects garbage and wrong-length signatures without throwing", () => {
    expect(verifyUnsubscribeSignature(secret, uid, "zz")).toBe(false);
    expect(verifyUnsubscribeSignature(secret, uid, "")).toBe(false);
  });
});
```

`src/lib/validations/digest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  digestBoardRowSchema,
  digestNotificationPayloadSchema,
} from "@/lib/validations/digest";

describe("digest schemas", () => {
  it("parses a board row and caps samples at 5", () => {
    const r = digestBoardRowSchema.safeParse({
      boardId: "11111111-1111-1111-1111-111111111111",
      boardName: "Launch plan",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 2,
      incompleteItems: 3,
      newItems: 1,
      newSample: ["Kickoff"],
      incompleteSample: ["a", "b", "c", "d", "e", "f"], // 6 → reject
    });
    expect(r.success).toBe(false);
  });

  it("parses the notification payload", () => {
    const r = digestNotificationPayloadSchema.safeParse({
      newCount: 4,
      incompleteCount: 3,
      overdueCount: 2,
      periodStart: "2026-06-29",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative counts", () => {
    const r = digestNotificationPayloadSchema.safeParse({
      newCount: -1,
      incompleteCount: 0,
      overdueCount: 0,
      periodStart: "2026-06-29",
    });
    expect(r.success).toBe(false);
  });
});
```

`src/lib/digest/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderDigestHtml, renderDigestText } from "@/lib/digest/render";

const input = {
  orgName: "Acme <Inc>",
  periodStart: "2026-06-29",
  totals: { newCount: 4, incompleteCount: 3, overdueCount: 2 },
  boards: [
    {
      boardId: "11111111-1111-1111-1111-111111111111",
      boardName: "Launch <plan>",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 2,
      incompleteItems: 3,
      newItems: 1,
      newSample: ["Kickoff & scope"],
      incompleteSample: ["Design <review>"],
    },
  ],
  appBaseUrl: "https://pulse.example.com",
  unsubscribeUrl:
    "https://pulse.example.com/api/digest/unsubscribe?uid=u&sig=s",
};

describe("renderDigestHtml", () => {
  it("contains totals, board rows, and both links", () => {
    const html = renderDigestHtml(input);
    expect(html).toContain("4"); // new
    expect(html).toContain("Launch &lt;plan&gt;"); // escaped board name
    expect(html).toContain("Kickoff &amp; scope"); // escaped item name
    expect(html).toContain(input.unsubscribeUrl);
    expect(html).toContain("https://pulse.example.com/dashboards");
    expect(html).not.toContain("<plan>"); // no raw user HTML
  });
});

describe("renderDigestText", () => {
  it("lists totals and board names in plain text", () => {
    const text = renderDigestText(input);
    expect(text).toContain("Launch <plan>"); // plain text, unescaped
    expect(text).toContain("2 overdue");
    expect(text).toContain(input.unsubscribeUrl);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/digest src/lib/validations/digest.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/lib/digest/period.ts`:

```ts
/** The UTC Monday..Sunday week containing `now`. The digest's stats window is a
 * trailing 7 days at send time; this period is only the idempotency key
 * (digest_runs unique (org_id, period_start)). */
export type DigestPeriod = { periodStart: string; periodEnd: string };

export function currentDigestPeriod(now: Date = new Date()): DigestPeriod {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  const periodStart = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  return { periodStart, periodEnd: d.toISOString().slice(0, 10) };
}
```

`src/lib/digest/token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over "unsub:<userId>" — the one-click unsubscribe capability.
 * No expiry by design: the link must keep working from an old email, and it can
 * only ever flip one flag off. */
export function unsubscribeSignature(secret: string, userId: string): string {
  return createHmac("sha256", secret).update(`unsub:${userId}`).digest("hex");
}

export function verifyUnsubscribeSignature(
  secret: string,
  userId: string,
  sig: string,
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
  const expected = Buffer.from(unsubscribeSignature(secret, userId), "hex");
  const given = Buffer.from(sig, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

`src/lib/validations/digest.ts` (follow the file conventions of
`src/lib/validations/dashboards.ts` — local `uuid` helper or import the same one):

```ts
import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

/** One row of _org_health_digest, camelCased. */
export const digestBoardRowSchema = z.object({
  boardId: uuid,
  boardName: z.string().min(1).max(255),
  totalItems: count,
  doneItems: count,
  overdueItems: count,
  incompleteItems: count,
  newItems: count,
  newSample: z.array(z.string().max(255)).max(5),
  incompleteSample: z.array(z.string().max(255)).max(5),
});
export type DigestBoardRow = z.infer<typeof digestBoardRowSchema>;

/** notifications.payload for kind = 'health_digest'. */
export const digestNotificationPayloadSchema = z.object({
  newCount: count,
  incompleteCount: count,
  overdueCount: count,
  periodStart: isoDate,
});
export type DigestNotificationPayload = z.infer<
  typeof digestNotificationPayloadSchema
>;
```

`src/lib/digest/render.ts` (email-safe: table layout, inline styles, light-mode only, all
user strings escaped; visual language matches the branded auth templates in
`supabase/templates/` — dark ink on white, single accent, minimal chrome):

```ts
import type { DigestBoardRow } from "@/lib/validations/digest";

export type DigestEmailInput = {
  orgName: string;
  periodStart: string;
  totals: { newCount: number; incompleteCount: number; overdueCount: number };
  boards: DigestBoardRow[];
  appBaseUrl: string;
  unsubscribeUrl: string;
};

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const cellStyle = "padding:6px 12px;font-size:13px;color:#333;";

function boardRowHtml(b: DigestBoardRow): string {
  const samples = [
    b.newSample.length > 0
      ? `New: ${b.newSample.map(escapeHtml).join(", ")}`
      : "",
    b.incompleteSample.length > 0
      ? `Incomplete: ${b.incompleteSample.map(escapeHtml).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  return `<tr>
    <td style="${cellStyle}"><strong>${escapeHtml(b.boardName)}</strong>${
      samples ? `<br /><span style="color:#777;">${samples}</span>` : ""
    }</td>
    <td style="${cellStyle}text-align:right;">${b.newItems}</td>
    <td style="${cellStyle}text-align:right;">${b.incompleteItems}</td>
    <td style="${cellStyle}text-align:right;">${b.overdueItems}</td>
  </tr>`;
}

export function renderDigestHtml(input: DigestEmailInput): string {
  const { totals } = input;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e5e5e5;">
      <tr><td style="padding:24px;">
        <h1 style="margin:0 0 4px;font-size:18px;color:#111;">Weekly plan health &mdash; ${escapeHtml(input.orgName)}</h1>
        <p style="margin:0 0 16px;font-size:13px;color:#777;">Week of ${escapeHtml(input.periodStart)}</p>
        <p style="margin:0 0 16px;font-size:14px;color:#333;">
          <strong>${totals.newCount}</strong> new activities &middot;
          <strong>${totals.incompleteCount}</strong> structurally incomplete &middot;
          <strong>${totals.overdueCount}</strong> overdue
        </p>
        <table role="presentation" width="100%" style="border-collapse:collapse;border-top:1px solid #eee;">
          <tr>
            <th style="${cellStyle}text-align:left;color:#777;">Board</th>
            <th style="${cellStyle}text-align:right;color:#777;">New</th>
            <th style="${cellStyle}text-align:right;color:#777;">Incomplete</th>
            <th style="${cellStyle}text-align:right;color:#777;">Overdue</th>
          </tr>
          ${input.boards.map(boardRowHtml).join("\n")}
        </table>
        <p style="margin:20px 0 0;">
          <a href="${input.appBaseUrl}/dashboards" style="font-size:13px;color:#111;">Open your dashboards &rarr;</a>
        </p>
        <p style="margin:20px 0 0;font-size:11px;color:#999;">
          You receive this weekly digest as a member of ${escapeHtml(input.orgName)} on Pulse.
          <a href="${input.unsubscribeUrl}" style="color:#999;">Unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function renderDigestText(input: DigestEmailInput): string {
  const { totals } = input;
  const lines = [
    `Weekly plan health - ${input.orgName} (week of ${input.periodStart})`,
    ``,
    `${totals.newCount} new activities, ${totals.incompleteCount} structurally incomplete, ${totals.overdueCount} overdue`,
    ``,
    ...input.boards.map(
      (b) =>
        `- ${b.boardName}: ${b.newItems} new, ${b.incompleteItems} incomplete, ${b.overdueItems} overdue`,
    ),
    ``,
    `Open your dashboards: ${input.appBaseUrl}/dashboards`,
    `Unsubscribe: ${input.unsubscribeUrl}`,
  ];
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/digest src/lib/validations/digest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/digest/period.ts src/lib/digest/period.test.ts \
  src/lib/digest/token.ts src/lib/digest/token.test.ts \
  src/lib/validations/digest.ts src/lib/validations/digest.test.ts \
  src/lib/digest/render.ts src/lib/digest/render.test.ts
git commit -m "feat(digest): period, unsubscribe token, schemas, email render"
```

---

### Task 4: Widget vocabulary — Zod config + `HealthCounts` shaping

**Files:**

- Modify: `src/lib/validations/dashboards.ts` (widgetKindSchema; add schema; extend
  `configSchemaForKind`)
- Modify: `src/lib/dashboards/widget-data.ts` (append)
- Test: `src/lib/validations/dashboards.test.ts`, `src/lib/dashboards/widget-data.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks (pure).
- Produces (Tasks 5/6 import these exact names):
  - `widgetKindSchema` gains `"health"`; `export const healthConfigSchema = z.object({})`;
    `configSchemaForKind("health")` → that schema.
  - From `@/lib/dashboards/widget-data`:

```ts
export type HealthCounts = {
  totalItems: number;
  doneItems: number;
  overdueItems: number;
  incompleteItems: number;
  newItems7d: number;
};
export type ShapedHealth = {
  /** done/total as 0..100; null when the board has no top-level items. */
  progress: number | null;
  counts: HealthCounts;
};
export function shapeHealth(counts: HealthCounts): ShapedHealth;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/validations/dashboards.test.ts` (follow the file's per-schema describe
pattern; add `healthConfigSchema` to its import list):

```ts
describe("healthConfigSchema", () => {
  it("accepts the empty config", () => {
    expect(healthConfigSchema.safeParse({}).success).toBe(true);
  });

  it("routes via configSchemaForKind", () => {
    expect(configSchemaForKind("health").safeParse({}).success).toBe(true);
  });

  it("widgetKindSchema includes health", () => {
    expect(widgetKindSchema.safeParse("health").success).toBe(true);
  });
});
```

Append to `src/lib/dashboards/widget-data.test.ts`:

```ts
describe("shapeHealth", () => {
  it("computes progress as done/total", () => {
    const shaped = shapeHealth({
      totalItems: 8,
      doneItems: 2,
      overdueItems: 3,
      incompleteItems: 4,
      newItems7d: 1,
    });
    expect(shaped.progress).toBe(25);
    expect(shaped.counts.overdueItems).toBe(3);
  });

  it("returns null progress for an empty board", () => {
    const shaped = shapeHealth({
      totalItems: 0,
      doneItems: 0,
      overdueItems: 0,
      incompleteItems: 0,
      newItems7d: 0,
    });
    expect(shaped.progress).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts src/lib/dashboards/widget-data.test.ts`
Expected: FAIL — `healthConfigSchema` / `shapeHealth` not exported.

- [ ] **Step 3: Implement**

In `src/lib/validations/dashboards.ts` — add `"health"` to the `widgetKindSchema` enum list;
after the completion schema:

```ts
// Health summary widget: zero config beyond the source board — the structural-
// completeness/overdue rule is fixed (spec: 2026-07-03-health-summary-design.md).
export const healthConfigSchema = z.object({});
export type HealthConfig = z.infer<typeof healthConfigSchema>;
```

In `configSchemaForKind`, before `default`:

```ts
    case "health":
      return healthConfigSchema;
```

Append to `src/lib/dashboards/widget-data.ts`:

```ts
/** Single row of dashboard_health_summary (camelCased). */
export type HealthCounts = {
  totalItems: number;
  doneItems: number;
  overdueItems: number;
  incompleteItems: number;
  newItems7d: number;
};

export type ShapedHealth = {
  /** done/total as 0..100; null when the board has no top-level items. */
  progress: number | null;
  counts: HealthCounts;
};

export function shapeHealth(counts: HealthCounts): ShapedHealth {
  return {
    progress:
      counts.totalItems > 0
        ? (counts.doneItems / counts.totalItems) * 100
        : null,
    counts,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/validations/dashboards.test.ts src/lib/dashboards/widget-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/dashboards.ts src/lib/validations/dashboards.test.ts \
  src/lib/dashboards/widget-data.ts src/lib/dashboards/widget-data.test.ts
git commit -m "feat(dashboards): health widget config schema + shaping"
```

---

### Task 5: Cached health read + batched-action plumbing

**Files:**

- Modify: `src/lib/dashboards/queries-cached.ts` (append, sibling of
  `getWidgetCompletionCached`)
- Modify: `src/lib/dashboards/actions.ts` (`WidgetAggregatePayload`, `resolveWidgetAggregate`)
- Modify: `src/lib/dashboards/use-widget-data.tsx` (`usesAggregateData`, `WidgetData`, return
  mapping)
- Test: `src/lib/dashboards/actions.test.ts`, `src/lib/dashboards/use-widget-data.test.tsx`

**Interfaces:**

- Consumes: Task 1 RPC types (`supabase.rpc("dashboard_health_summary", …)`); Task 4
  `"health"` kind + `HealthCounts` from `@/lib/dashboards/widget-data`.
- Produces:
  - `getWidgetHealthCached(input: { widgetId: string; orgId: string; boardId: string; config:
Record<string, unknown> }): Promise<WidgetHealth>` where
    `type WidgetHealth = { ok: true; counts: HealthCounts } | { ok: false; error: string }`
    (exported from `queries-cached.ts`);
  - `WidgetAggregatePayload` gains `health?: HealthCounts`;
  - client `WidgetData` gains `health: HealthCounts | null` — Task 6's `HealthWidget` reads
    `data.health`.

- [ ] **Step 1: Write the failing tests**

In `actions.test.ts`, extend the `getWidgetsData` suite exactly as the completion tests do
(mock `@/lib/dashboards/queries-cached`, adding `getWidgetHealthCached` to the existing
`vi.mock` module):

```ts
it("resolves a health widget slot via the health cached read", async () => {
  // widget row: { id: "w-h", kind: "health", org_id: "org1",
  //   source_board_id: "b1", config: {} }
  // mock getWidgetHealthCached → { ok: true, counts: { totalItems: 8,
  //   doneItems: 2, overdueItems: 3, incompleteItems: 4, newItems7d: 1 } }
  const res = await getWidgetsData({ widgetIds: ["w-h"] });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const slot = res.data.results["w-h"];
  expect(slot.ok).toBe(true);
  if (!slot.ok) return;
  expect(slot.kind).toBe("health");
  expect(slot.health).toMatchObject({ overdueItems: 3, newItems7d: 1 });
  expect(slot.buckets).toEqual([]);
});

it("a health widget's failure does not blank sibling slots", async () => {
  // mock getWidgetHealthCached → { ok: false, error: "boom" } for "w-h",
  // aggregate mock healthy for "w-n" (number widget)
  const res = await getWidgetsData({ widgetIds: ["w-h", "w-n"] });
  if (!res.ok) return;
  expect(res.data.results["w-h"].ok).toBe(false);
  expect(res.data.results["w-n"].ok).toBe(true);
});
```

In `use-widget-data.test.tsx`, extend the provider suite (mirror the completion test):

```ts
it("includes health widgets in the batch and exposes data.health", async () => {
  // widgets: [{ id: "w-h", kind: "health", config: {} }]
  // mock getWidgetsData → slot { ok: true, kind: "health", config: {},
  //   buckets: [], columnMeta: null, health: { totalItems: 8, doneItems: 2,
  //   overdueItems: 3, incompleteItems: 4, newItems7d: 1 } }
  // render hook consumer for "w-h"; expect data.health?.overdueItems === 3
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/dashboards/actions.test.ts src/lib/dashboards/use-widget-data.test.tsx`
Expected: FAIL — `getWidgetHealthCached` not exported / `health` missing from types.

- [ ] **Step 3: Implement the cached read** (append to `queries-cached.ts`; extend the
      existing type-import line from `@/lib/dashboards/widget-data` with `HealthCounts`)

```ts
export type WidgetHealth =
  | { ok: true; counts: HealthCounts }
  | { ok: false; error: string };

/**
 * Cached health read — the 9.3b contract verbatim: caller resolves orgId/boardId
 * from the widget row (tenant boundary), entry keyed by org+widget+config and
 * tagged widgetAggregationTag so existing create/update/delete updateTag calls
 * invalidate it with zero new code. Freshness is TTL-bounded (cacheLife
 * "widget", ~30s), same tradeoff as getWidgetAggregationCached.
 */
export async function getWidgetHealthCached(input: {
  widgetId: string;
  orgId: string;
  boardId: string;
  config: Record<string, unknown>;
}): Promise<WidgetHealth> {
  "use cache";
  cacheLife("widget");
  cacheTag(widgetAggregationTag(input.orgId, input.widgetId));

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("dashboard_health_summary", {
    p_board_id: input.boardId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  return {
    ok: true,
    counts: {
      totalItems: Number(row?.total_items ?? 0),
      doneItems: Number(row?.done_items ?? 0),
      overdueItems: Number(row?.overdue_items ?? 0),
      incompleteItems: Number(row?.incomplete_items ?? 0),
      newItems7d: Number(row?.new_items ?? 0),
    },
  };
}
```

- [ ] **Step 4: Plumb through the actions layer** (`actions.ts`)

`WidgetAggregatePayload` gains (below the `completion?` field):

```ts
  /** Present only for health widgets. */
  health?: HealthCounts;
```

(import `HealthCounts` from `@/lib/dashboards/widget-data` and `getWidgetHealthCached` from
`@/lib/dashboards/queries-cached`.)

In `resolveWidgetAggregate`, immediately after the completion branch (same shape):

```ts
if (widget.kind === "health") {
  const result = await getWidgetHealthCached({
    widgetId,
    orgId: widget.org_id,
    boardId: widget.source_board_id,
    config,
  });
  if (!result.ok) return fail(result.error);
  return {
    ok: true,
    data: {
      kind: widget.kind,
      config,
      buckets: [],
      columnMeta: null,
      health: result.counts,
    },
  };
}
```

- [ ] **Step 5: Plumb through the client hook** (`use-widget-data.tsx`)

`WidgetData` gains `health: HealthCounts | null;` (typed import from
`@/lib/dashboards/widget-data`). `usesAggregateData` includes `"health"`:

```ts
function usesAggregateData(kind: CacheWidget["kind"]): boolean {
  return (
    kind === "number" ||
    kind === "battery" ||
    kind === "completion" ||
    kind === "health"
  );
}
```

`useWidgetData`'s return mapping gains `health: entry.health ?? null` alongside the existing
`completion` mapping.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/dashboards/actions.test.ts src/lib/dashboards/use-widget-data.test.tsx src/lib/dashboards/queries-cached.test.ts`
Expected: PASS (existing suites unaffected).

- [ ] **Step 7: Commit**

```bash
git add src/lib/dashboards/queries-cached.ts src/lib/dashboards/actions.ts \
  src/lib/dashboards/use-widget-data.tsx src/lib/dashboards/actions.test.ts \
  src/lib/dashboards/use-widget-data.test.tsx
git commit -m "feat(dashboards): cached health read via batched widget fetch"
```

---

### Task 6: HealthWidget component + canvas/preview/config wiring

**Files:**

- Create: `src/components/dashboards/widgets/HealthWidget.tsx`
- Create: `src/components/dashboards/widgets/HealthWidget.test.tsx`
- Modify: `src/components/dashboards/DashboardWidget.tsx` (render switch)
- Modify: `src/components/dashboards/WidgetConfigSheet.tsx` (preview switch)
- Modify: `src/components/dashboards/WidgetConfigForm.tsx` (kind option, `defaultConfig`,
  helper-text branch)
- Test: `src/components/dashboards/WidgetConfigForm.test.tsx`

**Interfaces:**

- Consumes: Task 4 `shapeHealth` (`@/lib/dashboards/widget-data`); Task 5 `useWidgetData` →
  `data.health`; existing `percentBandColor` from `@/lib/boards/percent-color`; `CacheWidget`
  from `@/lib/dashboards/cache`.
- Produces: `export function HealthWidget({ widget }: { widget: CacheWidget })` — used by
  `DashboardWidget` and the sheet preview; `defaultConfig("health")` → `{}`.

- [ ] **Step 1: Write the failing tests** (mirror `CompletionWidget.test.tsx` setup: mock
      `@/lib/dashboards/use-widget-data`)

```ts
it("prompts for configuration when no source board", () => {
  // widget with source_board_id null → "Configure a source board"
});

it("renders progress and the three counts", () => {
  // data.health: { totalItems: 8, doneItems: 2, overdueItems: 3,
  //   incompleteItems: 4, newItems7d: 1 }
  // expect "25%" header, "8 items" caption, rows:
  //   "New this week" → 1, "Overdue" → 3, "Incomplete" → 4
});

it("marks nonzero alert counts as destructive, zero as neutral", () => {
  // overdueItems: 0, incompleteItems: 4 → the Overdue count has NO
  // text-destructive class; the Incomplete count HAS it
});

it("shows the empty state for a board with no items", () => {
  // health: { totalItems: 0, ... } → "No data yet"
});

it("shows the error state", () => {
  // isError true → "Failed to load"
});
```

In `WidgetConfigForm.test.tsx`:

```ts
it("offers the health kind with fixed-rule helper text", async () => {
  // select widget type "health"; expect helper text mentioning
  // "overdue" and "no extra configuration"; no column selects rendered
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/components/dashboards/widgets/HealthWidget.test.tsx src/components/dashboards/WidgetConfigForm.test.tsx`
Expected: FAIL — module not found / no health option.

- [ ] **Step 3: Implement** (`HealthWidget.tsx` — plain DOM, no recharts, static import like
      `BatteryWidget`/`CompletionWidget`)

```tsx
"use client";

import { useWidgetData } from "@/lib/dashboards/use-widget-data";
import { shapeHealth } from "@/lib/dashboards/widget-data";
import { percentBandColor } from "@/lib/boards/percent-color";
import { cn } from "@/lib/utils";
import type { CacheWidget } from "@/lib/dashboards/cache";

/**
 * Health summary widget: overall progress (% of top-level items done) plus
 * overdue / structurally-incomplete / new-this-week counts for the source
 * board. Zero config; rule semantics match the board's overdue tint
 * (src/lib/boards/overdue.ts). Chrome is monochrome; text-destructive marks
 * only nonzero alert counts and is always paired with the row label (AA).
 */
export function HealthWidget({ widget }: { widget: CacheWidget }) {
  const { data, isLoading, isError } = useWidgetData(widget.id);

  if (!widget.source_board_id)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Configure a source board
      </div>
    );
  if (isLoading)
    return <div className="bg-muted/40 h-full animate-pulse rounded-md" />;
  if (isError || !data?.health)
    return <div className="text-destructive text-sm">Failed to load</div>;

  const shaped = shapeHealth(data.health);
  if (shaped.progress === null)
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        No data yet
      </div>
    );

  const rows: { label: string; value: number; alert: boolean }[] = [
    { label: "New this week", value: shaped.counts.newItems7d, alert: false },
    { label: "Overdue", value: shaped.counts.overdueItems, alert: true },
    { label: "Incomplete", value: shaped.counts.incompleteItems, alert: true },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {Math.round(shaped.progress)}%
          </span>
          <span className="text-muted-foreground text-xs">
            done · {shaped.counts.totalItems} items
          </span>
        </div>
        <span className="bg-muted mt-2 block h-2 overflow-hidden rounded-full">
          <span
            className={`block h-full rounded-full ${percentBandColor(shaped.progress)}`}
            style={{
              width: `${Math.min(Math.max(shaped.progress, 0), 100)}%`,
            }}
          />
        </span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col justify-end gap-1.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between border-t pt-1.5 text-xs first:border-t-0"
          >
            <span className="text-muted-foreground">{r.label}</span>
            <span
              className={cn(
                "font-medium tabular-nums",
                r.alert && r.value > 0 && "text-destructive",
              )}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Wire the switches and the config form**

`DashboardWidget.tsx` — render chain, before the fallback:

```tsx
          ) : widget.kind === "health" ? (
            <HealthWidget widget={widget} />
```

with `import { HealthWidget } from "@/components/dashboards/widgets/HealthWidget";`.

`WidgetConfigSheet.tsx` — preview chain, mirroring the completion entry:

```tsx
            ) : draft.kind === "health" ? (
              <HealthWidget widget={previewWidget} />
```

`WidgetConfigForm.tsx`:

- Widget-type select gains `<option value="health">Health summary</option>`.
- `defaultConfig` gains `case "health": return {};`.
- Kind chain gains a branch (before the list fallback) rendering only helper text:

```tsx
      ) : value.kind === "health" ? (
        <p className="text-muted-foreground text-xs">
          Shows overall progress plus overdue, incomplete, and new-item counts
          for the source board — no extra configuration. Incomplete = missing
          owner or date on an unfinished item.
        </p>
      ) : (
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/components/dashboards/widgets/HealthWidget.test.tsx src/components/dashboards/DashboardWidget.test.tsx src/components/dashboards/WidgetConfigSheet.test.tsx src/components/dashboards/WidgetConfigForm.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboards/widgets/HealthWidget.tsx \
  src/components/dashboards/widgets/HealthWidget.test.tsx \
  src/components/dashboards/DashboardWidget.tsx \
  src/components/dashboards/WidgetConfigSheet.tsx \
  src/components/dashboards/WidgetConfigForm.tsx \
  src/components/dashboards/WidgetConfigForm.test.tsx
git commit -m "feat(dashboards): health summary widget component"
```

---

### Task 7: `health_digest` notification rendering + bell click-through

**Files:**

- Modify: `src/components/notifications/NotificationsList.tsx` (the `label()` switch)
- Modify: `src/components/notifications/NotificationsBell.tsx` (open/click-through)
- Test: `src/components/notifications/NotificationsList.test.tsx` (create if absent,
  following the component-test conventions of the dashboards suites)

**Interfaces:**

- Consumes: Task 1 types (`notification_kind` incl. `"health_digest"`,
  `notifications.payload`); Task 3 `digestNotificationPayloadSchema` from
  `@/lib/validations/digest`.
- Produces: nothing consumed downstream (leaf UI).

- [ ] **Step 1: Write the failing test**

```ts
it("renders health_digest copy from payload", () => {
  // notification: { kind: "health_digest", payload: { newCount: 4,
  //   incompleteCount: 3, overdueCount: 2, periodStart: "2026-06-29" },
  //   actor_id: null, board_id: null, item_id: null, ... }
  // expect text "Weekly digest: 4 new · 3 incomplete · 2 overdue"
});

it("falls back to generic copy when payload is malformed", () => {
  // payload: null → "Weekly plan health digest"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/notifications/NotificationsList.test.tsx`
Expected: FAIL — switch falls through to the default label.

- [ ] **Step 3: Implement**

In `NotificationsList.tsx`'s `label()` switch, before `default` (import
`digestNotificationPayloadSchema` from `@/lib/validations/digest`):

```ts
    case "health_digest": {
      const parsed = digestNotificationPayloadSchema.safeParse(n.payload);
      return parsed.success
        ? `Weekly digest: ${parsed.data.newCount} new · ${parsed.data.incompleteCount} incomplete · ${parsed.data.overdueCount} overdue`
        : "Weekly plan health digest";
    }
```

Note: `health_digest` rows have `actor_id: null` — verify the row renderer's actor prefix
handles null actors (the `automation` kind already does; reuse that presentation, e.g. no
avatar / a system glyph).

In `NotificationsBell.tsx`'s open/click handler (which currently keys off
`board_id`/`item_id`): route `kind === "health_digest"` to `/dashboards`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/components/notifications`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationsList.tsx \
  src/components/notifications/NotificationsList.test.tsx \
  src/components/notifications/NotificationsBell.tsx
git commit -m "feat(notifications): render weekly health digest kind"
```

---

### Task 8: Digest orchestration + route + env

**Files:**

- Modify: `src/lib/env.server.ts` (four optional vars)
- Modify: `.env.example` (document them)
- Create: `src/lib/digest/run.ts`, `src/lib/digest/run.test.ts`
- Create: `src/app/api/digest/run/route.ts`

**Interfaces:**

- Consumes: Task 2 tables/RPC types (`digest_runs`, `_org_health_digest` — service-role);
  Task 3 `currentDigestPeriod`, `unsubscribeSignature`, `renderDigestHtml/Text`,
  `digestBoardRowSchema`; existing `createServiceClient` and the server-env module pattern.
- Produces:
  - `env.server.ts` exposes optional `DIGEST_SECRET`, `RESEND_API_KEY`, `APP_BASE_URL`,
    `DIGEST_FROM_EMAIL` (Task 9 reuses `DIGEST_SECRET` + `APP_BASE_URL`).
  - `runWeeklyDigest(now?: Date): Promise<{ processed: number; sent: number; skipped:
number; failed: number }>` from `@/lib/digest/run`.
  - `POST /api/digest/run` — Bearer-authenticated cron target.

- [ ] **Step 1: Extend server env**

In `src/lib/env.server.ts`, add to the schema (all optional — CI/boot stays green; follow the
file's existing zod + summary conventions):

```ts
  DIGEST_SECRET: z.string().min(32).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().optional(),
  DIGEST_FROM_EMAIL: z.string().email().optional(),
```

In `.env.example`, append with comments:

```bash
# Weekly health digest (all optional — feature self-disables without them)
# DIGEST_SECRET=            # 32+ random bytes; same value as the Vault 'digest_secret'
# RESEND_API_KEY=           # re_…; absent → in-app-only digests (no email)
# APP_BASE_URL=             # e.g. https://pulse.example.com (absolute links in emails)
# DIGEST_FROM_EMAIL=        # verified Resend sender, e.g. digest@pulse.example.com
```

- [ ] **Step 2: Write the failing tests** (`src/lib/digest/run.test.ts` — mock
      `@/lib/supabase/service` (or the repo's actual service-client module used by
      `queries-cached.ts`) and global `fetch`; follow `actions.test.ts` mocking conventions)

```ts
describe("runWeeklyDigest", () => {
  it("claims the week per org and skips already-claimed orgs", async () => {
    // org A: digest_runs insert succeeds → processed
    // org B: insert fails with code 23505 and existing row status "sent"
    //   → skipped, no notifications inserted for B
  });

  it("writes skipped and sends nothing when totals are all zero", async () => {
    // _org_health_digest → [] ⇒ digest_runs finalized status "skipped",
    // fetch never called, no notifications inserted
  });

  it("email-disabled mode inserts notifications and finalizes sent", async () => {
    // RESEND_API_KEY absent ⇒ no fetch; one notifications row per
    // owner/admin/member (guest excluded), kind "health_digest",
    // payload { newCount, incompleteCount, overdueCount, periodStart };
    // digest_runs status "sent", email_sent_count 0
  });

  it("email mode sends per-recipient batch and honors opt-out", async () => {
    // members: u1 (ok), u2 (email_digest_opt_out), u3 (null email)
    // ⇒ fetch called once with 1 personalized message incl. that user's
    //   unsubscribe sig; List-Unsubscribe header present;
    //   email_sent_count 1
  });

  it("resend failure finalizes failed and does NOT insert notifications", async () => {
    // fetch → 500 ⇒ digest_runs status "failed" with error text;
    // notifications insert never called (retry-safe ordering)
  });

  it("reclaims a stale pending run older than an hour", async () => {
    // insert 23505; existing row status "pending", created_at 2h ago
    // ⇒ update claims it (eq id + eq status "pending") and processing continues
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/digest/run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/lib/digest/run.ts`**

```ts
import "server-only";

import { createServiceClient } from "@/lib/supabase/service"; // match queries-cached.ts's import
import { serverEnv } from "@/lib/env.server"; // match the module's actual export
import { currentDigestPeriod } from "@/lib/digest/period";
import { unsubscribeSignature } from "@/lib/digest/token";
import { renderDigestHtml, renderDigestText } from "@/lib/digest/render";
import {
  digestBoardRowSchema,
  type DigestBoardRow,
} from "@/lib/validations/digest";

const ORG_LIMIT = 200;
const RECIPIENT_CAP = 200;
const RESEND_BATCH_MAX = 100;
const STALE_CLAIM_MS = 60 * 60 * 1000;

export type DigestRunSummary = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

type Recipient = { userId: string; email: string | null; optOut: boolean };

/**
 * Weekly digest pass. Idempotent per (org, ISO week) via digest_runs' unique
 * claim — the daily cron ping retries failed/unclaimed orgs all week. Ordering
 * inside an org is deliberate: email first, notifications after email success
 * (or email-disabled), so a retry can never duplicate notifications.
 */
export async function runWeeklyDigest(
  now: Date = new Date(),
): Promise<DigestRunSummary> {
  const supabase = createServiceClient();
  const period = currentDigestPeriod(now);
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const summary: DigestRunSummary = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const { data: orgs, error: orgsError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(ORG_LIMIT);
  if (orgsError)
    throw new Error(`digest: orgs read failed: ${orgsError.message}`);

  for (const org of orgs ?? []) {
    const claimed = await claimRun(supabase, org.id, period, now);
    if (!claimed) {
      summary.skipped += 1;
      continue;
    }
    summary.processed += 1;
    try {
      const outcome = await processOrg(
        supabase,
        org,
        since,
        period,
        claimed.id,
      );
      summary[outcome] += 1;
    } catch (err) {
      summary.failed += 1;
      await supabase
        .from("digest_runs")
        .update({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completed_at: new Date().toISOString(),
        })
        .eq("id", claimed.id);
    }
  }
  return summary;
}

/** Insert the pending claim; on conflict, reclaim only if stale-pending. */
async function claimRun(
  supabase: ReturnType<typeof createServiceClient>,
  orgId: string,
  period: { periodStart: string; periodEnd: string },
  now: Date,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("digest_runs")
    .insert({
      org_id: orgId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      status: "pending",
    })
    .select("id")
    .single();
  if (!error) return data;
  if (error.code !== "23505") throw new Error(error.message);

  const { data: existing } = await supabase
    .from("digest_runs")
    .select("id, status, created_at")
    .eq("org_id", orgId)
    .eq("period_start", period.periodStart)
    .single();
  const stale =
    existing?.status === "pending" &&
    existing.created_at !== null &&
    now.getTime() - new Date(existing.created_at).getTime() > STALE_CLAIM_MS;
  if (!existing || !stale) return null;
  const { data: reclaimed } = await supabase
    .from("digest_runs")
    .update({ created_at: now.toISOString() })
    .eq("id", existing.id)
    .eq("status", "pending")
    .select("id")
    .single();
  return reclaimed ?? null;
}

async function processOrg(
  supabase: ReturnType<typeof createServiceClient>,
  org: { id: string; name: string },
  since: string,
  period: { periodStart: string },
  runId: string,
): Promise<"sent" | "skipped"> {
  const { data: raw, error } = await supabase.rpc("_org_health_digest", {
    p_org_id: org.id,
    p_since: since,
  });
  if (error) throw new Error(`_org_health_digest: ${error.message}`);

  const boards: DigestBoardRow[] = (raw ?? []).map((r) =>
    digestBoardRowSchema.parse({
      boardId: r.board_id,
      boardName: r.board_name,
      totalItems: r.total_items,
      doneItems: r.done_items,
      overdueItems: r.overdue_items,
      incompleteItems: r.incomplete_items,
      newItems: r.new_items,
      newSample: r.new_sample,
      incompleteSample: r.incomplete_sample,
    }),
  );
  const totals = boards.reduce(
    (t, b) => ({
      newCount: t.newCount + b.newItems,
      incompleteCount: t.incompleteCount + b.incompleteItems,
      overdueCount: t.overdueCount + b.overdueItems,
    }),
    { newCount: 0, incompleteCount: 0, overdueCount: 0 },
  );

  if (
    totals.newCount === 0 &&
    totals.incompleteCount === 0 &&
    totals.overdueCount === 0
  ) {
    await supabase
      .from("digest_runs")
      .update({
        status: "skipped",
        stats: totals,
        completed_at: new Date().toISOString(),
      })
      .eq("id", runId);
    return "skipped";
  }

  // Members: owner/admin/member (guests excluded — spec Open question 5).
  const { data: members, error: mErr } = await supabase
    .from("org_members")
    .select("user_id, role, profiles ( email, email_digest_opt_out )")
    .eq("org_id", org.id)
    .in("role", ["owner", "admin", "member"])
    .limit(RECIPIENT_CAP);
  if (mErr) throw new Error(`members read: ${mErr.message}`);
  const recipients: Recipient[] = (members ?? []).map((m) => ({
    userId: m.user_id,
    email: m.profiles?.email ?? null,
    optOut: m.profiles?.email_digest_opt_out ?? false,
  }));

  // 1) Email first (skipped entirely when the key is absent).
  const emailSentCount = await sendEmails(
    org,
    boards,
    totals,
    period,
    recipients,
  );

  // 2) Notifications after email success — retry can't duplicate them.
  const payload = { ...totals, periodStart: period.periodStart };
  const rows = recipients.map((r) => ({
    org_id: org.id,
    recipient_id: r.userId,
    actor_id: null,
    kind: "health_digest" as const,
    payload,
  }));
  if (rows.length > 0) {
    const { error: nErr } = await supabase.from("notifications").insert(rows);
    if (nErr) throw new Error(`notifications insert: ${nErr.message}`);
  }

  await supabase
    .from("digest_runs")
    .update({
      status: "sent",
      stats: { ...totals, boards: boards.length },
      email_sent_count: emailSentCount,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  return "sent";
}

/** Returns the number of emails accepted by Resend; 0 in in-app-only mode. */
async function sendEmails(
  org: { name: string },
  boards: DigestBoardRow[],
  totals: { newCount: number; incompleteCount: number; overdueCount: number },
  period: { periodStart: string },
  recipients: Recipient[],
): Promise<number> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.DIGEST_SECRET || !env.APP_BASE_URL) return 0;
  const from =
    env.DIGEST_FROM_EMAIL ?? `digest@${new URL(env.APP_BASE_URL).hostname}`;

  const emailable = recipients.filter((r) => r.email !== null && !r.optOut);
  const messages = emailable.map((r) => {
    const unsubscribeUrl = `${env.APP_BASE_URL}/api/digest/unsubscribe?uid=${r.userId}&sig=${unsubscribeSignature(env.DIGEST_SECRET!, r.userId)}`;
    const input = {
      orgName: org.name,
      periodStart: period.periodStart,
      totals,
      boards,
      appBaseUrl: env.APP_BASE_URL!,
      unsubscribeUrl,
    };
    return {
      from,
      to: [r.email as string],
      subject: `Your weekly ${org.name} plan health digest`,
      html: renderDigestHtml(input),
      text: renderDigestText(input),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
    };
  });

  for (let i = 0; i < messages.length; i += RESEND_BATCH_MAX) {
    const chunk = messages.slice(i, i + RESEND_BATCH_MAX);
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      throw new Error(`resend batch failed: ${res.status} ${await res.text()}`);
    }
  }
  return messages.length;
}
```

(Adjust the two marked imports — service client module and env accessor — to the repo's
actual export names used by `queries-cached.ts` / `env.server.ts`; keep everything else
verbatim. If the generated types don't expose the `profiles` relation on `org_members`
select-with-join, fall back to two queries: members then `profiles in (…)`.)

- [ ] **Step 5: Implement the route** (`src/app/api/digest/run/route.ts`)

```ts
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";
import { runWeeklyDigest } from "@/lib/digest/run";

function authorized(req: Request, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const env = serverEnv();
  if (!env.DIGEST_SECRET) {
    return NextResponse.json(
      { error: "digest not provisioned" },
      { status: 503 },
    );
  }
  if (!authorized(req, env.DIGEST_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runWeeklyDigest();
  return NextResponse.json(summary);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/digest/run.test.ts`
Expected: PASS. Also run `pnpm typecheck` (route + env changes).

- [ ] **Step 7: Commit**

```bash
git add src/lib/env.server.ts .env.example src/lib/digest/run.ts \
  src/lib/digest/run.test.ts src/app/api/digest/run/route.ts
git commit -m "feat(digest): weekly digest orchestration, cron route, env"
```

---

### Task 9: Settings opt-out toggle + one-click unsubscribe route

**Files:**

- Create: `src/lib/settings/digest-actions.ts`, `src/lib/settings/digest-actions.test.ts`
- Create: `src/components/settings/DigestPreferenceForm.tsx` (+
  `DigestPreferenceForm.test.tsx`)
- Modify: `src/app/(app)/settings/page.tsx` (mount the form; pass the current flag)
- Create: `src/app/api/digest/unsubscribe/route.ts`

**Interfaces:**

- Consumes: Task 2 `profiles.email_digest_opt_out` types; Task 3
  `verifyUnsubscribeSignature`; Task 8 env (`DIGEST_SECRET`); existing authed server client +
  Server Action conventions (pattern-match `PersonalTimezoneForm` and its action).
- Produces: `setEmailDigestOptOut(input: { optOut: boolean }): Promise<ActionResult<null>>`
  (Server Action, RLS-scoped update of own profile); `GET /api/digest/unsubscribe`.

- [ ] **Step 1: Write the failing tests**

`digest-actions.test.ts` (mock the authed supabase client the way the timezone action's test
does):

```ts
it("updates the caller's own profile flag", async () => {
  // setEmailDigestOptOut({ optOut: true }) → update("profiles")
  //   .eq("id", user.id) with { email_digest_opt_out: true }; ok result
});

it("rejects when unauthenticated", async () => {
  // getUser → null ⇒ { ok: false }
});

it("validates input at the boundary", async () => {
  // ({ optOut: "yes" } as never) ⇒ { ok: false } via zod
});
```

`DigestPreferenceForm.test.tsx`:

```ts
it("renders checked when subscribed and calls the action on toggle", async () => {
  // initialOptOut=false → checkbox checked ("Email me the weekly digest");
  // click → setEmailDigestOptOut({ optOut: true })
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/settings/digest-actions.test.ts src/components/settings/DigestPreferenceForm.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the action** (`src/lib/settings/digest-actions.ts`; mirror the
      timezone action's structure — server client, `getUser()`, Zod, `ActionResult`)

```ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server"; // match the timezone action's import
import type { ActionResult } from "@/lib/types"; // match the repo's ActionResult source

const inputSchema = z.object({ optOut: z.boolean() });

export async function setEmailDigestOptOut(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<null>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { error } = await supabase
    .from("profiles")
    .update({ email_digest_opt_out: parsed.data.optOut })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
```

- [ ] **Step 4: Implement the form + mount** (`DigestPreferenceForm.tsx` — client leaf,
      pattern-match `PersonalTimezoneForm`'s card/copy style)

```tsx
"use client";

import { useState, useTransition } from "react";
import { setEmailDigestOptOut } from "@/lib/settings/digest-actions";

export function DigestPreferenceForm({
  initialOptOut,
}: {
  initialOptOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={!optOut}
        disabled={pending}
        onChange={(e) => {
          const next = !e.target.checked;
          setOptOut(next);
          startTransition(async () => {
            const res = await setEmailDigestOptOut({ optOut: next });
            if (!res.ok) setOptOut(!next); // revert on failure
          });
        }}
      />
      Email me the weekly plan health digest
    </label>
  );
}
```

In `src/app/(app)/settings/page.tsx`: the page's profile read gains
`email_digest_opt_out`; add a "Notifications" card (same card markup as the timezone cards)
mounting `<DigestPreferenceForm initialOptOut={profile.email_digest_opt_out} />` with caption
"In-app notifications are unaffected."

- [ ] **Step 5: Implement the unsubscribe route** (`src/app/api/digest/unsubscribe/route.ts`)

```ts
import { NextResponse } from "next/server";
import { verifyUnsubscribeSignature } from "@/lib/digest/token";
import { serverEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service"; // match queries-cached.ts

const page = (msg: string) => `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;padding:48px;color:#111;">
  <h1 style="font-size:18px;">Pulse</h1><p style="font-size:14px;">${msg}</p>
</body></html>`;

export async function GET(req: Request) {
  const env = serverEnv();
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid") ?? "";
  const sig = url.searchParams.get("sig") ?? "";

  if (
    !env.DIGEST_SECRET ||
    !uid ||
    !verifyUnsubscribeSignature(env.DIGEST_SECRET, uid, sig)
  ) {
    return new NextResponse(page("This unsubscribe link is not valid."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("profiles")
    .update({ email_digest_opt_out: true })
    .eq("id", uid);
  if (error) {
    return new NextResponse(page("Something went wrong — try again later."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
  return new NextResponse(
    page(
      "You're unsubscribed from the weekly digest email. You can turn it back on any time in Settings.",
    ),
    { status: 200, headers: { "Content-Type": "text/html" } },
  );
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/settings/digest-actions.test.ts src/components/settings/DigestPreferenceForm.test.tsx`
Expected: PASS. Also `pnpm typecheck`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/settings/digest-actions.ts src/lib/settings/digest-actions.test.ts \
  src/components/settings/DigestPreferenceForm.tsx \
  src/components/settings/DigestPreferenceForm.test.tsx \
  "src/app/(app)/settings/page.tsx" src/app/api/digest/unsubscribe/route.ts
git commit -m "feat(digest): opt-out preference + one-click unsubscribe"
```

---

### Task 10: RPC integration tests

**Files:**

- Create: `src/lib/dashboards/health-summary.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 1+2 deployed SQL (dev **and the dedicated test project** — hand the user
  both files for the test DB, like the completion suite did); existing helpers
  `loadIntegrationEnv` / `integrationTargetReady` (`@/test/integration-env`),
  `signInWithRetry` (`@/test/integration-auth`), and the provisioning pattern from
  `src/lib/dashboards/dashboard-completion.integration.test.ts`.
- Produces: nothing downstream (verification only).

- [ ] **Step 1: Write the test file**

Follow `dashboard-completion.integration.test.ts` verbatim for env-gating
(`describe.runIf(integrationTargetReady())`), provisioning (user → `create_organization` →
board with a status column [options incl. "Done"], a people column, a date column, two
groups), and serial placement. Fixture items (all top-level unless noted):

- `i-done`: status Done, owner set, date yesterday → done; not overdue (done suppresses); not
  incomplete.
- `i-overdue`: status "Working on it", owner set, date yesterday → overdue, not incomplete.
- `i-no-owner`: status empty, date tomorrow, **no people cell** → incomplete (owner), not
  overdue.
- `i-no-date`: owner set, **no date cell** → incomplete (date).
- `i-sub`: subitem of `i-no-date` with nothing set → excluded everywhere (top-level only).

Assertions:

```ts
it("counts done/overdue/incomplete/new per the fixed rule", async () => {
  const { data, error } = await client.rpc("dashboard_health_summary", {
    p_board_id: boardId,
  });
  expect(error).toBeNull();
  expect(data?.[0]).toMatchObject({
    total_items: 4, // subitem excluded
    done_items: 1,
    overdue_items: 1, // done item's past date suppressed
    incomplete_items: 2,
    new_items: 4, // all created just now
  });
});

it("skips the owner criterion on a board with no people column", async () => {
  // second board: status + date columns only; one item with a date, no status
  // → incomplete_items 0 (owner criterion inexpressible, date present)
});

it("rejects a non-member", async () => {
  const { error } = await otherUserClient.rpc("dashboard_health_summary", {
    p_board_id: boardId,
  });
  expect(error).not.toBeNull();
});

it("_org_health_digest is not callable by authenticated users", async () => {
  const { error } = await client.rpc("_org_health_digest", {
    p_org_id: orgId,
    p_since: new Date(Date.now() - 7 * 864e5).toISOString(),
  });
  expect(error).not.toBeNull(); // revoked
});

it("digest_runs is invisible to authenticated users", async () => {
  const { data } = await client.from("digest_runs").select("id");
  expect(data ?? []).toEqual([]); // RLS: no policies
});
```

(For `_org_health_digest`'s positive semantics — per-board rows, ≤5-name samples, zero-count
boards dropped — add a service-role-keyed describe block only if the integration env exposes
the service key the way other suites do; otherwise those semantics stay covered by Task 8's
mocked unit tests plus the counts assertions above.)

- [ ] **Step 2: Run the suite**

Run: `pnpm vitest run src/lib/dashboards/health-summary.integration.test.ts`
Expected: PASS against the dedicated test project (`.env.test` present); SKIP cleanly
otherwise. Requires Tasks 1+2 SQL applied to the **test** project too — hand the user both
files if not yet done.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dashboards/health-summary.integration.test.ts
git commit -m "test(dashboards): health summary rpc integration coverage"
```

---

### Task 11: Full gates + finish

**Files:** none new.

**Interfaces:**

- Consumes: everything above.
- Produces: merged `task/health-summary` → `develop`; worktree removed.

- [ ] **Step 1: Run all four gates from the worktree root**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all PASS. Known traps: cold `pnpm typecheck` can fail on `cacheLife("nav"/"guard")`
until `pnpm build` generates `.next/types` (run build first if so); if a rebase pulls a dep
another session added, `pnpm install` then re-run.

- [ ] **Step 2: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (auto-rebases onto latest `develop`,
re-runs gates against the merged state, merges, pushes, removes the worktree). If it stops on
a real rebase conflict: resolve `git rebase develop`, re-run.

- [ ] **Step 3: Hand the user the manual-test walkthrough** (closing message + `/wrapup`
      session note):

1. Pull `develop`, ensure both migrations are applied to dev, run the app.
2. **Widget:** Dashboards → any dashboard → Add widget → type **Health summary** → pick a
   board with items missing owners/dates and something overdue → expect a tile with a big
   done-% + progress bar and three rows (New this week / Overdue / Incomplete); overdue and
   incomplete counts render red only when > 0. Fix an item's owner/date on the board, wait
   ~30 s, refresh → counts drop.
3. **Manual digest run:** set `DIGEST_SECRET` (32+ chars) in `.env.local`, restart, then
   `curl -X POST -H "Authorization: Bearer <secret>" http://localhost:3000/api/digest/run`
   → JSON `{ processed, sent, skipped, failed }`; the bell shows "Weekly digest: X new · Y
   incomplete · Z overdue" for every org member; clicking it opens /dashboards. A second
   curl the same week → all orgs `skipped` (idempotent).
4. **Email (optional):** additionally set `RESEND_API_KEY`, `APP_BASE_URL`,
   `DIGEST_FROM_EMAIL` (verified Resend sender), delete this week's `digest_runs` rows, re-run
   the curl → digest email arrives with board table + working unsubscribe link; the link
   flips the Settings toggle off.
5. **Opt-out:** Settings → Notifications → untick "Email me the weekly plan health digest" →
   re-run (new week or cleared rows) → no email for that user, in-app notification still
   arrives.
6. **Cron (prod):** provision Vault secrets `app_url` + `digest_secret`; the daily 07:00 UTC
   job then sends Mondays (with all-week retry on failure) with no further action.

---

## Execution DAG (working agreement #6)

**Dependency edges** (from the Interfaces blocks):

- Task 1 (migration A) → Task 2 (digest RPC calls `_board_health_counts`), Task 5 (RPC
  types), Task 7 (kind + payload types), Task 10 (deployed SQL)
- Task 2 (migration B) → Task 8 (`digest_runs` + `_org_health_digest` types), Task 9
  (`email_digest_opt_out` types), Task 10
- Task 3 (pure digest lib) → Task 7 (payload schema), Task 8 (period/token/render), Task 9
  (token verify)
- Task 4 (widget vocab) → Task 5 (kind + `HealthCounts`), Task 6 (`shapeHealth`)
- Task 5 (server plumbing) → Task 6 (`data.health`)
- Task 8 (env vars) → Task 9 (reads `DIGEST_SECRET`/`APP_BASE_URL` from `env.server.ts`)
- Tasks 1–10 → Task 11 (gates + finish)

**Parallel batches** (≥2 tasks in a batch → dispatch with
`superpowers:dispatching-parallel-agents` / parallel subagents; all tasks share this one
worktree, so batch members must touch disjoint files — the batches below are file-disjoint):

| Wave | Tasks       | Notes                                                                                       |
| ---- | ----------- | ------------------------------------------------------------------------------------------- |
| 1    | T1, T3, T4  | independent (SQL+types / pure digest lib / widget vocab) — file-disjoint                    |
| 2    | T2, T5, T7  | T2 needs T1 applied; T5 needs T1+T4; T7 needs T1+T3 — file-disjoint                         |
| 3    | T6, T8, T10 | T6 needs T4+T5; T8 needs T2+T3; T10 needs T1+T2 applied to the test project — file-disjoint |
| 4    | T9          | needs T2+T3+T8 (env module is shared with T8 — keep sequential to avoid same-file edits)    |
| 5    | T11         | gates + finish                                                                              |

**Critical path (wall-clock floor):** T1 → T2 → T8 → T9 → T11 — dominated by the two
human-in-the-loop migration applies. Start T1 first and get its SQL to the user immediately;
T3/T4 fill the wait, and hand T2's SQL over as soon as T1 is confirmed.

## Out of scope (from the spec)

- Rule configurability (org/board-level), the "parent needs a sub-item" criterion (vacuous in
  Pulse — requester follow-up), org-local send times, per-board digest subscriptions, email
  for other notification kinds, AI-wizard support for the health kind.
- Feedback-row status update (`resolved` + admin response) happens at MVP-item closure per
  the goal plan's definition of done, not in this task.
