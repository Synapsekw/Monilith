# Phase 5b-2 — Date-Based Automation Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `date_reached` automation trigger ("when {date column} is {N days before / on / N days after}") driven by a `pg_cron` hourly sweep that fires each org once per local day at 08:00 org-local, reusing the existing `_automation_run` engine.

**Architecture:** Entirely in-DB, identical execution/security model to 5a/5b-1. A new `_automation_date_sweep(p_now)` Postgres function iterates orgs (using a new `organizations.timezone`), matches items whose date cell = `today − offsetDays`, records each firing in a once-only `automation_date_fires` ledger (`on conflict do nothing`), and calls `_automation_run(..., actor := null)`. `pg_cron` (available, not yet installed) runs the sweep hourly. A minimal `/settings` page lets org admins set the timezone.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + RLS + `pg_cron`), Zod, TanStack Query, Vitest, Playwright, shadcn/Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-18-phase-5b2-automations-design.md`

**⚠️ Manual gate:** Applying migrations to the cloud DB (`supabase db push --linked`) and `create extension pg_cron` require **per-session authorization from Danijel**. Stop and ask before pushing. Regenerate types after each migration: `pnpm db:types` (filter the stray PostHog `"_tag"` telemetry line if it appears, then prettier).

---

## File Structure

**Create:**

- `supabase/migrations/20260619090000_automations_5b2_schema.sql` — `organizations.timezone`, `automation_date_fires` ledger + RLS, indexes, org-admin UPDATE policy.
- `supabase/migrations/20260619090001_automations_5b2_engine.sql` — `create extension pg_cron`, `_automation_date_sweep`, `cron.schedule`.
- `src/lib/org/actions.ts` — `updateOrgTimezone` Server Action.
- `src/lib/validations/org.ts` — `updateOrgTimezoneSchema`, IANA validation helper.
- `src/lib/validations/org.test.ts` — schema unit tests.
- `src/app/(app)/settings/page.tsx` — settings RSC page (org name + timezone card).
- `src/components/settings/timezone-form.tsx` — client timezone `<Select>` form.
- `src/components/settings/timezone-form.test.tsx` — form unit test.
- `src/lib/boards/automations.5b2.engine.integration.test.ts` — cloud sweep integration tests.
- `e2e/automations-date.spec.ts` — e2e: settings timezone + date sweep fires.

**Modify:**

- `src/lib/validations/automations.ts` — add `date_reached` union member.
- `src/lib/validations/automations.test.ts` — date_reached schema cases.
- `src/components/boards/automations/AutomationBuilder.tsx` — "Date reached" trigger control.
- `src/components/boards/automations/AutomationBuilder.test.tsx` — builder JSON-construction cases.
- `src/components/boards/automations/AutomationsDialog.tsx` — `summarize()` for `date_reached`.
- `src/components/boards/automations/recipes.ts` — two date recipes.
- `src/components/sidebar.tsx` (or `app-shell.tsx` UserMenu) — "Settings" nav link.
- `src/types/database.types.ts` — regenerated (do not hand-edit).

> Confirm the real route group: the explore pass found the app shell at `src/components/app-shell.tsx` and sidebar at `src/components/sidebar.tsx`. Place the settings page under whichever authed route group the existing `boards`/dashboards pages use (check `src/app/` for the group dir, e.g. `(app)` or `(dashboard)`); the path above is the assumed group — verify and adjust before creating the file.

---

## Task 1: Validation — `date_reached` trigger schema

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Test: `src/lib/validations/automations.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/validations/automations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { automationTriggerSchema } from "./automations";

