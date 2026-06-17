# Collapsible sidebar — design

**Date:** 2026-06-17
**Status:** Approved (design), ready for implementation plan
**Topic:** Collapse the desktop app-shell sidebar to an icon rail, persisted, with a ⌘\ shortcut

## Summary

Make the desktop sidebar (`AppShell`'s `<aside>`) collapsible to a slim **icon rail** (~56px):
labels hide, icons remain, names surface as hover tooltips. State is **persisted** across reloads
and toggled by a footer button or \*\*⌘\*\* (Ctrl+\ on Windows). Mobile is unaffected (the sidebar is
already hidden below `md`; the mobile topbar brand is unchanged).

Chosen interactively: icon rail (not full off-canvas hide) + persist + ⌘\ shortcut.

## Decisions (locked)

| Aspect          | Decision                                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| Collapse style  | Icon **rail** — expanded `w-60` ⇄ collapsed `w-14`; labels hidden, tooltips on  |
| Toggle          | `PanelLeft` button at the sidebar footer + \*\*⌘\*\* shortcut + click           |
| Persistence     | localStorage via Zustand `persist` (only `sidebarCollapsed`)                    |
| Hydration       | server + first client paint render expanded; persisted value applies post-mount |
| Animation       | `transition-[width] duration-200 ease-out`, suppressed on first paint           |
| Scope           | Desktop (`md+`) sidebar only; mobile topbar unchanged                           |
| Workspaces list | Hidden when collapsed (secondary)                                               |

## Architecture

### State — `src/stores/ui.ts`

Extend the existing Zustand `useUIStore` with:

```ts
sidebarCollapsed: boolean;          // default false
setSidebarCollapsed(v: boolean): void;
toggleSidebar(): void;
hasHydrated: boolean;               // set true after persist rehydrates
```

Wrap the store in `persist` (from `zustand/middleware`), `name: "pulse-ui"`, `partialize` to persist
only `sidebarCollapsed`, and set `hasHydrated` in `onRehydrateStorage`. `commandOpen` stays
in-memory (not persisted). The `hasHydrated` flag lets the UI render the server-safe default
(expanded) on first paint, then apply the stored value — no hydration mismatch, no flash.

### Components

- **New `src/components/sidebar.tsx`** (`"use client"`) — owns the desktop sidebar, replacing the
  inline `<aside>` block in `AppShell`. Responsibilities: subscribe to `sidebarCollapsed` +
  `hasHydrated`; render expanded (`w-60`) or rail (`w-14`); render `Brand`, the main nav, the
  `Workspaces` list (expanded only), `BoardsNav`, and the footer toggle; register the \*\*⌘\*\*
  global key listener (toggles via the store); wrap icon-only controls in `Tooltip` when collapsed.
  Props: `boards`, `workspaces`. One clear purpose: the collapsible nav frame.
- **`Brand`** — moves into `sidebar.tsx`, exported, gains `collapsed?: boolean`: the `MonolithMark`
  always renders; the `MONOLITH` wordmark is hidden when collapsed. `AppShell` imports `Brand` for
  the mobile topbar (always expanded). Links to `/landing` (unchanged).
- **`BoardsNav` (`src/components/boards/BoardsNav.tsx`)** — gains `collapsed?: boolean`. Collapsed:
  the "Boards" header becomes the `FolderKanban` icon (tooltip "Boards"); the "New board" trigger
  stays as an icon `Button` (tooltip; dialog unchanged); each board renders as an **initial badge**
  (first character) with a `Tooltip` of its full name; `aria-current` active state preserved.
  Expanded: unchanged.
- **`AppShell` (`src/components/app-shell.tsx`)** — replace the inline `<aside>…</aside>` with
  `<Sidebar boards={…} workspaces={…} />`; keep the mobile topbar using the shared `Brand`. The
  static `nav` array moves into `sidebar.tsx`.

### Toggle + shortcut

A `PanelLeft` (lucide) ghost `Button` pinned at the sidebar footer (`mt-auto`), `aria-label`
("Collapse sidebar" / "Expand sidebar") and `aria-expanded`, with a tooltip showing the ⌘\ hint.
The same button expands from the rail. A `keydown` listener (registered in `Sidebar`) toggles on
`(metaKey || ctrlKey) && key === "\\"`, `preventDefault`.

## Data flow & performance budget

Collapsing is **pure ephemeral client state**: **0 server round-trips**, no `<Link>`/router
navigation, no RSC re-run, no data refetch — exactly the in-page-state rule in `AGENTS.md`
(client state, not navigation). No server data is read or written. Persistence is localStorage only.

## Accessibility

- Toggle is a real `<button>`, keyboard-reachable, with `aria-label` + `aria-expanded` and a visible
  `focus-visible` ring.
- In the rail, every icon-only control has an accessible name (tooltip content + `aria-label`/
  `sr-only`), so screen readers still announce "Boards", board names, and nav labels.
- ⌘\ shortcut supplements (never replaces) the click control.
- Width animation respects the global `prefers-reduced-motion` handling.

## Testing (Vitest + RTL)

1. **`ui.ts` store** — `sidebarCollapsed` defaults to `false`; `toggleSidebar` flips it;
   `setSidebarCollapsed(true)` sets it.
2. **`sidebar.tsx`** — renders the `MONOLITH` brand and nav; clicking the toggle flips the store and
   hides the text labels (rail); pressing \*\*⌘\*\* toggles; the toggle exposes `aria-expanded` and the
   collapsed nav items keep accessible names.
3. **`BoardsNav`** — collapsed: a board renders with its initial and an accessible name equal to the
   board name, and the "Boards" text label is not shown; expanded behavior unchanged.
4. **`app-shell`** — existing brand + children tests stay green with `Sidebar` embedded.

## Out of scope (YAGNI)

- No mobile drawer / off-canvas sidebar (separate concern).
- No resizable/drag-to-width sidebar — fixed two states only.
- No per-board custom icons — initials in the rail.
- No server-persisted preference — localStorage only.

## Verification gate

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green; manual check that collapse,
tooltips, ⌘\, and persistence (survives reload) work in the running app.
