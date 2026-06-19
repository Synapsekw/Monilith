# Phase 5c-1 — Automation Run-History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automations observable — every rule execution writes an `automation_runs` row (status + per-action outcomes), surfaced per-rule as a "Recent runs" disclosure in the Automations dialog; broken actions become fault-isolated (logged, not aborting the user's edit).

**Architecture:** Entirely in-DB. Logging happens inside `_automation_run` (the single chokepoint all four trigger paths call); it gains a `p_trigger_type` param and a `begin/exception` wrapper that logs `ran`/`blocked`/`error` runs with per-action outcomes. A daily `pg_cron` prune keeps the last 50 runs per rule. The client adds a lazy, bounded fetch-on-expand per rule.

**Tech Stack:** Next.js 16 (RSC + Server Actions), Supabase (Postgres + RLS + `pg_cron`), TanStack Query, Zod, Vitest, Playwright, shadcn/Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-06-19-phase-5c1-automations-design.md`

**⚠️ Manual gate:** Task 1 applies a migration to the linked cloud DB (`supabase db push --linked`). Confirm per-session authorization before pushing. Regenerate types with `pnpm db:types` — the piped prettier chokes on a stray PostHog `{"_tag":...}` telemetry line, so run: `supabase gen types typescript --linked --schema public | grep -v '"_tag"' | pnpm exec prettier --parser typescript > src/types/database.types.ts`.

---

## File Structure

**Create:**

- `supabase/migrations/20260619100000_automations_5c1_run_history.sql` — `automation_runs` table + RLS + index + CHECK; `_automation_run` recreation (logging + `p_trigger_type` + fault-isolation); the 3 caller updates; `_automation_runs_prune` + cron job.
- `src/lib/boards/automation-runs.ts` — `timeAgo()` helper + `formatRunActions()` / run-summary formatter (pure, unit-tested).
- `src/lib/boards/automation-runs.test.ts` — formatter + timeAgo unit tests.
- `src/components/boards/automations/RecentRuns.tsx` — the per-rule runs disclosure (client; lazy `useQuery`).
- `src/components/boards/automations/RecentRuns.test.tsx` — rendering test.
- `src/lib/boards/automations.5c1.runhistory.integration.test.ts` — cloud run-history integration tests.

**Modify:**

- `src/lib/boards/automation-actions.ts` — add `getAutomationRuns(automationId, limit)` (server action, mockable like `getAutomations`).
- `src/components/boards/automations/AutomationsDialog.tsx` — render `<RecentRuns>` per rule row.
- `src/components/boards/automations/AutomationsDialog.test.tsx` — (optional) smoke that the disclosure mounts; main coverage in `RecentRuns.test.tsx`.
- `src/types/database.types.ts` — regenerated (do not hand-edit).
- `e2e/automations.spec.ts` OR a new `e2e/automations-runs.spec.ts` — e2e for the runs disclosure.

---

## Task 1: Migration — `automation_runs` + engine logging + prune

**Files:**

- Create: `supabase/migrations/20260619100000_automations_5c1_run_history.sql`

> Adjust the timestamp so it sorts after the latest existing migration (`20260618170002_...`). The body below recreates `_automation_run` and its 3 callers — the SQL is complete; paste it verbatim.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619100000_automations_5c1_run_history.sql`:

