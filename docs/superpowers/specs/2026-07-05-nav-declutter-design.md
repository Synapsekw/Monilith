# Navigation declutter — grouped sidebar, top workspace switcher, top-right platform admin

**Date:** 2026-07-05
**Status:** Approved (brainstorming, **Direction B**) — ready for implementation plan. Switcher confirmed as **Option 1 (scoping)**.
**Design exploration:** interactive mockup of 3 directions (A · Tidy / B · Grouped / C · Dual-rail); user selected **B**.

## Problem

The authenticated sidebar (`src/components/shell/sidebar-nav.tsx`) reads as a wall of items. Concretely:

1. **Two unbounded dynamic lists stack at full height.** Boards and Dashboards each render their entire
   list, and both are **flattened across every workspace** — `sidebar-nav-data.tsx` loads
   `listMyBoardsCached(userId)` and `listDashboardsCached(orgId)` with **no workspace filter**, even though
   `boards.workspace_id` and `dashboards.workspace_id` are `NOT NULL` columns. The lists only grow.
2. **Six static items + a Workspaces management list + a Platform-admin group** sit below those two lists,
   with no visual grouping to let the user collapse what they don't need.
3. **"Workspaces" is a flat management list, not a switcher** (`WorkspaceNavItem` — rename/delete/new), placed
   low in the rail. It doesn't switch context; the app implicitly uses `orgs[0]` everywhere.
4. **A dead "Inbox" placeholder** — a disabled item with no `href` (`sidebar-nav.tsx:42`).
5. **Platform admin is reachable two ways** — the bottom-of-rail `PlatformNav` group _and_ the user menu
   (`user-menu.tsx`) — duplication with no single home.
6. **Two admin surfaces are easy to confuse** — platform super-admin (`/admin`) vs org admin (Settings tabs).

## Goals

- A **decluttered, grouped sidebar** (Direction B): labelled, collapsible sections so the long lists can be
  folded away; dead items removed.
- A **workspace switcher pinned to the top** that **scopes the Boards + Dashboards lists to the active
  workspace** — the honest meaning of a switcher, and the single biggest reduction in list length.
- **One home for platform admin:** a dedicated **top-right button** (visible only to platform admins),
  removed from both the sidebar and the user menu.
- **Remove the dead "Inbox".**

## Non-goals (v1)

- Direction **C (dual-rail)** — parked; B ships first.
- **Multi-org / org switcher.** Still single org (`orgs[0]`). The switcher switches _workspaces within the org_.
- **Scoping Goals / Portfolios / Workload / My Time by workspace.** These are separate pages, not the cluttered
  sidebar lists. v1 scopes **only** the sidebar **Boards** and **Dashboards** lists. (`goals.workspace_id` is
  nullable; a later phase can scope it.)
- Virtualization of the board/dashboard lists. Workspace scoping already bounds them; revisit only if a single
  workspace routinely exceeds a few dozen boards.
- Retheming per workspace (the `--brand` override hook exists but is out of scope here).

## Decisions (locked in brainstorming)

| Question                                 | Decision                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Overall direction                        | **B · Grouped** — single rail, labelled collapsible sections                                 |
| Workspaces placement                     | **Switcher pinned to the top of the sidebar**                                                |
| Workspace management (rename/delete/new) | Moves **into the switcher dropdown** (+ Settings for the full console)                       |
| Dead "Inbox"                             | **Removed**                                                                                  |
| Platform admin                           | **Single top-right button**; removed from sidebar `PlatformNav` **and** the user menu        |
| Admin menu contents                      | Overview · Organizations · Users · Audit log · Feedback (with new-count badge) + SUPER badge |

## Switcher behavior — RESOLVED: Option 1 (scoping)

**Decision (2026-07-05): Option 1.** The switcher scopes the sidebar Boards + Dashboards lists to the active
workspace. Option 2 is recorded below only for context.

Because `boards`/`dashboards` are already `workspace_id`-scoped in the schema, the switcher _can_ be real. Two options were considered:

