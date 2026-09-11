# Sidebar Keystone polish — design

**Date:** 2026-09-11
**Status:** approved (owner picked "Option B — Keystone" from a four-way live gallery; the
prototype is committed next to this spec as `2026-09-11-sidebar-keystone-polish.prototype.html`
— open it in a browser, it renders from the real tokens and every hover/toggle is live)

## Why

The owner likes the sidebar's direction and asked for a polish pass over the whole package —
every element, expanded and collapsed, dark and light. A code audit of `src/components/sidebar.tsx`,
`src/components/shell/*`, `src/components/boards/{BoardsNav,PlainBoardRow,SharedBoardRow,BoardFolderRow}.tsx`
and `src/components/dashboards/DashboardsNav.tsx` (Chrome extension was down, so the baseline was
rebuilt 1:1 in the prototype from classes + `globals.css` tokens) found two defects and eight
grammar inconsistencies.

### Defects

1. **Active board / dashboard rows fail AA.** `PlainBoardRow`, `SharedBoardRow`, the sortable row,
   both `DashboardsNav` row variants and both collapsed letter-tile lists use
   `bg-primary/80 text-foreground`. In dark that is `#f4f4f6` on 80% `#8ea2eb` ≈ 2:1. The brand
   fill's only legal text is `text-primary-foreground` (near-black); the top-level links already use
   the correct Keystone active recipe (`bg-state-selected border-primary/40`).
2. **The desktop sidebar never scrolls.** Neither `<aside>` (`sidebar.tsx`) nor the nav body
   (`sidebar-nav.tsx`, `flex min-h-0 flex-1 flex-col`) has `overflow-y`. The mobile sheet does
   (`mobile-nav.tsx:51`). Twenty boards push Dashboards, Personal and Trash below the fold with no
   way to reach them.

### Grammar (polish)

| #   | Inconsistency                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 3   | Two active languages (links: tint + brand hairline; rows: solid brand fill) and two hover languages (links: hairline appears; rows: fill). |
| 4   | Three text left-edges: links 38px, board rows 32px, dashboard rows 20px; kickers at 34px.                                                  |
| 5   | Board rows `text-xs`, dashboard rows `text-sm`; dashboards `px-3`, boards a 24px grip slot.                                                |
| 6   | Org chip and workspace chip are identical twins, each `card-lift`ing 4px on hover (a card gesture on a nav control).                       |
| 7   | `Separator my-1` + `NavSection pt-2` + `nav pt-2` stack unevenly; some groups get a hairline, some don't.                                  |
| 8   | "Shared with me" is a plain `text-xs font-medium` paragraph between mono kickers — a third label style.                                    |
| 9   | "Personal" is a collapsible section wrapping one link; Trash floats below it ungrouped.                                                    |
| 10  | The collapsed rail has no grouping: bordered chips, icons and letter tiles run together.                                                   |

## Direction — "Keystone"

Keep the order, the parts and the data. Unify to **one row primitive, one active state, one hover,
one label style, one left edge**, then spend the brand where the Keystone system already lives:

- **Active = 3px periwinkle bar** flush to the sidebar's edge, plus the existing
  `bg-state-selected` tint. No hairline on rows. Works identically in the rail.
- **Section headers = ledger rules:** mono kicker, a hairline that runs to the actions, and a
  chevron that only shows on hover / when closed. The whole header toggles.
- **One context chip:** org as a mono kicker over the workspace name, one control, one menu.
- **Pinned footer:** My Time + Trash above a hairline, always reachable. The one-item "Personal"
  section goes away.
- **Hairlines brighten, never thicken; no lifts in the nav.** `card-lift` leaves the sidebar.

Out of scope: mobile drawer layout (it renders `SidebarNav forceExpanded` and inherits everything),
the header bar, the command palette, board/dashboard menus' contents, any data or RLS change.

---

## 1. `SidebarRow` — the one row primitive

New file `src/components/shell/sidebar-row.tsx` (client-free; plain markup). Every navigable row in
the sidebar renders through it: top-level links, Planning links, folder headers, owned / shared /
sortable board rows, dashboard rows, footer links.