```sql
-- Phase 5c-1: automation run-history (observability) + fault isolation.

-- 1) Run-history table.
create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations (id)    on delete cascade,
  org_id        uuid not null references public.organizations (id)  on delete cascade,
  board_id      uuid not null references public.boards (id)         on delete cascade,
  item_id       uuid          references public.items (id)          on delete set null,
  trigger_type  text not null,
  status        text not null check (status in ('ran','blocked','error')),
  actions       jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

alter table public.automation_runs enable row level security;

drop policy if exists "automation_runs: read if member" on public.automation_runs;
create policy "automation_runs: read if member"
  on public.automation_runs for select to authenticated
  using (public.is_org_member(org_id));
-- No client write policy: rows are written only by the SECURITY DEFINER engine.

create index if not exists automation_runs_rule_recent_idx
  on public.automation_runs (automation_id, created_at desc);

-- 2) Recreate _automation_run: + p_trigger_type, + per-action outcome logging,
--    + begin/exception fault isolation. Behavior of notify/set_option is unchanged;
--    each branch now also records its outcome.
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a          jsonb;
  v_outcomes jsonb := '[]'::jsonb;
  v_rid      uuid;
  v_target   uuid;
  v_opt      text;
  v_outcome  text;
begin
  begin
    if not public._automation_conditions_pass(p_condition, p_item_id) then
      insert into public.automation_runs
        (automation_id, org_id, board_id, item_id, trigger_type, status)
      values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'blocked');
      return;
    end if;

    for a in select * from jsonb_array_elements(p_actions)
    loop
      if a->>'type' = 'notify' then
        if a#>>'{recipient,kind}' = 'member' then
          v_rid := (a#>>'{recipient,userId}')::uuid;
        else
          select (cv.value->'userIds'->>0)::uuid
            into v_rid
          from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = (a#>>'{recipient,peopleColumnId}')::uuid;
        end if;

        if v_rid is null then
          v_outcome := 'skipped_no_recipient';
        elsif v_rid is not distinct from p_actor then
          v_outcome := 'skipped_self';
        elsif exists (
          select 1 from public.notifications n
          where n.recipient_id = v_rid
            and n.item_id = p_item_id
            and n.automation_id = p_automation_id
            and n.read_at is null
        ) then
          v_outcome := 'skipped_dup';
        else
          insert into public.notifications
            (org_id, recipient_id, actor_id, kind, board_id, item_id, automation_id)
          values
            (p_org_id, v_rid, p_actor, 'automation', p_board_id, p_item_id, p_automation_id);
          v_outcome := 'sent';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','notify','outcome',v_outcome);

      elsif a->>'type' = 'set_option' then
        v_target := (a->>'columnId')::uuid;
        v_opt := a->>'optionId';
        if exists (
          select 1 from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = v_target
            and cv.value->>'optionId' = v_opt
        ) then
          v_outcome := 'skipped_equal';
        else
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (p_org_id, p_board_id, p_item_id, v_target,
                  jsonb_build_object('optionId', v_opt))
          on conflict (item_id, column_id) do update set value = excluded.value;
          v_outcome := 'set';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_option','outcome',v_outcome);
      end if;
    end loop;

    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, actions)
    values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'ran', v_outcomes);

  exception when others then
    insert into public.automation_runs
      (automation_id, org_id, board_id, item_id, trigger_type, status, error)
    values (p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'error', sqlerrm);
  end;
end; $$;

-- 3) Recreate callers to pass p_trigger_type.
-- 3a) cell_values trigger (status_changed + person_assigned) — adds trigger_type to the select.
create or replace function public.tg_run_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth    int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor    uuid := (select auth.uid());
  v_new_opt  text := new.value->>'optionId';
  v_assigned boolean;
  r          record;
begin
  if (tg_op = 'UPDATE' and new.value is not distinct from old.value) then
    return new;
  end if;

  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  v_assigned := exists (
    select 1
    from jsonb_array_elements_text(coalesce(new.value->'userIds', '[]'::jsonb)) nu(uid)
    where tg_op = 'INSERT'
       or not (coalesce(old.value->'userIds', '[]'::jsonb) ? nu.uid)
  );

  for r in
    select id, actions, condition, trigger->>'type' as trigger_type
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'columnId' = new.column_id::text
      and (
        (
          trigger->>'type' = 'status_changed'
          and (
            trigger->>'toOptionId' is null
            or trigger->>'toOptionId' = v_new_opt
            or (new.value ? 'optionIds'
                and (new.value->'optionIds') ? (trigger->>'toOptionId'))
          )
        )
        or (trigger->>'type' = 'person_assigned' and v_assigned)
      )
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.item_id, new.org_id, new.board_id, v_actor, r.trigger_type
    );
  end loop;

  return new;
end; $$;

-- 3b) items trigger (item_created).
create or replace function public.tg_run_item_automations()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_depth int  := coalesce(nullif(current_setting('pulse.aut_depth', true), '')::int, 0);
  v_actor uuid := (select auth.uid());
  r       record;
begin
  if v_depth >= 5 then
    return new;
  end if;
  perform set_config('pulse.aut_depth', (v_depth + 1)::text, true);

  for r in
    select id, actions, condition
    from public.automations
    where board_id = new.board_id
      and enabled
      and trigger->>'type' = 'item_created'
  loop
    perform public._automation_run(
      r.id, r.actions, r.condition, new.id, new.org_id, new.board_id, v_actor, 'item_created'
    );
  end loop;

  return new;
end; $$;

-- 3c) date sweep (date_reached) — recreate passing 'date_reached'. Body identical to 5b-2
--     except the _automation_run call gains the trigger_type arg.
create or replace function public._automation_date_sweep(p_now timestamptz default now())
returns void
language plpgsql security definer set search_path = '' as $$
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
    begin
      v_local := p_now at time zone v_org.timezone;
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
        v_target := v_today - (v_rule.trigger ->> 'offsetDays')::int;

        for v_item in
          select cv.item_id
          from public.cell_values cv
          where cv.column_id = (v_rule.trigger ->> 'columnId')::uuid
            and (cv.value ->> 'date') = v_target::text
        loop
          insert into public.automation_date_fires
            (automation_id, item_id, org_id, fire_date)
          values (v_rule.id, v_item.item_id, v_org.id, v_today)
          on conflict do nothing;

          get diagnostics v_count = row_count;
          if v_count > 0 then
            perform public._automation_run(
              v_rule.id, v_rule.actions, v_rule.condition,
              v_item.item_id, v_rule.org_id, v_rule.board_id, null, 'date_reached');
          end if;
        end loop;
      end loop;
    exception
      when others then
        raise warning 'automation date sweep skipped org %: %', v_org.id, sqlerrm;
    end;
  end loop;
end; $$;

-- 4) Prune: keep the last 50 runs per rule; daily via pg_cron (installed in 5b-2).
create or replace function public._automation_runs_prune() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.automation_runs ar
  using (
    select id, row_number() over (
      partition by automation_id order by created_at desc, id desc
    ) as rn
    from public.automation_runs
  ) ranked
  where ar.id = ranked.id and ranked.rn > 50;
end; $$;

select cron.schedule('automation-runs-prune', '30 3 * * *',
  $cron$ select public._automation_runs_prune() $cron$);
```

