---
type: spec
status: approved
date: 2026-06-19
phase: 5c-2
title: Automations — external/webhook actions (Phase 5c-2)
tags: [project/pulse, spec, phase-5, automations, webhooks, pg_net]
related:
  - "[[2026-06-19-phase-5c1-automations-design]]"
  - "[[2026-06-18-phase-5b2-automations-design]]"
  - "[[2026-06-18-phase-5b1-automations-design]]"
  - "[[2026-06-18-phase-5a-automations-design]]"
  - "[[2026-06-14-pulse-design]]"
  - "[[00-north-star]]"
---

# Phase 5c-2 — Automations: external/webhook actions

## 1. Goal & context

Phase 5 (master spec §7, PRD F-9) is no-code **When / If / Then** automations. **5a** shipped the
in-DB engine (status/dropdown triggers → notify / set_option). **5b-1** added more triggers + the
"If" condition gate. **5b-2** added date-based triggers via a `pg_cron` sweep. **5c-1** made every
rule-fire observable via run-history (`automation_runs`, per-action outcomes), and was deliberately
built so **webhook outcomes land in the same history**.

This slice (**5c-2**) closes Phase 5: a **webhook action** that lets a rule POST to an external URL
(Slack incoming hooks, Zapier/Make/n8n catch-hooks, a customer's own endpoint) when it fires. It is
the project's **first outbound HTTP**, delivered **entirely in-DB** via `pg_net` (0.20.3, confirmed
available) — no Edge Functions, consistent with 5a/5b/5c-1.

**The central constraint:** `pg_net` is **asynchronous**. `net.http_post` enqueues a request and
returns a `request_id bigint` immediately; the response lands later in `net._http_response`. The
engine, however, writes its run-history row **synchronously** at the end of `_automation_run`. We
therefore **enqueue + reconcile**: log the webhook as `queued`, record the `request_id` in a small
delivery ledger, and a `pg_cron` **reconcile sweep** patches the run's outcome to
`delivered_<code>` / `failed_<code>` / `failed_network` once the response arrives.

### Decisions locked in brainstorming (2026-06-19)

- **Outcome model:** enqueue via `pg_net` + a 1-minute `pg_cron` **reconcile sweep** that reads
  `net._http_response` and patches the run-history outcome. 100% in-DB (chosen over fire-and-forget,
  which never confirms delivery, and an Edge-Function relay, which adds deploy infra the project has
  avoided).
- **Request config (v1):** POST only; a required **https** URL; an **auto-generated structured JSON
  envelope** body; **one optional auth header** (e.g. `Authorization: Bearer …`). No arbitrary
  headers, no body templating.
- **Security:** a **baseline SSRF URL guard** (always on) + **admin-only creation** of
  webhook-containing rules. **No** HMAC signing and **no** per-org domain allowlist in v1 (both
  deferred — see §9).
- **Recipe:** **one** quick-start ("When status changes → POST to a webhook").
- **Testing:** real end-to-end HTTP delivery is **not** in CI (non-deterministic); CI covers enqueue,
  ledger, SSRF guard, admin gate, and reconcile via a **pure outcome-mapping helper**. End-to-end
  delivery is verified manually against `webhook.site`.

**Non-goals for 5c-2:** HMAC payload signing; per-org domain allowlist; arbitrary header maps; body
templating / token interpolation (`{{item.name}}`); Slack-specific message formatting; retries /
backoff on failed deliveries; GET/PUT/PATCH/DELETE methods; a board-level webhook activity feed
(run-history per-rule view is the surface); Realtime on delivery status (reconcile + fetch-on-expand
suffices); incoming webhooks (Monolith as a receiver).

## 2. Data model

### 2.1 Extension

```sql
create extension if not exists pg_net;   -- installs the `net` schema on Supabase
```

### 2.2 Delivery ledger — `public.automation_webhook_deliveries`

```sql
create table if not exists public.automation_webhook_deliveries (
  request_id   bigint primary key,                                  -- net.http_post() id
  run_id       uuid not null references public.automation_runs (id) on delete cascade,
  action_index int  not null,                                       -- index into automation_runs.actions
  org_id       uuid not null references public.organizations (id)   on delete cascade,
  status       text not null default 'pending'                      -- 'pending' | 'done'
               check (status in ('pending','done')),
  created_at   timestamptz not null default now()
);
```

