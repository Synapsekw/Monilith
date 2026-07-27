# Overall health summary + alerts + weekly email digest — design

- **Date:** 2026-07-03
- **Status:** Spec written, awaiting review
- **Branch:** `task/health-summary`
- **Source:** MVP Final Features item 8 (feedback F5.5): "Overall Health Summary + Alerts —
  Dashboard summary of overall plan health/progress. In-dashboard notifications + a weekly
  email digest to the team covering: new activities added, and activities flagged as
  structurally incomplete. Structural-completeness rule (suggested): an item is flagged
  incomplete if it is missing any of — owner, start date, due date, or (for a parent/group
  item) at least one sub-item. Confirm or adjust."
- **Mode:** Non-interactive brainstorm — decisions the user would normally arbitrate are
  recorded in "Open questions for review" at the end.
- **Constraint carried in from item 9's descoping:** there are **no stored health columns**.
  Every signal here is re-derived from dates/cells directly, the same way the shipped overdue
  red tint does (`src/lib/boards/overdue.ts`).

## Verified context (explored in this worktree)

- **Item data is EAV.** `items` has `name`, `parent_id` (single-level subitems, emergent —
  an item is a "parent" only once it has children), `created_at`/`created_by` (immutable,
  stamped), and denormalized `org_id`/`board_id`/`group_id`. Owner and dates are **cell
  values**: people columns store `{ "userIds": [] }`, date columns store
  `{ "date": "YYYY-MM-DD", "end"?: … }`, status columns store `{ "optionId": … }` against
  `columns.settings.options` (`{ id, label, color }`). A missing `cell_values` row = empty
  cell. The default board seeds exactly Status + Owner (people) + Date (date) columns.
- **Overdue + complete predicates already exist** (status-intelligence, merged):
  `src/lib/boards/overdue.ts` — complete ⇔ first status column's option label matches
  `/done|complete/i`; overdue ⇔ `(end ?? date) < today` (ISO string compare) and incomplete.
  This spec's SQL re-implements exactly these semantics so the digest/widget counts agree
  with the red tint users see on boards.
- **Widget pipeline (Phase 8 + 9.3b) is the template.** The `completion` widget
  (`20260703093000_dashboard_completion.sql` + 8 TS touchpoints) shows the full recipe: DB
  `widget_kind` enum value + bounded SECURITY DEFINER RPC → `getWidget*Cached` fetcher
  (`"use cache"`, `cacheLife("widget")` 30 s, `cacheTag(widgetAggregationTag(orgId, widgetId))`)
  → `resolveWidgetAggregate` branch in the **batched** `getWidgetsData` action →
  `usesAggregateData` + `WidgetData` field → renderer switch + config-form branch.
- **Notifications (Phase 4b):** `notifications` table (recipient-indexed, unread partial
  index, realtime publication), `notification_kind` enum grown via
  `add value if not exists` (`automation`, `feedback_response` precedents — each also added
  a link column). Creation is inline inserts (server action or DEFINER fn); rendering is a
  `label()` switch in `NotificationsList.tsx`; delivery is the existing
  `notifications:{userId}` realtime channel. **No payload column exists today.**
- **Scheduling:** pg_cron + pg_net installed. House pattern: `cron.schedule('<name>',
'<expr>', $cron$ select public._fn() $cron$)` calling a SECURITY DEFINER fn —
  `automations-date-sweep` (hourly, org-timezone-aware), `automation-runs-prune` (daily),
  `automation-webhook-reconcile` (per-minute). Outbound HTTP from SQL exists via
  `net.http_post` (webhook actions).
- **App email: nothing exists.** No provider dependency, no key in `env.server.ts` /
  `.env.example`, no `supabase/functions/`, `config.toml` SMTP commented out (auth-only,
  Inbucket locally). `scripts/push-auth-emails.ts` only provisions GoTrue **auth** templates
  via the Management API — not reusable as a runtime send path. Recipients are available:
  `profiles.email` (mirrored from auth.users) + `org_members` (+ `profiles.timezone`).
- **Preferences: none exist.** No notification-settings table or UI; the Settings page has
  timezone forms + admin console. The digest opt-out is greenfield.
- **Migration slots:** this branch owns `20260703120000+` (gotcha-43 — the priority-critical
  sibling owns earlier slots; do not mint other versions).

## Goals