- [ ] **Step 2: Confirm authorization, then apply**

Confirm per-session authorization to push to the linked cloud project. Then run:
Run: `supabase db push --linked --yes`
Expected: migration applies cleanly; `automation_runs` created, functions recreated, `cron.job` has `automation-runs-prune`.

- [ ] **Step 3: Verify objects (via Supabase MCP `execute_sql` or SQL editor)**

Run:

```sql
select
  (select count(*) from information_schema.tables where table_name='automation_runs') as tbl,
  (select relrowsecurity from pg_class where relname='automation_runs') as rls,
  (select count(*) from cron.job where jobname='automation-runs-prune') as prune_job,
  (select proconfig from pg_proc where proname='_automation_run');
```

Expected: `tbl=1`, `rls=true`, `prune_job=1`, sweep/run fns have `search_path=""`.

- [ ] **Step 4: Regenerate types + typecheck**

Run: `supabase gen types typescript --linked --schema public | grep -v '"_tag"' | pnpm exec prettier --parser typescript > src/types/database.types.ts`
Then: `pnpm typecheck`
Expected: `automation_runs` present in types; typecheck clean (no consumers yet).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260619100000_automations_5c1_run_history.sql src/types/database.types.ts
git commit -m "feat(automations): 5c-1 run-history table + engine logging + prune"
```

---

## Task 2: `getAutomationRuns` server action

**Files:**

- Modify: `src/lib/boards/automation-actions.ts`

`getAutomations` already lives here and is the client-callable query the dialog uses (and mocks in tests). Add a sibling for runs, mirroring its shape (read `getAutomations` first to match the exact style — `"use server"` placement, `createClient` import, return type).

- [ ] **Step 1: Implement the query**

Add to `src/lib/boards/automation-actions.ts`:

```ts
import type { Tables } from "@/types/database.types";

