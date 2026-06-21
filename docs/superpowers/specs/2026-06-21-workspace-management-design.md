# Workspace management (create / rename / delete) — design

**Date:** 2026-06-21
**Status:** Approved (spec)

## Problem

Workspaces (org-scoped containers for boards/dashboards) are auto-created once during
onboarding (the default "Main" workspace) and then rendered **read-only** in the sidebar
as plain `<span>` text (`src/components/sidebar.tsx:155-169`). There is no user-facing way
to create, rename, or delete a workspace, even though the RLS policies already permit these
operations. Stray/test workspaces (e.g. "verify WS") cannot be cleaned up from the product.

## Goal

Add full workspace management — **create, rename, delete** — surfaced in the sidebar's
existing "Workspaces" section, following established repo patterns (column menu, board-title
rename, type-to-confirm user delete).

## Access model (RLS is the security boundary)

The existing policies in `supabase/migrations/20260614174043_init_auth_tenancy.sql` already
define who may do what — the UI only reflects this; it does not enforce it:

- **Read** — any org member (`workspaces: read if member`).
- **Create (insert)** — any org member, with `created_by = auth.uid()` (`workspaces: insert if member`).
- **Rename (update)** — any org member (`workspaces: update if member`).
- **Delete** — **owner/admin only** (`workspaces: delete if owner/admin`).

UI consequence: the ⋯ menu always offers **Rename**; **Delete** renders only for owners/admins.
RLS remains the real boundary — a non-admin who bypasses the UI still gets denied at the DB.

## Scope

In the sidebar "Workspaces" section:

1. **Create** — a `+` button beside the "Workspaces" label opens a small name dialog.
2. **Rename** — chosen from a per-workspace `⋯` hover menu; swaps the row into an inline
   editable field (Enter commits, Escape cancels, blur commits) — mirrors `BoardHeader` /
   `ColumnHeader` inline rename.
3. **Delete** — chosen from the `⋯` menu (owner/admin only); opens a **type-to-confirm**
   dialog that warns about cascade. **Deleting the org's last workspace is blocked.**

Out of scope: moving boards between workspaces, per-workspace settings pages, workspace
sharing/permissions beyond existing org membership.

## Components (each small, single-purpose)

| File                                                   | Type         | Responsibility                                                                             |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------ |
| `src/lib/validations/workspace-actions.ts`             | new          | Zod schemas at the boundary                                                                |
| `src/lib/workspaces/actions.ts`                        | new          | `createWorkspace`, `renameWorkspace`, `deleteWorkspace` Server Actions                     |
| `src/components/workspaces/WorkspaceNavItem.tsx`       | new (client) | One workspace row: name, hover `⋯` menu, inline rename, delete dialog                      |
| `src/components/workspaces/NewWorkspaceDialog.tsx`     | new (client) | `+` create dialog                                                                          |
| `src/components/sidebar.tsx`                           | edit         | Replace read-only `<span>` list with `WorkspaceNavItem`s + create button; thread role flag |
| layout(s) feeding `AppShell` (`src/app/**/layout.tsx`) | edit         | Pass `isOrgAdmin` + workspace count to `AppShell` → `Sidebar`                              |

### Zod schemas (`workspace-actions.ts`)

```ts
const name = z.string().trim().min(1).max(100);
const uuid = z.string().uuid();

export const createWorkspaceSchema = z.object({ name });
export const renameWorkspaceSchema = z.object({ workspaceId: uuid, name });
export const deleteWorkspaceSchema = z.object({ workspaceId: uuid });
```

`name` matches the DB check constraint (`char_length(name) between 1 and 100`).

### Server Actions (`actions.ts`) — repo conventions

`"use server"`; `.safeParse()` with `fail(parsed.error.issues[0]?.message ?? "Invalid")`;
return the shared `ActionResult<T>` discriminated union; `revalidatePath("/", "layout")` on
success (workspaces appear in the root layout sidebar). No explicit auth check — RLS enforces.

