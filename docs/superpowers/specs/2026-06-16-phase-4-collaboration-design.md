---
type: spec
status: proposed
date: 2026-06-16
tags: [project/monolith, spec, phase/4, collaboration]
related:
  ["[[00-north-star]]", "[[2026-06-14-pulse-design]]", "[[platform-roadmap]]"]
---

# Phase 4 — Collaboration (Item panel · Updates · Activity · @mentions · Notifications · Attachments)

> Status: Proposed. One cohesive design for the whole Phase-4 collaboration surface (north-star §2,
> item 4). Built as **three sequenced slices (4a → 4b → 4c)**, each its own implementation plan.
> Informed by a study of the `idandavid1/My-Day` Monday.com clone — we steal its **UX taxonomy**
> (Updates-vs-Activity split, per-action from→to activity rendering) and explicitly **reject its
> data architecture** (capped activity array on the board doc, comments nested on the task, full-board
> socket broadcasts). See §11.

## 1. Goal & scope

Give an item a first-class detail surface and the collaboration primitives around it:

- **4a — Item panel + Updates + Activity Log.** A right-side drawer opened per item, showing the
  item's fields/cells, a human **Updates** feed (add/edit/delete), and a trigger-driven **Activity
  Log** with per-action from→to rendering.
- **4b — @mentions + Notifications inbox.** Mention parsing in updates → per-user `notifications`
  fan-out, a Realtime inbox with unread state.
- **4c — Attachments.** Supabase Storage bucket + RLS, upload UI, files attached to items/updates,
  rendered in the panel.

**In scope**

- Four new org-scoped, RLS-default-deny tables on the Realtime publication: `item_updates`,
  `item_activities`, `notifications`, `attachments`.
- `item_activities` populated by **Postgres triggers** on `items` / `cell_values` / `item_updates`
  (drift-proof), storing raw `old_value`/`new_value` jsonb; **presentation resolved at render time**
  from the columns already in the board cache.
- Item-detail drawer opened via **`?item=<id>` (History API)** — 0 RSC refetch; item fields read from
  the existing board cache. Updates + activity fetched on open, keyed by `itemId`, paginated.
- Updates: flat (no threads/reactions in 4a), rich-text body (`jsonb`), optimistic add/edit/delete.
- @mentions parsed app-side in the create-update action → notification fan-out. Per-user Realtime inbox.
- Attachments via Supabase Storage (org-scoped path) + metadata table; attach to item or update.

**Explicitly out of scope (deferred)**

- Update **threads/replies** and **reactions** (4a is flat). Rich-text tables/embeds beyond basic marks.
- Notification **digests/email**, mute/subscribe preferences, watcher model beyond mention+assignee.
- Attachment **previews/thumbnails generation**, versioning, inline image paste (basic upload only).
- Per-field **comment anchoring**, presence/typing indicators, read receipts on updates.

## 2. Reused foundation (Phases 1–3)

- **Board cache:** `getBoardPayload(boardId)` → `{ board, groups, columns, items, cellValues, views }`;
  `["board", boardId]` TanStack cache (`staleTime: Infinity`); pure patch helpers in `cache.ts`; one
  Realtime channel reconciling into it (`use-board-realtime.ts`); `useBoardMutations` optimistic writes.
- **RLS conventions (verbatim):** denormalized `org_id`; `is_org_member(org_id)` for reads; `+
board_in_org/group_in_org/item_in_org/column_in_org` in `with check` for writes; `set_updated_at`
  trigger; SECURITY-DEFINER RPCs with `set search_path = ''`; `delete` gated by membership or role.
- **Realtime pattern:** tables added to `supabase_realtime`; client subscribes filtered (`board_id=eq`
  or `recipient_id=eq`); echo-dedupe on no-op patches.
- **Column kinds** (`text/status/people/date/numbers/dropdown`) and their cell value shapes — the
  Activity renderer resolves diffs against these (e.g. status option `{id,label,color}`, date
  `{date,end?}`), so it reuses board-cache data with **no extra fetch**.