export type AutomationRun = Tables<"automation_runs">;

export async function getAutomationRuns(
  automationId: string,
  limit = 50,
): Promise<AutomationRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
```

(Use the file's existing `createClient` import from `@/lib/supabase/server`; if `Tables` is already imported there, don't duplicate.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/boards/automation-actions.ts
git commit -m "feat(automations): getAutomationRuns query (5c-1)"
```

---

## Task 3: `timeAgo` + run formatter (pure helpers)

**Files:**

- Create: `src/lib/boards/automation-runs.ts`
- Test: `src/lib/boards/automation-runs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/boards/automation-runs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { timeAgo, formatRunSummary } from "./automation-runs";

describe("timeAgo", () => {
  it("formats minutes/hours/days ago", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toMatch(
      /5 min/,
    );
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toMatch(
      /3 hour/,
    );
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toMatch(
      /2 day/,
    );
  });
  it("handles just-now", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 2_000).toISOString(), now)).toMatch(
      /now|sec/i,
    );
  });
});

describe("formatRunSummary", () => {
  it("blocked → condition message", () => {
    expect(formatRunSummary("blocked", [])).toMatch(/condition not met/i);
  });
  it("error → error message", () => {
    expect(formatRunSummary("error", [])).toMatch(/error/i);
  });
  it("ran → joins action outcomes", () => {
    const s = formatRunSummary("ran", [
      { type: "notify", outcome: "sent" },
      { type: "set_option", outcome: "skipped_equal" },
    ]);
    expect(s).toMatch(/notified/i);
    expect(s).toMatch(/unchanged|skipped/i);
  });
  it("ran with no actions → 'ran, no actions'", () => {
    expect(formatRunSummary("ran", [])).toMatch(/no action/i);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test src/lib/boards/automation-runs.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/lib/boards/automation-runs.ts`:

```ts
export type RunActionOutcome = { type: string; outcome: string };

/** Relative "x min ago" using Intl.RelativeTimeFormat. `nowMs` injectable for tests. */
export function timeAgo(iso: string, nowMs: number = Date.now()): string {
  const diffSec = Math.round((nowMs - new Date(iso).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs)
      return rtf.format(-Math.floor(diffSec / secs), unit);
  }
  return "just now";
}

const NOTIFY: Record<string, string> = {
  sent: "notified",
  skipped_dup: "already notified",
  skipped_no_recipient: "no recipient",
  skipped_self: "skipped (self)",
};
const SET_OPTION: Record<string, string> = {
  set: "set status",
  skipped_equal: "status unchanged",
};

function describeAction(a: RunActionOutcome): string {
  if (a.type === "notify") return NOTIFY[a.outcome] ?? a.outcome;
  if (a.type === "set_option") return SET_OPTION[a.outcome] ?? a.outcome;
  return `${a.type}: ${a.outcome}`;
}

/** Human one-liner for a run's outcome. */
export function formatRunSummary(
  status: string,
  actions: RunActionOutcome[],
): string {
  if (status === "blocked") return "Condition not met — skipped";
  if (status === "error") return "Error while running";
  if (!actions.length) return "Ran, no actions";
  return actions.map(describeAction).join(" · ");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/lib/boards/automation-runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/automation-runs.ts src/lib/boards/automation-runs.test.ts
git commit -m "feat(automations): run-history time + outcome formatters (5c-1)"
```

