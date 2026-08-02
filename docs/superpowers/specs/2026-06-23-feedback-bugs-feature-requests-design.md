# Feedback (bugs & feature requests) — design

**Date:** 2026-06-23
**Topic:** An in-app channel for users to report **bugs** and request **features** about Monolith itself, triaged by the **platform admin**. A highlighted "Feedback" pill in the app-shell header opens a popover with **New** (capture form) and **My requests** (own submissions + live status) tabs. The platform admin reviews/triages everything in a new `/admin/feedback` section and can set status + post a public response; the submitter is notified in-app on each change.
**Status:** Spec — ready for plan. Nothing built.
**Estimated size:** M (one migration + RLS, one validations module, one server-action module with notification wiring, one header client surface, one admin RSC surface).

---

## Problem

Monolith has **no** channel for users to report product bugs or request features. The only adjacent concepts are `admin_audit_log` (privileged-action log, not user-facing) and the in-app notifications system (collaborative activity only). Today feedback would have to travel out-of-band (email/Slack), with no triage surface and no loop back to the reporter.

We want a first-class, low-friction capture point in the product, plus a single triage surface for the product owner.

## Decisions locked during brainstorming

1. **Audience: platform admin only.** Feedback is **global product feedback**. Any authenticated member of any org can submit; only the platform super-admin (the `platform_admins` table, via `is_platform_admin()`) reads/triages across all orgs. The submitter's `org_id` + `submitted_by` are captured for context only — there is **no per-org triage**.
2. **Entry point: a header "Feedback" pill.** A highlighted labelled button (megaphone icon + "Feedback" text) in the app-shell header, visible to all authenticated users. Clicking opens a shadcn **Popover** anchored under it.
3. **Two tabs, loop closed.** _New_ = capture form. _My requests_ = the user sees their **own** submissions and their current status + the admin's public response. (The submitter tracks their reports; this is not fire-and-forget.)
4. **Text only.** Captured fields are `kind`, `title`, `body`. **No** auto page/browser context and **no** screenshot upload in v1 (explicitly deferred — see Non-goals).
5. **Status lifecycle:** `new → triaged → planned → in_progress → resolved`, plus `declined` as a terminal "won't do". Visible to both the submitter and the admin.
6. **Public response field.** The admin can attach a short public note (e.g. "Fixed in today's release") that the submitter sees next to their request.
7. **Notifications: submitter-only (direction B), via the existing bell.** When the admin changes status or posts/edits a response, the submitter gets an in-app notification in the **existing notifications bell**. The admin is **not** notified per submission; instead the admin nav item carries a count badge of `new` feedback. Integrating into the bell requires three deliberate extensions, decided at plan-time (see §5): (a) a new `notification_kind` value `feedback_response`; (b) a nullable `feedback_id` link column on `notifications`; (c) a **service-client insert** (server-only `SUPABASE_SERVICE_ROLE_KEY`) because the platform admin is not a member of the submitter's org, so the notifications-insert RLS policy (`actor must be org member`) would otherwise block a cross-tenant notification.

## Goal / non-goals

**Goal.** Any member can submit a bug/feature in two clicks from anywhere in the app and later see its status + the admin's reply. The platform admin has one bounded, filterable triage surface to read every report, advance its status, and reply — with the reply/status change pushed back to the submitter as a notification.

**Non-goals (YAGNI, deferred to later iterations):**

- Screenshot/file attachments (needs a Storage bucket + upload UI + object RLS).
- Auto-captured page route / user-agent context.
- Per-org triage or org-admin visibility (audience is platform admin only).
- Voting / upvotes / public roadmap.
- User edit/withdraw after submit (reports are immutable to the submitter in v1).
- Threaded back-and-forth conversation (a single admin response field, not a comment thread).
- Email/Slack delivery (in-app notification only).

---

## Architecture

### 1. Data model — `public.feedback`

Follows recent-migration conventions (`text` + `check` constraints as in `20260617110000_attachments.sql`; `timestamptz not null default now()`; org-denormalized `org_id`; `auth.users` FKs).