## 3. Data model

New migration `supabase/migrations/<ts>_collaboration.sql` (4a creates `item_updates` +
`item_activities` + triggers; 4b adds `notifications`; 4c adds `attachments` — sliced across
migrations, shown together here).

```sql
-- ── 4a: Updates ───────────────────────────────────────────────────────────
create table public.item_updates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  author_id  uuid not null references auth.users (id),
  body       jsonb not null,              -- portable rich-text doc (marks: bold/italic/underline/align)
  body_text  text  not null default '',   -- denormalized plaintext (mention scan, search, previews)
  edited_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index item_updates_item_id_idx on public.item_updates (item_id, created_at desc);
create index item_updates_board_id_idx on public.item_updates (board_id);
create index item_updates_org_id_idx on public.item_updates (org_id);

-- ── 4a: Activity log (append-only; NEVER capped) ─────────────────────────────
create type public.activity_action as enum (
  'item_created', 'item_renamed', 'item_moved', 'item_deleted',
  'cell_changed', 'update_added'
);
create table public.item_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations (id) on delete cascade,
  board_id   uuid not null references public.boards (id) on delete cascade,
  item_id    uuid not null references public.items (id) on delete cascade,
  actor_id   uuid references auth.users (id),         -- null = system/automation
  action     public.activity_action not null,
  column_id  uuid references public.columns (id) on delete set null,  -- for cell_changed
  old_value  jsonb,                                   -- raw; resolved to chips at render time
  new_value  jsonb,
  created_at timestamptz not null default now()
);
create index item_activities_item_id_idx  on public.item_activities (item_id, created_at desc);
create index item_activities_board_id_idx on public.item_activities (board_id, created_at desc);
create index item_activities_org_id_idx   on public.item_activities (org_id);

-- ── 4b: Notifications (per-user fan-out rows) ────────────────────────────────
create type public.notification_kind as enum ('mention', 'assigned', 'update_on_item');
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id     uuid references auth.users (id),
  kind         public.notification_kind not null,
  board_id     uuid references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

-- ── 4c: Attachments (metadata; bytes live in Storage) ────────────────────────
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade,
  uploaded_by  uuid not null references auth.users (id),
  storage_path text not null,             -- bucket key: <org_id>/<board_id>/<item_id>/<uuid>-<name>
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now(),
  check (item_id is not null or update_id is not null)
);
create index attachments_item_id_idx on public.attachments (item_id);
create index attachments_org_id_idx  on public.attachments (org_id);
```

**RLS (all four tables):** `enable row level security`; read `using (is_org_member(org_id))`; writes
`with check (is_org_member(org_id) and board_in_org(board_id, org_id) and item_in_org(item_id, ...))`
following the Phase-2 pattern. `notifications` is the exception — **read/update gated on
`recipient_id = (select auth.uid())`** (you only see your own), insert via the fan-out path only.
`item_activities` has **no client insert policy** — only the trigger (SECURITY DEFINER) writes it;
clients get `select` + (no update/delete). Updates are author-or-admin editable/deletable.

**Storage (4c):** a private `attachments` bucket; Storage RLS policies authorize by deriving `org_id`
from the leading path segment and checking `is_org_member`. The metadata row is the queryable handle;
signed URLs are minted server-side for download.

## 4. Activity log — trigger design (the core mechanism)

Three `after` trigger functions (SECURITY DEFINER, `set search_path = ''`), all deriving the actor
from `auth.uid()` (null for service-role/automation writes):

- **`items`** — `insert` → `item_created`; `update of name` → `item_renamed` (old/new name);
  `update of group_id/position` → `item_moved`; `delete` → `item_deleted`.
- **`cell_values`** — `insert/update/delete` → `cell_changed`, recording `column_id`, `old_value`,
  `new_value` (raw jsonb straight from `OLD`/`NEW`). No label/option resolution in SQL.