---

## Task 4: `RecentRuns` disclosure + dialog wiring

**Files:**

- Create: `src/components/boards/automations/RecentRuns.tsx`
- Test: `src/components/boards/automations/RecentRuns.test.tsx`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx`

**Load the `pulse-ui` skill before building the component.** Use existing primitives (`Button`, `cn`) and a status-badge styled like `src/components/changelog/changelog-item-badge.tsx`. No Collapsible primitive exists — use local `useState` + conditional render.

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/automations/RecentRuns.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RecentRuns } from "./RecentRuns";

const getAutomationRuns = vi.fn();
vi.mock("@/lib/boards/automation-actions", () => ({
  getAutomationRuns: (...a: unknown[]) => getAutomationRuns(...a),
}));

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => getAutomationRuns.mockReset());

describe("RecentRuns", () => {
  it("does not fetch until expanded, then lists runs", async () => {
    getAutomationRuns.mockResolvedValue([
      {
        id: "r1",
        automation_id: "a1",
        status: "ran",
        trigger_type: "status_changed",
        actions: [{ type: "notify", outcome: "sent" }],
        item_id: "i1",
        error: null,
        created_at: new Date().toISOString(),
        org_id: "o1",
        board_id: "b1",
      },
    ]);
    wrap(<RecentRuns automationId="a1" />);
    // not fetched yet
    expect(getAutomationRuns).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    await waitFor(() => expect(getAutomationRuns).toHaveBeenCalledWith("a1"));
    expect(await screen.findByText(/notified/i)).toBeInTheDocument();
  });

  it("shows empty state when no runs", async () => {
    getAutomationRuns.mockResolvedValue([]);
    wrap(<RecentRuns automationId="a2" />);
    await userEvent.click(screen.getByRole("button", { name: /recent runs/i }));
    expect(await screen.findByText(/no runs yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm test src/components/boards/automations/RecentRuns.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement `RecentRuns`**

Create `src/components/boards/automations/RecentRuns.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAutomationRuns } from "@/lib/boards/automation-actions";
import {
  timeAgo,
  formatRunSummary,
  type RunActionOutcome,
} from "@/lib/boards/automation-runs";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ran: {
    label: "Ran",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  blocked: { label: "Blocked", className: "bg-muted text-muted-foreground" },
  error: { label: "Error", className: "bg-destructive/15 text-destructive" },
};

