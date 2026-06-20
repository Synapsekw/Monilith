# Board-Level Sharing — Design

- **Date:** 2026-06-20
- **Status:** Approved (brainstorming) — pending implementation plan
- **Author:** danijel + Claude
- **Phase:** Cross-cutting (extends Phase 2 — Boards core; builds on Phase 1 tenancy)

## 1. Summary

Today every board is visible to every member of the org: RLS on all five board-data
tables (`boards`, `groups`, `items`, `columns`, `cell_values`) is a single
`is_org_member(org_id)` check. There is no way to keep a board private or to show a board
to only some people.

This adds **per-board sharing on top of the existing org spine**. Org membership stays the
outer boundary and the prerequisite — you can only share with people already invited to
your org (the org-invite flow shipped 2026-06-19 is unchanged). Within that boundary:

- A new board is **private to its creator** until explicitly shared.
- The creator (owner) shares a board with specific org members at **Viewer** (read-only)
  or **Editor** (full edit) access.
- **Private means private even from org owners/admins** — no role-based read bypass.
- The sidebar gains a **"Shared with me"** section and a **shared-out indicator** on
  boards the current user owns and has shared.

This is the board-scoped sharing the PRD (§9 Risks) flagged as an open question.

## 2. Goals / Non-goals

**Goals**

- Per-board visibility: private-by-default, explicit grants to named org members.
- Two access levels: `viewer` (read-only) and `editor` (full board-data edit).
- RLS-enforced — board contents are unreadable without a grant, even to admins.
- Sidebar restructure: "My boards" (with shared-out indicator) + "Shared with me".
- A Share dialog on the board header (owner-only) to grant/change/revoke access.
- Migration that preserves current visibility for existing boards (no board "disappears").

**Non-goals (YAGNI — possible future work)**

- Sharing a whole **workspace** at once (we chose per-board; revisit later).
- A "share with the entire org" one-click grant (extensible later via a sentinel row —
  see §6).
- A third **Commenter** tier (deferred; the enum is designed to extend).
- **Editors re-sharing** a board onward — only the owner manages sharing in v1.
- Public / external (non-org) share links or guest-outside-org access.
- Ownership **transfer** of a board (use a future flow; not needed now).
- Real-time presence/cursors on shared boards (separate concern).

## 3. Decisions (locked in brainstorming)

| Decision            | Choice                                                         |
| ------------------- | -------------------------------------------------------------- |
| Unit of sharing     | Individual board                                               |
| Default visibility  | Private to `created_by` until shared                           |
| Access levels       | `viewer`, `editor`                                             |
| Admin visibility    | None — private is private even from owners/admins              |
| Share target        | Existing org members only (org invite remains the gate)        |
| Who manages sharing | Board owner (`created_by`) only                                |
| Existing boards     | Back-filled with Editor grants to all current org members (§7) |
| Nav label           | "Shared with me" (per-board, so not "workspaces")              |

## 4. Architecture — read-visibility enforcement

The chosen approach (brainstorming "Approach A"): a `board_members` grant table plus a
`SECURITY DEFINER STABLE` helper `can_read_board(board_id)`, with the **read** policies on
the five board-data tables rewritten from `is_org_member(org_id)` to `can_read_board`.

Why this composes cleanly:

- Every board-data table **already denormalizes `board_id`** (and `org_id`), so the new
  read policy is still a single function call per statement — no joins, no recursion.
- The helper is `SECURITY DEFINER STABLE` → evaluated once per statement and able to read
  `board_members`/`boards` without recursive RLS. Mirrors the existing `is_org_member` /
  `board_in_org` helper pattern verbatim.
- **Writes keep the tenant check.** Write policies become "can edit this board AND
  `is_org_member(org_id)`" — org isolation is never relaxed; sharing only ever _narrows_
  who can read, on top of the org boundary.

Rejected alternatives: an `is_private` deny-flag on org-visible boards (leaky by default,
contradicts private-by-default); query-layer filtering instead of RLS (violates the repo
invariant "RLS is the security boundary").

## 5. Data model

### New table

```sql
create type public.board_access as enum ('viewer', 'editor');

create table public.board_members (
  org_id       uuid not null references public.organizations (id) on delete cascade,
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  access_level public.board_access not null default 'viewer',
  granted_by   uuid not null references auth.users (id),
  created_at   timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_id_idx on public.board_members (user_id);
create index board_members_org_id_idx  on public.board_members (org_id);
```

- `org_id` denormalized for consistency with the rest of the schema (cheap tenant scoping
  and cascade clarity). It must equal the board's `org_id` (enforced in the share RPC).
- PK `(board_id, user_id)` → one grant per person per board; `user_id` index drives the
  "shared with me" sidebar query.

### Ownership

A board's owner is the existing `boards.created_by`. The owner is implicit (not a
`board_members` row): owner = full access + sole sharing manager.

### Helpers (SECURITY DEFINER, STABLE, `set search_path = ''`)

