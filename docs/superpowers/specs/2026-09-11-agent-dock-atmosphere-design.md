# Agent dock "Atmosphere" — design

**Date:** 2026-09-11 · **Status:** approved by the owner (brainstorm, three visual rounds) ·
**Prototype:** `2026-09-11-agent-dock-atmosphere.prototype.html` (open in a browser; V1 is the
chosen column — the other two columns record the rejected finishes and are kept for reference).
**Scope:** the board page's right-hand agent dock (`src/components/boards/dock/*`) on desktop; the
mobile Sheet keeps its current interior.

## Why

The dock is the place a user talks to their agents, but it looks like a second table: a flat
near-black column _inside_ the content card, a native `<select>` as the only sign of who is
answering, a thread list that spends 192px of a 320px column before a word of transcript is read,
and a pill row (Chat | Intelligence) stacked above all that. The owner asked for the dock to be
polished, coloured rather than flat black, and rethought so that **agents are the hero**.

Three rounds of live options settled the direction:

1. Round 1 (placement): the dock leaves the content card and sits on the periwinkle **app wash**
   as the left sidebar's twin — rail | card | dock. Rejected: painting a wash column inside the
   card; a persona-hero header.
2. Round 2 (roster): avatars as **tabs in the 56px header band**, one grammar with the app
   header. Rejected: a labelled tile strip, a vertical roster with status lines, a
   threads-nested-under-agents tree.
3. Round 3 (finish + collapse + motion): **no chat card at all** — the transcript sits on the
   wash; the composer is the one raised surface; collapsed, the dock becomes a **48px mini rail**
   of the same tiles. Rejected: a log/timeline transcript that folds into the app header; a bloom
   finish that folds to a vertical-label spine.

Colour comes from the wash, so every theme preset re-tints the dock for free and the component
never reads a preset (pulse-ui seed-token rule).

## Direction — "Atmosphere"

- **Chrome, not content.** The dock is atmosphere like the left nav: transparent on the wash, no
  divider, no card. Only the composer is raised. Words stay AA because `--muted-foreground` and
  `--foreground` are already tuned against the wash (the sidebar proves it).
- **One tab row for everything you consult.** Intelligence, Ask, and each agent are tiles in one
  `tablist`; the active tile carries the sidebar's 3px edge bar. `DockTabs` (pill row) and
  `AgentSwitcher` (native select) are retired.
- **Presence is always visible.** The active agent's dot pulses while a run is live, in the open
  band and on the mini rail.
- **Keystone motion.** One axis, `ease-keystone`, hairlines brighten, nothing scales.

## 1. Placement — dock slot in the shell

`AppShell` (`src/components/app-shell.tsx`) renders a static, empty
`<div id="app-dock-slot" className="flex shrink-0" />` as the last child of the outer flex row,
after the `<div class="flex min-w-0 flex-1 flex-col">` that holds the header and `<main>`. It is
part of the prerendered static shell: no props, no request-time reads, nothing awaited
(`src/test/static-shell.test.ts` must stay green).

`BoardDock` mounts as today from `boards/[boardId]/page.tsx`, but on the wide surface it renders
its `<aside>` through `createPortal` into that slot. The portal target is looked up in an effect
after mount (`document.getElementById`) and held in state; until it exists — or on any page that
has no slot — the desktop dock renders nothing. Effects run after the whole tree has committed, so
the slot always exists by the time the board page's effect runs. The page's own flex wrapper drops
the dock as a child; `BoardViews` keeps `min-w-0 flex-1`.

`<main>` keeps `mr-2 mb-2 ml-1 rounded-xl`. When the dock is present the gutter between the card
and the dock is `ml-1`'s 4px on the dock side (the dock's own `pl-1`), matching the left side, and
the card's right margin collapses to `mr-1` via a `data-dock` attribute the portal sets on the
slot's parent (`[&:has(#app-dock-slot:not(:empty))>div>main]:mr-1`, pure CSS, no state).