export function RecentRuns({ automationId }: { automationId: string }) {
  const [open, setOpen] = useState(false);
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["automationRuns", automationId],
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAutomationRuns(automationId),
  });

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        Recent runs
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {isLoading ? (
            <p className="text-muted-foreground text-xs">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground text-xs">No runs yet.</p>
          ) : (
            runs.map((run) => {
              const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.ran;
              return (
                <div key={run.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-medium",
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {timeAgo(run.created_at)}
                  </span>
                  <span className="truncate">
                    {formatRunSummary(
                      run.status,
                      (run.actions as RunActionOutcome[] | null) ?? [],
                    )}
                  </span>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/components/boards/automations/RecentRuns.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire into `AutomationsDialog`**

In `src/components/boards/automations/AutomationsDialog.tsx`, import `RecentRuns` and render it inside each rule row. The rule row is currently a horizontal flex (`flex items-center gap-3 ...`). Restructure that row to stack the existing horizontal content over a `<RecentRuns>` line: wrap the existing toggle+summary+delete in an inner `<div className="flex items-center gap-3">`, and put `<RecentRuns automationId={rule.id} />` below it, inside an outer `<div className="... flex flex-col gap-2 ...">`. Concretely:

```tsx
import { RecentRuns } from "./RecentRuns";
// ...
rules.map((rule) => (
  <div
    key={rule.id}
    className="bg-surface flex flex-col gap-2 rounded-md border p-3"
  >
    <div className="flex items-center gap-3">
      {/* existing: toggle button, summary <p>, delete <Button> — unchanged */}
    </div>
    <RecentRuns automationId={rule.id} />
  </div>
));
```

(Keep the toggle/summary/delete markup exactly as-is; only the wrapping changes.)

- [ ] **Step 6: Verify dialog still green + typecheck**

Run: `pnpm test src/components/boards/automations/AutomationsDialog.test.tsx && pnpm typecheck`
Expected: PASS (existing dialog tests unaffected; `RecentRuns` mounts but only fetches on expand).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/automations/RecentRuns.tsx src/components/boards/automations/RecentRuns.test.tsx src/components/boards/automations/AutomationsDialog.tsx
git commit -m "feat(automations): per-rule Recent runs disclosure (5c-1)"
```

---

## Task 5: Run-history engine integration tests (cloud)

**Files:**

- Create: `src/lib/boards/automations.5c1.runhistory.integration.test.ts`

Copy the harness boilerplate from `src/lib/boards/automations.5b2.engine.integration.test.ts` (env wiring, `describe.skipIf(!SERVICE_ROLE_KEY)`, the `beforeAll` org/board/columns seeding incl. a date column + status column with Working/Stuck, and the `insertAutomation`/`setCell`/`createFreshItem`/`poll` helpers). Read that file fully first and reuse its exact patterns.

- [ ] **Step 1: Write the integration tests**

Create `src/lib/boards/automations.5c1.runhistory.integration.test.ts` with the copied harness + helpers, plus:

```ts
async function runsFor(automationId: string) {
  const { data } = await admin
    .from("automation_runs")
    .select("*")
    .eq("automation_id", automationId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
```

Tests (each creates rule + item, acts, asserts, cleans up — follow the 5b-2 delete-after pattern):

1. **status_changed → ran row with notify outcome:** seed a status cell, build a `status_changed`→`notify member userA` rule (use a _second_ user as recipient so it's not self-skipped, or assert `skipped_self` if userA notifies self — pick member = a seeded second user; if only userA exists, assert outcome `skipped_self` and status `ran`). Change the status cell. `poll(runsFor)` until 1 row. Assert `trigger_type='status_changed'`, `status='ran'`, `actions[0].type='notify'`.
2. **set_option → 'set' then 'skipped_equal':** build `status_changed`→`set_option(S2→opt)`; fire once → run with `actions[0].outcome='set'`; fire again (change trigger col again) → newest run `outcome='skipped_equal'`.
3. **condition blocked → status='blocked':** rule with a condition that fails (e.g. `S is Stuck` while S unset) on a `status_changed` trigger that matches; fire; assert newest run `status='blocked'`, `actions=[]`.
4. **item_created → ran row:** build `item_created`→`set_option`; `createFreshItem()`; poll runsFor → row with `trigger_type='item_created'`.
5. **prune keeps 50:** insert 55 `automation_runs` rows for one automation directly via admin (varying `created_at`), call `admin.rpc("_automation_runs_prune")`, assert exactly 50 remain (the newest).
6. **fault isolation:** build `status_changed`→`set_option` targeting a **deleted** column id (insert the rule, then delete that target column, or use a random uuid as columnId so the FK insert raises), then fire the trigger by changing the trigger column. Assert: (a) a run row with `status='error'` and non-null `error`; (b) the triggering cell write itself **succeeded** (read the trigger cell back — it has the new value), proving the error didn't abort the user's edit.
7. **RLS:** a second org's user cannot read org-A runs (0 rows); no client insert into `automation_runs` (insert attempt by a signed-in user fails / 0 rows; verify count unchanged via admin). (Reuse the rls test's two-org users if you place this case there instead; otherwise seed a second user/org minimally.)

> For the prune test, set `created_at` explicitly on the 55 inserted rows (e.g. `new Date(Date.now() - i*1000).toISOString()`) so "newest 50" is deterministic. For test 6, using a random uuid columnId is the cleanest forced error (the `set_option` insert violates the `cell_values.column_id` FK).

- [ ] **Step 2: Run the suite**

Run: `pnpm test src/lib/boards/automations.5c1.runhistory.integration.test.ts`
Expected: ALL PASS against the live DB. If the prune RPC 404s (PostgREST cache), run `notify pgrst, 'reload schema';` once and retry.

- [ ] **Step 3: Run regressions**

Run: `pnpm test src/lib/boards/automations.5b2.engine.integration.test.ts src/lib/boards/automations.engine.5b1.integration.test.ts src/lib/boards/automations.rls.integration.test.ts`
Expected: PASS — existing engine behavior unchanged (notify/set_option/date sweep still act; the new logging is additive).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/automations.5c1.runhistory.integration.test.ts
git commit -m "test(automations): 5c-1 run-history cloud integration"
```

---

## Task 6: e2e + full gate

**Files:**

- Create: `e2e/automations-runs.spec.ts`

Model on `e2e/automations.spec.ts` (admin service-client seeding, UI login/onboard, board+columns, Automations dialog flow).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/automations-runs.spec.ts`: log in + onboard, create a board (seeds a status column), add an item, build a `status_changed`→`set_option` (or notify) rule via the dialog, trigger it (change the item's status), then in the Automations dialog expand the rule's **"Recent runs"** and assert a run appears with a status badge ("Ran") and outcome text. Use the existing e2e's selector conventions for the dialog/builder.

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/automations-runs.spec.ts`
Expected: PASS. Generous timeout (these flows are slow).

- [ ] **Step 3: Full verification gate**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all PASS.

- [ ] **Step 4: Advisor parity (via Supabase MCP `execute_sql`)**

```sql
select
  (select relrowsecurity from pg_class where relname='automation_runs') as rls_on,
  (select count(*) from pg_policies where tablename='automation_runs') as policies,
  (select array_agg(proname) from pg_proc
     where proname in ('_automation_run','_automation_runs_prune','_automation_date_sweep')
       and not exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%')
  ) as fns_missing_search_path;
```

Expected: `rls_on=true`, `policies=1`, `fns_missing_search_path=null`.

- [ ] **Step 5: Commit**

```bash
git add e2e/automations-runs.spec.ts
git commit -m "test(automations): 5c-1 run-history e2e"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** §2 data model → Task 1; §3 engine (logging + `p_trigger_type` + fault-isolation + 3 callers + prune) → Task 1; §4 queries + client → Tasks 2, 3, 4; §5 realtime (none) → no task needed; §6 testing → Tasks 3, 4, 5, 6; §7 non-functional (bounded/indexed/search_path/RLS) → Tasks 1, 6; §8 fault-isolation behavior change → Task 5 (test 6). All mapped.
- **Type consistency:** `_automation_run(... , p_trigger_type)` 8-arg signature is used identically in all 3 callers (Task 1). `getAutomationRuns(automationId, limit)` matches between Task 2 (def) and Task 4 (call). `RunActionOutcome { type, outcome }` matches the jsonb the engine writes (Task 1) and the formatter (Task 3) and the component (Task 4). Status values `ran`/`blocked`/`error` consistent across migration CHECK, engine, formatter, badges, tests.
- **Placeholder scan:** the migration §3a/3b/3c bodies are full SQL (no "unchanged, omitted"); the dialog edit in Task 4 Step 5 keeps existing markup and shows the exact wrapper change. No TBDs.

## Open items to confirm at build time

- Re-confirm cloud migration authorization at Task 1.
- Whether `getAutomations` in `automation-actions.ts` is `"use server"` or a plain async export — match it for `getAutomationRuns` (Task 2).
- In Task 5 test 1, whether a second seeded user exists for a non-self notify; if not, assert `skipped_self` (still a `ran` row) — either is valid coverage.
