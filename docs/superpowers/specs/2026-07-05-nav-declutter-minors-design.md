# Nav-declutter Minors — Design Spec

**Date:** 2026-07-05
**Status:** Awaiting review
**Source:** `vault/sessions/2026-07-05-1456-nav-declutter-direction-b.md` → "Deferred Minors"
**Relates:** `docs/superpowers/specs/2026-07-05-nav-declutter-design.md`

## Purpose

Four small, reviewer-approved follow-ups deferred from the nav-declutter (Direction B) work. Each
is a self-contained cleanup: kill a redundant server round-trip, delete dead component plumbing,
finish an a11y detail, and backfill missing test coverage. No user-facing behavior changes — this
is hygiene + coverage, verified by the test suite.

## Grounding — confirmed against the worktree

Every item was located and confirmed to still exist (none already resolved), with one nuance on
item 3 (partially done — see below).

| #   | Item                                           | Primary file(s)                                                                                                                                  | Status                                |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 1   | Redundant `countNewFeedback` in sidebar loader | `src/components/shell/sidebar-nav-data.tsx`, `src/components/shell/sidebar-nav.tsx`                                                              | Confirmed dead round-trip             |
| 2   | Dead `WorkspaceSwitcher.isOrgAdmin`            | `src/components/shell/workspace-switcher.tsx`, `src/components/shell/sidebar-nav.tsx`, `src/components/shell/sidebar-nav-data.tsx`, `*.test.tsx` | Confirmed dead prop chain             |
| 3   | `NavSection` a11y polish                       | `src/components/shell/nav-section.tsx`                                                                                                           | Partially done — one real gap remains |
| 4   | Dashboards workspace-filter test               | `src/lib/dashboards/queries-cached.test.ts`                                                                                                      | Confirmed missing coverage            |

---

## Item 1 — Remove the redundant `countNewFeedback` query from the sidebar loader

### What's wrong

`getSidebarNavData()` (`sidebar-nav-data.tsx`) computes admin/feedback data that `SidebarNav` no
longer consumes. After Direction B moved Platform admin into the header (`PlatformAdminMenu` in
`HeaderUserData`), the sidebar's copy became dead:

```ts
// sidebar-nav-data.tsx (current)
const [boards, sharedBoards, dashboards, platformAdmin, orgAdmin] =
  await Promise.all([
    listMyBoardsCached(userId, activeWorkspaceId),
    listSharedBoardsCached(userId),
    listDashboardsCached(orgId, activeWorkspaceId),
    isPlatformAdminCached(userId), // (1) now only gates the dead count
    isOrgAdminCached(userId, orgId), // (item 2)
  ]);
const newFeedbackCount = platformAdmin ? await countNewFeedback() : 0; // (1) redundant round-trip
return {
  boards,
  sharedBoards,
  workspaces,
  activeWorkspaceId,
  dashboards: dashboards.map((d) => ({ id: d.id, name: d.name })),
  isPlatformAdmin: platformAdmin, // unused by SidebarNav
  isOrgAdmin: orgAdmin, // (item 2) unused by SidebarNav
  newFeedbackCount, // unused by SidebarNav
};
```

`SidebarNav` declares `isPlatformAdmin?`, `isOrgAdmin?`, `newFeedbackCount?` in its props type but
**destructures none of them** — the only prop passed onward is `isOrgAdmin` (item 2). The
`HeaderUserData` component runs its **own** `isPlatformAdminCached` + `countNewFeedback` for the
header shield badge, so the sidebar's `countNewFeedback` is a second, wholly-redundant Supabase
round-trip on every authenticated page load (both desktop `SidebarNavData` and mobile
`MobileNavData` call `getSidebarNavData`).

### Fix

Delete the platform-admin/feedback plumbing from the loader and the `SidebarNav` prop type:

- Remove imports: `countNewFeedback` (`@/lib/feedback/queries`), `isPlatformAdminCached`
  (`@/lib/platform/guard`).
- Remove `platformAdmin` from the `Promise.all` and the `newFeedbackCount` line.
- Drop `isPlatformAdmin` and `newFeedbackCount` from the returned object.
- Remove `isPlatformAdmin?` and `newFeedbackCount?` from `SidebarNav`'s props type
  (`sidebar-nav.tsx`). `MobileNav` and `MobileNavData` inherit the type via
  `ComponentProps<typeof SidebarNav>`, so they update automatically — no edits there.

`countNewFeedback` in `@/lib/feedback/queries` stays (still used by `HeaderUserData` and the
feedback admin page). We are only removing the sidebar's redundant call.