- **`request_id` is the PK** (the `pg_net` request id is globally unique) — natural dedupe for the
  reconcile join.
- **`run_id` cascade**: deleting a run (e.g. via the 5c-1 prune, or rule deletion) discards its
  pending deliveries.
- **RLS:** enabled; org-scoped `select` only (`is_org_member(org_id)`, mirrors `automation_runs`);
  **no client insert/update/delete policy** — written only by the `SECURITY DEFINER` engine.
- **Index (partial):** `automation_webhook_deliveries_pending_idx on (...) where status = 'pending'`
  — the reconcile sweep scans only un-reconciled rows; keeps the sweep O(pending), not O(all).

### 2.3 `automation_runs` — no DDL change

The 5c-1 `actions` jsonb is already open; webhook outcomes are appended as
`{ "type": "call_webhook", "outcome": "queued" }` and later patched in place by the reconcile sweep.
No migration to `automation_runs` itself.

## 3. Action schema (Zod) — `src/lib/validations/automations.ts`

Add a `call_webhook` variant to `automationActionSchema`:

```ts
z.object({
  type: z.literal("call_webhook"),
  url: z.string().url().refine((u) => u.startsWith("https://"), {
    message: "Webhook URL must use https://",
  }),
  authHeader: z
    .object({
      name: z.string().trim().min(1).max(128)
        .regex(/^[A-Za-z0-9-]+$/, "Header name may contain letters, digits, and dashes only"),
      value: z.string().min(1).max(2048),
    })
    .optional(),
}),
```

`automationActionsSchema` (`.min(1)`) and `createAutomation`/`updateAutomation` envelope schemas are
unchanged — the new variant flows through the existing discriminated union. The Zod https-refine is
defense-in-depth UX validation; the **engine's `_webhook_url_safe` is the real boundary** (§5).

## 4. Engine — `_automation_run` new branch (Postgres, in-DB)

`_automation_run` keeps its 5c-1 signature, `SECURITY DEFINER set search_path = ''`, the depth-cap
loop guard, the gotcha-17 GUC handling, the `actor` semantics, and the `begin/exception`
fault-isolation wrapper — **verbatim**. Two structural changes:

1. **Mint the run id up front** so the action loop can attach ledger rows to it:
   `v_run_id uuid := gen_random_uuid();` and insert the `automation_runs` row with that explicit id.
2. **New action branch** `a->>'type' = 'call_webhook'`:

   ```text
   -- inside the action loop, after notify / set_option branches
   v_url  := a->>'url';
   if not public._webhook_url_safe(v_url) then
     v_outcome := 'blocked_unsafe_url';           -- skip; do NOT enqueue
   else
     -- envelope (auto body)
     v_body := jsonb_build_object(
       'automation', jsonb_build_object('id', p_automation_id),
       'board_id',   p_board_id,
       'item_id',    p_item_id,
       'item_name',  (select name from public.items where id = p_item_id),
       'trigger',    p_trigger_type,
       'fired_at',   now()
     );
     -- optional single auth header
     v_headers := jsonb_build_object('Content-Type', 'application/json');
     if a->'authHeader' is not null then
       v_headers := v_headers || jsonb_build_object(a#>>'{authHeader,name}', a#>>'{authHeader,value}');
     end if;

     v_req_id := net.http_post(url := v_url, body := v_body, headers := v_headers);
     v_outcome := 'queued';
     v_pending := v_pending || jsonb_build_object('rid', v_req_id, 'idx', v_action_idx);  -- remember
   end if;
   v_outcomes := v_outcomes || jsonb_build_object('type','call_webhook','outcome',v_outcome);
   ```

   - `v_action_idx` is the loop's running index (the position the reconcile sweep patches).
   - **Enqueue is immediate; the ledger insert is deferred.** During the loop the function only calls
     `net.http_post` and **remembers** each `(request_id, action_index)` in `v_pending`. After the
     loop it inserts the `automation_runs` row (with the pre-minted `v_run_id`) **first**, then
     inserts the `automation_webhook_deliveries` rows from `v_pending` — so the ledger FK to
     `automation_runs(id)` is always satisfied (both within the one transaction, run row written
     first).
   - **Envelope is intentionally minimal** (ids + item name + trigger + time). Receivers that need
     more can call back into Monolith; richer payloads are a future slice.