```tsx
type SidebarRowProps = {
  /** Renders an <a> (next/link) when set; a <div> otherwise (rows that wrap their own control). */
  href?: string;
  active?: boolean;
  /** Child rows (boards, dashboards, folder contents): 28px tall, text-xs. Default 32px, text-sm. */
  child?: boolean;
  /** 24px lead slot. Icon for top-level rows, chevron for folders, grip for sortable rows,
   *  an inert spacer for plain rows. Always rendered so text edges never move. */
  lead?: ReactNode;
  /** Right-aligned trailing controls (count, shared-out icon, ⋯ menu). */
  trailing?: ReactNode;
  className?: string;
  children: ReactNode; // the label, truncated
} & (link | div passthrough props)
```

Recipe (Tailwind, tokens only):

- Container: `group/row relative flex items-center gap-1 rounded-md pl-0.5 pr-1 text-muted-foreground
transition-colors hover:bg-state-hover hover:text-foreground` + `min-h-8` (child: `min-h-7`).
- Lead slot: `flex size-6 shrink-0 items-center justify-center` (this IS the "24px leading slot"
  that `BoardsNav.test.tsx` "folder row alignment" already pins — same width, same contract as
  today's `leading` prop; the prop is renamed `lead` and the tests updated to the new prop name
  only).
- Label: `min-w-0 flex-1 truncate` + `text-sm` (child: `text-xs font-medium`).
- Active: `bg-state-selected text-foreground` and the bar:
  `before:absolute before:-left-2 before:top-1.5 before:bottom-1.5 before:w-[3px]
before:rounded-r-full before:bg-primary before:content-['']` (child rows use `before:top-1
before:bottom-1`). `-left-2` cancels the sidebar's `px-2` so the bar sits on the sidebar edge.
  `aria-current="page"` stays on the link.
- Trailing controls stay outside the label link (the shared-out icon / ⋯ contract from
  `BoardsNav.test.tsx:394` is unchanged). The ⋯ menu button keeps its `group-hover/row` reveal.

Resulting single text edge: 8 (sidebar `px-2`) + 2 + 24 + 4 = **38px** for every row. Section
kickers sit on the same edge via `pl-7.5` (§2).

Removed everywhere: `bg-primary/80`, `border-transparent hover:border-border` on links,
`duration-300 ease-[…]` color transitions on links (colors move at the default 150ms; only hairlines
and the ledger rule use `duration-300 ease-keystone`).

## 2. `NavSection` — ledger header

`src/components/shell/nav-section.tsx` keeps its API minus `icon` (Boards/Dashboards drop
`FolderKanban`/`LayoutGrid` from their headers; the kicker carries the section). Structure:

```
[ kicker ][ ───── rule (flex-1) ─────][ actions ][ chevron ]
```

- Wrapper: `flex flex-col gap-0.5 px-2 pt-3.5` (14px rhythm; the first group after the context chip
  uses `pt-2.5`). **All `<Separator>`s in `sidebar-nav.tsx` are deleted** — the rules and the 14px
  gap are the rhythm.
- Header row: `group/sec flex h-6.5 items-center gap-2 pr-1 pl-7.5` (kicker text edge = 38px).
  When there is no `titleHref` the whole row is the toggle `<button>` (`aria-expanded`,
  `aria-controls`, accessible name = title). With `titleHref` the kicker is the `<Link>` and the
  rule + chevron form the toggle button, as today.
- Rule: `h-px flex-1 bg-border transition-colors duration-300 ease-keystone
group-hover/sec:bg-border-bright`. Kicker brightens to `text-foreground` on hover (existing).
- Actions slot unchanged (`NewFolderDialog`, `NewBoardDialog`, dashboards `+` menu).
- Chevron: `size-5` at the end, `opacity-0 group-hover/sec:opacity-100 pointer-coarse:opacity-100`,
  and `opacity-100` while the section is closed; rotates `-rotate-90` when closed (200ms
  `ease-keystone`). One `ChevronDown` with a rotate, not two icons.