Mobile (`useNarrowViewport`) is unchanged: the Sheet renders `DockBody` with the same interior; the
floating open button stays. The `PanelRightOpen` desktop trigger is replaced by the mini rail.

## 2. `DockTiles` — the one tab row

New `src/components/boards/dock/DockTiles.tsx`, replacing `DockTabs.tsx` and `AgentSwitcher.tsx`.

- **Model.** `type DockTile = { id: "intelligence" } | { id: "ask" } | { id: agentId }`. Value is a
  `DockTab` extended: `tab: "chat" | "intelligence"` stays in `use-dock-state` (persisted), and the
  chat persona stays in `BoardDock`'s `agentId` state. `DockTiles` takes
  `{ agents, tab, agentId, badge, onSelect(tile) }` and derives the active tile:
  `tab === "intelligence"` → intelligence tile; else `agentId ?? "ask"`.
- **Rendering.** `role="tablist"` `aria-label="Dock sections"`, roving tabindex, ArrowLeft/Right,
  Home/End, exactly as `DockTabs` does today (that keyboard code moves over). Each tile is a
  32px `role="tab"` button, `rounded-lg border border-transparent hover:border-border-hover`,
  `aria-selected` → `border-border` plus a 3px `bg-primary` edge bar via `after:` flush on the
  band's bottom edge (same recipe as `SidebarRow`'s `before:` bar, rotated). Inside: a 26px tile —
  Intelligence: `AskAiMark` in `text-brand` on `bg-chrome-fill border`; Ask: `MonolithMark`
  (the neutral glyph); agent: uppercase initial on `bg-primary/15 text-primary`. Names are
  `Tooltip`s (`side="bottom"`), never inline text.
- **Badge.** The Intelligence tile shows the unresolved count as a `text-primary text-3xs
tabular-nums` chip at its top-right (absolute, `-translate-y-1/3 translate-x-1/3`), the only
  colour on an inactive tile.
- **Presence dot.** Agent tiles take `presence?: "idle" | "running"`; `running` renders a 9px
  `bg-primary` dot at the tile's bottom-right, separated from the tile by a 2px `border-border`
  hairline ring, with the `animate-pulse-ring` keyframe added to globals.css (§7). Phase-1 scope:
  `running` is true only for the persona of the thread whose `AskChat` is streaming — the dock
  already knows this (`onStarted` … `onTurnComplete`). Scheduled-run presence is out of scope.
- **Selection semantics.** Intelligence tile → `setTab("intelligence")` (counts as "asked", same
  `openedThisSession` rule as today). Ask/agent tile → `setTab("chat")` and, if the persona
  differs from the open thread's persona, **start a new thread on that persona** (`changeAgent` +
  `startNew`); if it is the open thread's persona, no-op. This replaces today's disabled select:
  the owner chose "tap an agent and talk" over "locked until you press New".
- **Right side of the band.** `New` (`Plus`, ghost `icon-sm`, disabled while `activeId === null`,
  chat tab only) and `Close` (`PanelRightClose`). Below `md` the Sheet keeps its own close.

## 3. Chat finish on the wash

`DockBody` (chat tab) becomes, top to bottom:

1. **Band** (§2), `h-14`.
2. **Title row**, `px-3.5 pt-2`: the open thread's title in `text-sm font-extrabold truncate`
   (or "New thread" when none), plus a `<Kicker>` with the persona name on the right. Read-only
   shared threads append a `Shared` kicker chip, as the list row does today.
3. **Threads ledger**, a `NavSection`-style header: `<Kicker>Threads</Kicker>`, hairline rule that
   brightens on hover, mono count, chevron. Collapsed by default; state is component state (not
   persisted). Open, it shows `DockThreadList` unchanged inside a `max-h-48 overflow-y-auto`
   well. Active row keeps the `bg-state-selected` + edge-bar row grammar it already shares with
   `/ask`.