```sql
-- read: I created it OR I have any grant on it
can_read_board(p_board_id uuid) returns boolean
  := created_by = auth.uid() OR exists(board_members where board_id, user_id=auth.uid())

-- write: I created it OR I have an editor grant
can_edit_board(p_board_id uuid) returns boolean
  := created_by = auth.uid()
     OR exists(board_members where board_id, user_id=auth.uid() and access_level='editor')
```

Both deliberately omit any `has_org_role` branch → admins get no read/write bypass.

## 6. RLS changes

### 6a. Full board-scoped table surface (not just the core 5)

A board's contents live in **every table carrying a `board_id`**, and each is currently
readable by any org member via `is_org_member(org_id)`. For "private means private" to
actually hold, **all** of them must switch their SELECT to `can_read_board(board_id)` —
locking only the core 5 would still leak a private board's comments, attachments, time
entries, and activity (all queryable directly by `board_id`). The full list (15 tables):

| Group         | Tables                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| Core          | `boards`, `groups`, `items`, `columns`, `cell_values`                                      |
| Views/links   | `board_views`, `item_dependencies`                                                         |
| Collaboration | `item_updates`, `item_activities`, `attachments`                                           |
| Time          | `time_entries`                                                                             |
| Automations   | `automations`, `automation_date_fires`, `automation_runs`, `automation_webhook_deliveries` |

For **each** table above:

- **SELECT:** `using (public.can_read_board(board_id))`
  (for `boards`, the policy reads `can_read_board(id)`).