- **Option 1 — Scoping switcher (recommended).** Selecting a workspace filters the sidebar Boards + Dashboards
  lists to that workspace, and new boards/dashboards default to it. Biggest declutter, honest UX. Cost: introduce
  a persisted **active-workspace** (cookie, server-readable), filter the two nav loaders by it, and a small server
  action to switch. Switching changes server-data scope, so it's a **server action + targeted revalidation** (not
  an in-page toggle) — one refetch of the scoped nav lists per switch.
- **Option 2 — Management-only relocation (lighter).** The top control shows the current workspace and houses
  rename/delete/new, but the lists stay flattened across all workspaces. Fastest, lowest-risk, but a "switcher"
  that doesn't switch context — weaker UX and doesn't fix the unbounded-list clutter.

**Recommendation: Option 1** — the data supports it and it's the actual fix for problem #1. The rest of this
spec assumes Option 1; if we choose Option 2, drop the active-workspace cookie + loader filtering (unit **U5**)
and the switcher becomes selection-free management.

## Final information architecture (Direction B)

Sidebar, top → bottom:

```
┌──────────────────────────────┐
│ ◧ Product        ⇅  (switcher)│  ← WorkspaceSwitcher (new)
├──────────────────────────────┤
│ ▸ My Work                     │  singleton, top
│                               │
│ PLANNING            ▾         │  collapsible group
│   ◎ Goals                     │
│   ▥ Portfolios                │
│   ◔ Workload                  │
│                               │
│ BOARDS            ▾   +       │  collapsible, scoped to active ws
│   ▤ Q3 Roadmap  …             │
│   ▤ Bug Triage  …             │
│   Shared with me              │
│     ▤ Design System  ◉        │
│                               │
│ DASHBOARDS        ▾   +       │  collapsible, scoped to active ws
│   ▦ Exec Overview …           │
│                               │
│ PERSONAL          ▾           │  collapsible
│   ◷ My Time                   │
└──────────────────────────────┘
```

- **Removed from the rail:** dead "Inbox"; the old bottom `PlatformNav` group; the inline "Workspaces"
  management list (its actions move into the switcher dropdown).
- **Per-group collapse state persists** in `useUIStore` (client-only, like `sidebarCollapsed`).

Top bar (`app-shell.tsx` header → `header-user-data.tsx`), right side, left → right:

```
[Search ⌘K]  … · · ·  [🛡 Admin ▾]  [🔔]  [📣]  [☾]  [DJ ▾]
```

- **New: `PlatformAdminMenu`** button (shield) — rendered only when `isPlatformAdmin`; dropdown lists the five
  admin destinations + Feedback badge, headed by a SUPER badge.
- **`user-menu.tsx`: remove the "Platform admin" item** (now solely the top-right button). Keeps Settings +
  Sign out (Theme optional — see open Q3).

## Component & file changes

**New components**

- `src/components/shell/workspace-switcher.tsx` (client) — current workspace + avatar; dropdown = workspace list
  (switch, Option 1) · Manage workspaces (→ `/settings`) · New workspace (reuses `NewWorkspaceDialog`).
- `src/components/shell/platform-admin-menu.tsx` (client) — top-right shield button + dropdown; gated on
  `isPlatformAdmin`.
- `src/components/shell/nav-section.tsx` (client) — reusable collapsible group (button + `aria-expanded`,
  chevron, optional `+` action slot); collapse state keyed in `useUIStore`.

**Edited**

- `sidebar-nav.tsx` — restructure into the IA above using `NavSection`; drop the `Inbox` entry from the static
  array; remove the inline Workspaces block and the bottom `PlatformNav`; mount `WorkspaceSwitcher` at the top.
- `sidebar-nav-data.tsx` — (Option 1) read active workspace, filter boards + dashboards by `workspace_id`; pass
  the active workspace + list into `WorkspaceSwitcher`.
- `src/lib/boards/queries*.ts` / `src/lib/dashboards/queries*.ts` — add a `workspaceId` filter variant to the
  cached list reads (indexed FK column).