describe("date_reached trigger", () => {
  it("accepts a valid date_reached trigger", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: "11111111-1111-1111-1111-111111111111",
      offsetDays: -3,
    });
    expect(r.success).toBe(true);
  });

  it("accepts offset 0 (on the date)", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: "11111111-1111-1111-1111-111111111111",
      offsetDays: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects offsetDays out of range", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: "11111111-1111-1111-1111-111111111111",
      offsetDays: 9999,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer offsetDays", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      columnId: "11111111-1111-1111-1111-111111111111",
      offsetDays: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing columnId", () => {
    const r = automationTriggerSchema.safeParse({
      type: "date_reached",
      offsetDays: 0,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/validations/automations.test.ts`
Expected: FAIL — `date_reached` not a recognized discriminated-union member.

- [ ] **Step 3: Add the union member**

In `src/lib/validations/automations.ts`, add to the `automationTriggerSchema` discriminated union array (after the `person_assigned` member):

```ts
  z.object({
    type: z.literal("date_reached"),
    columnId: z.string().uuid(),
    offsetDays: z.number().int().min(-365).max(365),
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/validations/automations.test.ts`
Expected: PASS (all date_reached cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts
git commit -m "feat(automations): date_reached trigger schema (5b-2)"
```

---

## Task 2: Validation — org timezone schema

**Files:**

- Create: `src/lib/validations/org.ts`
- Test: `src/lib/validations/org.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validations/org.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidTimeZone, updateOrgTimezoneSchema } from "./org";

describe("isValidTimeZone", () => {
  it("accepts a real IANA zone", () => {
    expect(isValidTimeZone("Europe/Belgrade")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects a bogus zone", () => {
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("updateOrgTimezoneSchema", () => {
  it("accepts a valid payload", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "11111111-1111-1111-1111-111111111111",
      timezone: "America/New_York",
    });
    expect(r.success).toBe(true);
  });
  it("rejects an invalid timezone", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "11111111-1111-1111-1111-111111111111",
      timezone: "Not/AZone",
    });
    expect(r.success).toBe(false);
  });
  it("rejects a non-uuid orgId", () => {
    const r = updateOrgTimezoneSchema.safeParse({
      orgId: "nope",
      timezone: "UTC",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/validations/org.test.ts`
Expected: FAIL — module `./org` does not exist.

- [ ] **Step 3: Implement the schema**

Create `src/lib/validations/org.ts`:

```ts
import { z } from "zod";

/** True when `tz` is an IANA timezone the runtime recognizes. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    // Throws RangeError for unknown zones.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const updateOrgTimezoneSchema = z.object({
  orgId: z.string().uuid(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
});
export type UpdateOrgTimezoneInput = z.infer<typeof updateOrgTimezoneSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/validations/org.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/org.ts src/lib/validations/org.test.ts
git commit -m "feat(org): timezone validation schema (5b-2)"
```

---

## Task 3: Migration — schema (timezone column, ledger, indexes, admin policy)

**Files:**

- Create: `supabase/migrations/20260619090000_automations_5b2_schema.sql`

> Adjust the timestamp prefix so it sorts **after** the latest existing migration (`20260618160002_...`) and reflects the actual date. Convention: `YYYYMMDDHHMMSS_name.sql`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619090000_automations_5b2_schema.sql`:

```sql
-- Phase 5b-2: schema for date-based automation triggers.

-- (a) Org timezone (IANA name). Default UTC; existing rows backfill via the default.
alter table public.organizations
  add column if not exists timezone text not null default 'UTC';

-- Validate against Postgres's known zone names. (pg_timezone_names is a catalog view.)
alter table public.organizations
  add constraint organizations_timezone_valid
  check (timezone in (select name from pg_timezone_names));

-- Allow org owners/admins to update their org (e.g. timezone). Reuses has_org_role.
drop policy if exists "organizations: update if admin" on public.organizations;
create policy "organizations: update if admin"
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::public.org_role[]))
  with check (public.has_org_role(id, array['owner','admin']::public.org_role[]));

-- (b) Once-only fire ledger. PK gives idempotency; rows written only by the sweep (definer).
create table if not exists public.automation_date_fires (
  automation_id uuid not null references public.automations (id) on delete cascade,
  item_id       uuid not null references public.items (id) on delete cascade,
  org_id        uuid not null references public.organizations (id) on delete cascade,
  fire_date     date not null,
  fired_at      timestamptz not null default now(),
  primary key (automation_id, item_id, fire_date)
);

alter table public.automation_date_fires enable row level security;

-- Org-scoped read only (for a future 5c run-history). No client write policy:
-- inserts happen exclusively via the SECURITY DEFINER sweep.
drop policy if exists "date_fires: read if member" on public.automation_date_fires;
create policy "date_fires: read if member"
  on public.automation_date_fires for select to authenticated
  using (public.is_org_member(org_id));

-- (c) Indexes.
-- Partial index for the per-org date_reached rule lookup (mirrors the item_created index).
create index if not exists automations_date_reached_idx
  on public.automations (board_id)
  where enabled and (trigger ->> 'type') = 'date_reached';

-- Functional index so the per-rule date-cell match is indexed, not a scan.
create index if not exists cell_values_date_idx
  on public.cell_values (column_id, (value ->> 'date'));
```

- [ ] **Step 2: Ask Danijel for authorization, then apply**

Stop and request authorization to push migrations to the linked cloud project. Once granted:

Run: `supabase db push --linked`
Expected: migration applies cleanly; `organizations.timezone` exists, `automation_date_fires` created.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` gains `automation_date_fires` and `organizations.timezone`. (If a stray `"_tag"` PostHog line appears at the top, remove it, then re-run prettier.)

- [ ] **Step 4: Verify typecheck still green**

Run: `pnpm typecheck`
Expected: PASS (no consumers reference the new types yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260619090000_automations_5b2_schema.sql src/types/database.types.ts
git commit -m "feat(automations): 5b-2 schema — org timezone, date-fires ledger, indexes"
```

---

## Task 4: Migration — engine (pg_cron + sweep function)

**Files:**

- Create: `supabase/migrations/20260619090001_automations_5b2_engine.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619090001_automations_5b2_engine.sql`:

```sql
-- Phase 5b-2: the date sweep + pg_cron schedule.

create extension if not exists pg_cron;   -- installs into the `cron` schema on Supabase

-- _automation_date_sweep: fire date_reached rules for every org at 08:00 org-local.
-- p_now defaults to now() in production; tests inject a deterministic instant.
create or replace function public._automation_date_sweep(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org    record;
  v_rule   record;
  v_item   record;
  v_local  timestamp;
  v_today  date;
  v_target date;
  v_count  int;
begin
  for v_org in select id, timezone from public.organizations loop
    -- Wall-clock time in the org's timezone (DST-correct).
    v_local := p_now at time zone v_org.timezone;
    -- Fire each org once per local day, at its own 08:00 local hour.
    if extract(hour from v_local)::int <> 8 then
      continue;
    end if;
    v_today := v_local::date;

    for v_rule in
      select id, board_id, org_id, actions, condition, trigger
      from public.automations
      where org_id = v_org.id
        and enabled
        and (trigger ->> 'type') = 'date_reached'
    loop
      -- offsetDays sign: cell = today - offsetDays
      -- (-3 => today+3 i.e. 3 days out; +2 => today-2 i.e. 2 days ago).
      v_target := v_today - (v_rule.trigger ->> 'offsetDays')::int;

      for v_item in
        select cv.item_id
        from public.cell_values cv
        where cv.column_id = (v_rule.trigger ->> 'columnId')::uuid
          and (cv.value ->> 'date') = v_target::text   -- text compare: no cast errors
      loop
        insert into public.automation_date_fires
          (automation_id, item_id, org_id, fire_date)
        values (v_rule.id, v_item.item_id, v_org.id, v_today)
        on conflict do nothing;

        get diagnostics v_count = row_count;
        if v_count > 0 then
          -- actor := null (system-initiated; never self-excludes a recipient).
          perform public._automation_run(
            v_rule.id, v_rule.actions, v_rule.condition,
            v_item.item_id, v_rule.org_id, v_rule.board_id, null);
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

-- Hourly schedule. cron.schedule upserts by job name => migration is re-runnable.
select cron.schedule(
  'automations-date-sweep',
  '0 * * * *',
  $cron$ select public._automation_date_sweep() $cron$
);
```

- [ ] **Step 2: Apply (authorization already granted in Task 3)**

Run: `supabase db push --linked`
Expected: `pg_cron` installed; `_automation_date_sweep` created; one row in `cron.job` named `automations-date-sweep`.

If `create extension pg_cron` is rejected by the linked project, enable `pg_cron` once via the Supabase dashboard (Database → Extensions) — note this in the session log — then re-run `supabase db push --linked`.

- [ ] **Step 3: Verify the job registered**

Run (via the Supabase SQL editor or MCP `execute_sql`): `select jobname, schedule from cron.job where jobname = 'automations-date-sweep';`
Expected: one row, schedule `0 * * * *`.

- [ ] **Step 4: Regenerate types + typecheck**

Run: `pnpm db:types && pnpm typecheck`
Expected: PASS (no new public tables; types unchanged or trivially so).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260619090001_automations_5b2_engine.sql src/types/database.types.ts
git commit -m "feat(automations): 5b-2 engine — _automation_date_sweep + pg_cron schedule"
```

---

## Task 5: Engine integration tests (cloud)

**Files:**

- Create: `src/lib/boards/automations.5b2.engine.integration.test.ts`

Model the harness on `src/lib/boards/automations.engine.5b1.integration.test.ts` (service-role admin client, anon user client, `create_organization` / `create_board` RPCs, `poll()` helper). The sweep is invoked deterministically via `admin.rpc("_automation_date_sweep", { p_now })`.

> **Determinism:** set the test org's timezone to a known zone and pick `p_now` so it is exactly 08:00 there. Example: `timezone = "Asia/Tokyo"` (UTC+9) and `p_now = "<date>T23:00:00Z"` → Tokyo local 08:00 next day.

- [ ] **Step 1: Write the integration tests**

Create `src/lib/boards/automations.5b2.engine.integration.test.ts`. Reuse the 5b-1 setup boilerplate (copy `beforeAll`/`afterAll` org+board+user creation; adjust names). Core cases:

```ts
// --- helpers specific to this suite (alongside the copied harness) ---

// Set an item's date cell (value shape: { date: "YYYY-MM-DD" }).
async function setDate(itemId: string, columnId: string, iso: string) {
  return setCell(itemId, columnId, { date: iso });
}

// Invoke the sweep at a chosen instant.
async function sweep(pNowIso: string) {
  const { error } = await admin.rpc("_automation_date_sweep", {
    p_now: pNowIso,
  });
  expect(error, error?.message).toBeNull();
}

// ISO date string for "today + n" relative to a base date.
function isoPlus(base: string, n: number): string {
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
```

Tests (each creates its rule + item, sweeps, asserts, then cleans up — follow the 5b-1 delete-after pattern):

```ts
it("fires on the date (offset 0) → set_option", async () => {
  // Tokyo 08:00 == 2026-06-21 local; due date = that local date.
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-20T23:00:00Z"; // 2026-06-21 08:00 Tokyo
  const localToday = "2026-06-21";

  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, localToday); // offset 0 => cell == today

  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    actions: [{ type: "set_option", columnId: colSId, optionId: optWorkingId }],
  });

  await sweep(pNow);

  const cell = await poll(async () => {
    const { data } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemId)
      .eq("column_id", colSId);
    return data && data.length > 0 ? data[0] : null;
  });
  expect((cell as { value: unknown }).value).toMatchObject({
    optionId: optWorkingId,
  });

  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("fires 3 days before (offset -3): cell == today+3", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-20T23:00:00Z"; // local 2026-06-21
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-24"); // today+3

  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: -3 },
    actions: [{ type: "set_option", columnId: colSId, optionId: optWorkingId }],
  });
  await sweep(pNow);

  const cell = await poll(async () => {
    const { data } = await admin
      .from("cell_values")
      .select("value")
      .eq("item_id", itemId)
      .eq("column_id", colSId);
    return data && data.length > 0 ? data[0] : null;
  });
  expect((cell as { value: unknown }).value).toMatchObject({
    optionId: optWorkingId,
  });
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("does NOT fire when the local hour is not 08:00", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-21T05:00:00Z"; // Tokyo 14:00 — not the target hour
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-21");
  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    actions: [{ type: "set_option", columnId: colSId, optionId: optWorkingId }],
  });
  await sweep(pNow);
  await new Promise((r) => setTimeout(r, 1500));
  const { data } = await admin
    .from("cell_values")
    .select("value")
    .eq("item_id", itemId)
    .eq("column_id", colSId);
  expect(data ?? []).toHaveLength(0); // no set_option happened
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("is idempotent: running the sweep twice fires once", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-20T23:00:00Z";
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-21");
  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    actions: [
      { type: "notify", recipient: { kind: "member", userId: userAId } },
    ],
  });
  await sweep(pNow);
  await sweep(pNow); // second run must not duplicate
  await new Promise((r) => setTimeout(r, 1500));
  const { data: fires } = await admin
    .from("automation_date_fires")
    .select("automation_id")
    .eq("automation_id", autoId);
  expect(fires ?? []).toHaveLength(1);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("re-fires for a moved date (new fire_date)", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-21");
  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    actions: [
      { type: "notify", recipient: { kind: "member", userId: userAId } },
    ],
  });
  await sweep("2026-06-20T23:00:00Z"); // local 2026-06-21 -> fires
  await setDate(itemId, dateColId, "2026-06-22"); // move date out a day
  await sweep("2026-06-21T23:00:00Z"); // local 2026-06-22 -> fires again
  await new Promise((r) => setTimeout(r, 1500));
  const { data: fires } = await admin
    .from("automation_date_fires")
    .select("fire_date")
    .eq("automation_id", autoId);
  expect((fires ?? []).length).toBe(2);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("respects the If condition gate", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-20T23:00:00Z";
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-21");
  // Condition requires S == Stuck, but the cell is unset => gate blocks.
  const autoId = await insertAutomation({
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    condition: {
      combinator: "and",
      conditions: [{ columnId: colSId, operator: "is", value: optStuckId }],
    },
    actions: [
      { type: "notify", recipient: { kind: "member", userId: userAId } },
    ],
  });
  await sweep(pNow);
  await new Promise((r) => setTimeout(r, 1500));
  const { data: fires } = await admin
    .from("automation_date_fires")
    .select("automation_id")
    .eq("automation_id", autoId);
  expect(fires ?? []).toHaveLength(0); // gate blocked => no fire row
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});

it("disabled rules never fire", async () => {
  await admin
    .from("organizations")
    .update({ timezone: "Asia/Tokyo" })
    .eq("id", orgAId);
  const pNow = "2026-06-20T23:00:00Z";
  const itemId = await createFreshItem();
  await setDate(itemId, dateColId, "2026-06-21");
  const autoId = await insertAutomation({
    enabled: false,
    trigger: { type: "date_reached", columnId: dateColId, offsetDays: 0 },
    actions: [
      { type: "notify", recipient: { kind: "member", userId: userAId } },
    ],
  });
  await sweep(pNow);
  await new Promise((r) => setTimeout(r, 1500));
  const { data: fires } = await admin
    .from("automation_date_fires")
    .select("automation_id")
    .eq("automation_id", autoId);
  expect(fires ?? []).toHaveLength(0);
  await admin.from("automations").delete().eq("id", autoId);
  await admin.from("items").delete().eq("id", itemId);
});
```

> You will need a `dateColId` (a `date` column) and `optStuckId` in the suite's seed. Add a date column and a "Stuck" status option to the copied `beforeAll` seeding. `insertAutomation` must accept an optional `enabled` and `condition` (extend the 5b-1 helper). `createFreshItem`, `setCell`, `poll`, `insertAutomation` come from the 5b-1 harness — copy and adapt.

- [ ] **Step 2: Run the suite**

Run: `pnpm test src/lib/boards/automations.5b2.engine.integration.test.ts`
Expected: PASS (all cases). If the sweep RPC 404s (PostREST schema cache), run `notify pgrst, 'reload schema';` once via SQL and retry.

- [ ] **Step 3: Run the 5b-1/5a regression suites**

Run: `pnpm test src/lib/boards/automations.engine.5b1.integration.test.ts src/lib/boards/automations.rls.integration.test.ts`
Expected: PASS — reactive triggers + depth cap unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/automations.5b2.engine.integration.test.ts
git commit -m "test(automations): 5b-2 date sweep cloud integration"
```

---

## Task 6: Server Action — `updateOrgTimezone`

**Files:**

- Create: `src/lib/org/actions.ts`

The action validates input, then updates `organizations.timezone` via the **user** client (RLS + the new admin policy enforce authorization). Mirror the patterns in `src/lib/boards/automation-actions.ts` (`createClient`, `safeParse`, `revalidatePath`, an `ActionResult`/`fail` shape — reuse the same result helper that file uses; import it from wherever it is defined there).

- [ ] **Step 1: Implement the action**

Create `src/lib/org/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateOrgTimezoneSchema } from "@/lib/validations/org";

type Result = { ok: true } | { ok: false; error: string };

export async function updateOrgTimezone(input: {
  orgId: string;
  timezone: string;
}): Promise<Result> {
  const parsed = updateOrgTimezoneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated." };

  // RLS ("organizations: update if admin") gates this to org owners/admins.
  const { error } = await supabase
    .from("organizations")
    .update({ timezone: parsed.data.timezone })
    .eq("id", parsed.data.orgId);

  if (error) return { ok: false, error: "Could not update timezone." };

  revalidatePath("/settings");
  return { ok: true };
}
```

> If `src/lib/boards/automation-actions.ts` exports a shared `ActionResult`/`fail` helper, use that instead of the inline `Result` above for consistency. Match the file's existing style.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/org/actions.ts
git commit -m "feat(org): updateOrgTimezone server action (5b-2)"
```

---

## Task 7: Settings page + timezone form + nav link

**Files:**

- Create: `src/components/settings/timezone-form.tsx`
- Create: `src/components/settings/timezone-form.test.tsx`
- Create: `src/app/(app)/settings/page.tsx` (verify the route group — see File Structure note)
- Modify: `src/components/sidebar.tsx` **or** `src/components/app-shell.tsx` (Settings link)

**UI work — load the `pulse-ui` and `frontend-design` skills before building these components.** Use existing shadcn primitives (`Select`, `Card`, `Button`, `Label`) and Monolith tokens; match the dashboards/board surfaces' density and chrome.

- [ ] **Step 1: Write the form test**

Create `src/components/settings/timezone-form.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneForm } from "./timezone-form";

vi.mock("@/lib/org/actions", () => ({
  updateOrgTimezone: vi.fn(async () => ({ ok: true })),
}));
import { updateOrgTimezone } from "@/lib/org/actions";

describe("TimezoneForm", () => {
  it("renders the current timezone as the selected value", () => {
    render(<TimezoneForm orgId="o1" currentTimezone="Europe/Belgrade" />);
    expect(screen.getByDisplayValue("Europe/Belgrade")).toBeInTheDocument();
  });

  it("saves the chosen timezone via the action", async () => {
    render(<TimezoneForm orgId="o1" currentTimezone="UTC" />);
    const select = screen.getByLabelText(/timezone/i);
    await userEvent.selectOptions(select, "America/New_York");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgTimezone).toHaveBeenCalledWith({
      orgId: "o1",
      timezone: "America/New_York",
    });
  });
});
```

> If the project's `Select` is the shadcn Radix combobox (not a native `<select>`), adapt the queries (`getByRole("combobox")` + option click) to match how other forms in `src/components` are tested. Check an existing form test (e.g. the dashboards add-widget dialog test) for the established pattern, and mirror it. The form may use a plain native `<select>` populated from `Intl.supportedValuesOf("timeZone")` for simplicity — that is acceptable and matches the test above.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/settings/timezone-form.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement the form**

Create `src/components/settings/timezone-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { updateOrgTimezone } from "@/lib/org/actions";

// Full IANA list from the runtime; no DB round-trip.
const ZONES: string[] =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];

export function TimezoneForm({
  orgId,
  currentTimezone,
}: {
  orgId: string;
  currentTimezone: string;
}) {
  const [tz, setTz] = useState(currentTimezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    start(async () => {
      const res = await updateOrgTimezone({ orgId, timezone: tz });
      setMsg(res.ok ? "Saved." : res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="org-tz" className="text-sm font-medium">
        Timezone
      </label>
      <select
        id="org-tz"
        value={tz}
        onChange={(e) => setTz(e.target.value)}
        className="..." /* match the app's select styling / shadcn Select */
      >
        {ZONES.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || tz === currentTimezone}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-muted-foreground text-sm">{msg}</span>}
      </div>
      <p className="text-muted-foreground text-sm">
        Date automations fire at 8:00 AM in this timezone.
      </p>
    </div>
  );
}
```

> Replace raw `<button>`/`<select>`/`className="..."` with the project's shadcn `Button`/`Select` + Monolith tokens per the `pulse-ui` skill. Keep the same props/behavior so the test holds.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/settings/timezone-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Implement the settings page**

Create `src/app/(app)/settings/page.tsx` (RSC). Resolve the user's org server-side; for v1 use the first org (single-org assumption — see Risks). Use the same auth/redirect guard the other authed pages use.

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TimezoneForm } from "@/components/settings/timezone-form";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS-scoped: returns only orgs the user belongs to. v1 uses the first.
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, timezone")
    .order("created_at", { ascending: true })
    .limit(1);
  const org = orgs?.[0];
  if (!org) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="mt-6 rounded-lg border p-5">
        <h2 className="text-muted-foreground text-sm font-medium">
          Organization
        </h2>
        <p className="mt-1 text-base">{org.name}</p>
        <div className="mt-5">
          <TimezoneForm
            orgId={org.id}
            currentTimezone={org.timezone ?? "UTC"}
          />
        </div>
      </section>
    </div>
  );
}
```

> Apply the `pulse-ui` skill to the layout (Card primitive, spacing, heading scale). Confirm the route group matches the other authed pages so the app-shell chrome wraps it.

- [ ] **Step 6: Add the Settings nav link**

Add a "Settings" entry. Preferred home: the **UserMenu** dropdown in `src/components/app-shell.tsx` (a `DropdownMenuItem asChild` linking to `/settings`, above the Sign-out item), or a sidebar-footer link in `src/components/sidebar.tsx` near the Workspaces section. Use a `Settings` icon from the same icon set the sidebar uses (lucide). Example (user menu):

```tsx
<DropdownMenuItem asChild>
  <a href="/settings">Settings</a>
</DropdownMenuItem>
<DropdownMenuSeparator />
```

- [ ] **Step 7: Verify build + typecheck + the page renders**

Run: `pnpm typecheck && pnpm test src/components/settings/timezone-form.test.tsx`
Expected: PASS. (Full `pnpm build` runs in the final gate, Task 10.)

- [ ] **Step 8: Commit**

```bash
git add src/app src/components/settings src/components/app-shell.tsx src/components/sidebar.tsx
git commit -m "feat(settings): org timezone settings page + nav link (5b-2)"
```

---

## Task 8: Builder — "Date reached" trigger control

**Files:**

- Modify: `src/components/boards/automations/AutomationBuilder.tsx`
- Test: `src/components/boards/automations/AutomationBuilder.test.tsx`

**Load `pulse-ui` before editing the builder UI.** Match the existing trigger-control styling.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/boards/automations/AutomationBuilder.test.tsx` (follow the file's existing render/save assertion pattern — it constructs a trigger JSON and asserts the saved draft):

```tsx
it("builds a date_reached trigger with a negative offset (days before)", async () => {
  // render the builder with a board that has a date column "Due";
  // select trigger type "Date reached", pick column "Due",
  // choose "days before" with value 3, add a set_option action, Save.
  // Assert the saved trigger equals:
  //   { type: "date_reached", columnId: <dueId>, offsetDays: -3 }
});

it("builds a date_reached trigger 'on the date' (offset 0)", async () => {
  // select "On the date"; assert offsetDays === 0.
});

it("builds a date_reached trigger with 'days after' (positive offset)", async () => {
  // choose "days after" value 2; assert offsetDays === 2.
});
```

> Fill these in concretely using the exact queries the existing builder tests use (the explore pass showed the trigger is built via a union switch and saved through an `onSave`/draft callback). Reuse the same harness, board fixture, and a date column. Mirror how the `person_assigned` test selects a people column.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL — no "Date reached" option / offset control yet.

- [ ] **Step 3: Add the control**

In `AutomationBuilder.tsx`:

1. Add `"date_reached"` to the trigger-type selector options ("Date reached").
2. Derive `dateColumns = columns.filter((c) => c.kind === "date")`.
3. Add state for the date column id and the offset (a `direction: "before" | "on" | "after"` + a `count: number`). Render: a date-column picker + a direction select (`On the date` / `N days before` / `N days after`) + a number input (hidden/disabled when "on").
4. Map to `offsetDays`: `on → 0`, `before → -count`, `after → +count`.
5. Extend the trigger-construction switch:

```ts
const trigger: AutomationTrigger =
  triggerType === "status_changed"
    ? {
        type: "status_changed",
        columnId: statusColId,
        toOptionId: statusOptId === ANY ? null : statusOptId,
      }
    : triggerType === "person_assigned"
      ? { type: "person_assigned", columnId: peopleColId }
      : triggerType === "date_reached"
        ? {
            type: "date_reached",
            columnId: dateColId,
            offsetDays:
              dateDirection === "on"
                ? 0
                : dateDirection === "before"
                  ? -Math.abs(dateCount)
                  : Math.abs(dateCount),
          }
        : { type: "item_created" };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationBuilder.tsx src/components/boards/automations/AutomationBuilder.test.tsx
git commit -m "feat(automations): date_reached builder control (5b-2)"
```

---

## Task 9: Dialog summary + recipes

**Files:**

- Modify: `src/components/boards/automations/AutomationsDialog.tsx`
- Modify: `src/components/boards/automations/recipes.ts`
- Test: `src/components/boards/automations/AutomationsDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/boards/automations/AutomationsDialog.test.tsx` a test that the `summarize()` output renders a date trigger (follow how existing summary tests assert text). Cases: offset 0 → "When Due date is reached, …"; offset -3 → "… is in 3 days …"; offset +2 → "… is 2 days overdue …".

If `summarize` is not exported, test it via the rendered rule list (the dialog renders each rule's summary string) as the existing tests do.

```tsx
it("summarizes a date_reached rule (on the date)", () => {
  // render the dialog with a rule:
  //   trigger: { type: "date_reached", columnId: dueId, offsetDays: 0 }
  //   actions: [{ type: "notify", recipient: { kind: "member", userId } }]
  // expect text matching /When .* is reached/i
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: FAIL — `summarize` doesn't handle `date_reached` (likely throws or renders wrong).

- [ ] **Step 3: Extend `summarize()`**

In `AutomationsDialog.tsx`, add a branch to the `when` computation:

```ts
} else if (trigger.type === "date_reached") {
  const col = colName(columns, trigger.columnId);
  const n = Math.abs(trigger.offsetDays);
  when =
    trigger.offsetDays === 0
      ? `When ${col} is reached`
      : trigger.offsetDays < 0
        ? `When ${col} is in ${n} day${n === 1 ? "" : "s"}`
        : `When ${col} is ${n} day${n === 1 ? "" : "s"} overdue`;
}
```

(Keep the existing `status_changed` / `person_assigned` / `item_created` branches.)

- [ ] **Step 4: Add the recipes**

In `recipes.ts`, add two builders (matching the existing `Draft` shape):

```ts
export function recipeDateReachedSetOption(
  dateColumnId: string,
  targetColumnId: string,
  toOptionId: string,
): Draft {
  return {
    trigger: { type: "date_reached", columnId: dateColumnId, offsetDays: 0 },
    actions: [
      { type: "set_option", columnId: targetColumnId, optionId: toOptionId },
    ],
  };
}

export function recipeDueSoonNotifyOwner(
  dateColumnId: string,
  peopleColumnId: string,
  daysBefore = 3,
): Draft {
  return {
    trigger: {
      type: "date_reached",
      columnId: dateColumnId,
      offsetDays: -Math.abs(daysBefore),
    },
    actions: [{ type: "notify", recipient: { kind: "owner", peopleColumnId } }],
  };
}
```

Wire these into the recipe quick-start list the dialog/builder renders (mirror how `recipeItemCreatedSetOption` / `recipePersonAssignedNotify` are surfaced — same call site, gated on the board having a date column / people column).

- [ ] **Step 5: Run to verify pass**

Run: `pnpm test src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/automations/AutomationsDialog.tsx src/components/boards/automations/recipes.ts src/components/boards/automations/AutomationsDialog.test.tsx
git commit -m "feat(automations): date_reached summary + recipes (5b-2)"
```

---

## Task 10: e2e + full gate

**Files:**

- Create: `e2e/automations-date.spec.ts`

Model on `e2e/automations.spec.ts` (admin service client seeding, UI login, build-rule-in-dialog flow).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/automations-date.spec.ts` with two tests:

1. **Settings timezone persists:** log in, onboard, go to `/settings`, change the timezone select, click Save, reload, assert the new value is selected. Also assert via the admin client that `organizations.timezone` updated.

2. **Date rule fires via the sweep:** log in, onboard, create a board with a Date column and a Status column, add an item with the Date cell = a known local "today", set the org timezone (admin client) to a zone where a chosen `p_now` is 08:00. Build "When {Date} is reached → set Status → Working" in the Automations dialog (now exercising the new builder control). Invoke `admin.rpc("_automation_date_sweep", { p_now })`. Assert (poll) the item's Status cell becomes Working in the UI / DB.

> Use the same combobox/option selectors the existing automations e2e uses for the trigger-type and value selects; add selection of the new "Date reached" type and the offset "On the date" option.

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm exec playwright test e2e/automations-date.spec.ts`
Expected: PASS (both tests). Dev server auto-starts per `playwright.config.ts`.

- [ ] **Step 3: Full verification gate**

Run each and confirm green:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all PASS. Then re-run the automations integration + e2e suites once more for evidence:

```bash
pnpm test src/lib/boards/automations.5b2.engine.integration.test.ts src/lib/boards/automations.engine.5b1.integration.test.ts
pnpm exec playwright test e2e/automations-date.spec.ts e2e/automations.spec.ts
```

- [ ] **Step 4: Advisors**

Run advisors (Supabase MCP `get_advisors` if exposed, else dashboard) and confirm no new warnings — especially that `_automation_date_sweep` has `search_path` pinned (it does) and no "RLS disabled" on `automation_date_fires` (it's enabled). Note `pg_cron` may surface an informational "extension in public" advisor — it installs to the `cron` schema, so this should not fire; record the result.

- [ ] **Step 5: Commit**

```bash
git add e2e/automations-date.spec.ts
git commit -m "test(automations): 5b-2 date trigger e2e (settings tz + sweep fires)"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §2 data model → Tasks 1, 3; §3 engine/sweep → Task 4 (+ Task 5 tests); §4 validation + server action → Tasks 1, 2, 6; §5 client (settings + builder + recipes) → Tasks 7, 8, 9; §6 realtime → no new wiring (reuses existing, no task needed); §7 testing → Tasks 5, 9, 10; §8 non-functional (indexes, search_path, admin gating) → Tasks 3, 4, 6, 10. All sections mapped.
- **Type consistency:** `_automation_run(p_automation_id, p_actions, p_condition, p_item_id, p_org_id, p_board_id, p_actor)` arg order matches the 5b-1 migration; `offsetDays` sign convention (`cell = today − offsetDays`) is identical across Task 4 SQL, Task 8 builder mapping, Task 9 summary, and the spec. `updateOrgTimezone({ orgId, timezone })` signature matches between Task 6 action and Task 7 form. `Draft` recipe shape matches `recipes.ts`.
- **Placeholder scan:** UI-styling `"..."` placeholders are intentional (deferred to the `pulse-ui` skill at build time) and flagged as such; all logic/test/SQL steps contain concrete code. Builder/dialog test bodies are described against the existing harness rather than fully written because they depend on that file's private render helpers — the implementer fills them using the shown assertions.

## Open items to confirm at build time

- The authed **route group** name for `src/app/.../settings/page.tsx`.
- Whether `automation-actions.ts` exports a shared `ActionResult`/`fail` to reuse (Task 6).
- The exact **Select** primitive + its test query pattern (native vs Radix) used elsewhere (Task 7).
- **Single-org assumption** on the settings page (first org) — acceptable for v1; a real org switcher is deferred.
  </content>