- Storage keys unchanged (`planning`, `boards`, `dash`) — `personal` is deleted.

**"Shared with me"** (`SharedBoardsSection.tsx`) becomes a sub-header in the same language:
`<Kicker size="xs">Shared with me</Kicker>` + rule, `mt-1.5 h-6 pl-7.5 pr-1`, not a paragraph.

**Folder row** (`BoardFolderRow.tsx`) renders through `SidebarRow child` with the chevron button in
`lead` (one disclosure, unchanged a11y contract), `FolderOpen`/`Folder` glyph then the name, and
count + `BoardFolderMenu` in `trailing`. The count becomes `font-mono text-3xs tabular-nums`.
`isOver` styling (drop target ring) is preserved via `className`.

## 3. `ContextSwitcher` — one chip

New `src/components/shell/context-switcher.tsx` replaces both `org-switcher.tsx` and
`workspace-switcher.tsx` (both files and their tests are deleted; `sidebar-nav.tsx` is the only
consumer).

Props: `orgs`, `activeOrgId`, `workspaces`, `activeWorkspaceId`, `collapsed`.

- Expanded trigger: `mx-2 mt-2 flex w-auto items-center gap-2.5 rounded-lg border bg-chrome-fill
px-2 py-1.5 text-left transition-colors duration-300 ease-keystone hover:border-border-bright
focus-visible:ring-2` — **no `card-lift`**. Avatar `size-7 rounded-md bg-primary/[0.18]
text-primary text-sm font-semibold` with the **workspace** initial. Text column: when
  `orgs.length > 1`, `<Kicker size="xs">` with the org name (truncate) above the workspace name;
  otherwise the workspace name alone, vertically centred. Workspace name `text-sm font-bold
truncate`. `ChevronsUpDown size-4 text-muted-foreground` at the end. `aria-label="Switch
workspace"`; when orgs > 1, `"Switch organization or workspace"`.
- Collapsed: `size-9` bordered chip with the workspace initial, tooltip `"{workspace} · {org}"`
  (org part only when orgs > 1), centred in the rail with `mt-2`.
- Menu (`DropdownMenuContent align="start" className="w-60"`): if orgs > 1 → label
  "Organization", one item per org (initial square + name + `Check` on active), separator; label
  "Workspaces", one item per workspace (same shape); separator; "New workspace" (opens the
  controlled `NewWorkspaceDialog`, unchanged); "Manage workspaces" → `/settings`.
- Behaviour is a straight move: `setActiveOrg` / `setActiveWorkspace` inside `startTransition`,
  then `router.refresh()`; no-op when the id is already active. Returns `null` when
  `workspaces.length === 0` (as `WorkspaceSwitcher` does today).

## 4. `SidebarNav` — scroll body, groups, footer

`src/components/shell/sidebar-nav.tsx`:

```
<ContextSwitcher … />
<div className="nav-scroll min-h-0 flex-1 overflow-y-auto" data-scroll-container>   ← scrolls
  [My Work, Agents]                       (group, pt-2.5)
  <NavSection Planning>                   (pt-3.5)
  <BoardsNav>                             (NavSection inside)
  <DashboardsNav>                         (NavSection inside)
</div>
<footer className="mx-2 border-t pt-2 pb-2">                                          ← pinned
  [My Time, Trash]                        (SidebarRow, text-sm)
</footer>
```

- `.nav-scroll` is a new utility in `globals.css` next to `.card-lift`:
  `mask-image: linear-gradient(to bottom, transparent, black 10px, black calc(100% - 14px), transparent)`
  so rows fade at both ends instead of clipping. `data-scroll-container` opts into the existing
  `scrollbar-gutter: stable` + hover-revealed thumb rules — nothing new for the scrollbar.
- The `PERSONAL` array and its `NavSection` are removed; `HOME`, `ASK`, `PLANNING`, `TRASH` stay
  as data; `MY_TIME` joins `TRASH` in a `FOOTER` array. `ALL_LINKS` (rail order) is rebuilt from
  groups (§5).