- `app-shell.tsx` / `header-user-data.tsx` — mount `PlatformAdminMenu` in the header.
- `user-menu.tsx` — remove the Platform-admin item.
- `mobile-nav.tsx` — mirror the new structure (drawer parity).
- `src/stores/ui` — add per-group collapse keys (+ optional `activeWorkspaceId` if we prefer store over cookie;
  spec assumes **cookie** for server-readability).

**Retired usage**

- `PlatformNav.tsx` and `WorkspaceNavItem.tsx` are no longer mounted in the rail (kept in tree or deleted per the
  plan; the platform links live in `PlatformAdminMenu`, management lives in the switcher/Settings).

**New (Option 1)**

- `pulse_active_ws` cookie + `setActiveWorkspace` server action (sets cookie, `revalidatePath("/", "layout")`
  or targeted revalidate, so the streamed sidebar re-renders scoped).

## Data-fetching budget (working-agreement rule #5)

| Interaction                              | Changes server data?          | Mechanism                                                                                             | Round-trips                 |
| ---------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------- |
| First paint                              | —                             | sidebar Suspense-streams **workspace-scoped** boards/dashboards (bounded, not all-workspace)          | baseline (already streamed) |
| Collapse / expand a section              | No                            | client state, persisted in `useUIStore`                                                               | **0**                       |
| Open admin / user / bell / feedback menu | No                            | client popovers                                                                                       | **0**                       |
| **Switch workspace**                     | **Yes** (which data is shown) | `setActiveWorkspace` server action → set cookie → targeted revalidate → RSC re-render of scoped lists | **1** (sanctioned)          |
| New board/dashboard                      | Yes (create)                  | existing Server Action, defaulted to active workspace                                                 | existing                    |

Hot-path reads become **bounded by workspace** over the **indexed** `workspace_id` FK — a net reduction vs.
today's flattened all-workspace lists.

## Accessibility

- Switcher and admin button: keyboard-reachable, `aria-expanded`, visible `focus-visible` ring; icon-only admin
  button carries an `aria-label`. SUPER badge is decorative (`aria-hidden`), meaning carried by the text.
- `NavSection` header is a `<button aria-expanded>`; collapsed content is removed from the a11y tree.
- Active nav item conveys state with weight + a brand indicator bar (not color alone).

## Independent units (for the plan's execution DAG — rule #6)

- **U1 — `NavSection`** collapsible primitive + `useUIStore` per-group collapse. _Deps: none._
- **U2 — `WorkspaceSwitcher`** + active-workspace cookie + `setActiveWorkspace` action. _Deps: none (UI); U5 consumes its active value._
- **U3 — `PlatformAdminMenu`** (top-right) + remove admin item from `user-menu.tsx`. _Deps: none._
- **U4 — `sidebar-nav.tsx` restructure** into B groups; drop Inbox; unmount old Workspaces/PlatformNav. _Deps: U1, U2._
- **U5 — nav-data + query filtering** by active workspace (Option 1 only). _Deps: U2._
- **U6 — `mobile-nav.tsx` parity** + header mounts `PlatformAdminMenu`. _Deps: U1, U2, U3, U4._

**Parallel batches:** Batch 1 = {U1, U2, U3} · Batch 2 = {U4, U5} · Batch 3 = {U6}. Critical path: U2 → U5/U4 → U6.

## Testing (rule #4 — written and executed)

- **Unit (Vitest):** `NavSection` toggles + persists collapse; `PlatformAdminMenu` renders only when
  `isPlatformAdmin` (true/false); `user-menu` no longer renders a Platform-admin item; `WorkspaceSwitcher`
  selection calls `setActiveWorkspace`; nav-data filters boards/dashboards by active workspace (Option 1).
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- **Manual walkthrough** (delivered on merge): switch workspace → lists rescope; collapse sections; admin button
  visible as super-admin and absent when toggled off; no duplicate admin entry point.

## Open questions for review

1. ~~Switcher behavior~~ — **RESOLVED: Option 1 (scoping).**
2. Confirm v1 scopes **only** Boards + Dashboards (not Goals/Portfolios/Workload). (Assumed: yes.)
3. Keep a "Theme" item inside the user menu, or rely solely on the header theme toggle? (Default: header toggle
   only — matches today; no Theme item in the user menu.)