- **`item_updates`** — `insert` → `update_added` (carries `update_id` in `new_value`).

**Render-time resolution** (`lib/boards/activity.ts`, pure + unit-tested): given an activity row +
the board's `columns`, produce a typed descriptor the `ActivityPreview` renders — status/dropdown →
`{from,to}` colored chips (resolve option id→`{label,color}`), people → avatar diff (resolve user
ids), date → formatted from→to, numbers/text → literal from→to. This is My-Day's `getFromTo(action)`
registry, but **data-driven by column kind** and fed from cache, not hardcoded per task field.

## 5. The item-detail panel (4a)

- **Shell:** shadcn `Sheet` (right side), styled via `pulse-ui` tokens (layered near-black surfaces,
  indigo accent). Header = editable item name (Server Action, Zod-validated — _not_ `contentEditable`).
- **URL:** open/close via `?item=<id>` using `window.history.pushState`/`replaceState` →
  `useSearchParams()` syncs with **no RSC re-run** (gotcha-09). Deep-linkable + back-button correct;
  the board stays mounted and is never refetched.
- **Body tabs (client state, 0 round-trips to switch):**
  - **Fields** — the item's cells, reusing the existing cell editors over the board cache.
  - **Updates** — composer (collapsed "Write an update" → expanded with basic marks) + list; empty state.
  - **Activity Log** — reverse-chron `ActivityPreview` list with the §4 renderer; paginated "load more".
- **Data on open:** item fields come from the board cache (0 fetch). Updates + activity are fetched
  via React Query keyed by `["item-updates", itemId]` / `["item-activity", itemId]`, **bounded**
  (latest 30 updates / 50 activities, cursor "load more") over the `item_id`-indexed tables.

## 6. Data layer & Realtime

- **Queries** (`lib/collaboration/queries.ts`): `getItemUpdates(itemId, cursor)`,
  `getItemActivity(itemId, cursor)`, `getNotifications(cursor)`, `getUnreadCount()`.
- **Server Actions** (`lib/collaboration/actions.ts`): `addUpdate` / `editUpdate` / `deleteUpdate`
  (Zod-validated body; `addUpdate` also parses @mentions → notification fan-out in 4b),
  `markNotificationRead` / `markAllRead`, `createAttachment` (after Storage upload), `deleteAttachment`.
  All mutations optimistic against their React-Query key; `revalidate` not needed (client-state reads).
- **Realtime:** extend the publication with the four tables.
  - Open item: a small per-item subscription (`item_updates`/`item_activities` filtered
    `item_id=eq.<id>`) reconciled into the item-keyed caches — scoped, not a board firehose.
  - Notifications: a **per-user** channel filtered `recipient_id=eq.<uid>` mounted app-shell-wide,
    feeding the inbox + unread badge.
- **Activity coherence:** because activities are trigger-written, an optimistic update's matching
  activity row simply _arrives_ via Realtime; the client de-dupes on `id` (echo-safe), same pattern
  as `use-board-realtime`.

## 7. @mentions + Notifications inbox (4b)

- **Mention capture:** the composer offers an @-autocomplete over org members; the stored `body`
  carries mention marks and `body_text` holds the resolved `@name`. `addUpdate` extracts mentioned
  user ids from the body and inserts one `notifications` row per recipient (`kind='mention'`).
- **Assignment:** when a People cell gains a member (detected in the cell Server Action),
  fan out `kind='assigned'` to the added user(s).
- **Inbox UI:** an app-shell popover/drawer; unread badge from `getUnreadCount()` (partial-index
  query); list paginated; row click deep-links to `?item=` on the right board; mark-read on view.

## 8. Attachments (4c)