- `ExpandedLink` / `CollapsedLink` are replaced by `SidebarRow` (+ tooltip wrapper for the rail).
  `CoarseCaption` (gotcha-47) stays for the rail.
- `sidebar.tsx` frame: unchanged apart from the aside becoming `overflow-hidden` so only the body
  scrolls (brand row and footer stay put).

## 5. Collapsed rail

Same components, `collapsed` branch. Groups are separated by a **16px hairline**
(`<span aria-hidden className="my-1.5 h-px w-4 bg-border" />`):

```
[ws chip]  ─  [My Work, Agents]  ─  [Planning ×4]  ─  [Boards icon, + new board, board tiles…]
─  [Dashboards icon, dashboard tiles…]      …scrolls…      ─ footer: [My Time, Trash]
```

- Tiles: `size-9 rounded-md` (coarse: existing `pointer-coarse:` sizes), icon `size-4` or the
  uppercase initial `text-sm font-semibold`. Hover = `bg-state-hover text-foreground`; active =
  `bg-state-selected text-foreground` + the same `before:` bar (`-left-2`, `top-2 bottom-2`).
  `border-transparent hover:border-border` is removed from `CollapsedLink`.
- The dividers and the Boards / Dashboards head icons are rendered by `SidebarNav` (rail owner),
  not by `BoardsNav`/`DashboardsNav`; those keep rendering only their tiles when `collapsed`.
- The rail footer mirrors the expanded footer: `mt-auto`, hairline, My Time, Trash.

## 6. Motion & states summary

| State             | Recipe                                                          |
| ----------------- | --------------------------------------------------------------- |
| Row hover         | `bg-state-hover text-foreground`, 150ms                         |
| Row active        | `bg-state-selected text-foreground` + 3px `bg-primary` edge bar |
| Chip hover        | `border-border-bright`, 300ms `ease-keystone`, no transform     |
| Ledger rule hover | `bg-border` → `bg-border-bright`, 300ms `ease-keystone`         |
| Section chevron   | opacity on hover / when closed; `-rotate-90` closed, 200ms      |
| Reduced motion    | handled globally in `globals.css`; nothing added                |

Chrome stays monochrome; the only colour is the bar + tint (both `--brand`-derived) and the existing
`text-primary` avatar initials.

## Performance & data-fetching budget

- **First paint:** unchanged — the same `SidebarNavData` payload (boards, shared boards, folders,
  placements, workspaces, dashboards, orgs) streams into the same Suspense slot.
- **Interactions:** section fold, folder fold, sidebar collapse, hover/active — all client state in
  `useUIStore` (persisted), **0 server round-trips**, as today. Org/workspace switch — the same two
  Server Actions + `router.refresh()` as today (server data does change).
- **Hot-path reads:** none added; no new queries, no new columns.
- **Bundle:** `@dnd-kit` stays lazy (`BoardsNavSortable` untouched); `SidebarRow` is markup only.

## Tests (written and executed; Vitest + Testing Library)

- `sidebar-row.test.tsx` (new): renders `<a>` with `href` / `<div>` without; `aria-current` when
  active; active class set (`bg-state-selected`, `before:bg-primary`) and **never**
  `bg-primary/80`; lead slot always present (`size-6`) even when `lead` is omitted; `child` swaps
  size classes.
- `nav-section.test.tsx` (update): kicker still `text-kicker uppercase`; header is one toggle with
  `aria-expanded`/`aria-controls`; `titleHref` variant keeps a link + separate toggle; rule element
  present; chevron has `opacity-0` when open and not when closed; no `icon` prop.
- `context-switcher.test.tsx` (new, replaces `org-switcher.test.tsx` + `workspace-switcher.test.tsx`):
  returns null with no workspaces; single org → no org kicker, `aria-label="Switch workspace"`;
  multiple orgs → kicker with org name, both menu groups, selecting an org calls `setActiveOrg` and
  a workspace calls `setActiveWorkspace` (mocked) then `router.refresh`; selecting the active id is a
  no-op; "New workspace" opens the dialog; collapsed renders the `size-9` chip with tooltip text.