- **Fault isolation preserved:** if `net.http_post` raises (malformed args), the `exception when
others` handler logs `status='error'` and swallows it — the user's triggering edit still commits.
  A URL that merely fails the SSRF guard is **not** an error: it records `blocked_unsafe_url` and the
  run is still `ran`.

## 5. SSRF guard — `public._webhook_url_safe(text) → boolean`

`SECURITY DEFINER set search_path = ''`, pure SQL/regex (no DNS — see residual risk):

- **Require `https://`** scheme (case-insensitive).
- Extract the host. **Reject** if the host:
  - is an **IP literal** in a private/loopback/link-local/special range — checked with `inet`/`<<`
    against `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`,
    `::1/128`, `fc00::/7`, `fe80::/10`, `0.0.0.0/8`;
  - is `localhost`, or ends with `.internal` / `.local` / `.localhost`;
  - is a known cloud-metadata host (`169.254.169.254`, `metadata.google.internal`).
- Otherwise **allow**.

Unit-testable in isolation (pass URLs, assert boolean). **Documented residual risk:** pure-SQL
cannot resolve DNS, so a public hostname that resolves to a private IP (DNS rebinding) is **not**
caught — the **admin-only gate (§6)** is the compensating control, and a per-org allowlist (§9) is
the deferred hardening that would close it.

## 6. Admin gate — security boundary

Webhook actions are admin-gated (owner/admin), mirroring the 5b-2 timezone gate
(`has_org_role(org_id, array['owner','admin'])`). Enforced in **two layers**:

1. **DB boundary — `before insert or update` trigger on `public.automations`**
   (`tg_automations_guard_webhook`, `SECURITY DEFINER set search_path = ''`): if
   `new.actions @> '[{"type":"call_webhook"}]'` (any element is a webhook) **and**
   `not public.has_org_role(new.org_id, array['owner','admin']::public.org_role[])`, `raise
exception ... using errcode = '42501'`. This is the real boundary (a member cannot insert a
   webhook rule even via a raw client).
2. **Server-action UX guard** in `createAutomation`/`updateAutomation`
   (`src/lib/boards/automation-actions.ts`): if the payload's `actions` include `call_webhook` and
   the caller lacks owner/admin, return a friendly error **before** hitting the DB. (The DB trigger
   still backstops it.)

Notify/set_option-only rules are unaffected — any member may still create them.

## 7. Reconcile sweep — `public._automation_webhook_reconcile()`

`SECURITY DEFINER set search_path = ''`. For each `pending` delivery joined to its `net._http_response`
row (by `id = request_id`):

```text
for d in (select * from public.automation_webhook_deliveries where status = 'pending') loop
  select status_code, error_msg into v_code, v_err
  from net._http_response where id = d.request_id;

  if not found then continue; end if;   -- response not back yet; revisit next minute

  v_outcome := public._webhook_outcome(v_code, v_err);

  -- patch the matching action's outcome in the run-history jsonb
  update public.automation_runs
    set actions = jsonb_set(
      actions,
      array[d.action_index::text, 'outcome'],
      to_jsonb(v_outcome)
    )
    where id = d.run_id;

  update public.automation_webhook_deliveries set status = 'done' where request_id = d.request_id;
end loop;
```

- **`public._webhook_outcome(status_code int, error_msg text) → text`** — a **pure** mapping
  helper (no I/O), unit-tested directly:
  - `error_msg is not null` → `failed_network` (covers timeouts, DNS failure, connection refused;
    `pg_net` reports these via `error_msg` with `status_code` null).
  - `status_code between 200 and 299` → `delivered_<code>` (e.g. `delivered_200`).
  - else → `failed_<code>` (e.g. `failed_404`, `failed_500`).
