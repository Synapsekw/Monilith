# UI polish micro-pass — design spec

**Date:** 2026-07-02
**Status:** Awaiting review
**Scope class:** micro-pass — class-level and small-component changes only. No redesigns, no new
dependencies, no schema or data-flow changes.

## Goal

A smoothness/consistency pass over interactive surfaces: branded `focus-visible` rings where raw
buttons drifted from the codebase pattern, one restrained tab-content fade, a single shared
`EmptyState` component to end empty-state drift, hover/drag transitions, and one layout-shift fix.
Every change stays inside the pulse-ui system (semantic tokens, monochrome chrome,
150–250 ms ease-out motion, WCAG AA focus visibility).

## Verification of the brief (each finding checked against code)

The brief came from a visual sweep; each item was verified against the worktree. Three items were
**contradicted by the code and are dropped**; the rest are confirmed (some refined).

| #   | Brief claim                                                            | Verdict                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ItemPanel tab buttons lack focus-visible ring                          | **Confirmed**              | `src/components/boards/item-panel/ItemPanel.tsx:100-113` — raw `<button>`, no `focus-visible:*`, no `transition-colors`, no tab ARIA. UA default outline only (inconsistent with the branded ring used by GoalTree/PortfolioGrid sort buttons and the `Button` primitive).                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | Tab content swaps instantly; add ~150 ms fade                          | **Confirmed**              | `ItemPanel.tsx:116-171` — plain conditional render. The design system already ships `animate-fadein` (0.15 s ease-out, `globals.css:86`, reduced-motion-safe via the global media query at `globals.css:310`); it is used by `FlashHighlight`/`PresenceFlashMessage`. Reuse it — no Framer, no new keyframes.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | NotificationsList bare-text empty state; adopt DashboardCanvas pattern | **Confirmed**              | `NotificationsList.tsx:27-33` bare `<p>`; the designed pattern is `DashboardCanvas.tsx:151` (`rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground`). No `EmptyState` component exists anywhere in `src/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4a  | FilesTab gallery/list toggles missing focus-visible                    | **Contradicted — dropped** | `FilesTab.tsx:74-97` — the toggles are shadcn `Button`s; the primitive already applies `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` (`ui/button.tsx:8`). Nothing to fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 4b  | FilesTab drag-over ring pops in without transition                     | **Confirmed**              | `FilesTab.tsx:55` — conditional `ring-ring ring-2` with no transition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | UpdatesTab "Write an update" CTA styled ad-hoc                         | **Confirmed**              | `UpdatesTab.tsx:47-53` — raw `<button>` with hand-rolled border/hover, also missing focus-visible ring. Violates "shadcn first".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6   | Empty-state padding drift across item-panel tabs                       | **Confirmed**              | FilesTab `py-10` (`FilesTab.tsx:124`), UpdatesTab `py-6` (`UpdatesTab.tsx:77`), ActivityTab `py-6` (`ActivityTab.tsx:22`). Fields tab has no empty state (n/a).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 7a  | "View only" badge causes layout shift; reserve space                   | **Contradicted — dropped** | `BoardHeader.tsx:38,114-119` — `access` is a server prop, fixed for the lifetime of the page; the badge never mounts/unmounts client-side, so it cannot shift layout. **Replaced with a real, adjacent shift found while verifying:** entering rename mode swaps a 28 px `text-xl` button (`BoardHeader.tsx:106-112`) for an `h-8` (32 px) `Input` (`BoardHeader.tsx:83-100`) — a 4 px vertical jump on every rename. Fix: give the display-mode title a stable `h-8` line box.                                                                                                                                                                                                                                                           |
| 7b  | Header icon sizes drift (size-3.5 vs size-4)                           | **Contradicted — dropped** | `Button size="sm"` already defaults SVGs to `size-3.5` (`ui/button.tsx:27`); the explicit `size-3.5` on Zap/UserPlus/Download matches that default, and the `Eye` badge icon is in a dense chip where pulse-ui prescribes `size-3.5`. No drift; no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | NotificationsList hover lacks transition-colors; unread dot too subtle | **Confirmed / refined**    | `NotificationsList.tsx:41` — no `transition-colors`, and the raw button also lacks a branded focus ring. Dot: `size-2` (8 px) is a standard unread-dot size and it is already `bg-primary` (brand); **we keep size-2** (enlarging it fights the system's restraint). The real defect: the dot renders only when unread, so read rows' text starts 16 px further left — inter-row misalignment. Fix by always rendering the dot slot (transparent when read).                                                                                                                                                                                                                                                                              |
| 9a  | GoalTree/PortfolioGrid sort buttons lack pressed feedback              | **Contradicted — dropped** | Both already have `aria-pressed`, `bg-accent` pressed style, branded focus ring, and `transition-colors` (`GoalTree.tsx:168-183`, `PortfolioGrid.tsx:97-114`). Nothing to fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9b  | Row-hover drifts across tables                                         | **Refined**                | GoalTree and PortfolioGrid data rows both use `hover:bg-accent/30` (consistent with each other) but without `transition-colors`. Other tables (members-table, TimeCard, ListWidget, WorkloadGrid) have **no row hover — correctly**: their rows have no row-level click affordance, and adding hover would imply clickability. Decision: add `transition-colors` to the two hovering tables; leave non-interactive tables alone. **Real gap found while verifying:** GoalTree row controls — the expand chevron (`GoalTree.tsx:87-98`) and goal-name button (`GoalTree.tsx:102-108`) — lack the branded focus ring, same defect family as item 1. ViewSwitcher's tab button (`ViewSwitcher.tsx:199-214`) has the same gap. Both included. |

## Design

### D1. Shared `EmptyState` component (the one extraction)

New file `src/components/ui/empty-state.tsx` — server-compatible (no `"use client"`), one purpose:
render an empty-state message consistently.

```tsx
type EmptyStateProps = {
  children: React.ReactNode; // the message (plain prose; may contain <strong>)
  variant?: "panel" | "inline"; // default "panel"
  className?: string;
};
```

- **`panel`** — the designed pattern from DashboardCanvas: `rounded-lg border border-dashed p-12
text-center text-sm text-muted-foreground`. For page/canvas-level emptiness.
- **`inline`** — no box, `py-8 text-center text-sm text-muted-foreground`. For emptiness inside an
  already-bounded region (item-panel tabs, popovers). `py-8` is the standardized padding (splits
  the current `py-6`/`py-10` drift; matches the tables' existing `py-8`).
- Rendered as a `<div>` (or `<p>` when children are plain text — implementation detail; the tests
  assert classes and text, not tag). No icon prop, no action prop, no title/description split —
  YAGNI; every current call site is a single sentence.

**Adopters (this pass):** DashboardCanvas (`panel`, no visual change — becomes the canonical
consumer), NotificationsList (`inline`), UpdatesTab / ActivityTab / FilesTab (`inline`).
**Explicit non-adopters:** GoalTree/PortfolioGrid empty rows stay as `<td colSpan>` text — they are
already mutually consistent at `py-8`, and wrapping a div-in-td adds churn without visible benefit.

### D2. ItemPanel tabs — focus ring, semantics, fade

- Tab buttons get the codebase's branded focus pattern
  (`focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none rounded-sm`) plus
  `transition-colors` — matching GoalTree/PortfolioGrid sort buttons.
- Add `role="tablist"` on the container, `role="tab"` + `aria-selected` on buttons (pattern
  precedent: ViewSwitcher).
- Tab content: wrap the tab body in a keyed div — `<div key={tab} className="animate-fadein …">` —
  inside the existing scroll container, so each tab switch re-mounts the wrapper and plays the
  existing 150 ms fade (4 px rise). Zero new CSS; reduced-motion already globally handled.

### D3. FilesTab drag-over transition

Base class becomes `ring-2 ring-transparent transition-shadow` with `dragOver` toggling
`ring-ring` — the ring color transitions in (~150 ms default) instead of popping, and the layout
never changes (ring is box-shadow). Empty state → `EmptyState variant="inline"` (D1).

### D4. UpdatesTab CTA → Button

Replace the ad-hoc button with
`<Button variant="outline" className="w-full justify-start font-normal text-muted-foreground">Write an update</Button>`.
Gets the primitive's focus ring, hover, and pressed translate for free; reads as the same quiet
placeholder affordance. Empty state → `EmptyState variant="inline"` (D1).

### D5. NotificationsList row polish

- Row button: add `transition-colors` and the branded focus ring (raw button today).
- Unread dot: keep `size-2 bg-primary`; render the dot span **unconditionally**, `bg-transparent`
  when read (`aria-hidden` when transparent; keep `aria-label="unread"` only when unread) — rows
  align regardless of read state.
- Empty state → `EmptyState variant="inline"` (D1). (Popover is `max-h-96`; the inline variant
  fits; the boxed `panel` variant would be chrome-on-chrome inside a popover.)

### D6. BoardHeader rename stability

Give the display-mode title button (and the viewer `<h1>`) a stable `h-8` line box
(`flex h-8 items-center`) so toggling into the `h-8` Input swaps at identical height — no 4 px
header jump. No badge change (see verification 7a).

### D7. GoalTree / PortfolioGrid / ViewSwitcher consistency

- GoalTree expand-chevron and goal-name buttons: add branded focus-visible ring +
  `transition-colors` (chevron already has a hover color change with no transition).
- GoalTree + PortfolioGrid data rows: add `transition-colors` next to the existing
  `hover:bg-accent/30`.
- ViewSwitcher tab button: add the branded focus-visible ring (it already has
  `transition-colors`).
- No sort-button changes (already correct); no hover added to non-interactive tables.

## Testing

DOM-class assertion tests, precedent `src/components/ui/button.touch.test.tsx` (assert the class
string / roles via Testing Library; media queries and animations don't run in jsdom, so we assert
the classes that carry them).

- **New:** `src/components/ui/empty-state.test.tsx` — panel vs inline classes, renders children.
- **Extend existing tests:** `ItemPanel.test.tsx` (tablist/tab roles + `aria-selected`; tab body
  wrapper has `animate-fadein`; tab buttons' class contains `focus-visible:ring`),
  `FilesTab.test.tsx` (base class contains `ring-transparent` + `transition-shadow`),
  `UpdatesTab.test.tsx` (CTA is a `Button` — has `data-slot="button"`),
  `NotificationsList.test.tsx` (dot span present on read rows with transparent class; row button
  class contains `transition-colors` and `focus-visible:ring`; empty state renders EmptyState
  classes), `BoardHeader.test.tsx` (title button class contains `h-8`),
  `ViewSwitcher.test.tsx` (tab class contains `focus-visible:ring`),
  `DashboardCanvas.test.tsx` (empty state still renders the dashed-box classes — regression guard
  for the EmptyState swap).
- **New (no test file today):** minimal `GoalTree.test.tsx` — row buttons expose focus-visible
  classes; rows have `transition-colors`. (PortfolioGrid's one-class row change is covered by
  visual parity with GoalTree; a dedicated test file for one class is not warranted — recorded as
  a decision.)

## Performance & data-fetching budget (AGENTS.md rule #5)

- **First paint:** unchanged — every change is classes, ARIA attributes, or a client-only wrapper
  div. `EmptyState` is a server-compatible leaf.
- **Interactions:** 0 new server round-trips. Tab switches, hovers, focus, drag-over, and the fade
  are pure client rendering over already-loaded data; no navigation, no Server Action, no fetch is
  added anywhere.
- **Bounded reads / indexes:** n/a — no data reads are added or altered.
- **Motion cost:** one 150 ms CSS animation per tab switch and CSS transitions on
  hover/focus/drag — GPU-cheap (opacity/transform/box-shadow/color), globally disabled under
  `prefers-reduced-motion`.

## Independent units (for the plan's DAG)

1. **EmptyState component + its own test + DashboardCanvas adoption** — produces the shared API.
2. **Item-panel cluster** (ItemPanel, FilesTab, UpdatesTab, ActivityTab) — consumes EmptyState.
3. **NotificationsList** — consumes EmptyState.
4. **BoardHeader + ViewSwitcher** — independent of everything.
5. **GoalTree + PortfolioGrid** — independent of everything.

Units 2 and 3 depend on unit 1; units 4 and 5 have no dependencies.

## Open questions / decisions taken (non-interactive run)

1. **Dropped brief items 4a, 7a-badge, 7b, 9a-sort** — contradicted by code (see verification
   table). Recorded here rather than silently omitted.
2. **Substituted findings** in the same defect families: BoardHeader rename height-shift (for 7a),
   GoalTree row-control focus rings + ViewSwitcher tab focus ring (for 9a). Same size class as the
   brief items they replace; still a micro-pass.
3. **EmptyState is deliberately minimal** (children + 2 variants). No icon/action/title props until
   a real call site needs them (YAGNI).
4. **Unread dot stays `size-2`** — 8 px brand-colored dot is standard and system-restrained; the
   alignment fix (always-rendered slot) addresses the actual perceptual problem.
5. **`py-8` chosen** as the standardized inline empty-state padding (middle of the observed
   `py-6`–`py-10` drift; matches existing table empties).
6. **Non-interactive tables get no hover** — hover implies row-level clickability they don't have.
7. **Table `<td>` empty states keep their current markup** — already mutually consistent; churn
   without visible benefit.
8. **Fade uses the existing `animate-fadein` token**, not Framer Motion — Framer is reserved for
   bespoke motion (panels/drag) per pulse-ui; a keyed CSS animation is the restrained tool here.
9. **PortfolioGrid gets no new test file** for a one-class change; GoalTree gets a minimal one
   because it also gains focus-ring behavior on two buttons.