- Upload client-side directly to the private `attachments` bucket at
  `<org_id>/<board_id>/<item_id>/<uuid>-<name>`; on success call `createAttachment` to persist
  metadata. Download via server-minted **signed URLs**. Render as chips/thumbposters in the panel
  (item-level) and inline in updates (update-level). Delete removes the Storage object + the row.

## 9. Perf & data-fetching budget (gotcha-09 — mandatory)

| Interaction                        | Server round-trips                  | Notes                                                                                                                          |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Board first paint                  | unchanged                           | Panel not rendered until opened; no new queries added to the board load.                                                       |
| Open panel (`?item=`)              | **0 RSC refetch** + 2 bounded reads | History API (no RSC re-run). Item fields from board cache (0). Updates (≤30) + activity (≤50) fetched once, `item_id`-indexed. |
| Switch Fields/Updates/Activity tab | **0**                               | Pure client state.                                                                                                             |
| Add/edit/delete update             | 1 Server Action                     | Optimistic; matching activity arrives via Realtime.                                                                            |
| Edit a cell from the panel         | 1 (existing path)                   | Reuses `useBoardMutations`; activity trigger-written.                                                                          |
| Open notifications inbox           | 1 bounded read                      | `recipient_id`-indexed, paginated; unread count via partial index.                                                             |
| Live updates (peers)               | 0 (push)                            | Row-level Realtime deltas, filtered by item/recipient — never full-board.                                                      |

All hot-path reads are **bounded** (cursor pagination) over **indexed** columns. No interaction that
only changes view state issues an RSC navigation.

## 10. Reject-list — My-Day anti-patterns we explicitly do NOT copy

| My-Day                                                                  | Why it's wrong here                                  | Monolith-native                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Activities = capped 30-item array on the board doc (`activities.pop()`) | Silent history loss; full-board re-save per event    | Append-only `item_activities` rows, paginated, never capped                |
| Comments nested array on the task                                       | No pagination/permissions; board re-save per comment | `item_updates` table, RLS, optimistic per-row                              |
| Full-board socket broadcast on every change                             | Heaviest possible sync; double-apply bugs            | Row-level Realtime deltas filtered by item/recipient (already our pattern) |
| `contentEditable` title, no validation                                  | Unvalidated writes                                   | Zod-validated name via Server Action                                       |

## 11. Testing

- **RLS integration** (per table, the Phase-1/2 harness): member reads; cross-tenant denial; author-vs-
  member update/delete on `item_updates`; `notifications` visible only to recipient; no client insert
  into `item_activities`.
- **Trigger unit tests:** each write path produces exactly one activity row with correct `action`,
  `column_id`, and raw `old_value`/`new_value`; actor = `auth.uid()`.
- **Pure logic** (`activity.ts`): diff descriptor for every column kind; mention extraction from a body.
- **Component:** panel open/close via `?item=` (no refetch), tab switching, update composer optimistic
  flow, activity rendering per kind, unread badge.
- **e2e (Playwright):** add an update → appears + logs an activity; @mention → recipient inbox row;
  upload an attachment → visible + downloadable. Gates: `pnpm typecheck && lint && test && build`.

## 12. Build order (for the plans)

1. **4a** — migration (`item_updates` + `item_activities` + triggers) → types → queries/actions →
   `activity.ts` → per-item Realtime → panel shell (`?item=`) → Fields/Updates/Activity tabs. One PR.
2. **4b** — migration (`notifications`) → types → @-autocomplete + mention extraction → fan-out in
   `addUpdate` + assignment fan-out → per-user Realtime + inbox UI. One PR.
3. **4c** — migration (`attachments`) + Storage bucket/policies → upload + signed-URL download →
   panel rendering. One PR.

Each slice: regenerate `database.types.ts`, run advisors, full verification gate, `/wrapup`.

## 13. Open questions / future

- Threads + reactions on updates (likely 4d). Watcher/subscribe model + notification preferences.
- Whether `update_on_item` notifications need a watcher table before they're useful (deferred until 4b
  proves the inbox).