- **`createWorkspace({ name })`** — derive `org_id` **server-side** from the caller's org
  membership (do **not** accept `org_id` from the client); insert
  `{ org_id, name, created_by: auth.uid() }`. Revalidate.
- **`renameWorkspace({ workspaceId, name })`** — `update({ name }).eq("id", workspaceId)`;
  RLS gates it. Revalidate.
- **`deleteWorkspace({ workspaceId })`** —
  1. **Last-workspace guard:** count workspaces in the caller's org; if `≤ 1`, return a
     friendly failure ("You can't delete your only workspace.").
  2. **Storage cleanup:** workspace delete cascades board/dashboard/item/cell rows in the DB
     (`boards.workspace_id … on delete cascade`, etc.), but attachment **Storage objects do
     not cascade**. Gather `storage_path` for every attachment whose board belongs to this
     workspace (select board ids in the workspace, then attachments by `board_id`), then call
     `removeAttachmentObjects(...)` — same approach as the existing `deleteBoard` action.
  3. Delete the workspace (`delete().eq("id", workspaceId)`); RLS gates to owner/admin.
  4. Revalidate.

## Data flow

- **First paint:** unchanged round-trips. The workspace list is already loaded by the
  layout; we extend that same query to also yield the caller's org role and the workspace
  count. No new fetch on render.
- **Interactions** (create / rename / delete) all change **server data** → Server Action +
  `revalidatePath("/", "layout")` to refresh the sidebar. These are _not_ in-page view
  toggles, so RSC revalidation is the correct tool (per the working agreement).

## Data-fetching & performance budget (working agreement rule #5)

- (a) **First paint vs interaction:** workspace list loads once with the layout; no new
  server round-trips are added on first paint. Each management action is an explicit
  mutation, not a passive toggle.
- (b) **Server data vs client state:** all three operations mutate server data → Server
  Action + targeted `revalidatePath("/", "layout")`. No client-state/History-API path
  applies here.
- (c) **Bounded + indexed:** the hot-path read is the existing small, org-scoped workspace
  list, filtered on the `org_id`-indexed column — bounded by construction (workspaces per org
  are few). The delete-time attachment lookup is bounded to a single workspace's boards and
  runs only on an explicit destructive click — not a hot path.

## Error handling

`ActionResult<T>` union (`{ ok: true; data } | { ok: false; error }`) with friendly messages:

- last-workspace guard,
- permission denial (RLS) surfaced as a readable message,
- name validation (empty / too long).

Errors render inside the dialogs as `role="alert"` text, matching
`src/components/admin/user-row-actions.tsx`.

## Testing

- **Action unit tests** (Vitest, mocked Supabase client):
  - `createWorkspace` derives `org_id` server-side and ignores any client-supplied org;
  - validation failures (empty / overlong name, bad uuid);
  - `deleteWorkspace` last-workspace guard returns failure when count ≤ 1;
  - `deleteWorkspace` gathers attachment storage paths and calls `removeAttachmentObjects`;
  - success paths return `{ ok: true }`.
- **Component tests** (Testing Library):
  - delete "Delete permanently" stays disabled until the typed name matches the workspace;
  - **Delete** action is not rendered for non-admins;
  - rename commits on Enter and cancels on Escape.

Definition of done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## Independent units (for the plan's execution DAG)

- **U1 — Zod schemas** (`workspace-actions.ts`): no dependencies.
- **U2 — Server Actions** (`actions.ts`): consumes U1.
- **U3 — Role/count plumbing** (layout → `AppShell` → `Sidebar` props): independent of
  U1/U2; can run in parallel with them.
- **U4 — UI components** (`WorkspaceNavItem`, `NewWorkspaceDialog`): consumes U2 (actions)
  and U3 (role flag).
- **U5 — Sidebar wiring** (`sidebar.tsx`): consumes U3 + U4.
- **U6 — Tests:** action tests consume U2; component tests consume U4.

The plan will turn this into a dependency graph + parallel batches + critical path.