1. **Health summary dashboard widget** (`health` widget kind): for one source board, show
   overall progress (% of items done) plus three alert counts — **overdue**, **structurally
   incomplete**, **new in the last 7 days** — riding the existing batched widget fetch and
   aggregation cache (0 extra dashboard round-trips).
2. **Weekly in-app notification** (`health_digest` kind) to org members with the org-wide
   digest numbers, delivered through the existing bell + realtime channel.
3. **Weekly email digest** to org members — the only genuinely new infrastructure — built
   minimal and reliable: pg_cron trigger → authenticated app route → Resend HTTP API, with
   idempotent send tracking and automatic daily retry.
4. **Opt-out story:** per-user email preference (Settings toggle) + one-click unsubscribe
   link in every digest email. In-app notifications are not affected by the email opt-out.
5. **One rule, one implementation per boundary:** the structural-completeness and overdue
   predicates are defined once in SQL (shared by widget RPC and digest RPC) with semantics
   identical to the shipped TS predicates in `overdue.ts`.

## Non-goals

- No stored health flags, no rules engine, no per-item alert feed (descoped with items 4/9).
- No per-board or per-org configurability of the completeness rule in this slice (see Open
  questions — ship the fixed rule, confirm with the requester).
- No org-local send-time personalization (fixed UTC send window; the
  `automations-date-sweep` pattern shows how to add it later).
- No email for any other notification kind (mentions etc.) — digest only.
- No AI-wizard support for the new widget kind (parity with `completion`).
- No changes to existing widgets, RPCs, or the notifications realtime path.

## Design

### 1. The structural-completeness rule (default, fixed)

An **incomplete top-level item** (not done, `parent_id is null`) is **structurally
incomplete** when either:

- **Owner missing** — the board's **first `people` column by position** has no cell for the
  item or `userIds` is empty. _Skipped if the board has no people column_ (the criterion is
  inexpressible there; flagging every item would be noise).
- **Date missing** — the board's **first `date` column by position** has no cell or no
  `date` value. In Monolith a single date column carries start (`date`) and optional end
  (`end`); "start date" and "due date" collapse to this one value, and `end` is optional
  (single-date boards dominate). _Skipped if the board has no date column._

**Adjustments to the suggested rule, made explicit (the "confirm or adjust"):**

- **"Parent/group item must have ≥1 sub-item" is vacuous in Monolith** — parentage is emergent
  (`items.parent_id`); an item with zero children is indistinguishable from a deliberate
  leaf activity, so the criterion can never fire. The nearest expressible analog (a board
  _group_ with zero items) is excluded from this slice. Recorded as Open question 1.
- **Done items are not flagged.** A completed item missing an owner is not actionable; the
  alert counts stay actionable. (Complete = the same done-label predicate as the tint.)
- **Start vs due:** a single missing-`date` check, not two separate criteria (see above).