- `sidebar-nav.test.tsx` (update): the existing assertions (`Trash` href, active `My Work` has
  `bg-state-selected`, links present) plus: no `Personal` text; My Time and Trash are inside
  `<footer>`; the scroll body has `overflow-y-auto` and `data-scroll-container`; no `Separator`
  rendered; rail renders group dividers (count = 5) and the footer; the rail's active tile carries
  the bar class.
- `BoardsNav.test.tsx` / `BoardsNavSortable.test.tsx` (update): "folder row alignment" suite keeps
  passing with the `lead` prop name; active row has `bg-state-selected` and not `bg-primary/80`;
  "Shared with me" renders as a kicker (`text-kicker`), not `<p>`.
- `DashboardsNav.test.tsx` (update/new if absent): rows render through `SidebarRow child`
  (`text-xs`), active has the bar, empty state text unchanged.
- `globals.contrast.test.ts`: no change needed (no new colour tokens); a one-line grep guard in
  `scripts/check-hover-tokens.mjs` (or a new tiny vitest) asserts no file under
  `src/components/{shell,boards,dashboards}` pairs `bg-primary/80` with `text-foreground`.

## Execution DAG

| Task | Scope                                                                                                                                                                 | Consumes | Produces               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------- |
| T1   | `SidebarRow` primitive + tests                                                                                                                                        | —        | `sidebar-row.tsx`      |
| T2   | `NavSection` ledger header + `SharedBoardsSection` kicker + tests                                                                                                     | —        | new `NavSection` API   |
| T3   | `ContextSwitcher` + tests; delete the two old switchers                                                                                                               | —        | `context-switcher.tsx` |
| T4   | `sidebar-nav.tsx` + `sidebar.tsx`: scroll body, `.nav-scroll` utility, footer, rail groups, remove Personal/Separators                                                | T1, T3   | shell wiring           |
| T5   | Migrate `PlainBoardRow`, `SharedBoardRow`, sortable row, `BoardFolderRow`, `DashboardsNav` rows (+ collapsed tiles) to `SidebarRow`; kill `bg-primary/80`; grep guard | T1, T2   | rows on the primitive  |

- **Batch 1 (parallel):** T1, T2, T3 — disjoint files, no shared state.
- **Batch 2 (parallel):** T4, T5 — T4 touches `shell/sidebar-nav.tsx`, `sidebar.tsx`, `globals.css`;
  T5 touches `boards/*`, `dashboards/*`. Disjoint.
- **Critical path:** T1 → T5 (the row migration is the widest change). Two waves, then the whole
  branch is reviewed and `finish-task.sh` runs once.

One worktree (`task/sidebar-keystone`), subagents per task inside it, merges serialized by the
orchestrator as usual.

## How to test (closing walkthrough)

1. Pull `develop`, run `pnpm dev`, sign in, open any board.
2. **Active bar:** the open board's row shows a 3px periwinkle bar on the sidebar's left edge and a
   faint tint; the text is full-contrast in both dark and light (toggle the theme in the header).
3. **Ledger headers:** hover "PLANNING" — the hairline to its right brightens and a chevron appears at
   the end; click anywhere on the header to fold it; the chevron stays visible while folded. Reload:
   still folded.
4. **Context chip:** one chip at the top shows the workspace name (and the org name as a small mono
   label above it if you belong to more than one org). Click it — organizations (if > 1) and
   workspaces are in one menu, plus "New workspace" / "Manage workspaces". Hovering the chip
   brightens its border and does not lift it.
5. **Footer:** "My Time" and "Trash" sit at the bottom above a hairline. Create enough boards (or
   fold nothing and use a small window) so the list overflows: the middle scrolls with a soft fade,
   the footer and the brand row stay put.
6. **Shared with me:** the label is a small mono kicker with a rule, aligned with the board names.
7. **Collapsed rail (⌘\\):** groups are separated by short hairlines; the active board tile carries
   the same edge bar; My Time / Trash are pinned at the rail's bottom; tooltips read the names.
8. **iPad / touch:** section chevrons are always visible; captions show under rail tiles.