**Note (shared file):** items 1 and 2 both edit `sidebar-nav-data.tsx` and `sidebar-nav.tsx`, so
they are executed as one atomic task (see Execution DAG). The `Promise.all` in the loader is
rewritten once, dropping both `isPlatformAdminCached` and `isOrgAdminCached`.

---

## Item 2 — Remove the dead `WorkspaceSwitcher.isOrgAdmin` prop and its plumbing

### What's wrong

`WorkspaceSwitcher` declares `isOrgAdmin?: boolean` in its props type but never destructures or
uses it. It is threaded through three layers, all dead:

1. `getSidebarNavData` computes `orgAdmin = await isOrgAdminCached(userId, orgId)` and returns it as
   `isOrgAdmin`.
2. `SidebarNav` receives `isOrgAdmin`, uses it **only** to pass `isOrgAdmin={!!isOrgAdmin}` to
   `WorkspaceSwitcher`.
3. `WorkspaceSwitcher` ignores it.

### Fix

Remove the whole chain:

- `workspace-switcher.tsx`: delete `isOrgAdmin?: boolean` from the props type.
- `sidebar-nav.tsx`: delete `isOrgAdmin?` from `SidebarNav`'s props type, remove `isOrgAdmin` from
  the destructure, and drop the `isOrgAdmin={!!isOrgAdmin}` line from the `<WorkspaceSwitcher>`
  call.
- `sidebar-nav-data.tsx`: remove `isOrgAdminCached` import, drop `orgAdmin` from the `Promise.all`,
  and drop `isOrgAdmin` from the returned object. (Combined with item 1, the `Promise.all` shrinks
  from five awaits to three: boards, sharedBoards, dashboards.)
- `workspace-switcher.test.tsx`: remove the `isOrgAdmin` prop from `renderSwitcher`'s JSX (line 26).
- `sidebar-nav-data.test.tsx`: the `@/lib/org/guard` and `@/lib/platform/guard` mocks
  (`isOrgAdminCached`, `isPlatformAdminCached`) become unused after items 1+2; remove those two
  `vi.mock` blocks so the test reflects the real (smaller) dependency set. The three existing
  assertions (boards / dashboards / workspaces render) are unaffected.

### Tradeoff considered

Could keep `isOrgAdmin` "in case a future menu item needs it." Rejected — YAGNI; the Settings →
Workspaces card already owns org-admin-gated management, and dead props are exactly the kind of
plumbing this cleanup exists to remove. Re-add it (typed, wired, tested) if/when a consumer appears.

---

## Item 3 — `NavSection` a11y: fix the dangling `aria-controls` reference

### What's already correct (do not redo)

`nav-section.tsx` already ships: `aria-expanded={open}`, `aria-controls={bodyId}`,
`aria-label={`${open ? "Collapse" : "Expand"} ${title}`}`, `type="button"` on the chevron, and
`id={bodyId}` on the body. Keyboard support (Enter/Space) is native to the `<button>`.

### The one real gap

The body is **conditionally unmounted**:

```tsx
{
  open ? (
    <div id={bodyId} className="flex flex-col gap-0.5">
      {children}
    </div>
  ) : null;
}
```

When the section is collapsed, `aria-controls={bodyId}` points at an element that **does not exist
in the DOM** — a dangling ARIA reference. Assistive tech announces a control for a region it cannot
locate.

### Fix

Always render the body element (so `aria-controls` always resolves) and toggle visibility with the
native `hidden` attribute:

```tsx
<div id={bodyId} hidden={!open} className="flex flex-col gap-0.5">
  {children}
</div>
```

`hidden` removes the region from the accessibility tree **and** from tab order when collapsed
(strictly better than `aria-hidden`, which would leave focusable children reachable). Collapsed
children render but are inert.

### Secondary gap (scope decision)

When `titleHref` is absent, the title is a **second** `<button>` that also toggles the section but
carries no `aria-expanded`/`aria-controls`. Decision: **add `aria-expanded={open}` and
`aria-controls={bodyId}` to the title toggle button** so both controls advertise the same state and
target. (When `titleHref` is present the title is a `<Link>` — a real navigation, not a toggle — and
correctly gets no toggle ARIA.) This is a one-line change and keeps the two toggle affordances
consistent.

### Testing

New `src/components/shell/nav-section.test.tsx`. `NavSection` reads collapse state from the real
`useUIStore` (persisted Zustand), so tests render the component and reset the store between cases.
Assertions:

- Default (no stored key) → `aria-expanded="true"`, body present and **not** `hidden`.
- The body element (`#nav-section-<key>`) is present in the DOM in **both** states (never
  unmounted).
