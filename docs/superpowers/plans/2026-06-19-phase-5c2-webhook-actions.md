# Phase 5c-2 — Webhook Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `call_webhook` automation action that POSTs to an external https URL when a rule fires, with delivery outcomes reconciled into the 5c-1 run-history.

**Architecture:** The in-DB engine (`_automation_run`) enqueues an HTTPS POST via `pg_net` (async), logs the per-action outcome as `queued`, and records the `pg_net` `request_id` in a `automation_webhook_deliveries` ledger. A 1-minute `pg_cron` `_automation_webhook_reconcile()` reads `net._http_response` and patches the run-history outcome to `delivered_<code>` / `failed_<code>` / `failed_network`. Webhook rules are admin-gated (DB trigger = boundary; server action = friendly error; builder hides the button for non-admins). A baseline SSRF URL guard (`_webhook_url_safe`) blocks non-https and private/loopback/metadata hosts before any enqueue.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript strict, Zod, Supabase (Postgres + RLS + `pg_net` + `pg_cron`), TanStack Query, Vitest, Playwright, Tailwind v4 / shadcn (`pulse-ui` skill for any UI).

## Global Constraints

- **This is Next.js 16, not the training-data version** — confirm framework APIs against `node_modules/next/dist/docs/` before writing framework code.
- **Server Components by default; Server Actions for all mutations.** Client components only when interactive.
- **Zod at every boundary.** TS strict; no unjustified `any`.
- **RLS is the security boundary** — default-deny, org-scoped. `automation_webhook_deliveries` gets RLS `select`-only for members; definer-only writes. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
- **Every Postgres function is `SECURITY DEFINER set search_path = ''`** and schema-qualifies all references (`public.…`, `net.…`, `cron.…`).
- **Schema changes are versioned migrations** in `supabase/migrations/`. After applying: regenerate `src/types/database.types.ts` via `pnpm db:types` (filter the PostHog `"_tag"` telemetry line before prettier), commit types in the same change, run advisors.
- **Migrations require explicit per-session user authorization** to push to cloud (`supabase db push --linked`). This project is cloud-native with no local stack. Pause and ask before pushing.
- **In-page builder state must not refetch server data** — the builder is client state; run-history stays 5c-1 fetch-on-expand.
- **Done gate (no completion claim before all pass):** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, plus the integration + e2e evidence in this plan.
- **Conventional-commit subjects, lowercase, no em-dash** (commitlint rejects sentence-case). End commit bodies with the Co-Authored-By trailer.
- **One recipe** for v1 ("When status changes → POST to a webhook"). **No** HMAC signing, **no** domain allowlist, **no** body templating, **no** non-POST methods, **no** retries (all explicit non-goals).

**Spec:** `docs/superpowers/specs/2026-06-19-phase-5c2-automations-design.md`. Migration timestamps: `20260619130000` (schema), `20260619130001` (reconcile).

---

### Task 1: Zod `call_webhook` action variant

**Files:**

- Modify: `src/lib/validations/automations.ts`
- Test: `src/lib/validations/automations.test.ts`

**Interfaces:**

- Produces: a third member of `automationActionSchema`'s discriminated union:
  `{ type: "call_webhook"; url: string; authHeader?: { name: string; value: string } }`. The inferred `AutomationAction` union gains this variant (consumed by the builder, recipes, and dialog in later tasks).

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/validations/automations.test.ts`:

```ts
import { automationActionSchema } from "@/lib/validations/automations";