- **INSERT / UPDATE / DELETE:** `is_org_member(org_id) AND public.can_edit_board(board_id)`
  plus the existing `*_in_org()` parent-consistency checks in `WITH CHECK`.
  - `boards` INSERT keeps `created_by = auth.uid()` (you create your own private board).
  - `boards` DELETE: owner only (`created_by = auth.uid()`) — replaces the old
    owner/admin-role delete policy (admins no longer delete others' private boards).
  - Append-only/system-written tables (`item_activities`, `automation_runs`,
    `automation_date_fires`, `automation_webhook_deliveries`) only need the **SELECT**
    rewrite; their writes already run via `SECURITY DEFINER` engine/trigger paths.

### 6b. Write RPCs must enforce `can_edit_board` (SECURITY DEFINER bypass)

`SECURITY DEFINER` RPCs bypass RLS, so a Viewer (who is an org member) could write through
them. These user-callable write RPCs gain a `can_edit_board(board_id)` guard (raising
`42501` when false), in addition to their existing `is_org_member` check:

`create_item`, `create_board_view`, `delete_board_view`, `create_item_dependency`,
`delete_column_option`, `start_timer`.

(`create_board` / `create_board_from_template` are exempt — they create a _new_ board the
caller owns. Dashboard RPCs are out of scope: dashboards stay org-scoped in v1, noted as
follow-up.)

`board_members` own RLS:

- SELECT: board owner OR a member of that board (you can see who it's shared with if you're
  on it). `can_read_board(board_id)`.
- INSERT/UPDATE/DELETE: **owner only** — `exists(boards where id=board_id and
created_by=auth.uid())`. Routed through a `SECURITY DEFINER` RPC (below) for validation.

### Sharing RPCs / actions

- `share_board(p_board_id, p_user_id, p_access)` — owner-only; validates target
  `is_org_member` of the board's org; upserts the grant; stamps `granted_by`. `SECURITY
DEFINER`.
- `unshare_board(p_board_id, p_user_id)` — owner-only; deletes the grant.
- Future extension (non-goal now): a sentinel `user_id = '00000000-…'` row meaning
  "everyone in the org" would re-introduce org-wide visibility without schema change.

## 7. Migration & back-fill

One ordered migration:

1. Create enum, `board_members`, helpers, new policies (drop old `is_org_member`-based
   read/write policies on **all 15 board-scoped tables** from §6a and recreate them on
   `can_read_board` / `can_edit_board`), and add the `can_edit_board` guard to the 6 write
   RPCs in §6b.
2. **Back-fill:** for every existing board, insert an `editor` grant for **every current
   member of that board's org except `created_by`** (the creator already has owner access).
   `granted_by` = the board's `created_by`. This preserves today's "everyone sees
   everything" for pre-existing boards, so nothing vanishes at rollout. New boards created
   after the migration are private-by-default automatically.

Regenerate `src/types/database.types.ts` (`pnpm db:types`) and commit in the same PR.

## 8. Server / data layer

- **`listBoards()`** (sidebar) splits into the data for two sections, both RLS-safe and
  bounded by indexes:
  - `myBoards`: `created_by = me` (+ a `shared_out` boolean = exists any `board_members`
    row for that board).
  - `sharedWithMe`: boards with a `board_members` row for me where `created_by != me`,
    selecting the owner's display name for the "from {owner}" label.
- **`getBoardPayload()`** is unchanged in shape — RLS now returns `null` for boards the
  user can't read (already its "not visible" contract).
- New server actions in `src/lib/boards/sharing-actions.ts`: `shareBoard`, `unshareBoard`,
  `setBoardAccess` — Zod-validated (`src/lib/validations/board-sharing.ts`), owner-gated,
  call the RPCs, then targeted `revalidatePath`.
- Board read access in the page also exposes the viewer's effective access level so the UI
  can render read-only for viewers (hide edit affordances; RLS is still the real guard).

## 9. UI

### Share dialog (board header)

- Owner-only "Share" button → dialog: list current org members (reuse `listOrgMembers`),
  each with a None / Viewer / Editor control; shows current grantees; empty-state links to
  Settings → invite. Built with `pulse-ui` + `frontend-design` skills.

### Sidebar (`BoardsNav`)

```
BOARDS                         + New board
  My boards
    Roadmap            (shared-out glyph)
    Personal tasks
  Shared with me
    Q3 Launch          · from Dana   (viewer → subtle read-only hint)
```

- **Shared-out indicator** on owned boards with ≥1 grant (requirement #1).
- **"Shared with me"** section listing boards others granted me, with owner name
  (requirement #2). Hidden when empty.
- Read-only (viewer) boards get a subtle hint; editors look like owned boards.

## 10. Performance & data-fetching budget

- **First paint:** sidebar = two indexed reads (`myBoards`, `sharedWithMe`); board page =
  the existing batched payload. No N+1; `board_members` lookups are index-backed and the
  read helper is `STABLE` (one evaluation per statement, not per row).
- **Interactions:** the only new server round-trips are share/unshare/set-access — all
  **mutations of server data**, so Server Action + targeted revalidation is correct (per
  AGENTS.md §5). In-board view/tab/filter toggles are untouched → still 0 round-trips.
- **Bounded:** sidebar reads are naturally small (a user's own + shared boards); no
  unbounded `select *` on a growing table.

## 11. Testing

- **RLS (integration, Vitest + Supabase):** a non-shared member **cannot** read a private
  board's rows on **any of the 15 board-scoped tables** (§6a — including comments,
  attachments, time entries, activity, automations); a viewer can read but **cannot** write
  (direct DML **and** via the 6 hardened RPCs in §6b); an editor can write; an owner/admin
  with no grant **cannot** read another member's private board; cross-org access still
  denied. This is the security core — most test weight here, split per table family so the
  suites run as parallel tasks.
- **Migration:** after back-fill, a second org member can still read a pre-existing board.
- **Actions:** `shareBoard`/`unshareBoard` owner-gating; non-owner rejected; target must be
  an org member; Zod boundary validation.
- **UI:** sidebar renders both sections + indicator; viewer sees read-only board (edit
  affordances hidden); share dialog grant/revoke flow.
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## 12. Execution DAG (parallelization plan)

**Tasks** (the implementation plan refines these; IDs match the plan)

1. **DB + RLS migration (TDD root):** enum, `board_members`, `can_read_board` /
   `can_edit_board` helpers, SELECT+write policy rewrite on all 15 tables (§6a), the 6 RPC
   guards (§6b), `share_board`/`unshare_board` RPCs, back-fill, regen types — driven by the
   core RLS integration suite. _(Produces: schema, types, RPC signatures.)_
2. **Sharing server actions + validations** (`sharing-actions.ts`,
   `validations/board-sharing.ts`). _(Consumes: T1 RPCs/types.)_
3. **`listBoards` split** → `listMyBoards` / `listSharedBoards` + `getBoardAccess`.
   _(Consumes: T1 types.)_
4. **Share dialog UI** (`ShareBoardDialog`). _(Consumes: T2 action contract — mockable.)_
5. **Sidebar restructure** + indicators. _(Consumes: T3 query contract — mockable.)_
6. **Satellite-table RLS test suites** (one file per family: views/links, collaboration,
   time, automations). _(Consumes: T1.)_
7. **Integration wiring + verification gate:** board page passes effective access + Share
   button; layout feeds split board lists to the sidebar; full gate. _(Consumes: T2–T6.)_

**Dependency graph:** T1 → {T2, T3, T4, T5, T6} → T7. T4 depends only on T2's documented
action signatures and T5 only on T3's documented query shapes (both fixed in the plan), so
they need no implementation from T2/T3 and join the same wave; they mock the server layer
in component tests.

**Parallel batches:**

- **Wave 1:** T1 (sole critical-path root — the migration + core RLS suite).
- **Wave 2 (5-wide, concurrent):** T2 ∥ T3 ∥ T4 ∥ T5 ∥ T6. Disjoint files (T2/T3 in
  `lib/boards`, T4/T5 in `components`, T6 in test files) → dispatch via
  `superpowers:dispatching-parallel-agents` in isolated worktrees per AGENTS.md #6.
- **Wave 3:** T7 wiring + `pnpm typecheck && lint && test && build`.

**Critical path (wall-clock floor):** T1 → (slowest of T2/T3/T4/T5/T6) → T7.