4. **Transcript**: `AskChat` with `surface="atmosphere"`. User turn = `bg-chrome-fill border
border-border rounded-lg` pill (was `bg-surface-muted`); agent turn = tile + kicker + plain
   text, unchanged; the 28px agent tile becomes the same brand-tinted initial tile as the band
   when a persona is answering, and the `AskAiMark` tile for plain Ask. `MessageList` drops
   `max-w-3xl` centring under `atmosphere` (the column is the width).
5. **Composer**: the one raised surface — `bg-surface border border-border shadow-content-lift
rounded-lg`, `hover:border-border-hover`, `focus-within:border-border-bright`; margin `mx-2.5
mb-1.5`. Its outer `bg-background border-t px-4 py-3` wrapper is dropped under `atmosphere`. The
   helper line (`↵ send · ⇧↵ newline`) is the `<Kicker>` it is today, `px-3.5 pb-2.5`.

`surface: "card" | "atmosphere"` is a new optional prop on `AskChat`, threaded to `MessageList`
and `Composer`; default `"card"` leaves `/ask` byte-for-byte unchanged. Error banners and the
read-only notice keep their copy; they lose the `border-b`/`border-t` hairlines in favour of
`px-3.5` alignment with the title row.

The **Intelligence tab body** (`IntelligenceTab`) is unchanged and simply renders on the wash;
its cards are already `bg-surface` islands.

## 4. Mini rail (collapsed)

The closed desktop state is a 48px column in the same slot: the same `DockTiles` in
`orientation="vertical"` (tablist `aria-orientation="vertical"`, ArrowUp/Down), edge bar on the
**right** edge (mirroring the left rail, whose bar sits on its left edge), presence dots and the
Intelligence badge intact. A `PanelRightOpen` ghost button sits at the top on the header baseline.
Clicking any tile opens the dock **on that tile** (same selection semantics as §2, then
`setOpen(true)`). The left rail's collapsed geometry (`w-14`, 32px tiles, 14px vertical rhythm) is
the reference; the mini rail uses `w-12` because it carries no wordmark.

## 5. Motion

- Container: `transition-[width] duration-[360ms] ease-keystone` on the `<aside>`, width
  `${width}px` ↔ `48px`. The transition class is applied only while an open/close is in flight
  (`data-animating`, cleared on `transitionend`) so **drag-resize stays instant**.
- Two layers, one component: `.layer-full` and `.layer-mini` absolutely fill the aside.
  Close: full layer `opacity 140ms ease, translate-x-6 200ms ease-in`, then mini layer fades in
  with `delay-[140ms]`. Open: mini layer out `120ms`; full layer `delay-[80ms]`; inside it the
  band, title and each transcript turn get `translate-x-3.5 → 0` with `delay` 120/180/240ms
  (`nth-child` up to 3, then flat), the composer rises `translate-y-2.5 → 0` at `delay-[200ms]`.
- Presence: `animate-pulse-ring` (box-shadow ring 0 → 6px, 1.4s, `ease-keystone`, infinite).
- Reduced motion: nothing here re-implements it; the global `prefers-reduced-motion` rule in
  `globals.css` collapses transitions to instant.

## 6. State, persistence, budget

- `use-dock-state` is unchanged: `{ open, width, tab }` per board in localStorage, read in an
  effect. `DOCK_MIN_WIDTH` stays 320; the mini rail width is a constant `DOCK_RAIL_WIDTH = 48`.