- Clicking the chevron button flips `aria-expanded` to `"false"` and sets the body's `hidden`
  attribute.
- The title toggle button (no `titleHref`) carries `aria-expanded`/`aria-controls` matching the
  chevron.

Store isolation: reset `useUIStore` (e.g. `useUIStore.setState({ collapsedSections: {} })`) in a
`beforeEach` so per-key collapse state does not leak between tests.

---

## Item 4 — Test the `listDashboardsCached` workspace-filter path

### What's wrong

`listDashboardsCached(orgId, workspaceId?)` applies the workspace scope conditionally:

```ts
let query = supabase.from("dashboards").select("*").eq("org_id", orgId);
if (workspaceId) query = query.eq("workspace_id", workspaceId);
```

`queries-cached.test.ts` covers `orgId` filtering, the bound (`DASHBOARDS_LIMIT`), and the empty
case — but **not** the workspace scope. This is the exact path the nav's `WorkspaceSwitcher` relies
on to rescope Dashboards to the active workspace, and it is untested.

### Fix

Add two assertions to the `describe("listDashboardsCached", …)` block:

- With a `workspaceId` → the builder's `.eq` is called with `("workspace_id", <id>)` (in addition
  to `("org_id", <orgId>)`).
- Without a `workspaceId` → `.eq` is **never** called with `"workspace_id"`.

### Test-infra change (required)

The current mock cannot express a chained `.eq().eq()`:

```ts
const listEq = vi.fn(() => ({ order: orderForList })); // only supports ONE eq, then order
```

With a `workspaceId` the real chain is `.eq("org_id").eq("workspace_id").order().limit()`. Rework
the mock so the object `listEq` returns is a **chainable builder** exposing both `eq` (→ itself)
and `order` (→ `{ limit }`):

```ts
const limitForList = vi.fn();
const orderForList = vi.fn(() => ({ limit: limitForList }));
const listBuilder = {
  eq: undefined as unknown as ReturnType<typeof vi.fn>,
  order: orderForList,
};
const listEq = vi.fn(() => listBuilder);
listBuilder.eq = listEq;
const listSelect = vi.fn(() => ({ eq: listEq }));
```

(Exact wiring is in the plan.) The three existing `listDashboardsCached` tests continue to pass
unchanged: `select().eq("org_id").order().limit()` still resolves because the builder exposes
`order`. Assert workspace scoping via `listEq.mock.calls` (e.g.
`expect(listEq).toHaveBeenCalledWith("workspace_id", "w1")` and, for the negative case,
`expect(listEq).not.toHaveBeenCalledWith("workspace_id", expect.anything())`).

The `getWidgetAggregationCached` tests in the same file are untouched (separate mock paths:
`columns` / `rpc`).

---

## Non-goals / YAGNI

- No schema/migration changes; `database.types.ts` untouched.
- No visual redesign of the sidebar, switcher, or sections.
- No new features on `WorkspaceSwitcher` (`isOrgAdmin` is deleted, not repurposed).
- No integration/E2E tests — unit coverage over the existing Vitest mocks is sufficient for these
  cleanups.

## Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint:** item 1 removes one Supabase round-trip (`countNewFeedback`) per sidebar render
  (desktop + mobile) — a net reduction. No new fetches introduced anywhere.
- **Interactions:** unchanged. `NavSection` collapse remains 0 server round-trips (client Zustand);
  `WorkspaceSwitcher` switching still uses the existing `setActiveWorkspace` Server Action +
  `router.refresh` (server-data change — correct per rule #5). This spec adds nothing to either
  path.
- **Bounded reads:** `listDashboardsCached` stays bounded by `DASHBOARDS_LIMIT` over
  `dashboards_org_id_idx`; item 4 only adds test coverage of its existing `workspace_id` filter.

## Independent units (for the plan's Execution DAG)

- **Unit A (items 1 + 2):** sidebar loader + `SidebarNav` + `WorkspaceSwitcher` dead-plumbing
  removal. Items 1 and 2 **share** `sidebar-nav-data.tsx` and `sidebar-nav.tsx`, so they are **one
  atomic unit**, not two parallel ones.
- **Unit B (item 3):** `nav-section.tsx` a11y fix + new `nav-section.test.tsx`. Disjoint files.
- **Unit C (item 4):** `queries-cached.test.ts` only. Disjoint files.

Units A, B, C touch **disjoint** file sets and are parallel-safe. Ordering constraint: only the
two sub-items _inside_ Unit A must be serialized (same files); A/B/C have no cross-edges.