- **Scheduling:** `cron.schedule('automation-webhook-reconcile', '* * * * *', …)` — every minute
  (pg_cron's finest granularity). `cron.schedule` upserts by job name (idempotent migration).
  Running every minute comfortably beats `pg_net`'s own `net._http_response` retention (hours).
- **Ledger prune:** `done` deliveries are deleted by the existing daily prune job (extend
  `_automation_runs_prune` or a sibling) — `delete … where status='done' and created_at < now() -
interval '1 day'`. The `automation_runs` cascade already drops deliveries when a run is pruned.

## 8. Queries + client

### 8.1 Run-history formatter — `src/lib/boards/automation-runs.ts`

Extend `describeAction` (used by `formatRunSummary`) for `type === 'call_webhook'`:

| outcome              | text                           |
| -------------------- | ------------------------------ |
| `queued`             | "webhook queued"               |
| `delivered_<code>`   | "webhook delivered (`<code>`)" |
| `failed_<code>`      | "webhook failed (`<code>`)"    |
| `failed_network`     | "webhook failed (no response)" |
| `blocked_unsafe_url` | "webhook blocked: unsafe URL"  |

Because the reconcile sweep patches `automation_runs.actions` in place, the per-rule "Recent runs"
disclosure shows the **updated** outcome the next time it is expanded/refetched (5c-1's
fetch-on-expand). No Realtime, no new query — `getAutomationRuns` is unchanged.

### 8.2 Builder — `src/components/boards/automations/AutomationBuilder.tsx`

- A third **"Call a webhook"** action button (alongside "Notify" / "Set a column"), plus a
  `WebhookRow` config component: an **https URL** input (inline validation mirroring the Zod refine)
  and an optional auth-header **name + value** pair.
- **Admin gating in the UI:** the "Call a webhook" button is **hidden/disabled for non-admins**
  (the builder receives the caller's role; if absent, derive via a lightweight check). A disabled
  state shows a hint ("Webhook actions require admin"). This is UX only — the DB trigger (§6) is the
  boundary.
- **One recipe** in `recipes.ts`: `recipeStatusChangedWebhook(statusColumnId, optionId|null, url)`
  → "When status changes → POST to a webhook." (Returns `{ trigger, actions }`.)

Built with the `pulse-ui` skill (inputs, buttons, density consistent with the existing builder rows).

## 9. Realtime

None. Delivery status is reconciled in the background and reviewed on demand (expand a rule). Adding
Realtime to the run/delivery list is out of scope.

## 10. Testing

- **Integration (cloud; extend the engine integration suite) — deterministic, no real HTTP in CI:**
  - **Enqueue:** an admin webhook rule fires → `automation_runs` has a `call_webhook` action with
    `outcome='queued'`, and exactly one `automation_webhook_deliveries` row (`pending`, correct
    `run_id` + `action_index` + `org_id`).
  - **SSRF guard:** `_webhook_url_safe` rejects `http://…`, `https://localhost`, `https://10.0.0.1`,
    `https://169.254.169.254`, `https://x.internal`; allows a normal public https URL. (A
    guard-rejected action fires → outcome `blocked_unsafe_url`, **no** ledger row, run still `ran`.)
  - **Admin gate:** the `tg_automations_guard_webhook` trigger denies a `member` inserting/updating a
    webhook rule (42501) and allows an `owner`/`admin`. Notify-only rule still allowed for a member.
  - **Reconcile:** insert a synthetic `pending` delivery + a matching `automation_runs` row, then
    drive the outcome mapping by calling `_webhook_outcome` (and, where the test harness can seed
    `net._http_response`, run `_automation_webhook_reconcile()` and assert the run's action outcome is
    patched to `delivered_200` / `failed_500` and the delivery flips to `done`). If `net._http_response`
    cannot be seeded in-suite, cover the patch path via a direct unit on the mapping + a documented gap.
  - **RLS:** org member reads own org's deliveries; cross-org member denied (0 rows); no client INSERT.
  - **Regression:** 5a/5b-1/5b-2/5c-1 effects unchanged (notify/set_option/date sweep/run-history
    still act); depth cap + fault-isolation intact.
- **Unit:** Zod `call_webhook` schema (https refine, header-name regex, optional header);
  `_webhook_outcome` mapping (all branches); the formatter's webhook strings; `WebhookRow` render +
  inline URL validation; admin-gating of the builder button.
- **e2e (Playwright):** an admin builds a webhook rule → triggers it → opens the dialog → expands the
  rule → asserts a run appears with the **`webhook queued`** outcome text. (Reconcile to
  `delivered`/`failed` against a live endpoint is **manual**, see below.)
- **Manual (documented in the session note):** point a rule at a `webhook.site` URL, fire it, confirm
  the request arrives with the envelope + auth header, wait ≤1 min, re-expand the rule, confirm the
  outcome flips to `webhook delivered (200)`.

## 11. Non-functional

- **Performance & data-fetching budget:** the builder is **in-page client state** (0 new server
  round-trips on add/configure); run-history is unchanged 5c-1 **fetch-on-expand** (bounded ≤50 over
  the indexed `(automation_id, created_at desc)`); the reconcile sweep is a **bounded background
  scan** over the **partial-indexed** `pending` deliveries (O(pending), not O(all)). No new hot-path
  read; no unbounded `select *` on a growing table.
- **Security:** RLS is the boundary — `automation_webhook_deliveries` default-deny, org-scoped read,
  definer-only write; the webhook **admin gate is a DB trigger** (server-action check is UX only);
  the **SSRF guard** (`_webhook_url_safe`) gates every enqueue; every new/changed function is
  `SECURITY DEFINER set search_path = ''`. The optional auth-header value lives in
  `automations.actions` (org-member-readable) — accepted under the admin-only gate; HMAC signing +
  allowlist deferred (§1 non-goals).
- **Schema discipline:** all via versioned migrations in `supabase/migrations/`; after applying,
  regenerate `src/types/database.types.ts` (`pnpm db:types`, filtering the PostHog `"_tag"`
  telemetry line) and run advisors; **pin `search_path`** on every function; RLS enabled on the new
  table. Likely **two migrations** (extension + ledger + SSRF guard + `_automation_run` branch +
  admin trigger; then reconcile fn + `_webhook_outcome` + `cron.schedule` + prune), or one combined.
- **Done gate:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all green + the integration
  - e2e evidence in §10, before any completion claim.

## 12. Risks / notes

- **Async delivery is eventually-consistent.** Between the fire and the next reconcile tick (≤1 min),
  a webhook outcome reads `queued`. This is correct and expected; the UI text makes the transient
  state legible.
- **`pg_net` response retention.** `net._http_response` is purged by `pg_net` after a few hours; the
  1-minute reconcile is far inside that window. A delivery whose response is somehow never written
  (worker death) stays `pending` indefinitely → its run outcome stays `queued`; acceptable for v1
  (the daily prune does **not** drop `pending` rows — only `done`). A future slice could time out
  stale `pending` deliveries to `failed_network`.
- **DNS rebinding** is not covered by the in-SQL SSRF guard (no DNS resolution). The admin-only gate
  is the compensating control; a per-org allowlist (deferred) would close it.
- **No retries.** A `failed_*` delivery is terminal in v1 (no backoff/replay). Retries are a future
  slice.
- **`net.http_post` signature.** Confirm the installed `pg_net` (0.20.3) arg names
  (`url`, `body`, `headers`, optional `timeout_milliseconds`) against the actual extension during
  implementation — the call site is the one place a version mismatch bites. Default timeout is
  acceptable; no custom timeout in v1.
- **Migration ripple.** Only `_automation_run` changes among the 5c-1 engine functions (the new
  branch + up-front run id); the four trigger callers are **unchanged** (signature is stable). The
  new objects (extension, ledger, two functions, trigger, cron job) are additive.
- **Closes Phase 5.** With 5c-2, Automations spans triggers (status/dropdown/item-created/
  person-assigned/date-reached) × conditions × actions (notify/set_option/**webhook**) × run-history
  with delivery reconciliation. Remaining automations ideas (HMAC signing, allowlist, retries, body
  templating, more methods) are explicit future slices, not Phase 5 gaps.