- Threads-ledger open/closed and the portal target are component state.
- **Zero new fetches** (working agreement #5): the roster (`user_agents` names) and the latest
  Intelligence run arrive with the page as today; threads load on first open through the same
  Server Action; selecting a tile is client state; opening on a tile from the mini rail does the
  same single first-open read. No `router.push`/`refresh` anywhere (gotcha-09).

## 7. Tokens & globals

- New utility keyframe `pulse-ring` + `--animate-pulse-ring` in `globals.css` `@theme`.
- No new colour tokens. The presence dot is `bg-primary` with a 2px `border-border` ring — a
  hairline separating it from the tile, not the solid wash-coloured ring the prototype used
  (that was gallery chrome, and the wash is a gradient with no single colour to match).
- `AskAiMark` / `MonolithMark` reuse; no new icons beyond lucide `PanelRightOpen/Close`, `Plus`,
  `ChevronRight`.

## 8. Accessibility

- One tablist, roving tabindex, arrow keys, `aria-selected`, `aria-controls` only for the mounted
  panel (as today). Tooltip names on every icon-only tile; the tile's `aria-label` is the name.
- Presence and the badge are never colour-only: the tooltip reads "Scout · running" / "Intelligence
  · 3 suggestions".
- The resize separator keeps its `role="separator"` keyboard behaviour; it is hidden on the mini
  rail.
- Focus rings `focus-visible:ring-2 ring-ring` on tiles, ledger header, composer.

## 9. Tests (written and executed; Vitest + Testing Library)

- `DockTiles.test.tsx`: renders Intelligence + Ask + agents; badge shows count; arrow keys and
  Home/End move focus and select; `aria-selected` follows `tab`/`agentId`; vertical orientation
  swaps to Up/Down; presence dot present only when `running`; selection callbacks for each tile.
- `BoardDock.test.tsx` (update): desktop dock portals into `#app-dock-slot`; renders nothing on
  the wide surface when the slot is absent; closed → mini rail with tiles, clicking an agent tile
  opens on that persona and starts a new thread; clicking the Intelligence tile opens on
  Intelligence; `New` disabled with no thread; mobile Sheet path unchanged.
- `DockBody.test.tsx` (new): title row shows thread title + persona kicker; threads ledger
  collapsed by default, expands to the list; read-only notice; error + retry.
- `AskChat`/`MessageList`/`Composer` tests: `surface="atmosphere"` applies the wash classes and
  drops the card wrapper; default output unchanged (snapshot of existing `/ask` render).
- `app-shell.test.tsx`: the slot renders empty and static; `static-shell.test.ts` stays green.
- `globals.contrast.test.ts` unaffected (no new colour tokens).
- Retired: `DockTabs.test.tsx`, `AgentSwitcher.test.tsx`.

## Execution DAG

| Task | Produces                                                                        | Consumes   |
| ---- | ------------------------------------------------------------------------------- | ---------- |
| T1   | `AppShell` dock slot + `mr-1` rule; `BoardDock` portal + mini-rail shell        | —          |
| T2   | `DockTiles` (horizontal + vertical), `pulse-ring` keyframe, tests               | —          |
| T3   | `surface` prop on `AskChat`/`MessageList`/`Composer`, tests                     | —          |
| T4   | `DockBody` relayout: band, title row, threads ledger, motion layers; wire T1–T3 | T1, T2, T3 |
| T5   | Retire `DockTabs`/`AgentSwitcher`, update `BoardDock` tests, `/updates` entry   | T4         |

Batches: **1** = T1 ‖ T2 ‖ T3 (three agents, one worktree, orchestrator commits by path);
**2** = T4; **3** = T5. Critical path T2 → T4 → T5.

## How to test (closing walkthrough)

Pull `develop`, `pnpm dev`, sign in, open a board on a desktop-width window, dark and light.

1. **Placement:** the dock is no longer inside the board card — it sits to the right of the card
   on the periwinkle wash with no divider, the card's right gutter matching its left.
2. **Band:** tiles read Intelligence · Ask · your agents; hover shows names; the active tile has a
   periwinkle bar under it. Press → / ← to move.
3. **Talk:** click an agent tile — a new thread starts on that agent, the title row says "New
   thread · AGENT"; ask something; the agent's dot pulses while it answers.
4. **Threads:** click the THREADS ledger — the list unfolds under the title; pick an older thread;
   the ledger folds again on click.
5. **Collapse:** click the close icon — the column folds to a thin rail of the same tiles over
   ~0.4s; click any tile in the rail — it opens on that tile.
6. **Intelligence:** the first tile shows the suggestion count; clicking it opens the
   Intelligence body on the wash, unchanged inside.
7. **Phone width:** the floating button still opens the full-screen sheet with the same interior.
8. **`/ask`:** unchanged.