| Column           | Type                                                                                                            | Notes                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `id`             | `uuid` pk default `gen_random_uuid()`                                                                           |                                               |
| `submitted_by`   | `uuid not null` → `auth.users(id)`                                                                              | the reporter                                  |
| `org_id`         | `uuid not null` → `organizations(id)` on delete cascade                                                         | reporter's org, captured for context only     |
| `kind`           | `text not null check (kind in ('bug','feature_request'))`                                                       |                                               |
| `title`          | `text not null`                                                                                                 | app-enforced ≤ 120 chars                      |
| `body`           | `text not null`                                                                                                 | app-enforced ≤ 2000 chars                     |
| `status`         | `text not null default 'new' check (status in ('new','triaged','planned','in_progress','resolved','declined'))` |                                               |
| `admin_response` | `text` (nullable)                                                                                               | public reply shown to submitter               |
| `responded_by`   | `uuid` → `auth.users(id)` (nullable)                                                                            | platform admin who last responded             |
| `responded_at`   | `timestamptz` (nullable)                                                                                        |                                               |
| `created_at`     | `timestamptz not null default now()`                                                                            |                                               |
| `updated_at`     | `timestamptz not null default now()`                                                                            | bumped on admin update (trigger or in-action) |

**Indexes:**

- `feedback_status_created_idx on (status, created_at desc)` — the admin list (filter by status, newest first).
- `feedback_submitter_created_idx on (submitted_by, created_at desc)` — the "My requests" tab.

### 2. RLS (default-deny; mirrors the `attachments` policy style with `is_org_member` / `is_platform_admin` helpers)

- `enable row level security`.
- **select** (`feedback_select`): `submitted_by = (select auth.uid())` **OR** `public.is_platform_admin()`. A user reads only their own rows; the platform admin reads all.
- **insert** (`feedback_insert`): `to authenticated with check (submitted_by = (select auth.uid()) and public.is_org_member(org_id))` — self-authored, within the submitter's own org.
- **update** (`feedback_update`): `using (public.is_platform_admin()) with check (public.is_platform_admin())` — only the platform admin can mutate (status / response / `responded_*` / `updated_at`). Submitters cannot edit after insert.
- **delete** (`feedback_delete`): `public.is_platform_admin()` only.

> Note: confirm at plan time whether `is_platform_admin()` exists as a callable SQL helper (the guard `src/lib/platform/guard.ts` calls an RPC `is_platform_admin()`); if it is an RPC wrapper over a SQL function, reuse the SQL function directly in policies. If only the RPC exists, add a thin SQL `security definer` predicate in the migration.

### 3. Server layer — `src/lib/feedback/`

All actions return the project's `ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }`, validate input with Zod, and rely on RLS for authorization (no hand-rolled role checks beyond what the action needs to branch on).

- **`submitFeedback({ kind, title, body }): ActionResult<{ id }>`** — any authenticated member. Resolves the user + their `org_id`, inserts the row (`submitted_by = auth.uid()`, `status='new'`). No `revalidatePath` needed (the popover refetches its own list).
- **`listMyFeedback(): ActionResult<MyFeedback[]>`** — returns the caller's own rows (`id, kind, title, status, admin_response, responded_at, created_at`), capped to the 50 most recent (indexed on `(submitted_by, created_at desc)`), for the _My requests_ tab. Invoked on first open of that tab.
- **`adminUpdateFeedback({ id, status, adminResponse? }): ActionResult`** — platform admin only (RLS enforces; action also short-circuits via the platform guard for a clean error). Updates `status`, optional `admin_response`, stamps `responded_by`/`responded_at` (when a response is set) and `updated_at`; then **inserts an in-app notification** for that row's `submitted_by` (see §5); then `revalidatePath('/admin/feedback')`.

**Zod schemas — `src/lib/validations/feedback.ts`:**

- `submitFeedbackSchema`: `kind` enum (`bug` | `feature_request`), `title` 1–120 trimmed, `body` 1–2000 trimmed.
- `adminUpdateFeedbackSchema`: `id` uuid, `status` enum (the six values), `adminResponse` optional string ≤ 2000.

### 4. UI

**User side — header (`src/components/app-shell.tsx` / shell header):**