"Done", "overdue", and "today" semantics mirror `src/lib/boards/overdue.ts` exactly:
complete ⇔ first status column's option label matches `done|complete` (case-insensitive);
overdue ⇔ any date-kind cell with `coalesce(end, date) <` today and the item incomplete
(matching the tint's any-date-column scope, so the count equals "items showing red
somewhere"). SQL uses `current_date` (UTC) for "today" — a server-side count can't use the
viewer's clock; the ≤1-day boundary disagreement with the client tint is accepted.

### 2. Data model & migrations (two files, owned slots)

**Migration A — `supabase/migrations/20260703120000_health_summary.sql`** (widget + kinds):

1. `alter type public.widget_kind add value if not exists 'health';`
2. `alter type public.notification_kind add value if not exists 'health_digest';`
3. `alter table public.notifications add column if not exists payload jsonb;` — nullable,
   used only by `health_digest` rows to carry the digest numbers (precedent: kinds add their
   own link columns; a jsonb payload avoids a join at render time).
4. **Shared rule core** — `public._board_health_counts(p_board_id uuid, p_since timestamptz)
returns table (total_items int, done_items int, overdue_items int, incomplete_items int,
new_items int)` — SECURITY DEFINER, `set search_path = ''`, **no grant to
   `authenticated`** (internal; callers below do their own auth). One pass over the board's
   top-level items with lateral cell lookups:
   - first status/people/date columns resolved once per board (by `position`);
   - done ⇔ status option label `~* '(done|complete)'`;
   - overdue ⇔ exists a date-kind cell with `coalesce(value->>'end', value->>'date') <
current_date::text` and not done;
   - structurally incomplete ⇔ not done AND (owner criterion OR date criterion, each skipped
     when the board lacks that column kind);
   - new ⇔ `created_at >= p_since` (uses `items_board_created_idx (board_id, created_at)`).
     Access paths: `items_board_id_idx`, `items_parent_id_idx`, `cell_values` PK
     `(item_id, column_id)` — the same bounded shape as `dashboard_completion`.
5. **Widget RPC** — `public.dashboard_health_summary(p_board_id uuid) returns table (…same
five columns…)` — SECURITY DEFINER, `is_org_member(boards.org_id)` guard raising like
   `dashboard_aggregate`, `grant execute to authenticated`; body = `_board_health_counts`
   with `p_since = now() - interval '7 days'`. Single row out.

**Migration B — `supabase/migrations/20260703121000_health_digest.sql`** (digest infra):

1. `alter table public.profiles add column email_digest_opt_out boolean not null default
false;` (opt-out, so the digest works for existing users without a backfill).
2. **`public.digest_runs`** — send ledger + idempotency:
   `id uuid pk`, `org_id` (FK, cascade), `period_start date not null`, `period_end date not
null`, `status text not null default 'pending'` (`pending|sent|skipped|failed`), `stats
jsonb`, `email_sent_count int`, `error text`, `created_at`, `completed_at`;
   **`unique (org_id, period_start)`** — the exactly-once guard. RLS enabled with **no
   policies** (service-role only; default-deny for authenticated).
3. **Digest RPC** — `public._org_health_digest(p_org_id uuid, p_since timestamptz) returns
table (board_id uuid, board_name text, total_items int, done_items int, overdue_items
int, incomplete_items int, new_items int, new_sample jsonb, incomplete_sample jsonb)` —
   SECURITY DEFINER, no authenticated grant (service-role caller). Loops the org's boards
   (bounded: `limit 200` by board `created_at`) calling `_board_health_counts`, plus two
   bounded sample arrays per board (≤5 item names each: newest new items, first structurally
   incomplete items) for the email body. Only boards with any nonzero count return a row.
4. **Cron ping** — `public._health_digest_ping()` (SECURITY DEFINER): reads `app_url` and
   `digest_secret` from **Supabase Vault** (`vault.decrypted_secrets` by name; if either is
   missing, `raise notice` and return — safe no-op until provisioned), then
   `net.http_post(url := app_url || '/api/digest/run', headers := …Bearer digest_secret…,
body := '{}')`. Fire-and-forget (the route is the reliability boundary; no reconcile
   needed). Scheduled **daily**: `select cron.schedule('health-digest-ping', '0 7 * * *',
$cron$ select public._health_digest_ping() $cron$);` — daily + an idempotent route =
   automatic retry all week if a send fails; job name is the upsert key (re-runnable
   migration, matching the sweep precedent).

Secrets provisioning (manual, alongside the manual migration apply): the user creates two
Vault secrets — `app_url` (production origin) and `digest_secret` (random ≥32 bytes; the
same value goes into the app env as `DIGEST_SECRET`).

After each migration: `pnpm db:types` regen (this branch owns the schema change; per
gotcha-43 siblings take these types wholesale).

### 3. Health summary widget

Follows the completion-widget recipe verbatim (same 8 touchpoints):

- **Zod** (`src/lib/validations/dashboards.ts`): `widgetKindSchema` gains `"health"`;
  `healthConfigSchema = z.object({}).strict()` — **zero config** beyond the source board
  (the rule is fixed; users wanting configurable progress semantics add a Completion
  widget); `configSchemaForKind("health")` routes to it; `defaultConfig("health")` → `{}`.
- **Cached fetcher** (`src/lib/dashboards/queries-cached.ts`):
  `getWidgetHealthCached(input: { widgetId; orgId; boardId; config }) →
{ ok: true; counts: HealthCounts } | { ok: false; error }` with `"use cache"`,
  `cacheLife("widget")`, `cacheTag(widgetAggregationTag(orgId, widgetId))`, service client →
  `dashboard_health_summary` RPC. `HealthCounts = { totalItems; doneItems; overdueItems;
incompleteItems; newItems7d }` lives in `src/lib/dashboards/widget-data.ts` with a pure
  `shapeHealth` (progress % = done/total, null when 0 items) unit-tested like
  `shapeCompletion`.
- **Batched fetch**: `resolveWidgetAggregate` branch on `kind === "health"`;
  `WidgetAggregatePayload` gains optional `health?: HealthCounts`; `usesAggregateData`
  includes `"health"`; client `WidgetData.health` plumbed in `use-widget-data.tsx`.
- **Widget body** — `src/components/dashboards/widgets/HealthWidget.tsx` (client, plain DOM,
  static import — no recharts). pulse-ui: monochrome chrome, color earned:
  - Header: overall progress — `text-2xl font-semibold tabular-nums` percentage + muted
    "On track · N items" caption; a thin `h-2 rounded-full bg-muted` progress track filled
    via the existing `percentBandColor(percent)` ramp (consistent with Completion/percent
    cells app-wide).
  - Three stat rows (compact, hairline-separated): label (`text-muted-foreground text-xs`)
    - right-aligned `tabular-nums` count — **New this week** (always neutral), **Overdue**
      and **Incomplete** (`text-destructive` only when > 0, neutral at 0 — color paired with
      the label text, never color alone; AA).
  - States mirror `BatteryWidget`: "Configure a source board" / pulse skeleton /
    "Failed to load" / "No data yet".
- **Config form** (`WidgetConfigForm.tsx`): `<option value="health">Health summary</option>`
  - a `health` branch that renders only helper text ("Shows overall progress plus overdue,
    incomplete, and new-item counts for the source board — no extra configuration."). Kind
    switch in `DashboardWidget.tsx`, preview switch in `WidgetConfigSheet.tsx`.

### 4. Weekly digest pipeline (in-app + email)

**Trigger:** pg_cron daily ping (Migration B) → `POST /api/digest/run`.

**Route handler** — `src/app/api/digest/run/route.ts` (machine-called webhook → route
handler, not a Server Action):

1. **Auth:** constant-time compare of the `Authorization: Bearer` token against
   `env.DIGEST_SECRET`; 401 otherwise. 503 when `DIGEST_SECRET` is unset (feature not
   provisioned).
2. **Period:** `currentDigestPeriod(now)` (pure helper, `src/lib/digest/period.ts`) — the
   ISO week: `period_start` = most recent Monday (UTC date), `period_end` = Sunday. The
   stats window is the **trailing 7 days** ending at send. The route only proceeds on/after
   Monday 07:00 UTC for that period (always true when the cron fires; guards manual calls).
3. **Per org** (service client; orgs page-bounded, `limit 200` ordered by `created_at`, cap
   recorded below):
   a. **Idempotency claim:** insert `digest_runs (org_id, period_start, …, status
'pending')`; on unique-violation → this week already handled for the org → skip. Crashed
   `pending` rows older than 1 hour are reclaimed (status reset) so a mid-run crash retries
   next ping — this is the exactly-once-per-week guarantee.
   b. **Compute:** `_org_health_digest(org_id, now - 7 days)` → per-board rows + samples;
   org totals summed in TS. **All-zero totals → status `skipped`**, no notification, no
   email (no noise for dormant orgs).
   c. **Email first:** recipients = members (`org_members` join `profiles`, roles
   `owner|admin|member` — guests excluded) minus `email_digest_opt_out` and null emails,
   capped at 200/org. If `RESEND_API_KEY` unset → email is skipped by design (in-app-only
   mode — enablement is just adding the key). Otherwise `fetch` to
   `https://api.resend.com/emails/batch` (≤100 per call, chunked; **no new npm dependency**)
   with per-recipient HTML (personalized unsubscribe link), subject "Your weekly {org} plan
   health digest", `List-Unsubscribe` header. Resend failure → status `failed` + `error`,
   stop this org here (next daily ping retries the whole org; because notifications come
   after email, a retry can't duplicate them).
   d. **In-app notifications:** after email success (or email-disabled), one `notifications`
   insert per member (same member set, opt-out irrelevant): `kind 'health_digest'`,
   `actor_id null`, `payload = { newCount, incompleteCount, overdueCount, periodStart }`.
   Rides the existing realtime channel; no client changes beyond rendering.
   e. Finalize the `digest_runs` row (`sent`, `stats`, `email_sent_count`, `completed_at`).
4. **Response:** `{ processed, sent, skipped, failed }` (also useful for manual invocation
   during testing).

**Email rendering** — `src/lib/digest/render.ts`: pure `renderDigestHtml(payload)` /
`renderDigestText(payload)` string templates (table-based inline-styled HTML matching the
branded auth-template look in `supabase/templates/`, light-mode only email-safe). Content:
org header + totals strip (new / incomplete / overdue), then per-board rows (board name,
counts, up to 5 sample item names for new + incomplete), footer with dashboard link
(`APP_BASE_URL`) + unsubscribe link. Unit-tested with snapshot-ish assertions (counts,
escaping of item names, unsubscribe URL).

**Notification rendering** — `NotificationsList.tsx` `label()` gains a `health_digest` case
reading `payload` ("Weekly digest: 4 new · 3 incomplete · 2 overdue"); bell click-through →
`/dashboards` (no board/item FK).

### 5. Opt-out / unsubscribe

- **Settings toggle:** a "Notifications" card on the existing
  `src/app/(app)/settings/page.tsx` (component `src/components/settings/DigestPreferenceForm.tsx`, pattern-match
  `PersonalTimezoneForm`): checkbox "Email me the weekly plan health digest" bound to
  `profiles.email_digest_opt_out` via a Server Action (Zod-validated, RLS `update own
profile`).
- **One-click unsubscribe:** every email carries
  `/api/digest/unsubscribe?uid=<userId>&sig=<hmac>` where `sig = HMAC-SHA256(DIGEST_SECRET,
"unsub:" + userId)` (Node `crypto`, no expiry — the link must work from an old email; it
  can only ever flip one flag off). GET route handler validates the signature
  (constant-time), sets `email_digest_opt_out = true` via the service client, returns a
  minimal branded HTML confirmation ("You're unsubscribed — manage this in Settings").
  Invalid signature → 400, no side effect. Also sent as the `List-Unsubscribe` header.

### 6. Environment & configuration

`src/lib/env.server.ts` gains three **optional** vars (boot validation stays green in CI and
for contributors — the digest feature self-disables, per the env-boot-validation gotcha):

- `DIGEST_SECRET` — route auth + unsubscribe HMAC (same value provisioned into Vault).
- `RESEND_API_KEY` — email sending (absent → in-app-only digests).
- `APP_BASE_URL` — absolute links in emails (dashboard + unsubscribe).

`.env.example` documents all three. From-address (`DIGEST_FROM_EMAIL`, optional, default
`digest@<APP_BASE_URL host>`) requires a Resend-verified domain — owner action, Open
question 3.

### 7. Security

- New RPCs: `dashboard_health_summary` is the only one granted to `authenticated`, guarded
  by `is_org_member` exactly like `dashboard_aggregate`. `_board_health_counts` /
  `_org_health_digest` have no authenticated grant (definer-internal / service-role).
- `digest_runs`: RLS enabled, zero policies — service-role only.
- The digest route trusts nothing from the request body; org iteration and recipient
  resolution are entirely server-side (service client). Bearer token compared
  constant-time; secret never logged.
- Unsubscribe: HMAC-gated single-purpose flag flip; no auth session required (industry
  norm), cannot read or reveal any data, idempotent.
- Emails contain item **names** only (no cell data) — same exposure class as the recipient's
  own board access; recipients are org members whose RLS already grants board reads.
  Caveat: board-level sharing means a member might receive names from boards they don't
  follow — accepted for org-wide digest (Open question 5).
- `notifications.payload` is written only by the service-role digest path; the existing
  insert policy (`actor_id = auth.uid()`) is unchanged, so authenticated users cannot forge
  digest notifications for others.

## Performance & data-fetching budget (working agreement #5)

- **(a) First paint vs interaction:** the widget rides the **existing single batched
  `getWidgetsData` round-trip** — 0 additional client→server round-trips per dashboard, any
  number of health widgets. It has no interactions (no tabs/filters/toggles → nothing for
  the History API); config save is the existing Server Action + `updateTag` targeted
  invalidation. The Settings toggle is one Server Action on change. All digest work is
  **scheduled server-side** — zero impact on any page load.
- **(b) Server data vs client state:** nothing new is client-navigable; digest sends and
  preference changes are server-data mutations (route handler / Server Action). The in-app
  notification arrives over the already-open realtime channel.
- **(c) Bounded + indexed:** widget RPC = one board's top-level items via
  `items_board_id_idx` + `items_parent_id_idx`, cell lookups on the `(item_id, column_id)`
  PK, new-item count on `items_board_created_idx` — single row out; same cost class as
  `dashboard_completion`, cached 30 s per widget (9.3b). Digest RPC = per-org loop over
  ≤200 boards × the same per-board shape, trailing-7-day windows on indexed columns,
  samples capped at 5, boards with all-zero counts dropped; runs once per org per week
  (daily ping is an idempotent no-op after success). Recipient fan-out capped at 200/org,
  Resend batched ≤100/call. No unbounded `select *` anywhere.

## Testing

- **Unit (Vitest):** `shapeHealth` (progress %, zero-item null); `healthConfigSchema` +
  `defaultConfig("health")`; `currentDigestPeriod` (Monday boundaries, UTC); digest payload
  Zod; `renderDigestHtml/Text` (counts, HTML-escaped item names, unsubscribe URL,
  opt-out-link presence); unsubscribe HMAC sign/verify round-trip + tamper rejection;
  route-handler auth (401/503) and idempotency-claim logic with a mocked service client.
- **Integration (serial project, existing provisioning pattern):**
  `dashboard_health_summary` — done-label matching, owner/date criteria incl. the
  skipped-when-column-absent rule, overdue vs done suppression, subitem exclusion,
  new-in-window counting, non-member rejection; `_org_health_digest` — per-board rows,
  samples bounded, zero-count boards dropped; `digest_runs` unique claim.
- **Component (RTL):** `HealthWidget` states + counts + destructive-at->0 styling;
  `NotificationsList` `health_digest` copy; `DigestPreferenceForm` toggle → action.
- Full gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Independent units (for the plan's Execution DAG)

1. Migration A (widget/kinds/rule core) + types regen — manual-apply gate.
2. Migration B (digest infra + cron) — after A (calls `_board_health_counts`).
3. Pure TS lib: period/HMAC/render/Zod — no dependencies.
4. Widget pipeline (fetcher, batch, component, config form) — needs 1 + shaping from 3.
5. Notification renderer case + bell — needs 1 (types).
6. Digest route + env — needs 2 + 3.
7. Settings toggle + unsubscribe route — needs 2 (+ HMAC from 3).
8. Integration tests — need 1/2 applied to the test project.

## Open questions for review

1. **The "parent must have ≥1 sub-item" criterion is dropped** — in Monolith parentage is
   emergent (an item becomes a parent by having children), so the criterion can never fire.
   Nearest expressible analogs: flag _groups_ with zero items, or a per-board "expects
   subitems" setting — both excluded as not-cheap. **Needs requester confirmation**
   (irdhina.harith@accenture.com) per the goal plan's definition of done, alongside the rest
   of the rule: owner = first people column, date = first date column (single check — start
   and due collapse to one value on Monolith date columns), done items never flagged,
   criteria skipped on boards lacking that column kind.
2. **Rule configurability deferred.** Org/board-level rule config (which columns, which
   criteria) needs schema + UI on both the widget and the org — not cheap; the fixed rule
   ships first. Revisit if the requester's boards diverge from the seeded
   Status/Owner/Date shape.
3. **Email provider account is an owner action:** a Resend account + verified sending
   domain + `RESEND_API_KEY`/`DIGEST_SECRET`/`APP_BASE_URL` env + the two Vault secrets.
   Until provisioned the feature degrades to in-app-only digests by design. Confirm Resend
   (vs SendGrid/Postmark — all fetch-compatible; Resend chosen for the simplest batch API
   and generous free tier).
4. **Send timing:** fixed Monday ~07:00 UTC for everyone (daily-ping retry until sent).
   Org-local Monday 08:00 (the `automations-date-sweep` timezone pattern) is a follow-up if
   requested.
5. **Recipient set:** org members with role `owner|admin|member`; `guest` excluded (external
   collaborators; also avoids leaking cross-board item names to board-scoped guests).
   Confirm.
6. **"New activities" counts top-level items only** (consistent with overdue/incomplete and
   the completion widget's double-weighting rationale). If subitem creation should count,
   it's a one-line predicate change.
7. **Digest scope is org-wide** (all boards a member's org has, up to the 200-board cap) —
   not per-workspace or per-board subscriptions. Acceptable for MVP?