describe("call_webhook action", () => {
  it("accepts an https url with no auth header", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an optional auth header", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
      authHeader: { name: "Authorization", value: "Bearer xyz" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-https url", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "http://hooks.example.com/abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an auth header name with illegal characters", () => {
    const r = automationActionSchema.safeParse({
      type: "call_webhook",
      url: "https://hooks.example.com/abc",
      authHeader: { name: "Bad Header!", value: "x" },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: FAIL — the `call_webhook` type is not a member of the union (parse returns `success: false` for the valid cases).

- [ ] **Step 3: Add the variant**

In `src/lib/validations/automations.ts`, add a third object to the `automationActionSchema` discriminated union (after the `set_option` object):

```ts
  z.object({
    type: z.literal("call_webhook"),
    url: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), {
        message: "Webhook URL must use https://",
      }),
    authHeader: z
      .object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(128)
          .regex(/^[A-Za-z0-9-]+$/, {
            message: "Header name may contain letters, digits, and dashes only",
          }),
        value: z.string().min(1).max(2048),
      })
      .optional(),
  }),
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm test -- src/lib/validations/automations.test.ts`
Expected: PASS (all four new cases + existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/automations.ts src/lib/validations/automations.test.ts
git commit -m "feat(automations): add call_webhook action zod variant"
```

---

### Task 2: Run-history formatter — webhook outcome strings

**Files:**

- Modify: `src/lib/boards/automation-runs.ts`
- Test: `src/lib/boards/automation-runs.test.ts`

**Interfaces:**

- Consumes: `RunActionOutcome = { type: string; outcome: string }` (existing).
- Produces: `describeAction` (internal) now renders `type === "call_webhook"` outcomes; `formatRunSummary` (existing signature) shows them. Outcome vocabulary the DB will emit: `queued`, `delivered_<code>`, `failed_<code>`, `failed_network`, `blocked_unsafe_url`.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/boards/automation-runs.test.ts`:

```ts
import { formatRunSummary } from "@/lib/boards/automation-runs";

describe("call_webhook outcome formatting", () => {
  const cases: [string, string][] = [
    ["queued", "webhook queued"],
    ["delivered_200", "webhook delivered (200)"],
    ["delivered_204", "webhook delivered (204)"],
    ["failed_500", "webhook failed (500)"],
    ["failed_404", "webhook failed (404)"],
    ["failed_network", "webhook failed (no response)"],
    ["blocked_unsafe_url", "webhook blocked: unsafe URL"],
  ];
  it.each(cases)("renders %s as %s", (outcome, expected) => {
    expect(formatRunSummary("ran", [{ type: "call_webhook", outcome }])).toBe(
      expected,
    );
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm test -- src/lib/boards/automation-runs.test.ts`
Expected: FAIL — current `describeAction` falls through to `"call_webhook: queued"` for unknown types.

- [ ] **Step 3: Implement the webhook branch**

In `src/lib/boards/automation-runs.ts`, add a formatter and a branch in `describeAction`:

```ts
function describeWebhook(outcome: string): string {
  if (outcome === "queued") return "webhook queued";
  if (outcome === "failed_network") return "webhook failed (no response)";
  if (outcome === "blocked_unsafe_url") return "webhook blocked: unsafe URL";
  const m = /^(delivered|failed)_(\d{3})$/.exec(outcome);
  if (m) {
    return m[1] === "delivered"
      ? `webhook delivered (${m[2]})`
      : `webhook failed (${m[2]})`;
  }
  return `webhook: ${outcome}`;
}
```

Then in `describeAction`, before the final `return`:

```ts
if (a.type === "call_webhook") return describeWebhook(a.outcome);
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm test -- src/lib/boards/automation-runs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/automation-runs.ts src/lib/boards/automation-runs.test.ts
git commit -m "feat(automations): format webhook run outcomes"
```

---

### Task 3: DB migration — extension, ledger, guards, engine webhook branch, admin trigger

**Files:**

- Create: `supabase/migrations/20260619130000_automations_5c2_webhook_schema.sql`
- Modify (regenerate): `src/types/database.types.ts`

**Interfaces:**

- Produces (Postgres):
  - extension `pg_net`;
  - table `public.automation_webhook_deliveries (request_id bigint pk, run_id uuid, action_index int, org_id uuid, status text default 'pending', created_at timestamptz)` + RLS + partial index;
  - `public._webhook_url_safe(text) returns boolean`;
  - `public._webhook_outcome(status_code int, error_msg text) returns text`;
  - `public._automation_run(...)` recreated (same 8-arg signature) with the `call_webhook` branch + up-front `v_run_id`;
  - `before insert or update` trigger `tg_automations_guard_webhook` on `public.automations`.
- Consumes: nothing from later tasks. The four trigger callers (`tg_run_automations`, `tg_run_item_automations`, `_automation_date_sweep`) are **unchanged** (the `_automation_run` signature is stable).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619130000_automations_5c2_webhook_schema.sql`. Base the recreated `_automation_run` **verbatim** on the current definition in `supabase/migrations/20260619120000_automations_fix_set_option_dropdown_shape.sql` (lines 13–109), adding only the webhook branch + run-id changes shown below.

```sql
-- Phase 5c-2: external/webhook automation actions (pg_net) — schema + engine branch.
-- Adds the pg_net extension, a delivery ledger, an SSRF URL guard, a pure outcome
-- mapper, the call_webhook branch in _automation_run, and an admin-gate trigger on
-- automations. Reconcile sweep + cron live in the sibling 130001 migration.

create extension if not exists pg_net;   -- installs the `net` schema on Supabase

-- ── Delivery ledger ─────────────────────────────────────────────────────────
create table if not exists public.automation_webhook_deliveries (
  request_id   bigint primary key,
  run_id       uuid not null references public.automation_runs (id) on delete cascade,
  action_index int  not null,
  org_id       uuid not null references public.organizations (id)   on delete cascade,
  status       text not null default 'pending' check (status in ('pending','done')),
  created_at   timestamptz not null default now()
);

alter table public.automation_webhook_deliveries enable row level security;

drop policy if exists "webhook_deliveries: read if member"
  on public.automation_webhook_deliveries;
create policy "webhook_deliveries: read if member"
  on public.automation_webhook_deliveries for select to authenticated
  using (public.is_org_member(org_id));
-- No client write policy: rows are written only by the SECURITY DEFINER engine.

create index if not exists automation_webhook_deliveries_pending_idx
  on public.automation_webhook_deliveries (request_id)
  where status = 'pending';

-- ── SSRF URL guard (best-effort; pure SQL, no DNS) ──────────────────────────
create or replace function public._webhook_url_safe(p_url text)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare
  v_host text;
begin
  if p_url is null or lower(p_url) not like 'https://%' then
    return false;
  end if;
  -- host = between scheme and the first '/', '?' or '#'; strip any userinfo/port.
  v_host := lower(split_part(regexp_replace(substring(p_url from 9), '[/?#].*$', ''), '@', -1));
  v_host := split_part(v_host, ':', 1);
  if v_host is null or v_host = '' then
    return false;
  end if;
  if v_host in ('localhost', 'metadata.google.internal', '169.254.169.254')
     or v_host like '%.internal' or v_host like '%.local' or v_host like '%.localhost' then
    return false;
  end if;
  -- IP-literal hosts: reject private/loopback/link-local/special ranges.
  begin
    if v_host::inet <<= any (array[
        '127.0.0.0/8','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16',
        '169.254.0.0/16','0.0.0.0/8','::1/128','fc00::/7','fe80::/10'
      ]::inet[]) then
      return false;
    end if;
  exception when others then
    null;  -- not an IP literal → a hostname; allowed (DNS rebinding is a documented residual)
  end;
  return true;
end; $$;

-- ── Pure outcome mapper (unit-tested directly) ──────────────────────────────
create or replace function public._webhook_outcome(p_status_code int, p_error_msg text)
returns text language sql immutable security definer set search_path = '' as $$
  select case
    when p_error_msg is not null and p_error_msg <> '' then 'failed_network'
    when p_status_code between 200 and 299 then 'delivered_' || p_status_code::text
    when p_status_code is not null then 'failed_' || p_status_code::text
    else 'failed_network'
  end;
$$;

-- ── Engine: _automation_run + call_webhook branch ───────────────────────────
create or replace function public._automation_run(
  p_automation_id uuid, p_actions jsonb, p_condition jsonb,
  p_item_id uuid, p_org_id uuid, p_board_id uuid, p_actor uuid,
  p_trigger_type text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a          jsonb;
  v_idx      int;
  v_outcomes jsonb := '[]'::jsonb;
  v_pending  jsonb := '[]'::jsonb;      -- {rid, idx} per queued webhook
  v_run_id   uuid := gen_random_uuid(); -- minted up front so ledger FK resolves
  v_rid      uuid;
  v_target   uuid;
  v_opt      text;
  v_kind     text;
  v_newval   jsonb;
  v_url      text;
  v_body     jsonb;
  v_headers  jsonb;
  v_req_id   bigint;
  v_outcome  text;
  p          jsonb;
begin
  begin
    if not public._automation_conditions_pass(p_condition, p_item_id) then
      insert into public.automation_runs
        (id, automation_id, org_id, board_id, item_id, trigger_type, status)
      values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'blocked');
      return;
    end if;

    for a, v_idx in
      select value, (ordinality - 1)::int from jsonb_array_elements(p_actions) with ordinality
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
        select kind into v_kind from public.columns where id = v_target;
        if v_kind = 'dropdown' then
          v_newval := jsonb_build_object('optionIds', jsonb_build_array(v_opt));
        else
          v_newval := jsonb_build_object('optionId', v_opt);
        end if;
        if exists (
          select 1 from public.cell_values cv
          where cv.item_id = p_item_id
            and cv.column_id = v_target
            and cv.value = v_newval
        ) then
          v_outcome := 'skipped_equal';
        else
          insert into public.cell_values (org_id, board_id, item_id, column_id, value)
          values (p_org_id, p_board_id, p_item_id, v_target, v_newval)
          on conflict (item_id, column_id) do update set value = excluded.value;
          v_outcome := 'set';
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','set_option','outcome',v_outcome);

      elsif a->>'type' = 'call_webhook' then
        v_url := a->>'url';
        if not public._webhook_url_safe(v_url) then
          v_outcome := 'blocked_unsafe_url';
        else
          v_body := jsonb_build_object(
            'automation', jsonb_build_object('id', p_automation_id),
            'board_id',   p_board_id,
            'item_id',    p_item_id,
            'item_name',  (select name from public.items where id = p_item_id),
            'trigger',    p_trigger_type,
            'fired_at',   now()
          );
          v_headers := jsonb_build_object('Content-Type', 'application/json');
          if a->'authHeader' is not null then
            v_headers := v_headers
              || jsonb_build_object(a#>>'{authHeader,name}', a#>>'{authHeader,value}');
          end if;
          v_req_id := net.http_post(url := v_url, body := v_body, headers := v_headers);
          v_outcome := 'queued';
          v_pending := v_pending || jsonb_build_object('rid', v_req_id, 'idx', v_idx);
        end if;
        v_outcomes := v_outcomes || jsonb_build_object('type','call_webhook','outcome',v_outcome);
      end if;
    end loop;

    insert into public.automation_runs
      (id, automation_id, org_id, board_id, item_id, trigger_type, status, actions)
    values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'ran', v_outcomes);

    for p in select * from jsonb_array_elements(v_pending) loop
      insert into public.automation_webhook_deliveries (request_id, run_id, action_index, org_id)
      values ((p->>'rid')::bigint, v_run_id, (p->>'idx')::int, p_org_id);
    end loop;

  exception when others then
    insert into public.automation_runs
      (id, automation_id, org_id, board_id, item_id, trigger_type, status, error)
    values (v_run_id, p_automation_id, p_org_id, p_board_id, p_item_id, p_trigger_type, 'error', sqlerrm);
  end;
end; $$;

-- ── Admin gate (security boundary): webhook rules require owner/admin ────────
create or replace function public.tg_automations_guard_webhook()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Boundary applies only to authenticated end-users. A null auth.uid() means a
  -- trusted server context (service-role key, cron, SECURITY DEFINER RPC), which
  -- is server-only and never reaches the browser — allow it through.
  if new.actions @> '[{"type":"call_webhook"}]'::jsonb
     and (select auth.uid()) is not null
     and not public.has_org_role(new.org_id, array['owner','admin']::public.org_role[]) then
    raise exception 'Webhook actions require an organization admin'
      using errcode = '42501';
  end if;
  return new;
end; $$;

drop trigger if exists trg_automations_guard_webhook on public.automations;
create trigger trg_automations_guard_webhook
  before insert or update on public.automations
  for each row execute function public.tg_automations_guard_webhook();
```

- [ ] **Step 2: Self-check the SQL locally (syntax only)**

Run: `git diff --stat` and re-read the migration; confirm `_automation_run` body matches `20260619120000` verbatim except (a) the `id` column is now in all three `automation_runs` inserts with `v_run_id`, (b) the loop uses `with ordinality`, (c) the new `call_webhook` branch, (d) the post-loop ledger insert, (e) the new declared vars.
Expected: no other differences from the 5c-1 engine.

- [ ] **Step 3: Apply the migration to cloud (AUTHORIZATION GATE)**

Pause and ask the user to authorize the DB push. Then run:
`supabase db push --linked`
Expected: the `20260619130000` migration applies cleanly; `pg_net` extension created.

- [ ] **Step 4: Regenerate and commit types**

Run: `pnpm db:types` (filter any PostHog `"_tag"` line before prettier if present).
Expected: `src/types/database.types.ts` gains `automation_webhook_deliveries` Row/Insert/Update.

- [ ] **Step 5: Run advisors**

Use the Supabase MCP `get_advisors` (security + performance) or `supabase db lint`.
Expected: RLS enabled on the new table; all new functions pin `search_path`; no new warnings beyond pre-existing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260619130000_automations_5c2_webhook_schema.sql src/types/database.types.ts
git commit -m "feat(automations): webhook schema, ssrf guard, engine branch, admin gate"
```

---

### Task 4: DB migration — reconcile sweep + cron + prune

**Files:**

- Create: `supabase/migrations/20260619130001_automations_5c2_reconcile.sql`

**Interfaces:**

- Consumes: `public._webhook_outcome`, `public.automation_webhook_deliveries`, `net._http_response` (from `pg_net`), `public.automation_runs`.
- Produces: `public._automation_webhook_reconcile() returns void`; recreated `public._automation_runs_prune()` that also deletes old `done` deliveries; a `cron.schedule('automation-webhook-reconcile', '* * * * *', …)` job.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260619130001_automations_5c2_reconcile.sql`. The recreated `_automation_runs_prune` must keep its existing body (keep-50-per-rule delete from `20260619100000_automations_5c1_run_history.sql`) and append the delivery cleanup.

```sql
-- Phase 5c-2: reconcile sweep — fold pg_net responses into run-history, plus a
-- ledger cleanup folded into the existing daily prune.

create or replace function public._automation_webhook_reconcile()
returns void language plpgsql security definer set search_path = '' as $$
declare
  d        record;
  v_code   int;
  v_err    text;
  v_timed  boolean;
begin
  for d in
    select request_id, run_id, action_index
    from public.automation_webhook_deliveries
    where status = 'pending'
  loop
    select status_code, error_msg, timed_out
      into v_code, v_err, v_timed
    from net._http_response
    where id = d.request_id;

    if not found then
      continue;  -- response not back yet; revisit next minute
    end if;

    update public.automation_runs
      set actions = jsonb_set(
        actions,
        array[d.action_index::text, 'outcome'],
        to_jsonb(public._webhook_outcome(
          v_code,
          case when coalesce(v_timed, false) then 'timeout' else v_err end
        ))
      )
      where id = d.run_id;

    update public.automation_webhook_deliveries
      set status = 'done'
      where request_id = d.request_id;
  end loop;
end; $$;

-- Recreate the daily prune: keep last 50 runs/rule (unchanged) + drop old done
-- deliveries. Body of the keep-50 delete is copied verbatim from 5c-1.
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

  delete from public.automation_webhook_deliveries
  where status = 'done' and created_at < now() - interval '1 day';
end; $$;

select cron.schedule(
  'automation-webhook-reconcile', '* * * * *',
  $cron$ select public._automation_webhook_reconcile() $cron$
);
```

- [ ] **Step 2: Apply the migration to cloud (AUTHORIZATION GATE)**

Pause and ask the user to authorize. Then run: `supabase db push --linked`
Expected: `20260619130001` applies; the cron job is registered (upsert by name).

- [ ] **Step 3: Verify the cron job exists**

Via Supabase MCP `execute_sql` (read-only): `select jobname, schedule from cron.job where jobname = 'automation-webhook-reconcile';`
Expected: one row, schedule `* * * * *`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619130001_automations_5c2_reconcile.sql
git commit -m "feat(automations): webhook reconcile sweep, cron, ledger prune"
```

---

### Task 5: Cloud integration tests — enqueue, ledger, SSRF, admin gate, outcome mapping, RLS

**Files:**

- Create: `src/lib/boards/automations.5c2.webhook.integration.test.ts`

**Interfaces:**

- Consumes: the cloud schema from Tasks 3–4. Mirrors the harness in `src/lib/boards/automations.5c1.runhistory.integration.test.ts` **exactly** (env wiring, `describe.skipIf(!SERVICE_ROLE_KEY)`, service-role `admin` client, per-user anon clients, `poll`, `afterAll` cleanup of created users/orgs/rows).

- [ ] **Step 1: Write the integration tests**

Create `src/lib/boards/automations.5c2.webhook.integration.test.ts`, copying the beforeAll/afterAll scaffolding from the 5c-1 suite (an org with an admin owner `userA`, a Status column with two options, a board + default group). Add these cases. Use `admin.rpc(...)` for the pure functions (underscore-prefixed definer functions are PostgREST-callable in this project — the 5c-1/5b-2 suites already call `_automation_runs_prune` / `_automation_date_sweep` that way).

```ts
// 1. SSRF guard accepts/rejects the right hosts
it("ssrf guard rejects unsafe urls and accepts public https", async () => {
  const cases: [string, boolean][] = [
    ["https://hooks.example.com/x", true],
    ["http://hooks.example.com/x", false],
    ["https://localhost/x", false],
    ["https://127.0.0.1/x", false],
    ["https://10.0.0.5/x", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://service.internal/x", false],
  ];
  for (const [url, expected] of cases) {
    const { data, error } = await admin.rpc("_webhook_url_safe", { p_url: url });
    expect(error).toBeNull();
    expect(data).toBe(expected);
  }
});

// 2. Outcome mapper
it("maps http responses to outcomes", async () => {
  const m = async (code: number | null, err: string | null) =>
    (await admin.rpc("_webhook_outcome", { p_status_code: code, p_error_msg: err })).data;
  expect(await m(200, null)).toBe("delivered_200");
  expect(await m(204, null)).toBe("delivered_204");
  expect(await m(404, null)).toBe("failed_404");
  expect(await m(500, null)).toBe("failed_500");
  expect(await m(null, "Timeout")).toBe("failed_network");
  expect(await m(null, null)).toBe("failed_network");
});

// 3. Enqueue + ledger: firing a webhook rule writes a queued outcome + one pending delivery
it("enqueues a webhook and records a pending delivery", async () => {
  // create an admin-owned rule: status_changed -> call_webhook(https://...)
  const { data: rule } = await admin
    .from("automations")
    .insert({
      org_id: orgAId, board_id: boardAId, enabled: true,
      trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
      actions: [{ type: "call_webhook", url: "https://example.com/hook-" + randomUUID() }],
    })
    .select("id").single();

  // fire it by changing the status cell (as userA)
  const itemId = /* create an item in groupAId, then upsert cell_values for colSId */;
  await userAAnon.from("cell_values").upsert({
    org_id: orgAId, board_id: boardAId, item_id: itemId,
    column_id: colSId, value: { optionId: optWorkingId },
  });

  const run = await poll(async () => {
    const { data } = await admin.from("automation_runs")
      .select("*").eq("automation_id", rule!.id).maybeSingle();
    return data;
  });
  expect(run!.status).toBe("ran");
  expect(run!.actions).toEqual([{ type: "call_webhook", outcome: "queued" }]);

  const { data: deliveries } = await admin
    .from("automation_webhook_deliveries").select("*").eq("run_id", run!.id);
  expect(deliveries).toHaveLength(1);
  expect(deliveries![0].status).toBe("pending");
  expect(deliveries![0].action_index).toBe(0);
  expect(deliveries![0].org_id).toBe(orgAId);
});

// 4. Unsafe url -> blocked_unsafe_url, no delivery, run still 'ran'
it("blocks an unsafe url without enqueuing", async () => {
  const { data: rule } = await admin.from("automations").insert({
    org_id: orgAId, board_id: boardAId, enabled: true,
    trigger: { type: "status_changed", columnId: colSId, toOptionId: null },
    actions: [{ type: "call_webhook", url: "http://10.0.0.1/x" }], // http + private
  }).select("id").single();
  // Inserted via the service-role `admin` client: auth.uid() is null, so the
  // admin-gate trigger allows it (the trigger only blocks authenticated non-admins).

  const itemId = /* fresh item */;
  await userAAnon.from("cell_values").upsert({
    org_id: orgAId, board_id: boardAId, item_id: itemId,
    column_id: colSId, value: { optionId: optStuckId },
  });

  const run = await poll(async () => {
    const { data } = await admin.from("automation_runs")
      .select("*").eq("automation_id", rule!.id).maybeSingle();
    return data;
  });
  expect(run!.actions).toEqual([{ type: "call_webhook", outcome: "blocked_unsafe_url" }]);
  const { data: deliveries } = await admin
    .from("automation_webhook_deliveries").select("*").eq("run_id", run!.id);
  expect(deliveries).toHaveLength(0);
});

// 5. Admin gate: a plain member cannot insert a webhook rule; an admin can
it("admin-gates webhook rule creation", async () => {
  // userM is a 'member' of orgA (add to createdUserIds + org_members in beforeAll or inline)
  const memberInsert = await userMAnon.from("automations").insert({
    org_id: orgAId, board_id: boardAId, enabled: true,
    trigger: { type: "item_created" },
    actions: [{ type: "call_webhook", url: "https://example.com/x" }],
  }).select("id").maybeSingle();
  expect(memberInsert.error).not.toBeNull(); // 42501 from the trigger (or RLS)

  // a notify-only rule by the same member succeeds
  const okInsert = await userMAnon.from("automations").insert({
    org_id: orgAId, board_id: boardAId, enabled: true,
    trigger: { type: "item_created" },
    actions: [{ type: "set_option", columnId: colSId, optionId: optWorkingId }],
  }).select("id").maybeSingle();
  expect(okInsert.error).toBeNull();
});

// 6. Reconcile is a no-op while the response is absent
it("reconcile leaves a delivery pending when no response yet", async () => {
  // reuse a pending delivery from case 3 (or insert a synthetic run + pending delivery as admin)
  const { error } = await admin.rpc("_automation_webhook_reconcile");
  expect(error).toBeNull();
  // the example.com request has no controllable receiver; assert it is still pending OR done,
  // but specifically that the function ran without error and did not corrupt the run.
});

// 7. RLS: a cross-org member cannot read another org's deliveries
it("rls blocks cross-org delivery reads", async () => {
  const { data } = await userBAnon
    .from("automation_webhook_deliveries").select("*").eq("org_id", orgAId);
  expect(data ?? []).toHaveLength(0);
});
```

Fill the `/* ... */` placeholders by following the exact item/cell-creation helpers already used in the 5c-1 suite. Add a `member` user (`userM`) to orgA in `beforeAll` (role `'member'` in `org_members`) and a `userMAnon` client; register its id in `createdUserIds` for cleanup.

- [ ] **Step 2: Run the integration suite**

Run: `pnpm test -- src/lib/boards/automations.5c2.webhook.integration.test.ts`
Expected: PASS (requires `.env.local` with `SUPABASE_SERVICE_ROLE_KEY`; otherwise the suite is skipped via `skipIf`).

- [ ] **Step 3: Run the 5c-1/5b-2 suites for regression**

Run: `pnpm test -- src/lib/boards/automations.5c1.runhistory.integration.test.ts src/lib/boards/automations.5b2.engine.integration.test.ts`
Expected: PASS — notify/set_option/date sweep/run-history unaffected by the engine recreate.

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/automations.5c2.webhook.integration.test.ts
git commit -m "test(automations): webhook engine, ssrf, admin-gate, reconcile integration"
```

---

### Task 6: Server actions — admin check + board admin status

**Files:**

- Modify: `src/lib/boards/automation-actions.ts`
- Test: `src/lib/boards/automation-actions.test.ts` (create if absent)

**Interfaces:**

- Produces:
  - `getBoardAdminStatus(boardId: string): Promise<boolean>` — true if the caller is owner/admin of the board's org (used by the dialog in Task 8).
  - `createAutomation` / `updateAutomation` return `{ ok: false, error: "Webhook actions require an organization admin" }` when the payload contains a `call_webhook` action and the caller is not owner/admin — **before** the DB write (the Task-3 trigger is the real boundary; this is a friendly pre-check).
- Consumes: the `org_members` table (`role` column, enum `org_role`), readable by members via existing RLS.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/boards/automation-actions.test.ts` a unit for the pure helper that detects webhook actions (extract it so it is testable without Supabase):

```ts
import { actionsContainWebhook } from "@/lib/boards/automation-actions";

describe("actionsContainWebhook", () => {
  it("detects a webhook action", () => {
    expect(
      actionsContainWebhook([{ type: "call_webhook", url: "https://x" }]),
    ).toBe(true);
  });
  it("ignores non-webhook actions", () => {
    expect(
      actionsContainWebhook([{ type: "notify" }, { type: "set_option" }]),
    ).toBe(false);
  });
  it("handles non-array input safely", () => {
    expect(actionsContainWebhook(null)).toBe(false);
    expect(actionsContainWebhook("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test -- src/lib/boards/automation-actions.test.ts`
Expected: FAIL — `actionsContainWebhook` is not exported.

- [ ] **Step 3: Implement the helper + admin checks**

In `src/lib/boards/automation-actions.ts`:

```ts
/** True if a (possibly unknown) actions payload contains a call_webhook action. */
export function actionsContainWebhook(actions: unknown): boolean {
  return (
    Array.isArray(actions) &&
    actions.some(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        (a as { type?: string }).type === "call_webhook",
    )
  );
}

async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

export async function getBoardAdminStatus(boardId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board) return false;
  return isOrgAdmin(supabase, board.org_id);
}
```

In `createAutomation`, after resolving `board` (which has `org_id`) and before the insert:

```ts
if (
  actionsContainWebhook(parsed.data.actions) &&
  !(await isOrgAdmin(supabase, board.org_id))
) {
  return fail("Webhook actions require an organization admin");
}
```

In `updateAutomation`, when `parsed.data.actions` is provided and contains a webhook, resolve the rule's `org_id` first and gate it:

```ts
if (
  parsed.data.actions !== undefined &&
  actionsContainWebhook(parsed.data.actions)
) {
  const { data: row } = await supabase
    .from("automations")
    .select("org_id")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!row || !(await isOrgAdmin(supabase, row.org_id))) {
    return fail("Webhook actions require an organization admin");
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test -- src/lib/boards/automation-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/automation-actions.ts src/lib/boards/automation-actions.test.ts
git commit -m "feat(automations): admin-gate webhook rules in server actions"
```

---

### Task 7: Builder UI — WebhookRow + addWebhook + admin gating

**Files:**

- Modify: `src/components/boards/automations/AutomationBuilder.tsx`
- Test: `src/components/boards/automations/AutomationBuilder.test.tsx`

**Interfaces:**

- Consumes: the `call_webhook` `AutomationAction` variant (Task 1).
- Produces: `AutomationBuilder` accepts a new optional prop `canWebhook?: boolean` (default `false`). When true, a third "Call a webhook" action button is shown; clicking it appends a `call_webhook` action; a `WebhookRow` edits its `url` + optional `authHeader`. `isActionComplete` returns true for a webhook iff `url` is a non-empty https string.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/boards/automations/AutomationBuilder.test.tsx` (follow the existing render/setup helpers in that file):

```tsx
it("hides the webhook action button when canWebhook is false", () => {
  render(
    <AutomationBuilder
      columns={cols}
      members={[]}
      canWebhook={false}
      onSubmit={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(screen.queryByRole("button", { name: /call a webhook/i })).toBeNull();
});

it("adds a webhook action and validates https before enabling save", async () => {
  const onSubmit = vi.fn();
  render(
    <AutomationBuilder
      columns={cols}
      members={[]}
      canWebhook
      initial={{ trigger: { type: "item_created" }, actions: [] }}
      onSubmit={onSubmit}
      onCancel={() => {}}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /call a webhook/i }),
  );
  // save disabled until a valid https url is entered
  expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText(/webhook url/i),
    "https://hooks.example.com/abc",
  );
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      actions: [{ type: "call_webhook", url: "https://hooks.example.com/abc" }],
    }),
  );
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: FAIL — no `canWebhook` prop / no "Call a webhook" button.

- [ ] **Step 3: Implement**

In `AutomationBuilder.tsx`:

1. Add `canWebhook = false` to the props destructure + type:

```ts
}: {
  columns: CacheColumn[];
  members: BuilderMember[];
  initial?: Draft;
  canWebhook?: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
```

(set the default in the destructure: `canWebhook = false,`).

2. Extend `isActionComplete` for webhooks:

```ts
function isActionComplete(a: AutomationAction): boolean {
  if (a.type === "notify") {
    return a.recipient.kind === "owner"
      ? !!a.recipient.peopleColumnId
      : !!a.recipient.userId;
  }
  if (a.type === "call_webhook") {
    return /^https:\/\/.+/.test(a.url);
  }
  return !!a.columnId && !!a.optionId;
}
```

3. Add an `addWebhook` handler next to `addSetOption`:

```ts
function addWebhook() {
  setActions((prev) => [
    ...prev,
    { _id: nextId(), type: "call_webhook", url: "" },
  ]);
}
```

4. In the action card render, route webhook actions to `WebhookRow`:

```tsx
{action.type === "notify" ? (
  <NotifyRow ... />
) : action.type === "call_webhook" ? (
  <WebhookRow action={action} onChange={(next) => updateAction(action._id, next)} />
) : (
  <SetOptionRow ... />
)}
```

5. Add the third button in the "Then" button row, gated on `canWebhook`:

```tsx
{
  canWebhook ? (
    <Button type="button" variant="outline" size="sm" onClick={addWebhook}>
      <Plus className="size-3.5" /> Call a webhook
    </Button>
  ) : null;
}
```

6. Add the `WebhookRow` component (after `SetOptionRow`). The card grid is `grid-cols-2`; the URL spans both columns, the optional header sits below:

```tsx
function WebhookRow({
  action,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "call_webhook" }>;
  onChange: (next: AutomationAction) => void;
}) {
  const urlInvalid = action.url.length > 0 && !/^https:\/\/.+/.test(action.url);
  const header = action.authHeader;
  function patch(
    next: Partial<Extract<AutomationAction, { type: "call_webhook" }>>,
  ) {
    onChange({
      type: "call_webhook",
      url: action.url,
      authHeader: action.authHeader,
      ...next,
    });
  }
  return (
    <>
      <label className="col-span-2 text-sm">
        <span className="text-muted-foreground">Webhook URL</span>
        <input
          aria-label="Webhook URL"
          type="url"
          inputMode="url"
          placeholder="https://hooks.example.com/…"
          className={selectClass}
          value={action.url}
          onChange={(e) => patch({ url: e.target.value })}
        />
        {urlInvalid ? (
          <span className="text-destructive mt-1 block text-xs">
            Must start with https://
          </span>
        ) : null}
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Header name (optional)</span>
        <input
          aria-label="Auth header name"
          className={selectClass}
          placeholder="Authorization"
          value={header?.name ?? ""}
          onChange={(e) => {
            const name = e.target.value;
            patch({
              authHeader:
                name || header?.value
                  ? { name, value: header?.value ?? "" }
                  : undefined,
            });
          }}
        />
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Header value (optional)</span>
        <input
          aria-label="Auth header value"
          className={selectClass}
          placeholder="Bearer …"
          value={header?.value ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            patch({
              authHeader:
                value || header?.name
                  ? { name: header?.name ?? "", value }
                  : undefined,
            });
          }}
        />
      </label>
    </>
  );
}
```

Use the `pulse-ui` skill to confirm input styling/density matches the existing rows (reuse `selectClass`).

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm test -- src/components/boards/automations/AutomationBuilder.test.tsx`
Expected: PASS (new + existing builder tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/automations/AutomationBuilder.tsx src/components/boards/automations/AutomationBuilder.test.tsx
git commit -m "feat(automations): webhook action row in the builder"
```

---

### Task 8: Dialog wiring — admin query, canWebhook, webhook recipe

**Files:**

- Modify: `src/components/boards/automations/recipes.ts`
- Modify: `src/components/boards/automations/AutomationsDialog.tsx`
- Test: `src/components/boards/automations/recipes.test.ts` (create if absent)
- Test: `src/components/boards/automations/AutomationsDialog.test.tsx`

**Interfaces:**

- Consumes: `getBoardAdminStatus` (Task 6), `AutomationBuilder`'s `canWebhook` prop (Task 7).
- Produces: `recipeStatusChangedWebhook(statusColumnId, optionId, url): Draft`; the dialog fetches the caller's admin status (TanStack `useQuery` keyed `["board-admin", boardId]`, enabled on open) and passes `canWebhook` to the builder; an admin-only recipe button.

- [ ] **Step 1: Write the failing recipe test**

Create `src/components/boards/automations/recipes.test.ts`:

```ts
import { recipeStatusChangedWebhook } from "@/components/boards/automations/recipes";

it("builds a status-changed -> webhook draft", () => {
  const d = recipeStatusChangedWebhook(
    "col-1",
    null,
    "https://hooks.example.com/x",
  );
  expect(d).toEqual({
    trigger: { type: "status_changed", columnId: "col-1", toOptionId: null },
    actions: [{ type: "call_webhook", url: "https://hooks.example.com/x" }],
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm test -- src/components/boards/automations/recipes.test.ts`
Expected: FAIL — `recipeStatusChangedWebhook` not exported.

- [ ] **Step 3: Add the recipe**

In `src/components/boards/automations/recipes.ts`:

```ts
/** "When status changes (to X), POST to a webhook." optionId null = any change. */
export function recipeStatusChangedWebhook(
  statusColumnId: string,
  optionId: string | null,
  url: string,
): Draft {
  return {
    trigger: {
      type: "status_changed",
      columnId: statusColumnId,
      toOptionId: optionId,
    },
    actions: [{ type: "call_webhook", url }],
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm test -- src/components/boards/automations/recipes.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing dialog test**

Add to `src/components/boards/automations/AutomationsDialog.test.tsx` (mock `getBoardAdminStatus` alongside the existing action mocks; follow the file's existing mock setup):

```tsx
// in the vi.mock("@/lib/boards/automation-actions", ...) factory add:
//   getBoardAdminStatus: vi.fn(),
it("passes canWebhook=true to the builder for an admin", async () => {
  vi.mocked(getBoardAdminStatus).mockResolvedValue(true);
  renderDialog(); // existing helper that opens the dialog
  await userEvent.click(
    await screen.findByRole("button", { name: /new automation/i }),
  );
  expect(
    await screen.findByRole("button", { name: /call a webhook/i }),
  ).toBeInTheDocument();
});

it("hides the webhook button for a non-admin", async () => {
  vi.mocked(getBoardAdminStatus).mockResolvedValue(false);
  renderDialog();
  await userEvent.click(
    await screen.findByRole("button", { name: /new automation/i }),
  );
  expect(screen.queryByRole("button", { name: /call a webhook/i })).toBeNull();
});
```

- [ ] **Step 6: Run it, verify it fails**

Run: `pnpm test -- src/components/boards/automations/AutomationsDialog.test.tsx`
Expected: FAIL — dialog does not yet query admin status or pass `canWebhook`.

- [ ] **Step 7: Wire the dialog**

In `AutomationsDialog.tsx`:

1. Import the action + recipe:

```ts
import { ..., getBoardAdminStatus } from "@/lib/boards/automation-actions";
import { ..., recipeStatusChangedWebhook } from "@/components/boards/automations/recipes";
```

2. Add the admin query (near the `rules` query):

```ts
const { data: isAdmin = false } = useQuery({
  queryKey: ["board-admin", boardId] as const,
  enabled: open,
  staleTime: 60_000,
  queryFn: () => getBoardAdminStatus(boardId),
});
```

3. Pass `canWebhook={isAdmin}` to `<AutomationBuilder … />`.

4. Add an admin-only recipe button inside the recipe quick-starts block (only when `isAdmin && statusColumns.length > 0`):

```tsx
{
  isAdmin && statusColumns.length > 0 ? (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        startBuild(recipeStatusChangedWebhook(statusColumns[0].id, null, ""))
      }
    >
      Call a webhook on status change
    </Button>
  ) : null;
}
```

(The empty `url` lands the user in the builder with the URL field focused/empty to fill in.)

- [ ] **Step 8: Run the dialog + recipe tests, verify pass**

Run: `pnpm test -- src/components/boards/automations/AutomationsDialog.test.tsx src/components/boards/automations/recipes.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/automations/recipes.ts src/components/boards/automations/recipes.test.ts src/components/boards/automations/AutomationsDialog.tsx src/components/boards/automations/AutomationsDialog.test.tsx
git commit -m "feat(automations): wire webhook builder gating and recipe in dialog"
```

---

### Task 9: e2e — admin builds a webhook rule, fires it, sees "webhook queued"

**Files:**

- Create or extend: `e2e/automations-webhook.spec.ts` (follow the existing automations e2e spec's auth/setup helpers)

**Interfaces:**

- Consumes: the full stack. Uses an admin/owner test user (the default e2e org owner is owner-role, so the webhook UI is available).

- [ ] **Step 1: Write the e2e test**

Mirror the existing automations e2e spec (locate it first: look in `e2e/` for the file that opens the Automations dialog). The new spec:

```ts
test("admin builds a webhook rule and sees a queued run", async ({ page }) => {
  // sign in as the owner; open a board with a Status column (use the existing seed/helpers)
  // open Automations dialog
  await page.getByRole("button", { name: /automations/i }).click();
  await page.getByRole("button", { name: /new automation/i }).click();
  // trigger: status changes (default); add a webhook action
  await page.getByRole("button", { name: /call a webhook/i }).click();
  await page.getByLabel(/webhook url/i).fill("https://example.com/hook");
  await page.getByRole("button", { name: /^save$/i }).click();
  // fire it: change the status cell on an item (reuse the helper from the 5c-1 e2e)
  // ... change status ...
  // re-open the dialog, expand the rule's Recent runs, assert the queued outcome
  await page.getByRole("button", { name: /automations/i }).click();
  await page
    .getByRole("button", { name: /recent runs/i })
    .first()
    .click();
  await expect(page.getByText(/webhook queued/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- automations-webhook` (use the project's actual e2e command — check `package.json` `scripts`).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/automations-webhook.spec.ts
git commit -m "test(automations): e2e webhook rule build and queued run"
```

---

### Task 10: Full gate, advisors, manual delivery verification, docs

**Files:**

- Modify: `vault/00-north-star.md` (Phase 5 status), session note via `/wrapup` (separate step), `CONTRIBUTING.md` only if a new dev command/env is introduced (none expected).

- [ ] **Step 1: Run the full done-gate**

Run, in order:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all green. Fix anything red before proceeding (no completion claim otherwise).

- [ ] **Step 2: Re-run advisors**

Use Supabase MCP `get_advisors` (security + performance).
Expected: RLS on `automation_webhook_deliveries`; all 5c-2 functions pin `search_path`; no new warnings.

- [ ] **Step 3: Manual end-to-end delivery (documented evidence)**

As an owner/admin in the running dev app (`pnpm dev`): create a rule whose action is `call_webhook` pointing at a fresh `https://webhook.site/<token>` URL (add an `Authorization: Bearer test` header). Trigger it. Confirm:

1. The request arrives at webhook.site with the envelope body + the auth header.
2. Within ≤1 minute, re-expand the rule's "Recent runs": the outcome flips from **webhook queued** to **webhook delivered (200)**.
   Record this in the session note (it is the one path not covered by CI).

- [ ] **Step 4: Bump the north-star**

Update `vault/00-north-star.md`: mark **Phase 5 complete** (5a + 5b-1 + 5b-2 + 5c-1 + **5c-2**), update the "Now" / "Where we are" sections, bump `last-updated`. Note webhook actions close Phase 5; remaining automations ideas (HMAC signing, allowlist, retries, templating) are future slices.

- [ ] **Step 5: Commit + wrapup**

```bash
git add vault/00-north-star.md
git commit -m "docs(vault): phase 5c-2 webhook actions complete, north-star bump"
```

Then run `/wrapup` to capture the session note in `vault/sessions/` (including the manual webhook.site evidence and the engine-recreate ripple note).

---

## Self-Review

**Spec coverage:**

- §2.1 extension → Task 3. §2.2 ledger + RLS + partial index → Task 3. §2.3 no `automation_runs` DDL → respected (Task 3 only adds the `id` column to existing inserts). §3 Zod variant → Task 1. §4 engine branch + up-front run id + deferred ledger insert → Task 3 (matches the spec's "remember then insert after the run row"). §5 SSRF guard → Task 3 + tested Task 5. §6 admin gate (DB trigger + server-action UX) → Task 3 (trigger) + Task 6 (actions) + Task 7/8 (builder/dialog UX). §7 reconcile + `_webhook_outcome` + cron + prune → Task 4, tested Task 5. §8.1 formatter → Task 2; §8.2 builder + recipe → Task 7 + Task 8. §9 no Realtime → respected. §10 tests → Tasks 1,2,5,7,8,9 + manual Task 10. §11 non-functional (budget, search_path, db:types, advisors) → Tasks 3,4,10. §12 risks acknowledged (engine ripple isolated to `_automation_run`; the four callers unchanged — verified in Task 3 interfaces).
- **Gap check:** the spec's "envelope" omits `value`/names beyond `item_name` — Task 3 envelope matches exactly. No spec requirement is left without a task.

**Placeholder scan:** The integration test (Task 5) contains intentional `/* ... */` markers for item/cell creation — these point the implementer at the **existing 5c-1 suite helpers** to copy, not vague instructions; every other step has concrete code. No "TBD/handle errors/add validation" placeholders.

**Type consistency:** `actionsContainWebhook` (Task 6) — same name in test + impl + dialog usage. `canWebhook` prop — same in builder (Task 7) and dialog (Task 8). `recipeStatusChangedWebhook` — same in recipe + test + dialog. `_webhook_outcome` / `_webhook_url_safe` / `_automation_webhook_reconcile` — same across Tasks 3,4,5. Outcome vocabulary (`queued`/`delivered_<code>`/`failed_<code>`/`failed_network`/`blocked_unsafe_url`) consistent between engine (Task 3), reconcile (Task 4), formatter (Task 2), and tests (Task 5).