- **`FeedbackButton`** (client) — the labelled "Feedback" pill (megaphone icon + text, accent-highlight treatment) rendered in the header for all authenticated users. Wraps a shadcn **Popover**.
- **`FeedbackPopover`** (client) — two tabs:
  - _New_: `kind` toggle (Bug / Feature), `title` input, `body` textarea, Submit → `submitFeedback`. On success: show a "Thanks!" confirmation and switch to _My requests_.
  - _My requests_: list of the user's submissions with a status pill and, when present, the admin's response. Data fetched **lazily on first open** of this tab via `listMyFeedback` (not on header render).

**Admin side — `src/app/admin/feedback/` (RSC, under the existing `requirePlatformAdmin()` layout):**

- List page: bounded first read (page 1, 50 rows) over the indexed `(status, created_at desc)`. **Kind/status filters and sort are client state + the History API — 0 new server round-trips** (per working-agreement #5 and the RSC-nav-refetch gotcha). Pagination/"load more" for older rows is a real server read.
- Detail (row drill-in, e.g. a side panel or `/admin/feedback/[id]`): shows the full report + submitter/org/created context; a status `Select` and a response `Textarea`; Save → `adminUpdateFeedback` + targeted `revalidatePath`.

**Navigation:**

- The header pill (above) — global.
- A **"Feedback"** item in the platform-admin sidebar section (`src/components/shell/sidebar-nav.tsx`, alongside `/admin/organizations` etc.), and optionally the admin user-menu, **carrying a count badge of `status='new'` rows** (one cheap `count` query in the admin layout/nav data).

### 5. Notifications integration (full bell integration — chosen at plan-time)

The submitter is notified through the **existing notifications bell** (`NotificationsBell` + the `public.notifications` table). Grounding established that the current schema does not accommodate feedback as-is, so v1 makes three scoped extensions:

1. **Enum value.** Extend `public.notification_kind` (`mention | assigned | update_on_item`) with **`feedback_response`**.
2. **Link column.** Add a nullable `feedback_id uuid references public.feedback(id) on delete cascade` to `public.notifications` (the existing `board_id` / `item_id` link columns don't apply to feedback). The bell uses it to label/route the notification.
3. **Cross-tenant insert via the service client.** The existing notifications-insert RLS policy requires `actor_id = auth.uid()` **and** `is_org_member(org_id)`. The platform admin is **not** a member of the submitter's org, so a normal authenticated insert is denied. `adminUpdateFeedback` therefore writes the notification with the **server-only service client** (`createServiceClient`, `SUPABASE_SERVICE_ROLE_KEY` — never reaches the browser), which bypasses RLS for this one trusted, server-controlled insert. Row shape: `{ org_id: feedback.org_id, recipient_id: feedback.submitted_by, actor_id: <admin uid>, kind: 'feedback_response', feedback_id: feedback.id }`. Self-notification is skipped when the admin submitted the feedback (`recipient_id === actor_id`).

On every `adminUpdateFeedback` that changes `status` or sets/edits `admin_response`, exactly one such notification row is written for `submitted_by`. `AppNotification` is the plain `notifications` row and `NotificationsList` renders via a `label(kind)` switch, so the bell needs **no query change**: T5 just adds a `feedback_response` case returning generic copy (_"updated your feedback request"_) and marks-read on click. The `feedback_id` column is stored for future routing (deep-linking the click into the My-requests popover is a Non-goal for v1).

---

## Performance & data-fetching budget (working-agreement #5)

- **First paint:** the header "Feedback" pill is static — **0 data fetches** to render it.
- **Popover open:** _New_ tab = **0 server reads** (pure form). _My requests_ tab fetches the caller's own rows **once on first open**, bounded to 50 and indexed on `(submitted_by, created_at desc)`.
- **Admin list:** first paint = one bounded page-1 read over the indexed `(status, created_at desc)`. **Kind/status filter + sort toggles operate on already-loaded data via client state + `window.history.replaceState` — 0 new round-trips**, no `<Link>`/router navigation. Loading older rows (pagination) is the only interaction that hits the server.
- **Admin mutations:** status/response edits go through a **Server Action** + targeted `revalidatePath('/admin/feedback')` (changes server data → RSC path, per working-agreement #5b). The submitter notification is written in the same action.
- **Nav badge:** a single `count(*) where status='new'` — cheap, indexed.
- All hot-path reads are **bounded and indexed**; no unbounded `select *` on a growing table.

---

## Execution DAG (working-agreement #6)

**Tasks**

- **T1 — Schema:** one migration creating `public.feedback` (columns, checks, indexes) + RLS (select/insert/update/delete), **plus** the two notifications extensions from §5 — `alter type public.notification_kind add value 'feedback_response'` and `alter table public.notifications add column feedback_id uuid references public.feedback(id) on delete cascade`. Run `pnpm db:types`, commit generated types. (`is_platform_admin()` / `is_org_member()` already exist as SQL functions — reuse directly in policies.)
  - _Produces:_ `feedback` table + RLS + extended `notifications` schema + regenerated `database.types.ts`.
- **T2 — Server layer:** `src/lib/validations/feedback.ts` + `src/lib/feedback/actions.ts` (`submitFeedback`, `listMyFeedback`, `adminUpdateFeedback`). `adminUpdateFeedback` writes the cross-tenant notification via `createServiceClient` (§5).
  - _Consumes:_ T1 types/schema + `@/lib/supabase/service`. _Produces:_ the three actions + schemas.
- **T3 — User popover surface:** `FeedbackButton` + `FeedbackPopover` (New + My requests tabs) wired into `HeaderUserData` (between the bell and the user menu).
  - _Consumes:_ `submitFeedback`, `listMyFeedback`.
- **T4 — Admin surface:** `src/app/admin/feedback/` list + detail (status/response editing) + the `/admin/feedback` item in `PlatformNav` with the `new` count badge.
  - _Consumes:_ `adminUpdateFeedback`, the admin list read, platform guard.
- **T5 — Bell rendering:** add a `feedback_response` case to the `label()` switch in `src/components/notifications/NotificationsList.tsx` (generic copy; mark-read on click already handled by the list). No notifications-query change.
  - _Consumes:_ T1 `feedback_response` kind. Independent of T3/T4 (different files: notifications UI vs. feedback popover vs. admin route).

**Dependency graph**

- T1 → T2 → {T3, T4}
- T1 → T5 (T5 needs only the schema extension + a feedback-title join, not the actions)

**Parallel batches**

- **Batch 1:** T1 (foundation; everything depends on it).
- **Batch 2:** T2 **and** T5 — both depend only on T1 and touch disjoint files (`src/lib/feedback/*` vs. `NotificationsBell` UI), so they run concurrently.
- **Batch 3 (parallel):** T3 and T4 — both depend on T2, independent of each other (header client surface vs. `/admin` RSC). Concurrent agents in **isolated git worktrees**.

**Critical path:** T1 → T2 → (T3 ‖ T4) — depth **3** (T5 rides along in Batch 2, off the critical path). Real wall-clock floor: one schema task + one server task + the slower of the two UI tasks.

---

## Testing (working-agreement #4 — written and executed)

- **Zod:** `submitFeedbackSchema` / `adminUpdateFeedbackSchema` — accept valid, reject empty/over-length/bad-enum.
- **Server actions / RLS:** a member can insert and read **only their own** rows; a member cannot read another user's feedback; a non-admin `adminUpdateFeedback` is rejected; an admin update sets status/response/`responded_*` **and** writes exactly one `feedback_response` notification for `submitted_by` (via the service client), skipping self-notification when admin == submitter.
- **Components:** _New_ form validation + success path (switches to My requests); _My requests_ renders status pill + response; admin detail status/response Save calls the action with the right payload; `NotificationsList.label()` returns the feedback copy for a `feedback_response` kind.
- **Gates (must pass before "done"):** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

## How to test (manual acceptance — filled in at closure)

After merge to `develop`:

1. As any user, click the **Feedback** pill in the header → _New_ tab → choose **Bug**, enter a title + details → **Submit** → see "Thanks!" and the report appears under **My requests** as `New`.
2. As the platform admin, go to **/admin/feedback** → the new report is listed → open it → set status to **In progress** and add a response → **Save**.
3. Back as the original user: a **notification** arrives; the **My requests** tab shows the report as `In progress` with the admin's response.
4. Confirm a non-admin user cannot reach `/admin/feedback` and sees only their own reports.
