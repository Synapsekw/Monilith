# Agent Dock "Atmosphere" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the board page's agent dock out of the content card onto the app wash, replace the pill tabs + native persona select with one tile row (Intelligence · Ask · each agent), fold the thread list into a ledger, make the composer the only raised surface, and collapse the dock to a 48px mini rail of the same tiles — per the approved spec `docs/superpowers/specs/2026-09-11-agent-dock-atmosphere-design.md`.

**Architecture:** `AppShell` gains a static, empty `#app-dock-slot`; `BoardDock` portals its `<aside>` into it after a mount-effect lookup, so the shell stays prerendered and the page's flex row no longer holds the dock. A new `DockTiles` tablist (horizontal in the band, vertical on the mini rail) carries the roving-tabindex keyboard logic that `DockTabs` had; `AskChat`/`MessageList`/`Composer` take an optional `surface="atmosphere"` prop that swaps their card chrome for wash chrome while leaving `/ask` byte-for-byte unchanged. Motion is CSS only: a width transition applied only while a toggle is in flight, two absolutely-positioned layers that crossfade, `@starting-style` entrances (Tailwind `starting:`), and one new `pulse-ring` keyframe.

**Tech Stack:** Next.js 16 App Router (client components under the dock), React 19 (`createPortal`, `inert`), Tailwind v4.3 (`starting:` variant, arbitrary `:has()` variant, `translate` property), shadcn `Button`/`Tooltip`/`Kicker`, lucide-react, Vitest + Testing Library (jsdom).

## Global Constraints

- **Semantic tokens only.** `bg-surface`, `bg-chrome-fill`, `bg-state-selected`, `border-border`, `hover:border-border-hover`, `focus-within:border-border-bright`, `text-primary`, `text-brand`, `text-kicker`, `ease-keystone`, `shadow-content-lift`… Raw Tailwind colours (`bg-zinc-800`, `text-blue-500`) are forbidden. Hairlines **brighten, never thicken**. Radius `rounded-lg` for tiles/panels, `rounded-sm` for the 26px inner tiles and chips.
- **`pnpm lint` runs three custom guards besides eslint** (all must stay green):
  - `scripts/check-hover-tokens.mjs` fails on an opaque surface token used as an interaction state: `hover:bg-accent`, `hover:bg-muted`, `hover:bg-secondary`, and the same with `focus:`/`focus-visible:`/`active:`/`aria-selected:`/`data-[...]:` prefixes. Use `hover:bg-state-hover`, `bg-state-active`, `bg-state-selected` instead.
  - `scripts/check-px-text.mjs` fails on arbitrary pixel text sizes (`text-[13px]`). Use scale tokens only (`text-3xs`, `text-2xs`, `text-xs`, `text-sm`, …).
  - `scripts/check-board-chrome.mjs` guards `vault/board.html` — irrelevant here, but do not touch that file.
- **Server Components by default.** Everything touched here is already `"use client"` under the dock, or the static `AppShell`. **No new fetches**; **no `router.push`/`router.refresh`** anywhere (gotcha-09). `use-dock-state`'s hook shape (`{ open, width, tab, hydrated, setOpen, setWidth, setTab }`) is unchanged; the module additionally exports `DOCK_RAIL_WIDTH = 48`.
- **`AppShell` must stay static:** no props added that need request-time data, nothing awaited; `src/test/static-shell.test.ts` must stay green. The dock slot is an empty `<div>` and the `mr-1` rule is pure CSS (`:has()`), no state.
- **`/ask` output must be byte-for-byte unchanged** when `surface` is omitted (default `"card"`). The card branch in `MessageList`/`Composer`/`AskChat` keeps the **exact literal class strings** that exist today (no `cn()` re-composition of the card strings), and tests pin those literals.
- **Retire `DockTabs.tsx`, `DockTabs.test.tsx`, `AgentSwitcher.tsx`, `AgentSwitcher.test.tsx`** (deleted in Task 5). The roving-tabindex keyboard logic moves into `DockTiles`. `DockAgent` moves to `DockTiles.tsx`.
- **Tailwind v4 facts this plan relies on (verified by compiling against the installed 4.3.3):** `translate-x-*` writes the CSS `translate` property, so entrance/exit transitions use `transition-[opacity,translate]` — **never** `transition-[opacity,transform]` (it would not animate). `starting:` (= `@starting-style`) is what makes a freshly mounted element transition in. `[&:has(#app-dock-slot:not(:empty))>div>main]:mr-1` compiles to `.…:has(#app-dock-slot:not(:empty)) > div > main { margin-right }`. `size-6.5` (26px), `after:-bottom-3`, `size-[9px]`, `[&:nth-child(2)]:delay-[180ms]` all compile.
- **Tests are mandatory per task:** write the test, run it, see it fail, implement, run it, see it pass. Single-file test command: **`pnpm vitest run <path>`**. Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Commits:** Conventional Commits, **lowercase subject ≤ 100 chars, no PascalCase words in the subject** (write `dock-tiles`, not `DockTiles`), stage **by explicit path only** (`git add <paths>` — never `-A`/`.`/`-a`). Every commit message ends with exactly these two trailer lines:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp
  ```
- **Worktree:** one worktree for the whole plan — `scripts/start-task.sh agent-dock-atmosphere` → `.claude/worktrees/agent-dock-atmosphere` on `task/agent-dock-atmosphere`. Batch 1 (Tasks 1‖2‖3) runs as three agents **in that one worktree**; the agents do **not** commit — the orchestrator runs each task's commit step by path once its review passes (memory: "Parallel agents in one worktree"). Tasks 4 and 5 run sequentially. Close with `scripts/finish-task.sh` from inside the worktree.
- **Copy:** the product is Monolith; never "Pulse" in user-facing text. The composer helper line keeps today's copy (`⌘↵ to send` / `Asking X — ⌘↵ to send` / `Working — one question at a time`) — the spec says it "is the `<Kicker>` it is today", and Enter-to-send is not in scope.
- **`/updates` entry** (Task 5): a `Changelog: <kind> | <title> | <description>` trailer on the retiring commit, then `pnpm changelog:gen` and commit `src/lib/changelog/generated.ts` (CONTRIBUTING.md → "Changelog entries").

---

## File Structure

| File                                                                               | Task   | Responsibility after this plan                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/app-shell.tsx`                                                     | T1     | Static frame; gains the empty `#app-dock-slot` and the `:has()` gutter rule.                                                                                                |
| `src/components/app-shell.test.tsx`                                                | T1     | Pins the slot: empty, static, positioned after the header+main column; the gutter rule lives on the root.                                                                   |
| `src/components/boards/dock/use-dock-state.ts` (+ test)                            | T1     | Unchanged hook; adds `export const DOCK_RAIL_WIDTH = 48`.                                                                                                                   |
| `src/components/boards/dock/BoardDock.tsx`                                         | T1, T4 | Owns dock state + data; T1: portals one `<aside>` (full layer / mini layer) into the slot; T4: tile selection semantics, presence, width/crossfade motion, mini-rail tiles. |
| `src/components/boards/dock/BoardDock.test.tsx`                                    | T1, T4 | Behaviour of the dock through a mocked `AskChat`; `mount()` renders the slot.                                                                                               |
| `src/app/(app)/boards/[boardId]/page.tsx`                                          | T1     | Comment only: the dock element stays in the page but renders through the shell's slot.                                                                                      |
| `src/components/boards/dock/DockTiles.tsx` (+ test)                                | T2     | The one tablist (horizontal/vertical), roving tabindex, tooltips, badge, presence dot. Exports `DockAgent`, `DockPresence`, `DockTile`, `dockTileId`.                       |
| `src/app/globals.css`                                                              | T2     | `--animate-pulse-ring` in `@theme` + `@keyframes pulse-ring`.                                                                                                               |
| `src/app/globals.motion.test.ts`                                                   | T2     | Pins the keyframe (box-shadow only, nothing scales).                                                                                                                        |
| `src/components/ai/ask/surface.ts`                                                 | T3     | `export type ChatSurface = "card" \| "atmosphere"`.                                                                                                                         |
| `src/components/ai/ask/AskChat.tsx` (+ test)                                       | T3     | `surface` and `onBusyChange` props; read-only notice chrome by surface.                                                                                                     |
| `src/components/ai/ask/MessageList.tsx` (+ test)                                   | T3     | `surface` prop: column width, user pill, persona initial tile, per-turn entrance.                                                                                           |
| `src/components/ai/ask/Composer.tsx` (+ test)                                      | T3     | `surface` prop: the one raised surface on the wash; composer rise entrance.                                                                                                 |
| `src/components/boards/dock/DockBody.tsx`                                          | T4     | Relayout: band (tiles + New + Close), title row, threads ledger, error line, transcript on the wash.                                                                        |
| `src/components/boards/dock/DockBody.test.tsx`                                     | T4     | New: title row, ledger, read-only notice, error + retry, band controls.                                                                                                     |
| `DockTabs.tsx`, `DockTabs.test.tsx`, `AgentSwitcher.tsx`, `AgentSwitcher.test.tsx` | T5     | Deleted.                                                                                                                                                                    |
| `src/lib/changelog/generated.ts`                                                   | T5     | Regenerated from the new `Changelog:` trailer.                                                                                                                              |

---

### Task 1: Dock slot in the shell, dock portal, mini-rail shell

**Files:**

- Modify: `src/components/app-shell.tsx:34-56`
- Modify: `src/components/app-shell.test.tsx` (append a `describe`)
- Modify: `src/components/boards/dock/use-dock-state.ts:12-15`
- Modify: `src/components/boards/dock/use-dock-state.test.ts:4-9` and append a test
- Modify: `src/components/boards/dock/BoardDock.tsx:1-33`, `:394-412`, `:464-516`
- Modify: `src/components/boards/dock/BoardDock.test.tsx:182-200` (mount helper) and append a `describe`
- Modify: `src/app/(app)/boards/[boardId]/page.tsx:109-115` (comment only)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `AppShell` renders `<div id="app-dock-slot" className="flex shrink-0" />` as the sibling right after the header+main column; the root `div.app-wash` carries the class `[&:has(#app-dock-slot:not(:empty))>div>main]:mr-1`.
  - `export const DOCK_RAIL_WIDTH = 48` from `src/components/boards/dock/use-dock-state.ts`.
  - `BoardDock` on the wide surface: `createPortal(<aside aria-label="Agent dock" data-open={open} style={{ width: open ? shownWidth : DOCK_RAIL_WIDTH }}>…</aside>, slot)`, where the aside holds **exactly one** of `<div data-layer="full" className="absolute inset-y-0 right-0 left-1 flex flex-col">` (resize separator + `DockBody`) or `<div data-layer="mini" className="absolute inset-y-0 right-0 left-1 flex flex-col items-center gap-2.5 pt-3">` (a ghost `Button aria-label="Open agent dock"` with `PanelRightOpen`). It renders `null` on the wide surface while no `#app-dock-slot` exists. Below `md` the fixed floating trigger and the Sheet are unchanged. Task 4 replaces the layer internals; the attributes above are the contract.
  - `BoardDock.test.tsx`'s `mount()` renders the slot next to the dock; `openDock()` still clicks `Open agent dock`.

- [ ] **Step 1: Write the failing AppShell tests**

Append to `src/components/app-shell.test.tsx` (after the `surface model` describe, line 72):

```tsx
describe("dock slot", () => {
  it("renders an empty, static #app-dock-slot right after the header+main column", () => {
    const { container } = renderShell();
    const slot = container.querySelector(
      "#app-dock-slot",
    ) as HTMLElement | null;
    expect(slot).not.toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(slot).toHaveClass("flex");
    expect(slot).toHaveClass("shrink-0");
    // The column that holds the header and <main> is the slot's previous sibling,
    // so the portalled dock lands beside the card — rail | card | dock.
    const column = screen.getByRole("main").parentElement as HTMLElement;
    expect(slot!.previousElementSibling).toBe(column);
  });

  it("collapses main's right gutter to mr-1 only while the slot is filled, in pure CSS", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(
      "[&:has(#app-dock-slot:not(:empty))>div>main]:mr-1",
    );
    // The default gutter is untouched: the variant, not a prop, decides.
    expect(screen.getByRole("main")).toHaveClass("mr-2");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: FAIL — `expect(received).not.toBeNull()` for the slot; the class assertion also fails.

- [ ] **Step 3: Add the slot and the gutter rule to AppShell**

In `src/components/app-shell.tsx`, replace lines 34–56 (the whole `return (…)`):

```tsx
return (
  <div className="app-wash flex h-svh w-full overflow-hidden [&:has(#app-dock-slot:not(:empty))>div>main]:mr-1">
    <Sidebar navSlot={sidebarNav} />

    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-1 md:hidden">
          {mobileNav}
          <Brand />
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <CommandTrigger />
          <ThemeToggle />
          {headerUser}
        </div>
      </header>
      <main className="bg-content-surface border-content-edge shadow-content-lift mr-2 mb-2 ml-1 min-h-0 flex-1 overflow-auto rounded-xl border">
        {children}
      </main>
    </div>
    {/* The board page's agent dock portals its <aside> in here (BoardDock.tsx),
          so the dock sits on the wash as the sidebar's twin — rail | card | dock —
          instead of inside the content card. Static and empty on purpose: no
          props, no request-time reads, so the prerendered shell is untouched
          (static-shell.test.ts). While it holds a dock, the root's `:has()`
          variant above narrows <main>'s right gutter to mr-1 — the dock's own
          `left-1` supplies the other 4px, matching the card's left side. */}
    <div id="app-dock-slot" className="flex shrink-0" />
    {commandPalette}
  </div>
);
```

Also extend the component docblock (lines 22–26) with one sentence at the end: `The empty dock slot is part of the static frame too — see the comment on it.`

- [ ] **Step 4: Run the AppShell tests and the static-shell guard**

Run: `pnpm vitest run src/components/app-shell.test.tsx src/test/static-shell.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Write the failing rail-width constant test**

In `src/components/boards/dock/use-dock-state.test.ts`, change the import (lines 4–9) to:

```ts
import {
  useDockState,
  clampDockWidth,
  DOCK_MIN_WIDTH,
  DOCK_MAX_WIDTH,
  DOCK_RAIL_WIDTH,
} from "./use-dock-state";
```

and append inside the `describe("useDockState", …)` block, after the last `it`:

```ts
it("exposes the mini rail width as a constant narrower than the open minimum", () => {
  // The closed dock is a 48px column of tiles (spec §4/§6) — a width the
  // hook never stores, so it is a constant beside the range, not in it.
  expect(DOCK_RAIL_WIDTH).toBe(48);
  expect(DOCK_RAIL_WIDTH).toBeLessThan(DOCK_MIN_WIDTH);
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/dock/use-dock-state.test.ts`
Expected: FAIL — `DOCK_RAIL_WIDTH` is `undefined` (TypeScript/ESM import of a missing export).

- [ ] **Step 7: Add the constant**

In `src/components/boards/dock/use-dock-state.ts`, replace lines 12–15 with:

```ts
/** Narrower than this and the dock stops being a column beside the board. */
export const DOCK_MIN_WIDTH = 320;
/** Wider than this and the dock is the page, not a dock. */
export const DOCK_MAX_WIDTH = 640;
/** The collapsed dock: a mini rail of the same tiles. Not part of the stored
 *  range — `width` always remembers the OPEN width. */
export const DOCK_RAIL_WIDTH = 48;
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run src/components/boards/dock/use-dock-state.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing BoardDock placement tests**

In `src/components/boards/dock/BoardDock.test.tsx`, replace the `mount` helper (lines 187–196) with:

```tsx
const mount = (props: MountProps = {}) =>
  render(
    <>
      {/* The static shell's slot (app-shell.tsx). On the wide surface the dock
          portals its <aside> into it; with no slot it renders nothing. */}
      <div id="app-dock-slot" className="flex shrink-0" />
      <BoardDock
        boardId="b1"
        agents={AGENTS}
        currentUserId="me"
        access={props.access ?? "editor"}
        initialRun={props.initialRun ?? null}
      />
    </>,
  );
```

Change the imports at lines 85–87 to also pull the width constants:

```tsx
import { BoardDock } from "./BoardDock";
import { DOCK_MIN_WIDTH, DOCK_RAIL_WIDTH } from "./use-dock-state";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import { useBoardIntelligenceStore } from "@/stores/board-intelligence";
```

Add a viewport stub next to `rememberOpen` (after line 118):

```tsx
/** Pretend the viewport is below `md`: `useNarrowViewport` reads exactly the
 *  negated-md query, so only that query matches (a coarse pointer stays off). */
function stubNarrow() {
  const NARROW = "not all and (min-width: 48rem)";
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === NARROW,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

const aside = () =>
  document.querySelector<HTMLElement>("aside[aria-label='Agent dock']");
```

Add `vi.unstubAllGlobals();` as the first line of the existing `beforeEach` (line 167).

Append a new describe at the end of the file:

```tsx
// The dock is chrome, not content (spec §1): it leaves the board page's flex
// row and renders through the static shell's slot, beside the card.
describe("BoardDock — placement in the shell's dock slot", () => {
  it("portals the wide dock into #app-dock-slot, closed and open", async () => {
    mount();
    const slot = document.getElementById("app-dock-slot")!;
    await waitFor(() => expect(slot).not.toBeEmptyDOMElement());
    expect(aside()!.closest("#app-dock-slot")).toBe(slot);
    expect(aside()!.querySelector("[data-layer='mini']")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /open agent dock/i }).closest("aside"),
    ).toBe(aside());

    await openDock();
    expect(aside()!.querySelector("[data-layer='full']")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /close agent dock/i })
        .closest("aside"),
    ).toBe(aside());
  });

  it("renders nothing on the wide surface when the page has no slot", async () => {
    render(<BoardDock boardId="b1" agents={AGENTS} currentUserId="me" />);
    await act(async () => {});
    expect(aside()).toBeNull();
    expect(
      screen.queryByRole("button", { name: /open agent dock/i }),
    ).toBeNull();
    expect(loadDockThreads).not.toHaveBeenCalled();
  });

  it("is DOCK_RAIL_WIDTH closed and the remembered width open", async () => {
    mount();
    await waitFor(() => expect(aside()).not.toBeNull());
    expect(aside()!.style.width).toBe(`${DOCK_RAIL_WIDTH}px`);
    expect(aside()).toHaveAttribute("data-open", "false");
    await openDock();
    expect(aside()!.style.width).toBe(`${DOCK_MIN_WIDTH}px`);
    expect(aside()).toHaveAttribute("data-open", "true");
  });

  it("keeps the floating trigger and the Sheet below md — no portal there", async () => {
    stubNarrow();
    mount();
    const trigger = screen.getByRole("button", { name: /open agent dock/i });
    expect(trigger.closest("#app-dock-slot")).toBeNull();
    expect(aside()).toBeNull();
    await userEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close agent dock/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/dock/BoardDock.test.tsx`
Expected: the four new tests FAIL (no `<aside aria-label="Agent dock">` inside the slot; the dock renders in place). Every pre-existing test still passes — the `mount()` change only adds a sibling.

- [ ] **Step 11: Portal the wide dock into the slot**

In `src/components/boards/dock/BoardDock.tsx`:

(a) Replace the imports at lines 3–30 with:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import { setThreadVisibility } from "@/lib/ai/ask/conversation-actions";
import type { BoardIntelligenceRun } from "@/lib/ai/board-intelligence/runs";
import {
  unresolvedCount,
  useBoardIntelligenceStore,
  type DockTab,
} from "@/stores/board-intelligence";
import { loadDockThreads, loadThreadMessages } from "./dock-actions";
import type { DockAgent } from "./AgentSwitcher";
import { DockBody, type DockBodyProps } from "./DockBody";
import {
  clampDockWidth,
  useDockState,
  useNarrowViewport,
  DOCK_MAX_WIDTH,
  DOCK_MIN_WIDTH,
  DOCK_RAIL_WIDTH,
} from "./use-dock-state";
```

(b) After the `deepLinkPending` ref (line 123) add:

```tsx
/**
 * The shell's dock slot (`#app-dock-slot`, app-shell.tsx), looked up AFTER
 * mount: effects run once the whole tree has committed, and the static shell
 * sits above this page in that tree, so the slot always exists by then.
 * State rather than a ref, so finding it re-renders the portal into place.
 * The server render and the first client render both see `null` and render
 * nothing — no hydration mismatch, and no dock on a page without a slot.
 */
const [slot, setSlot] = useState<HTMLElement | null>(null);
useEffect(() => {
  // A post-mount DOM lookup is the one correct time to find a portal target;
  // same exemption as the localStorage read in `useDockState`.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  setSlot(document.getElementById("app-dock-slot"));
}, []);
```

(c) Delete the early return at lines 394–412 (`if (!open) { return ( <div className="fixed right-4 …"> … ); }`) entirely — the closed state is now rendered per surface below.

(d) Replace lines 464–516 (from `if (narrow) {` to the end of the component) with:

```tsx
if (narrow) {
  if (!open) {
    return (
      // A phone has no rail to sit in: the trigger floats over the board.
      <div className="fixed right-4 bottom-4 z-30">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open agent dock"
          className="bg-surface border-border shadow-panel border"
          // Opening is just state. The fetch hangs off `open` in an effect,
          // so the click and a dock restored open from storage take one path.
          onClick={() => setOpen(true)}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      </div>
    );
  }
  return (
    <Sheet open onOpenChange={(next) => !next && setOpen(false)}>
      {/* `[&>button]:hidden` drops SheetContent's built-in X: the dock brings
            its own close affordance and two of them in one header is noise. */}
      <SheetContent
        side="right"
        className="w-full max-w-none gap-0 p-0 [&>button]:hidden"
      >
        <SheetTitle className="sr-only">Agent dock</SheetTitle>
        <SheetDescription className="sr-only">
          Conversations about this board, and threads from your agents.
        </SheetDescription>
        <DockBody {...body} onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

// The wide surface renders through the shell's slot, or not at all. `narrow`
// has already decided this is the wide surface — no second `hidden md:flex`
// breakpoint here, which is what used to open a band where neither surface
// rendered.
if (!slot) return null;

return createPortal(
  <aside
    aria-label="Agent dock"
    data-open={open}
    className="relative flex min-w-0 shrink-0 flex-col overflow-hidden"
    style={{ width: open ? shownWidth : DOCK_RAIL_WIDTH }}
  >
    {open ? (
      // `left-1` is the dock's half of the 8px gutter: <main> drops to mr-1
      // while the slot is filled (app-shell.tsx), this supplies the rest.
      <div
        data-layer="full"
        className="absolute inset-y-0 right-0 left-1 flex flex-col"
      >
        {/* Hairlines brighten rather than thicken: the grip is invisible
              until you reach for it, then it is the border going bright. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent dock"
          aria-valuenow={shownWidth}
          aria-valuemin={DOCK_MIN_WIDTH}
          aria-valuemax={DOCK_MAX_WIDTH}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setWidth(width + RESIZE_STEP);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setWidth(width - RESIZE_STEP);
            }
          }}
          className="hover:bg-border-hover focus-visible:bg-border-bright absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-none"
        />
        <DockBody {...body} onClose={() => setOpen(false)} />
      </div>
    ) : (
      // The mini rail (spec §4). Task 4 puts the tiles under this button.
      <div
        data-layer="mini"
        className="absolute inset-y-0 right-0 left-1 flex flex-col items-center gap-2.5 pt-3"
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open agent dock"
          className="text-muted-foreground hover:text-foreground size-8 shrink-0"
          onClick={() => setOpen(true)}
        >
          <PanelRightOpen className="size-4" />
        </Button>
      </div>
    )}
  </aside>,
  slot,
);
```

(e) Update the docblock at lines 69–82: replace the last paragraph (`It never calls router.push …`) with:

```
 * It never calls router.push or router.refresh: either would re-run the board
 * page's server query — getBoardPayload plus two more reads — to redisplay data
 * the client already holds (gotcha-09).
 *
 * Placement (spec §1): on the wide surface the <aside> is PORTALLED into the
 * static shell's `#app-dock-slot`, so the dock sits on the wash beside the
 * content card — chrome, like the sidebar — rather than inside the card. Below
 * `md` the Sheet is unchanged.
```

- [ ] **Step 12: Run the dock tests and typecheck**

Run: `pnpm vitest run src/components/boards/dock/BoardDock.test.tsx && pnpm typecheck`
Expected: PASS — the four new tests and every existing one (the existing suites only ever query by role/text, and portalled content is in `document.body`).

- [ ] **Step 13: Note the portal on the board page**

In `src/app/(app)/boards/[boardId]/page.tsx`, replace lines 109–115 with:

```tsx
{
  /* Rendered here (it needs the page's roster, access and latest run) but
          NOT laid out here: on the wide surface it portals its <aside> into the
          shell's `#app-dock-slot`, beside the content card. This flex row only
          ever holds the board column. */
}
<BoardDock
  boardId={boardId}
  agents={agentRows ?? []}
  currentUserId={user.id}
  access={access ?? "viewer"}
  initialRun={latestRun}
/>;
```

- [ ] **Step 14: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 15: Commit (orchestrator, by path)**

```bash
git add src/components/app-shell.tsx src/components/app-shell.test.tsx \
  src/components/boards/dock/use-dock-state.ts src/components/boards/dock/use-dock-state.test.ts \
  src/components/boards/dock/BoardDock.tsx src/components/boards/dock/BoardDock.test.tsx \
  "src/app/(app)/boards/[boardId]/page.tsx"
git commit -m "feat(shell): static dock slot, and portal the board dock into it beside the card

The agent dock leaves the board page's flex row and renders through an empty,
static slot in the app shell, so it sits on the wash as the sidebar's twin.
Closed, it is a 48px mini rail (tiles arrive in a later commit); the mobile
floating trigger and Sheet are unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

---

### Task 2: `DockTiles` — the one tab row (horizontal + vertical) and the `pulse-ring` keyframe

**Files:**

- Create: `src/components/boards/dock/DockTiles.tsx`
- Create: `src/components/boards/dock/DockTiles.test.tsx`
- Modify: `src/app/globals.css:127-135` (the `--animate-*` block inside `@theme inline`) and `:168-181` (append a keyframe after `@keyframes thinking-dot`)
- Create: `src/app/globals.motion.test.ts`

**Interfaces:**

- Consumes: `DockTab` from `@/stores/board-intelligence`; `AskAiMark`, `MonolithMark` from `@/components/brand/*`; `Tooltip*` from `@/components/ui/tooltip`.
- Produces (all from `src/components/boards/dock/DockTiles.tsx`):

  ```ts
  export type DockAgent = { id: string; name: string };
  export type DockPresence = "idle" | "running";
  export type DockTile =
    | { kind: "intelligence" }
    | { kind: "ask" }
    | { kind: "agent"; agentId: string };
  export type DockTilesProps = {
    agents: DockAgent[];
    tab: DockTab; // "chat" | "intelligence"
    agentId: string | null; // active chat persona; null = Ask
    badge: number; // unresolved suggestions
    presence?: Readonly<Record<string, DockPresence>>; // by agent id
    orientation?: "horizontal" | "vertical"; // default horizontal
    onSelect: (tile: DockTile) => void;
  };
  export function dockTileId(tile: DockTile): string;
  // "dock-tab-intelligence" | "dock-tab-ask" | `dock-tab-agent-${agentId}`
  export function DockTiles(props: DockTilesProps): JSX.Element;
  ```
  - The tablist is `role="tablist" aria-label="Dock sections"`, `aria-orientation="vertical"` only when vertical. Each tile is a `role="tab"` button with `id={dockTileId(tile)}`, `aria-label` = its name (`"Intelligence"` / `"Intelligence · N suggestion(s)"` / `"Ask"` / `"<Agent>"` / `"<Agent> · running"`), `aria-selected`, roving `tabIndex`, and `aria-controls` **only when selected** (`dock-panel-intelligence` for Intelligence, `dock-panel-chat` otherwise).
  - Test hooks: `[data-dock-badge]` on the badge chip, `[data-dock-presence]` on the presence dot.
  - `globals.css`: `--animate-pulse-ring` utility (`animate-pulse-ring`) + `@keyframes pulse-ring`.

- [ ] **Step 1: Write the failing DockTiles tests**

Create `src/components/boards/dock/DockTiles.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DockTiles, dockTileId, type DockTile } from "./DockTiles";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const names = () =>
  screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label"));

const selectedName = () =>
  screen
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true")
    ?.getAttribute("aria-label");

describe("DockTiles — roster", () => {
  it("renders Intelligence, Ask and every agent as one tab row, names in tooltips not text", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-label",
      "Dock sections",
    );
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation");
    expect(names()).toEqual([
      "Intelligence",
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    // Icon-only: the visible content is a mark or an initial, never the name.
    expect(screen.queryByText("Morning Brief")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).toHaveTextContent("M");
  });

  it("gives every tile a stable id the panels can point at", () => {
    expect(dockTileId({ kind: "intelligence" })).toBe("dock-tab-intelligence");
    expect(dockTileId({ kind: "ask" })).toBe("dock-tab-ask");
    expect(dockTileId({ kind: "agent", agentId: "a1" })).toBe(
      "dock-tab-agent-a1",
    );
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveAttribute(
      "id",
      "dock-tab-agent-a1",
    );
  });
});

describe("DockTiles — badge", () => {
  it("shows the unresolved count on the Intelligence tile and says it in the name", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={3}
        onSelect={() => {}}
      />,
    );
    const intel = screen.getByRole("tab", {
      name: "Intelligence · 3 suggestions",
    });
    const chip = intel.querySelector("[data-dock-badge]");
    expect(chip).toHaveTextContent("3");
    expect(chip!.className).toContain("text-primary");
    expect(chip!.className).toContain("tabular-nums");
  });

  it("singular for one, and hides a zero badge", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={1}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Intelligence · 1 suggestion" }),
    ).toBeInTheDocument();
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("tab", { name: "Intelligence" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dock-badge]")).toBeNull();
  });
});

describe("DockTiles — selection follows tab + agentId", () => {
  it("selects Intelligence when the tab is intelligence, whatever the persona", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="intelligence"
        agentId="a2"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Intelligence");
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-intelligence",
    );
    // Only the OPEN section is mounted, so only the selected tile has a panel
    // to point at — anything else would be a dangling reference.
    expect(
      screen.getByRole("tab", { name: "Overdue Chaser" }),
    ).not.toHaveAttribute("aria-controls");
  });

  it("selects Ask for a null persona and the agent tile for its id, controlling the chat panel", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Ask");
    expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-chat",
    );
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a2"
        badge={0}
        onSelect={() => {}}
      />,
    );
    expect(selectedName()).toBe("Overdue Chaser");
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-controls",
      "dock-panel-chat",
    );
  });

  it("is one tab stop: only the selected tile is tabbable", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        onSelect={() => {}}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it("draws the edge bar under the selected tile (band) or on its right (rail)", () => {
    const { rerender } = render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={() => {}}
      />,
    );
    const ask = () => screen.getByRole("tab", { name: "Ask" });
    expect(ask().className).toContain("after:bg-primary");
    expect(ask().className).toContain("after:-bottom-3");
    expect(ask().className).toContain("border-border");
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }).className,
    ).not.toContain("after:bg-primary");
    rerender(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        orientation="vertical"
        onSelect={() => {}}
      />,
    );
    expect(ask().className).toContain("after:-right-2");
    expect(ask().className).not.toContain("after:-bottom-3");
  });
});

describe("DockTiles — presence", () => {
  it("shows the pulsing dot only on a running agent, and says so in the name", () => {
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId="a1"
        badge={0}
        presence={{ a1: "running", a2: "idle" }}
        onSelect={() => {}}
      />,
    );
    const running = screen.getByRole("tab", {
      name: "Morning Brief · running",
    });
    const dot = running.querySelector("[data-dock-presence]");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("animate-pulse-ring");
    expect(dot!.className).toContain("bg-primary");
    expect(dot!.className).toContain("border-border");
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser" })
        .querySelector("[data-dock-presence]"),
    ).toBeNull();
  });
});

describe("DockTiles — keyboard", () => {
  const tiles = (calls: DockTile[][]) => calls.map((c) => c[0]);

  it("ArrowRight/ArrowLeft move focus AND select, wrapping, from the focused tile", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a1" });
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
    expect(tiles(onSelect.mock.calls)).toHaveLength(4);
  });

  it("Home and End jump to the ends", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{End}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
  });

  it("vertical: ArrowDown/ArrowUp move, ArrowRight/ArrowLeft are ignored", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        orientation="vertical"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    screen.getByRole("tab", { name: "Ask" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a1" });
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
  });

  it("clicking each tile reports it", async () => {
    const onSelect = vi.fn();
    render(
      <DockTiles
        agents={AGENTS}
        tab="chat"
        agentId={null}
        badge={0}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "intelligence" });
    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "ask" });
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "agent", agentId: "a2" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/dock/DockTiles.test.tsx`
Expected: FAIL — `Cannot find module './DockTiles'`.

- [ ] **Step 3: Implement DockTiles**

Create `src/components/boards/dock/DockTiles.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { AskAiMark } from "@/components/brand/ask-ai-mark";
import { MonolithMark } from "@/components/brand/monolith-mark";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DockTab } from "@/stores/board-intelligence";

/** One of the owner's agents, as the board page reads them (`user_agents`). */
export type DockAgent = { id: string; name: string };

/** Live state of an agent, for the presence dot. Phase 1: `running` only
 *  while that persona's chat turn is streaming (spec §2). */
export type DockPresence = "idle" | "running";

/** What a tile stands for. Everything the reader can consult is one of these. */
export type DockTile =
  | { kind: "intelligence" }
  | { kind: "ask" }
  | { kind: "agent"; agentId: string };

export type DockTilesProps = {
  agents: DockAgent[];
  /** Which section is open (persisted, `use-dock-state`). */
  tab: DockTab;
  /** The chat persona on screen — the open thread's, or the one queued for
   *  the next thread. `null` is plain Ask. Ignored while `tab` is
   *  intelligence, which is the active tile regardless. */
  agentId: string | null;
  /** Unresolved Intelligence suggestions. 0 hides the chip. */
  badge: number;
  presence?: Readonly<Record<string, DockPresence>>;
  /** `vertical` is the mini rail: Up/Down move, the edge bar sits on the
   *  right edge (the left rail's bar sits on its left — mirrored twins). */
  orientation?: "horizontal" | "vertical";
  onSelect: (tile: DockTile) => void;
};

const EMPTY_PRESENCE: Readonly<Record<string, DockPresence>> = {};

/** The tab's element id — also what the mounted panel's `aria-labelledby`
 *  names, so the id is shared here rather than spelled in two files. */
export function dockTileId(tile: DockTile): string {
  switch (tile.kind) {
    case "intelligence":
      return "dock-tab-intelligence";
    case "ask":
      return "dock-tab-ask";
    case "agent":
      return `dock-tab-agent-${tile.agentId}`;
  }
}

/** Only the OPEN section is mounted (DockBody), so only the selected tile has
 *  a panel to point at; the chat panel is one panel however many personas. */
function panelIdFor(tile: DockTile): string {
  return tile.kind === "intelligence"
    ? "dock-panel-intelligence"
    : "dock-panel-chat";
}

function isActive(tile: DockTile, tab: DockTab, agentId: string | null) {
  if (tab === "intelligence") return tile.kind === "intelligence";
  if (tile.kind === "intelligence") return false;
  return tile.kind === "ask" ? agentId === null : tile.agentId === agentId;
}

/** The accessible name — and the tooltip. Presence and the badge are said in
 *  words here so neither is colour-only (spec §8). */
function labelFor(
  tile: DockTile,
  agents: DockAgent[],
  badge: number,
  presence: Readonly<Record<string, DockPresence>>,
): string {
  if (tile.kind === "intelligence") {
    if (badge <= 0) return "Intelligence";
    return `Intelligence · ${badge} suggestion${badge === 1 ? "" : "s"}`;
  }
  if (tile.kind === "ask") return "Ask";
  const name = agents.find((a) => a.id === tile.agentId)?.name ?? "Agent";
  return presence[tile.agentId] === "running" ? `${name} · running` : name;
}

/** The 26px face inside the 32px tab. Intelligence and Ask are marks on the
 *  chrome fill; an agent is its initial on a brand tint — the same tile the
 *  transcript uses for that agent's turns (MessageList, `atmosphere`). */
function TileFace({ tile, agents }: { tile: DockTile; agents: DockAgent[] }) {
  if (tile.kind === "intelligence") {
    return (
      <span className="bg-chrome-fill text-brand flex size-6.5 items-center justify-center rounded-sm border">
        <AskAiMark className="size-3.5" />
      </span>
    );
  }
  if (tile.kind === "ask") {
    return (
      <span className="bg-chrome-fill text-foreground flex size-6.5 items-center justify-center rounded-sm border">
        <MonolithMark className="size-3.5" />
      </span>
    );
  }
  const name = agents.find((a) => a.id === tile.agentId)?.name ?? "?";
  return (
    <span className="bg-primary/15 text-primary text-2xs flex size-6.5 items-center justify-center rounded-sm font-bold uppercase">
      {name.slice(0, 1)}
    </span>
  );
}

/**
 * The dock's one tab row: Intelligence, Ask, and each of the owner's agents
 * (spec §2). Replaces the pill tabs (`DockTabs`) and the native persona select
 * (`AgentSwitcher`): agents are the hero, so they ARE the tabs.
 *
 * Icon-only tiles, 32px, hairline that brightens on hover; the active one gets
 * a `border-border` hairline and the sidebar's 3px edge bar — under the tile
 * in the band, on the right edge on the mini rail. Names are tooltips AND the
 * tile's aria-label; the only colour on an idle tile is the accent count.
 *
 * Arrow keys move from the FOCUSED tile, not from the selection: the component
 * is controlled, so a parent that ignores `onSelect` would otherwise pin every
 * arrow press to the same origin — and the two reads disagree for exactly one
 * frame on every real switch, which is the frame the user is pressing in.
 * Roving tabindex: the tablist is ONE tab stop.
 */
export function DockTiles({
  agents,
  tab,
  agentId,
  badge,
  presence = EMPTY_PRESENCE,
  orientation = "horizontal",
  onSelect,
}: DockTilesProps) {
  const vertical = orientation === "vertical";
  const tiles: DockTile[] = [
    { kind: "intelligence" },
    { kind: "ask" },
    ...agents.map((a) => ({ kind: "agent" as const, agentId: a.id })),
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tiles.findIndex((t) => isActive(t, tab, agentId));

  const move = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const focused = refs.current.findIndex(
      (el) => el === document.activeElement,
    );
    const from = focused === -1 ? Math.max(activeIndex, 0) : focused;
    const back = vertical ? "ArrowUp" : "ArrowLeft";
    const forward = vertical ? "ArrowDown" : "ArrowRight";
    let next: number;
    if (e.key === forward) next = (from + 1) % tiles.length;
    else if (e.key === back) next = (from - 1 + tiles.length) % tiles.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tiles.length - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onSelect(tiles[next]);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="tablist"
        aria-label="Dock sections"
        aria-orientation={vertical ? "vertical" : undefined}
        onKeyDown={move}
        className={cn(
          "flex min-w-0 shrink-0",
          vertical ? "flex-col items-center gap-2" : "items-center gap-1",
        )}
      >
        {tiles.map((tile, i) => {
          const selected = i === activeIndex;
          const label = labelFor(tile, agents, badge, presence);
          const running =
            tile.kind === "agent" && presence[tile.agentId] === "running";
          return (
            <Tooltip key={dockTileId(tile)}>
              <TooltipTrigger asChild>
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={dockTileId(tile)}
                  aria-label={label}
                  aria-selected={selected}
                  aria-controls={selected ? panelIdFor(tile) : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(tile)}
                  className={cn(
                    "focus-visible:ring-ring hover:border-border-hover ease-keystone relative flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11",
                    selected &&
                      "border-border after:bg-primary after:absolute after:content-['']",
                    // The 3px bar sits flush on the band's bottom edge (tile is
                    // 32px in a 56px band → 12px below it) or on the rail's
                    // right edge (32px in a 48px rail → 8px beside it).
                    selected &&
                      (vertical
                        ? "after:inset-y-2 after:-right-2 after:w-[3px] after:rounded-l-full"
                        : "after:inset-x-2 after:-bottom-3 after:h-[3px] after:rounded-t-full"),
                  )}
                >
                  <TileFace tile={tile} agents={agents} />
                  {tile.kind === "intelligence" && badge > 0 ? (
                    <span
                      aria-hidden="true"
                      data-dock-badge
                      className="text-primary text-3xs absolute top-0 right-0 translate-x-1/3 -translate-y-1/3 font-semibold tabular-nums"
                    >
                      {badge}
                    </span>
                  ) : null}
                  {running ? (
                    // A 2px `border-border` hairline separates the dot from the
                    // tile — not a wash-coloured ring, the wash is a gradient
                    // (spec §7). The pulse is a box-shadow: nothing scales.
                    <span
                      aria-hidden="true"
                      data-dock-presence
                      className="bg-primary border-border animate-pulse-ring absolute right-0.5 bottom-0.5 size-[9px] rounded-full border-2"
                    />
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent side={vertical ? "left" : "bottom"}>
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/components/boards/dock/DockTiles.test.tsx`
Expected: PASS (13 tests).

- [ ] **Step 5: Write the failing keyframe test**

Create `src/app/globals.motion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * The dock's presence dot (`animate-pulse-ring`, DockTiles.tsx) — spec §5/§7.
 * Read from the stylesheet so the utility can never drift from the class the
 * component uses, and so "nothing scales" is a check, not a comment.
 */
describe("presence pulse (agent dock)", () => {
  it("declares the pulse-ring utility in @theme and its keyframes", () => {
    expect(CSS).toMatch(
      /--animate-pulse-ring:\s*pulse-ring 1\.4s cubic-bezier\(0\.16, 1, 0\.3, 1\)\s+infinite;/,
    );
    expect(CSS).toMatch(/@keyframes pulse-ring \{/);
  });

  it("only ever animates box-shadow — nothing scales, ring 0 → 6px", () => {
    const block = /@keyframes pulse-ring \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? "";
    expect(block).toContain("box-shadow: 0 0 0 0");
    expect(block).toContain("box-shadow: 0 0 0 6px transparent");
    expect(block).not.toMatch(/transform|scale\(/);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/app/globals.motion.test.ts`
Expected: FAIL — no `--animate-pulse-ring` in the stylesheet.

- [ ] **Step 7: Add the utility and the keyframe**

In `src/app/globals.css`, replace lines 130–134 (the `thinking-dot` declaration) with:

```css
/* Long-running "the machine is working" tell (Ask AI's pre-token stretch is
     routinely 25–42s). Applied to staggered dots so it reads as a travelling
     wave; the reduced-motion block below stands it down. */
--animate-thinking-dot: thinking-dot 1.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
/* Agent presence (board dock): the answering agent's dot breathes while its
     turn streams. A box-shadow ring 0 → 6px — nothing scales — on the keystone
     curve; the reduced-motion block below collapses it like every animation. */
--animate-pulse-ring: pulse-ring 1.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
```

Then after `@keyframes thinking-dot { … }` (which ends at line 181, `}`), insert:

```css
@keyframes pulse-ring {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--brand) 55%, transparent);
  }
  60% {
    box-shadow: 0 0 0 6px transparent;
  }
}
```

- [ ] **Step 8: Run the stylesheet tests**

Run: `pnpm vitest run src/app/globals.motion.test.ts src/app/globals.contrast.test.ts src/app/globals.tokens.test.ts`
Expected: PASS — the new test, and the existing token/contrast suites unaffected (no colour tokens were added).

- [ ] **Step 9: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (`text-2xs`/`text-3xs` are scale tokens; `hover:border-border-hover` is a hairline, not an opaque fill.)

- [ ] **Step 10: Commit (orchestrator, by path)**

```bash
git add src/components/boards/dock/DockTiles.tsx src/components/boards/dock/DockTiles.test.tsx \
  src/app/globals.css src/app/globals.motion.test.ts
git commit -m "feat(boards): dock-tiles tab row with presence dot, badge and the pulse-ring keyframe

One tablist for everything the reader consults — Intelligence, Ask and each
agent — as 32px icon tiles with tooltip names, a roving tabindex (Left/Right
or Up/Down on the rail, Home/End), the sidebar's edge bar on the active tile,
an accent count on Intelligence and a pulsing presence dot on a running agent.
Not wired into the dock yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

---

### Task 3: `surface="atmosphere"` on `AskChat` / `MessageList` / `Composer` (+ `onBusyChange`)

**Files:**

- Create: `src/components/ai/ask/surface.ts`
- Modify: `src/components/ai/ask/MessageList.tsx:46-81` (Bubble), `:92-133` (props), `:143-155` (name lookup), `:157-159` (column), `:203-211` (turn wrapper), `:255-261` (streaming bubble)
- Modify: `src/components/ai/ask/Composer.tsx:40-71` (props), `:140-142` (wrappers), `:169-175` (form), `:264-277` (helper Kicker)
- Modify: `src/components/ai/ask/AskChat.tsx:66-129` (props), `:212-214` and `:319-324` (busy hooks), `:413-428` (MessageList), `:445-459` (notice + Composer)
- Test: `src/components/ai/ask/MessageList.test.tsx`, `src/components/ai/ask/Composer.test.tsx`, `src/components/ai/ask/AskChat.test.tsx` (append describes)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - `export type ChatSurface = "card" | "atmosphere"` from `src/components/ai/ask/surface.ts`.
  - `AskChat` props gain `surface?: ChatSurface` (default `"card"`, threaded to `MessageList` and `Composer`) and `onBusyChange?: (busy: boolean) => void` — called with `true` when a turn is accepted (right after the one-turn guard) and `false` in the turn's `finally`, on every path (done, error, failed send, drop recovery).
  - `MessageList` props gain `surface?: ChatSurface`. Under `atmosphere`: the column is `flex flex-col gap-3.5 px-3.5 py-2` (no `max-w-3xl`/`mx-auto`); user turns are `bg-chrome-fill border-border … rounded-lg`; an assistant turn whose agent resolves to a name renders a brand-tinted initial tile (`data-turn-tile`), a plain assistant turn keeps the `AskAiMark` on `bg-chrome-fill`; every turn wrapper carries `data-turn` and, under `atmosphere`, the entrance classes `starting:translate-x-3.5 starting:opacity-0 ease-keystone transition-[opacity,translate] duration-[360ms] [&:nth-child(1)]:delay-[120ms] [&:nth-child(2)]:delay-[180ms] [&:nth-child(3)]:delay-[240ms]`.
  - `Composer` props gain `surface?: ChatSurface`. Under `atmosphere`: outer wrapper `starting:translate-y-2.5 starting:opacity-0 ease-keystone px-2.5 pb-2.5 transition-[opacity,translate] duration-[360ms] delay-[200ms]`; inner `relative`; form `bg-surface border-border shadow-content-lift hover:border-border-hover focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors`; helper Kicker `mt-1.5 block px-1`.
  - The `"card"` branch strings are today's literals, unchanged.

- [ ] **Step 1: Write the failing MessageList tests**

Append to `src/components/ai/ask/MessageList.test.tsx`:

```tsx
// Spec §3: the dock's transcript sits on the wash — no card, no centring —
// and an agent's turn carries the same initial tile as its band tile. `/ask`
// keeps the card, byte-for-byte.
describe("MessageList — surface", () => {
  const TURNS: UIMessage[] = [
    { id: "m1", role: "user", content: "what slipped?" },
    { id: "m2", role: "assistant", content: "Three items.", agentId: "a-ops" },
    { id: "m3", role: "assistant", content: "Plain answer.", agentId: null },
  ];

  it("keeps the /ask card byte-for-byte by default", () => {
    const { container } = renderList(TURNS, { agents });
    const column = container.querySelector("[data-scroll-container] > div")!;
    expect(column.className).toBe(
      "mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6",
    );
    expect(screen.getByText("what slipped?").className).toBe(
      "bg-surface-muted max-w-[85%] rounded-lg border px-3.5 py-2 text-sm whitespace-pre-wrap",
    );
    const turn = container.querySelector("[data-turn]")!;
    expect(turn.className).toBe("flex flex-col gap-3");
    // Both assistant tiles are the Ask AI mark on a raised surface.
    const tiles = [...container.querySelectorAll("[data-turn-tile]")];
    expect(tiles).toHaveLength(2);
    for (const tile of tiles) {
      expect(tile.className).toBe(
        "bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border",
      );
      expect(tile.querySelector("svg")).not.toBeNull();
    }
  });

  it("on the wash: full-width column, chrome-fill user pill, initial tile for a persona, mark for plain Ask", () => {
    const { container } = renderList(TURNS, { agents, surface: "atmosphere" });
    const column = container.querySelector("[data-scroll-container] > div")!;
    expect(column.className).not.toContain("max-w-3xl");
    expect(column.className).toContain("px-3.5");
    const pill = screen.getByText("what slipped?");
    expect(pill.className).toContain("bg-chrome-fill");
    expect(pill.className).toContain("border-border");
    expect(pill.className).not.toContain("bg-surface-muted");
    // Ops answered → its initial on the brand tint, like the band tile.
    const opsTile = screen
      .getByText("Three items.")
      .closest("[data-turn]")!
      .querySelector("[data-turn-tile]")!;
    expect(opsTile).toHaveTextContent("O");
    expect(opsTile.className).toContain("bg-primary/15");
    expect(opsTile.querySelector("svg")).toBeNull();
    // Nobody on record → the Ask AI mark, on the chrome fill (no card).
    const plainTile = screen
      .getByText("Plain answer.")
      .closest("[data-turn]")!
      .querySelector("[data-turn-tile]")!;
    expect(plainTile.querySelector("svg")).not.toBeNull();
    expect(plainTile.className).toContain("bg-chrome-fill");
    expect(plainTile.className).not.toContain("bg-surface");
  });

  it("uses the initial tile for the live streaming bubble too, when its agent is known", () => {
    const { container } = renderList([], {
      agents,
      streamingText: "Working on it",
      streamingAgentId: "a-ops",
      surface: "atmosphere",
    });
    expect(container.querySelector("[data-turn-tile]")).toHaveTextContent("O");
  });

  it("slides each turn in on the wash, the first three staggered — and never on /ask", () => {
    const { container, unmount } = renderList(TURNS, { surface: "atmosphere" });
    const turns = [...container.querySelectorAll("[data-turn]")];
    expect(turns[0].className).toContain("starting:translate-x-3.5");
    expect(turns[0].className).toContain("transition-[opacity,translate]");
    expect(turns[0].className).toContain("[&:nth-child(1)]:delay-[120ms]");
    expect(turns[0].className).toContain("[&:nth-child(3)]:delay-[240ms]");
    unmount();
    renderList(TURNS);
    expect(document.querySelector("[data-turn]")!.className).not.toContain(
      "starting:",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx`
Expected: the four new tests FAIL (`[data-turn]` / `[data-turn-tile]` hooks missing; `surface` unknown).

- [ ] **Step 3: Implement the MessageList surface**

Create `src/components/ai/ask/surface.ts`:

```ts
/**
 * Where a chat surface renders. `card` is `/ask`: a centred column inside the
 * content card with a raised composer strip. `atmosphere` is the board dock
 * (spec 2026-09-11-agent-dock-atmosphere §3): the transcript sits directly on
 * the app wash — no card, the column is the width — and the composer is the
 * one raised surface. The default is `card`, so `/ask` never changes.
 */
export type ChatSurface = "card" | "atmosphere";
```

In `src/components/ai/ask/MessageList.tsx`:

(a) Add to the imports (after line 9):

```tsx
import type { ChatSurface } from "./surface";
```

(b) Replace lines 46–81 (the `Bubble` component) with:

```tsx
/** Atmosphere entrance (spec §5): each turn slides in 14px from the right on
 *  mount via `@starting-style`, the first three staggered, the rest flat.
 *  Transitions on `translate` (Tailwind v4's translate utilities write the
 *  `translate` property, not `transform`), so the global reduced-motion rule
 *  collapses them like everything else. */
const TURN_ENTRANCE =
  "starting:translate-x-3.5 starting:opacity-0 ease-keystone transition-[opacity,translate] duration-[360ms] [&:nth-child(1)]:delay-[120ms] [&:nth-child(2)]:delay-[180ms] [&:nth-child(3)]:delay-[240ms]";

/** A single chat turn. User turns sit right in a bubble; assistant turns sit
 *  left, full-width, chrome-neutral — named by a `Kicker` above the text so
 *  the mark (gutter) and the name (label) each do one job.
 *
 *  On the wash (`atmosphere`) the user bubble is the chrome fill rather than a
 *  muted card, and an assistant turn with a real persona carries that agent's
 *  brand-tinted initial — the same tile as its band tile (DockTiles) — while a
 *  plain assistant turn keeps the Ask AI mark. */
function Bubble({
  role,
  content,
  agentName,
  persona = false,
  surface = "card",
}: {
  role: UIMessage["role"];
  content: string;
  /** Assistant turns only — who answered. Ignored for user turns. */
  agentName?: string;
  /** `agentName` is a real agent (resolved from the roster or the historical
   *  names), not the plain-assistant fallback. */
  persona?: boolean;
  surface?: ChatSurface;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className={
            surface === "card"
              ? "bg-surface-muted max-w-[85%] rounded-lg border px-3.5 py-2 text-sm whitespace-pre-wrap"
              : "bg-chrome-fill border-border max-w-[85%] rounded-lg border px-3 py-1.5 text-sm whitespace-pre-wrap"
          }
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      {surface === "atmosphere" && persona ? (
        <span
          data-turn-tile
          aria-hidden="true"
          className="bg-primary/15 text-primary text-2xs mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm font-bold uppercase"
        >
          {agentName?.slice(0, 1)}
        </span>
      ) : (
        <span
          data-turn-tile
          className={
            surface === "card"
              ? "bg-surface text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border"
              : "bg-chrome-fill text-brand mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border"
          }
        >
          <AskAiMark className="size-3.5" />
        </span>
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        {agentName ? <Kicker className="mb-1 block">{agentName}</Kicker> : null}
        <div className="text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}
```

(c) In the `MessageList` signature, add the prop. After `readOnly = false,` (line 104) add `surface = "card",`; and after the `readOnly?: boolean;` docblock+field (lines 129–132) add:

```tsx
  /** `card` (/ask, default) or `atmosphere` (the board dock, on the wash).
   *  Purely presentational — see `surface.ts`. */
  surface?: ChatSurface;
```

(d) Replace lines 146–149 (`const nameOf = …`) with:

```tsx
// A real name, or nothing — the roster first, then the historical names.
const resolvedName = (id?: string | null) =>
  agentHandles.find((a) => a.agentId === id)?.name ??
  (id ? agentNames[id] : undefined);
const nameOf = (id?: string | null) => resolvedName(id) ?? PLAIN_ASSISTANT_NAME;
```

(e) Replace line 159 (the inner column div) with:

```tsx
      <div
        className={
          surface === "card"
            ? "mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6"
            : "flex flex-col gap-3.5 px-3.5 py-2"
        }
      >
```

(f) Replace lines 203–211 (the turn wrapper + `Bubble` for a persisted message) with:

```tsx
          return (
            <div
              key={m.id}
              data-turn
              className={cn(
                "flex flex-col gap-3",
                surface === "atmosphere" && TURN_ENTRANCE,
              )}
            >
              <Bubble
                role={m.role}
                content={m.content}
                agentName={
                  m.role === "assistant" ? nameOf(m.agentId) : undefined
                }
                persona={
                  m.role === "assistant" &&
                  resolvedName(m.agentId) !== undefined
                }
                surface={surface}
              />
```

(g) Replace lines 255–261 (the streaming `Bubble`) with:

```tsx
{
  streamingText ? (
    <Bubble
      role="assistant"
      content={streamingText}
      agentName={nameOf(streamingAgentId)}
      persona={resolvedName(streamingAgentId) !== undefined}
      surface={surface}
    />
  ) : null;
}
```

Note: the card branch of the turn wrapper stays `"flex flex-col gap-3"` exactly — `cn("flex flex-col gap-3", false)` yields that literal, which the test pins.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/components/ai/ask/MessageList.test.tsx`
Expected: PASS (all, including the pre-existing attribution suite).

- [ ] **Step 5: Write the failing Composer tests**

Append to `src/components/ai/ask/Composer.test.tsx`:

```tsx
// Spec §3: in the dock the composer is the ONE raised surface on the wash;
// its /ask strip (bg + top hairline + centred column) is gone. /ask itself
// keeps every class byte-for-byte.
describe("Composer — surface", () => {
  it("keeps the /ask card wrapper byte-for-byte by default", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toBe("bg-background border-t px-4 py-3");
    expect(outer.firstElementChild!.className).toBe(
      "relative mx-auto max-w-3xl",
    );
    expect(screen.getByRole("textbox").closest("form")!.className).toBe(
      "bg-surface focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors",
    );
    expect(screen.getByText("⌘↵ to send").className).toContain("max-w-3xl");
  });

  it("is the one raised surface on the wash: no strip, lifted form, hairline that brightens", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} surface="atmosphere" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).not.toMatch(
      /\bborder-t\b|\bbg-background\b|max-w-3xl/,
    );
    expect(outer.className).toContain("px-2.5");
    expect(outer.className).toContain("pb-2.5");
    expect(outer.firstElementChild!.className).toBe("relative");
    const form = screen.getByRole("textbox").closest("form")!;
    for (const cls of [
      "bg-surface",
      "border-border",
      "shadow-content-lift",
      "hover:border-border-hover",
      "focus-within:border-border-bright",
      "rounded-lg",
    ]) {
      expect(form.className).toContain(cls);
    }
    // The helper line is the same Kicker, aligned to the dock's px-3.5 (10 + 4).
    const helper = screen.getByText("⌘↵ to send");
    expect(helper.className).not.toContain("max-w-3xl");
    expect(helper.className).toContain("px-1");
  });

  it("rises into place on the wash (translate-y-2.5 → 0 at 200ms), on the wrapper not the form", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} surface="atmosphere" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("starting:translate-y-2.5");
    expect(outer.className).toContain("transition-[opacity,translate]");
    expect(outer.className).toContain("delay-[200ms]");
    // The hover/focus hairline must not inherit the entrance delay.
    expect(
      screen.getByRole("textbox").closest("form")!.className,
    ).not.toContain("delay-");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/Composer.test.tsx`
Expected: the two `atmosphere` tests FAIL (`surface` is ignored); the default test passes already.

- [ ] **Step 7: Implement the Composer surface**

In `src/components/ai/ask/Composer.tsx`:

(a) Add to the imports (after line 16):

```tsx
import type { ChatSurface } from "./surface";
```

(b) In the signature, after `onRetry,` (line 45) add `surface = "card",`; after the `onSubmit` field (line 70) add:

```tsx
  /** `card` (/ask, default): a strip on the page background with a top
   *  hairline and a centred column. `atmosphere` (the board dock): no strip —
   *  the form itself is the one raised surface on the wash, and it rises into
   *  place on mount. See `surface.ts`. */
  surface?: ChatSurface;
```

(c) Replace lines 140–142 with:

```tsx
  const card = surface === "card";
  return (
    <div
      className={
        card
          ? "bg-background border-t px-4 py-3"
          : "starting:translate-y-2.5 starting:opacity-0 ease-keystone px-2.5 pb-2.5 transition-[opacity,translate] duration-[360ms] delay-[200ms]"
      }
    >
      <div className={card ? "relative mx-auto max-w-3xl" : "relative"}>
```

(d) Replace lines 169–175 (the `<form className=… onSubmit=…>` opening) with:

```tsx
        <form
          className={
            card
              ? "bg-surface focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors"
              : "bg-surface border-border shadow-content-lift hover:border-border-hover focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors"
          }
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
```

(e) Replace line 269 (`<Kicker className="mx-auto mt-1.5 block max-w-3xl px-1">`) with:

```tsx
      <Kicker className={card ? "mx-auto mt-1.5 block max-w-3xl px-1" : "mt-1.5 block px-1"}>
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm vitest run src/components/ai/ask/Composer.test.tsx`
Expected: PASS.

- [ ] **Step 9: Write the failing AskChat tests**

Append to `src/components/ai/ask/AskChat.test.tsx`:

```tsx
// The dock renders this component on the wash (spec §3) and needs to know
// when a turn is live (presence dot, §2). /ask passes neither and changes not
// at all.
describe("AskChat — surface and busy signal", () => {
  it("defaults to the /ask card: composer strip, muted user bubble, bordered read-only notice", () => {
    render(
      <AskChat conversationId="c1" initialMessages={[USER_ROW]} readOnly />,
    );
    expect(screen.getByText(USER_ROW.content).className).toContain(
      "bg-surface-muted",
    );
    const note = screen.getByText(/only its owner can reply/i);
    expect(note.className).toBe(
      "text-muted-foreground border-t px-4 py-3 text-sm",
    );
  });

  it('threads surface="atmosphere" to the transcript, the composer and the notice', () => {
    const { rerender } = render(
      <AskChat
        conversationId="c1"
        initialMessages={[USER_ROW]}
        surface="atmosphere"
      />,
    );
    expect(screen.getByText(USER_ROW.content).className).toContain(
      "bg-chrome-fill",
    );
    const form = screen.getByLabelText("Your question").closest("form")!;
    const wrapper = form.parentElement!.parentElement!;
    expect(wrapper.className).not.toMatch(/\bborder-t\b|\bbg-background\b/);
    expect(form.className).toContain("shadow-content-lift");

    rerender(
      <AskChat
        conversationId="c1"
        initialMessages={[USER_ROW]}
        surface="atmosphere"
        readOnly
      />,
    );
    const note = screen.getByText(/only its owner can reply/i);
    expect(note.className).toBe("text-muted-foreground px-3.5 py-3 text-sm");
  });

  it("reports the turn busy from submit until it settles — including a failed send", async () => {
    const onBusyChange = vi.fn();
    const open = holdCreateConversation();
    render(
      <AskChat
        conversationId={null}
        initialMessages={[]}
        onBusyChange={onBusyChange}
      />,
    );
    ask();
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
    expect(onBusyChange).toHaveBeenCalledTimes(1);
    await act(async () => {
      open();
    });
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    expect(onBusyChange).toHaveBeenCalledTimes(2);

    // A refused send is still a settled turn. The thread exists now ("c1"),
    // so the second send goes through appendUserMessage, not createConversation.
    (appendUserMessage as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: "Couldn't reach the server.",
    });
    onBusyChange.mockClear();
    ask("again");
    await screen.findByRole("alert");
    expect(onBusyChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});
```

- [ ] **Step 10: Run it to verify it fails**

Run: `pnpm vitest run src/components/ai/ask/AskChat.test.tsx`
Expected: the `atmosphere` and busy tests FAIL; the default test passes.

- [ ] **Step 11: Implement the AskChat props**

In `src/components/ai/ask/AskChat.tsx`:

(a) Add to the imports (after line 25):

```tsx
import type { ChatSurface } from "./surface";
```

(b) In the signature, after `onTurnComplete,` (line 80) add `surface = "card",` and `onBusyChange,`; after the `onTurnComplete?: () => void;` field (line 128) add:

```tsx
  /** `card` (/ask, default) or `atmosphere` (the board dock, on the wash).
   *  Threaded to `MessageList` and `Composer`; see `surface.ts`. */
  surface?: ChatSurface;
  /** `true` the moment a turn is accepted (before the first Server Action),
   *  `false` when it settles on ANY path — done, error, refused send, drop
   *  recovery. The dock reads it for the answering agent's presence dot. */
  onBusyChange?: (busy: boolean) => void;
```

(c) Replace lines 212–214 with:

```tsx
if (turnInFlight.current) return;
turnInFlight.current = true;
setTurnBusy(true);
onBusyChange?.(true);
```

(d) Replace lines 319–324 (the `finally` block) with:

```tsx
    } finally {
      // Released on every path — a stuck flag would strand the composer, which
      // is the failure mode this guard exists to avoid, not to create. The
      // surface hears the same release, so a presence dot can never stick.
      turnInFlight.current = false;
      setTurnBusy(false);
      onBusyChange?.(false);
    }
```

(e) In the `<MessageList …/>` element (lines 413–428) add `surface={surface}` after `readOnly={readOnly}`.

(f) Replace lines 445–459 with:

```tsx
{
  readOnly ? (
    <p
      className={
        surface === "card"
          ? "text-muted-foreground border-t px-4 py-3 text-sm"
          : "text-muted-foreground px-3.5 py-3 text-sm"
      }
    >
      This thread was shared with the board. You can read it, but only its owner
      can reply.
    </p>
  ) : (
    <Composer
      disabled={turnBusy || streaming || dropState === "checking"}
      agents={agents}
      agentId={personaId}
      error={composerError}
      onRetry={retryLastSend}
      onSubmit={onSubmit}
      surface={surface}
    />
  );
}
```

- [ ] **Step 12: Run the three suites, typecheck, lint**

Run: `pnpm vitest run src/components/ai/ask && pnpm typecheck && pnpm lint`
Expected: PASS / clean. (`ThreadHeader`, `ConversationRail`, `use-ask-stream` suites in the same folder are untouched and still green.)

- [ ] **Step 13: Commit (orchestrator, by path)**

```bash
git add src/components/ai/ask/surface.ts src/components/ai/ask/AskChat.tsx src/components/ai/ask/AskChat.test.tsx \
  src/components/ai/ask/MessageList.tsx src/components/ai/ask/MessageList.test.tsx \
  src/components/ai/ask/Composer.tsx src/components/ai/ask/Composer.test.tsx
git commit -m "feat(ai): atmosphere surface for the chat, transcript and composer; busy signal for the dock

An optional surface prop (default card) lets the board dock render the same
chat on the app wash: no centred column, chrome-fill user pills, an agent's
initial tile on its turns, and the composer as the one raised surface with a
staggered entrance. /ask passes nothing and keeps every class byte-for-byte.
onBusyChange reports a live turn so the dock can pulse the answering agent.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

---

### Task 4: `DockBody` relayout, tile selection semantics, presence, mini-rail tiles and motion

**Files:**

- Modify: `src/components/boards/dock/DockBody.tsx` (full rewrite — the file is 240 lines today; every line changes)
- Create: `src/components/boards/dock/DockBody.test.tsx`
- Modify: `src/components/boards/dock/BoardDock.tsx` (as left by Task 1 — edits are given by anchor text)
- Modify: `src/components/boards/dock/BoardDock.test.tsx` (as left by Task 1 — mock, helpers, six existing tests, three new describes)

**Interfaces:**

- Consumes: `DockTiles`, `dockTileId`, `DockAgent`, `DockPresence`, `DockTile` (Task 2); `AskChat`'s `surface` + `onBusyChange` (Task 3); `DOCK_RAIL_WIDTH`, the portal + `data-layer` contract and `mount()`/`aside()`/`stubNarrow()` test helpers (Task 1).
- Produces:
  - `DockBodyProps` (replaces the old shape — `switcherValue`, `switcherLocked`, `onAgentChange`, `onTabChange` are gone):
    ```ts
    export type DockBodyProps = {
      agents: DockAgent[];
      agentNames: Record<string, string>;
      tileAgentId: string | null; // active chat persona (null = Ask)
      presence: Readonly<Record<string, DockPresence>>;
      onSelectTile: (tile: DockTile) => void;
      onNew: () => void;
      onClose?: () => void;
      error: string | null;
      onRetry?: () => void;
      loading: boolean;
      boardThreads: BoardThreadRow[];
      agentThreads: BoardThreadRow[];
      activeId: string | null;
      activeThread: BoardThreadRow | null;
      currentUserId: string;
      onSelectThread: (id: string) => void;
      onToggleShare: (thread: BoardThreadRow) => void;
      sharingId: string | null;
      threadLoading: boolean;
      readOnly: boolean;
      boardId: string;
      messages: UIMessage[];
      agentId: string | null;
      chatKey: string;
      onStarted: (conversationId: string) => void;
      onTurnComplete: () => void;
      onBusyChange: (busy: boolean) => void;
      tab: DockTab;
      badge: number;
      canApply: boolean;
      runOnMount: boolean;
      onRanOnMount: () => void;
    };
    ```
  - DOM contract: band `<header>` (h-14) holds the `DockTiles` tablist, a ghost `Button aria-label="New thread"` (chat tab only, disabled while `activeId === null`) and `Button aria-label="Close agent dock"` (when `onClose`). Chat panel `#dock-panel-chat role="tabpanel" aria-labelledby={dockTileId(chat tile)}`. Title row: `<h2>` with the thread title or `New thread`, a `Shared` kicker when the open thread's `visibility === "board"`, a persona kicker (`agentNames[tileAgentId] ?? "Ask"`). Threads ledger: a `button[aria-expanded][aria-controls="dock-threads"]` whose text starts with `Threads`, then `#dock-threads` (`hidden` until expanded, folds again when a thread is selected). Error line without hairlines. Transcript: `AskChat surface="atmosphere"`.
  - `BoardDock`: `<aside data-open data-animating?>` with **both** layer wrappers always mounted (`[data-layer="full"]`, `[data-layer="mini"]`), their contents mounted only while their side shows or is leaving; the leaving layer is `inert` + `aria-hidden`. `transition-[width] duration-[360ms] ease-keystone` only while `data-animating` is set. Mini rail: `Open agent dock` button + `DockTiles orientation="vertical"`; a tile click opens on that tile.

- [ ] **Step 1: Write the failing DockBody tests**

Create `src/components/boards/dock/DockBody.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";

// The chat and the Intelligence body have their own suites; here they are
// probes for what the dock body hands them.
vi.mock("@/components/ai/ask/AskChat", () => ({
  AskChat: (p: { surface?: string; onBusyChange?: (b: boolean) => void }) => (
    <div
      data-testid="ask-chat"
      data-surface={p.surface ?? ""}
      data-busy-wired={p.onBusyChange ? "yes" : "no"}
    />
  ),
}));
vi.mock("./intelligence/IntelligenceTab", () => ({
  IntelligenceTab: () => (
    <div
      id="dock-panel-intelligence"
      role="tabpanel"
      aria-labelledby="dock-tab-intelligence"
    >
      intelligence body
    </div>
  ),
}));

import { DockBody, type DockBodyProps } from "./DockBody";

const AGENTS = [
  { id: "a1", name: "Morning Brief" },
  { id: "a2", name: "Overdue Chaser" },
];

const thread = (over: Partial<BoardThreadRow> = {}): BoardThreadRow => ({
  id: "c1",
  title: "About the roadmap",
  updated_at: "2026-08-03T10:00:00Z",
  agent_id: null,
  board_id: "b1",
  visibility: "private",
  user_id: "me",
  ...over,
});

function props(over: Partial<DockBodyProps> = {}): DockBodyProps {
  return {
    agents: AGENTS,
    agentNames: { a1: "Morning Brief", a2: "Overdue Chaser" },
    tileAgentId: null,
    presence: {},
    onSelectTile: vi.fn(),
    onNew: vi.fn(),
    onClose: vi.fn(),
    error: null,
    loading: false,
    boardThreads: [],
    agentThreads: [],
    activeId: null,
    activeThread: null,
    currentUserId: "me",
    onSelectThread: vi.fn(),
    onToggleShare: vi.fn(),
    sharingId: null,
    threadLoading: false,
    readOnly: false,
    boardId: "b1",
    messages: [],
    agentId: null,
    chatKey: "chat-0",
    onStarted: vi.fn(),
    onTurnComplete: vi.fn(),
    onBusyChange: vi.fn(),
    tab: "chat",
    badge: 0,
    canApply: true,
    runOnMount: false,
    onRanOnMount: vi.fn(),
    ...over,
  };
}

const ledger = () => screen.getByRole("button", { name: /^threads/i });

describe("DockBody — band", () => {
  it("puts the tile row, New and Close in one 56px band", () => {
    render(<DockBody {...props()} />);
    expect(screen.getByRole("banner")).toHaveClass("h-14");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New thread" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close agent dock" }),
    ).toBeInTheDocument();
  });

  it("enables New once a thread is open, and omits Close inside the Sheet", () => {
    render(<DockBody {...props({ activeId: "c1", onClose: undefined })} />);
    expect(screen.getByRole("button", { name: "New thread" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Close agent dock" }),
    ).toBeNull();
  });

  it("hands the band over to Intelligence: no New, no title row, its own panel", () => {
    render(<DockBody {...props({ tab: "intelligence" })} />);
    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-intelligence",
    );
    expect(screen.getByRole("tab", { name: "Intelligence" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("DockBody — title row", () => {
  it("says New thread · Ask when nothing is open", () => {
    render(<DockBody {...props()} />);
    expect(
      screen.getByRole("heading", { name: "New thread" }),
    ).toBeInTheDocument();
    const row = screen.getByRole("heading").parentElement!;
    expect(row).toHaveTextContent("Ask");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-ask",
    );
  });

  it("shows the open thread's title and its persona, and labels the panel by that tile", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({ agent_id: "a2" }),
          tileAgentId: "a2",
        })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "About the roadmap" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading").parentElement).toHaveTextContent(
      "Overdue Chaser",
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-agent-a2",
    );
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("appends a Shared chip for a thread shared with the board", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({
            user_id: "someone-else",
            visibility: "board",
          }),
          readOnly: true,
        })}
      />,
    );
    const row = screen.getByRole("heading").parentElement!;
    expect(row).toHaveTextContent("Shared");
  });
});

describe("DockBody — threads ledger", () => {
  const rows = [thread(), thread({ id: "c2", title: "Sprint review" })];

  it("is collapsed by default, counts the threads, and unfolds on click", async () => {
    render(<DockBody {...props({ boardThreads: rows })} />);
    expect(ledger()).toHaveAttribute("aria-expanded", "false");
    expect(ledger()).toHaveAttribute("aria-controls", "dock-threads");
    expect(ledger()).toHaveTextContent("2");
    const well = document.getElementById("dock-threads")!;
    expect(well).toHaveAttribute("hidden");
    expect(well.className).toContain("max-h-48");

    await userEvent.click(ledger());
    expect(ledger()).toHaveAttribute("aria-expanded", "true");
    expect(well).not.toHaveAttribute("hidden");
    expect(screen.getByText("Sprint review")).toBeVisible();
  });

  it("folds again when a thread is picked, and reports the pick", async () => {
    const onSelectThread = vi.fn();
    render(<DockBody {...props({ boardThreads: rows, onSelectThread })} />);
    await userEvent.click(ledger());
    await userEvent.click(screen.getByText("Sprint review"));
    expect(onSelectThread).toHaveBeenCalledWith("c2");
    expect(ledger()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("dock-threads")).toHaveAttribute("hidden");
  });

  it("is a ledger header: kicker, hairline rule that brightens, mono count, chevron", () => {
    render(<DockBody {...props({ boardThreads: rows })} />);
    const rule = ledger().querySelector("[data-ledger-rule]")!;
    expect(rule.className).toContain("bg-border");
    expect(rule.className).toContain("group-hover/ledger:bg-border-bright");
    expect(ledger().querySelector(".tabular-nums")).toHaveTextContent("2");
    expect(ledger().querySelector("svg")).not.toBeNull();
  });

  it("shows the list skeleton inside the well while the first read is in flight, painted for the wash", async () => {
    render(<DockBody {...props({ loading: true })} />);
    await userEvent.click(ledger());
    const blocks = document
      .getElementById("dock-threads")!
      .querySelectorAll(".animate-pulse");
    expect(blocks.length).toBeGreaterThan(0);
    // On the wash an opaque `--muted` block reads as a grey rectangle punched
    // into the gradient — the chrome variant is alpha-on-parent.
    for (const block of blocks) {
      expect(block.className).toContain("bg-chrome-fill");
      expect(block.className).not.toContain("bg-muted");
    }
  });
});

describe("DockBody — transcript", () => {
  it("renders the chat on the wash and wires the busy signal", () => {
    render(<DockBody {...props()} />);
    expect(screen.getByTestId("ask-chat")).toHaveAttribute(
      "data-surface",
      "atmosphere",
    );
    expect(screen.getByTestId("ask-chat")).toHaveAttribute(
      "data-busy-wired",
      "yes",
    );
  });

  it("replaces the chat with the read-only notice on someone else's shared thread", () => {
    render(
      <DockBody
        {...props({
          activeId: "c1",
          activeThread: thread({
            user_id: "someone-else",
            visibility: "board",
          }),
          readOnly: true,
        })}
      />,
    );
    expect(screen.queryByTestId("ask-chat")).toBeNull();
    const note = screen.getByText(/only its owner can reply/i);
    expect(note.className).toContain("px-3.5");
    expect(note.className).not.toMatch(/\bborder-/);
  });

  it("shows the loading skeleton while a thread's messages are read", () => {
    render(<DockBody {...props({ threadLoading: true })} />);
    expect(
      screen.getByRole("status", { name: /loading thread/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ask-chat")).toBeNull();
  });
});

describe("DockBody — errors", () => {
  it("shows the error with a retry, aligned to the title row and without a hairline", async () => {
    const onRetry = vi.fn();
    render(
      <DockBody {...props({ error: "Couldn't load threads.", onRetry })} />,
    );
    const message = screen.getByText("Couldn't load threads.");
    expect(message.parentElement!.className).toContain("px-3.5");
    expect(message.parentElement!.className).not.toMatch(/\bborder-b\b/);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no retry when there is nothing to re-run", () => {
    render(
      <DockBody
        {...props({ error: "Couldn't change who can see this thread." })}
      />,
    );
    expect(screen.getByText(/who can see this thread/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/dock/DockBody.test.tsx`
Expected: FAIL — TypeScript/props mismatch and no `New thread` button / no ledger.

- [ ] **Step 3: Rewrite DockBody**

Replace the entire contents of `src/components/boards/dock/DockBody.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { ChevronRight, PanelRightClose, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { AskChat } from "@/components/ai/ask/AskChat";
import type { UIMessage } from "@/components/ai/ask/MessageList";
import type { BoardThreadRow } from "@/lib/ai/ask/board-threads";
import type { DockTab } from "@/stores/board-intelligence";
import { cn } from "@/lib/utils";
import { DockThreadList } from "./DockThreadList";
import {
  DockTiles,
  dockTileId,
  type DockAgent,
  type DockPresence,
  type DockTile,
} from "./DockTiles";
import { IntelligenceTab } from "./intelligence/IntelligenceTab";

export type DockBodyProps = {
  agents: DockAgent[];
  agentNames: Record<string, string>;
  /** The chat persona on screen — the open thread's (when its agent is still
   *  on the roster), else the one queued for the next thread. `null` is Ask.
   *  Drives the active tile, the title kicker and the chat panel's label. */
  tileAgentId: string | null;
  /** Live presence by agent id — `running` while that persona's turn streams. */
  presence: Readonly<Record<string, DockPresence>>;
  onSelectTile: (tile: DockTile) => void;
  onNew: () => void;
  /** Omitted inside the Sheet, which brings its own close affordance. */
  onClose?: () => void;
  error: string | null;
  /** Absent when the failure has nothing to retry (an optimistic write that
   *  already rolled itself back). */
  onRetry?: () => void;
  loading: boolean;
  boardThreads: BoardThreadRow[];
  agentThreads: BoardThreadRow[];
  activeId: string | null;
  /** The open thread's row, for the title row. `null` for a new thread. */
  activeThread: BoardThreadRow | null;
  currentUserId: string;
  onSelectThread: (id: string) => void;
  onToggleShare: (thread: BoardThreadRow) => void;
  sharingId: string | null;
  threadLoading: boolean;
  readOnly: boolean;
  boardId: string;
  messages: UIMessage[];
  agentId: string | null;
  /** Identity of the CHAT INSTANCE, not of the conversation — see `chatKey`. */
  chatKey: string;
  onStarted: (conversationId: string) => void;
  onTurnComplete: () => void;
  /** A turn opened / settled in the mounted chat — the presence dot's source. */
  onBusyChange: (busy: boolean) => void;
  /** Which section is showing. Chat and Intelligence never render at once. */
  tab: DockTab;
  /** Unresolved suggestions, on the Intelligence tile. */
  badge: number;
  /** Editors and owners may apply a suggestion; viewers read and filter. */
  canApply: boolean;
  runOnMount: boolean;
  onRanOnMount: () => void;
};

/** Full-layer entrance (spec §5): 14px slide from the right, staggered band →
 *  title → ledger by the `delay-*` each caller adds. `@starting-style` gives a
 *  freshly mounted element a start state to transition from; Tailwind's
 *  translate utilities write the `translate` property, hence the list. */
const RISE =
  "starting:translate-x-3.5 starting:opacity-0 ease-keystone transition-[opacity,translate] duration-[360ms]";

/**
 * The dock's whole interior: band, title row, threads ledger, transcript.
 *
 * Extracted so the desktop column and the mobile Sheet render ONE
 * implementation. Below `md` a 320px column beside a board leaves neither
 * usable, so the surface changes; what is inside it must not.
 *
 * Chrome, not content (spec §3): nothing here is a card. The band, the title
 * and the ledger sit straight on the wash; the transcript renders through
 * `AskChat surface="atmosphere"`, whose composer is the one raised surface.
 *
 * Only the open section is MOUNTED. That is what keeps switching tiles free:
 * the chat's thread fetch is guarded by the dock's `loaded` ref, so coming back
 * to a persona re-renders a list it already has, and opening Intelligence
 * renders a run the store already holds.
 */
export function DockBody({
  agents,
  agentNames,
  tileAgentId,
  presence,
  onSelectTile,
  onNew,
  onClose,
  error,
  onRetry,
  loading,
  boardThreads,
  agentThreads,
  activeId,
  activeThread,
  currentUserId,
  onSelectThread,
  onToggleShare,
  sharingId,
  threadLoading,
  readOnly,
  boardId,
  messages,
  agentId,
  chatKey,
  onStarted,
  onTurnComplete,
  onBusyChange,
  tab,
  badge,
  canApply,
  runOnMount,
  onRanOnMount,
}: DockBodyProps) {
  // Component state, not persisted (spec §6): the ledger opens on demand and
  // folds again when a thread is picked, so the transcript is what you see.
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadCount = boardThreads.length + agentThreads.length;
  const personaName = tileAgentId ? (agentNames[tileAgentId] ?? "Ask") : "Ask";
  const chatTile: DockTile = tileAgentId
    ? { kind: "agent", agentId: tileAgentId }
    : { kind: "ask" };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* The band (spec §2): one tablist for everything you consult, then New
          and Close. Same 56px as the app header — one grammar. */}
      <header
        className={cn(
          "flex h-14 shrink-0 items-center gap-1 pr-3 pl-2.5",
          RISE,
          "delay-[120ms]",
        )}
      >
        <DockTiles
          agents={agents}
          tab={tab}
          agentId={tileAgentId}
          badge={badge}
          presence={presence}
          onSelect={onSelectTile}
        />
        <span className="flex-1" />
        {tab === "chat" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New thread"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={onNew}
            disabled={activeId === null}
          >
            <Plus className="size-4" />
          </Button>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close agent dock"
            className="text-muted-foreground hover:text-foreground shrink-0"
            onClick={onClose}
          >
            <PanelRightClose className="size-4" />
          </Button>
        )}
      </header>

      {tab === "chat" ? (
        // A real flex column rather than `display: contents`: the panel has to
        // own the same min-height-0 column the dock body did, and a contents
        // box is skipped by part of the a11y tree it is meant to name.
        <div
          id="dock-panel-chat"
          role="tabpanel"
          aria-labelledby={dockTileId(chatTile)}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {/* Title row: the thread as a heading, the persona as a kicker. */}
          <div
            className={cn(
              "flex items-baseline gap-2 px-3.5 pt-2",
              RISE,
              "delay-[180ms]",
            )}
          >
            <h2 className="min-w-0 flex-1 truncate text-sm font-extrabold">
              {activeThread?.title ?? "New thread"}
            </h2>
            {activeThread?.visibility === "board" ? (
              // Said in words, not by colour alone — same chip as the list row.
              <Kicker size="xs" className="shrink-0 rounded-sm border px-1">
                Shared
              </Kicker>
            ) : null}
            <Kicker size="xs" className="max-w-[40%] shrink-0 truncate">
              {personaName}
            </Kicker>
          </div>

          {/* Threads ledger: NavSection's header grammar — kicker, hairline
              rule that brightens, mono count, chevron — as one toggle. */}
          <button
            type="button"
            aria-expanded={threadsOpen}
            aria-controls="dock-threads"
            onClick={() => setThreadsOpen((o) => !o)}
            className={cn(
              "group/ledger focus-visible:ring-ring mx-2 flex items-center gap-2 rounded px-1.5 pt-1 pb-1.5 focus-visible:ring-2 focus-visible:outline-none",
              RISE,
              "delay-[240ms]",
            )}
          >
            <Kicker
              size="xs"
              className="ease-keystone group-hover/ledger:text-foreground transition-colors duration-300"
            >
              Threads
            </Kicker>
            <span
              aria-hidden="true"
              data-ledger-rule
              className="bg-border ease-keystone group-hover/ledger:bg-border-bright h-px min-w-3 flex-1 transition-colors duration-300"
            />
            <span className="text-kicker text-3xs font-mono tabular-nums">
              {threadCount}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "text-muted-foreground ease-keystone size-3.5 shrink-0 transition-transform duration-200",
                threadsOpen && "rotate-90",
              )}
            />
          </button>
          {/* Bounded on purpose: the transcript is the point of the dock, and a
              thread list that grows without limit would push it off the panel. */}
          <div
            id="dock-threads"
            hidden={!threadsOpen}
            className="max-h-48 shrink-0 overflow-y-auto px-2 pb-1"
          >
            {loading ? (
              <div className="flex flex-col gap-1.5 p-1">
                <Skeleton variant="chrome" className="h-6 w-full" />
                <Skeleton variant="chrome" className="h-6 w-4/5" />
                <Skeleton variant="chrome" className="h-6 w-3/5" />
              </div>
            ) : (
              <DockThreadList
                boardThreads={boardThreads}
                agentThreads={agentThreads}
                activeId={activeId}
                currentUserId={currentUserId}
                agentNames={agentNames}
                sharingId={sharingId}
                onSelect={(id) => {
                  setThreadsOpen(false);
                  onSelectThread(id);
                }}
                onToggleShare={onToggleShare}
              />
            )}
          </div>

          {error && (
            <div className="flex shrink-0 items-center gap-2 px-3.5 py-1.5">
              <p className="text-destructive min-w-0 flex-1 text-xs">{error}</p>
              {onRetry && (
                <Button variant="ghost" size="xs" onClick={onRetry}>
                  Try again
                </Button>
              )}
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {threadLoading ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading thread"
                className="flex flex-col gap-3 px-3.5 py-3"
              >
                <Skeleton variant="chrome" className="h-4 w-2/3 self-end" />
                <Skeleton variant="chrome" className="h-4 w-full" />
                <Skeleton variant="chrome" className="h-4 w-5/6" />
              </div>
            ) : readOnly ? (
              <p className="text-muted-foreground px-3.5 py-3 text-sm">
                This thread was shared with the board. You can read it, but only
                its owner can reply.
              </p>
            ) : (
              <AskChat
                // Keyed on the CHAT INSTANCE, never on `activeId`.
                //
                // AskChat calls `onStarted` the moment createConversation
                // resolves — BEFORE the stream opens — so `activeId` flips from
                // null to the new id in the middle of a live turn. Keying on it
                // would unmount the running chat and mount a fresh one with
                // `initialMessages` still `[]`, and since that prop is
                // snapshotted at mount with no re-sync, the user's question and
                // the streaming answer would be gone for good. The instance id
                // changes only where a reset is actually wanted: selecting a
                // thread, or starting a new one (on any persona).
                key={chatKey}
                conversationId={activeId}
                initialMessages={messages}
                boardId={boardId}
                agentId={agentId ?? undefined}
                onStarted={onStarted}
                onTurnComplete={onTurnComplete}
                onBusyChange={onBusyChange}
                surface="atmosphere"
              />
            )}
          </div>
        </div>
      ) : (
        <IntelligenceTab
          boardId={boardId}
          canApply={canApply}
          runOnMount={runOnMount}
          onRanOnMount={onRanOnMount}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the DockBody tests**

Run: `pnpm vitest run src/components/boards/dock/DockBody.test.tsx`
Expected: PASS. (`BoardDock.tsx` no longer typechecks — that is the next step.)

- [ ] **Step 5: Update the BoardDock tests for tiles, motion and presence**

In `src/components/boards/dock/BoardDock.test.tsx` (as left by Task 1):

(a) Replace the `AskChat` mock's props type and markup (the `AskChat: (p: {…}) => {…}` block) so the probe also reports `surface` and drives `onBusyChange`:

```tsx
    AskChat: (p: {
      conversationId: string | null;
      initialMessages: unknown[];
      boardId?: string;
      agentId?: string;
      surface?: string;
      onStarted?: (id: string) => void;
      onTurnComplete?: () => void;
      onBusyChange?: (busy: boolean) => void;
    }) => {
      const instance = useRef(0);
      if (instance.current === 0) instance.current = ++seq;
      const [draft, setDraft] = useState("");
      return (
        <div
          data-testid="ask-chat"
          data-instance={String(instance.current)}
          data-conversation={p.conversationId ?? ""}
          data-board={p.boardId ?? ""}
          data-agent={p.agentId ?? ""}
          data-surface={p.surface ?? ""}
          data-messages={String(p.initialMessages.length)}
        >
          <span data-testid="chat-draft">{draft}</span>
          <button type="button" onClick={() => setDraft("in-flight turn")}>
            mock type
          </button>
          <button type="button" onClick={() => p.onStarted?.("minted-1")}>
            mock started
          </button>
          <button type="button" onClick={() => p.onTurnComplete?.()}>
            mock complete
          </button>
          <button type="button" onClick={() => p.onBusyChange?.(true)}>
            mock busy
          </button>
          <button type="button" onClick={() => p.onBusyChange?.(false)}>
            mock idle
          </button>
        </div>
      );
    },
```

(b) Replace the `threadRow` helper with one that unfolds the ledger first, and add `openThreads` + `settled` beside it:

```tsx
/** Unfold the threads ledger (collapsed by default) if it is not open yet. */
const openThreads = async () => {
  const ledger = screen.getByRole("button", { name: /^threads/i });
  if (ledger.getAttribute("aria-expanded") !== "true") {
    await userEvent.click(ledger);
  }
};

/** The row's SELECT target, with the ledger unfolded. Queried through its
 *  title text because the row's share toggle is labelled with that same
 *  title, so a role+name lookup is ambiguous by construction. */
const threadRow = async (title: string) => {
  await openThreads();
  return (await screen.findByText(title)).closest("button")!;
};

/** Wait for an open/close toggle's motion window to clear. */
const settled = () =>
  waitFor(() => expect(aside()).not.toHaveAttribute("data-animating"));
```

(c) Replace the test `"offers Ask as the first switcher entry, with no persona"` with:

```tsx
it("offers Intelligence, Ask and the roster as one tab row, opening on Ask", async () => {
  mount();
  await openDock();
  expect(
    screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
  ).toEqual(["Intelligence", "Ask", "Morning Brief", "Overdue Chaser"]);
  expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(chat()).toHaveAttribute("data-agent", "");
  expect(chat()).toHaveAttribute("data-board", "b1");
  expect(chat()).toHaveAttribute("data-surface", "atmosphere");
});
```

(d) In `"syncs the selected thread into the URL without disturbing ?view="` and `"DOES remount when the user genuinely starts over"`, change `{ name: /^new$/i }` to `{ name: /new thread/i }`.

(e) Replace the test `"carries the chosen persona into a new thread"` with:

```tsx
it("tap an agent and talk: an agent tile starts a new thread on that persona", async () => {
  mount();
  await openDock();
  await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
  expect(chat()).toHaveAttribute("data-agent", "a2");
  expect(chat()).toHaveAttribute("data-conversation", "");
  expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("heading", { name: "New thread" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading").parentElement).toHaveTextContent(
    "Overdue Chaser",
  );
});
```

(f) In the `"BoardDock — sharing a thread with the board"` describe, add `await openThreads();` right after every `await openDock();` (four tests).

(g) In `"BoardDock — Chat and Intelligence"`, replace the first three tests with:

```tsx
it("shows every tile and opens on Ask with the title row", async () => {
  mount();
  await openDock();
  expect(
    screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
  ).toEqual(["Intelligence", "Ask", "Morning Brief", "Overdue Chaser"]);
  expect(screen.getByRole("tab", { name: "Ask" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("heading", { name: "New thread" }),
  ).toBeInTheDocument();
});

it("hands the band over to Intelligence, and never re-reads the threads", async () => {
  mount({ initialRun: intelRun() });
  await openDock();
  await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));

  await openIntelligence();
  expect(screen.queryByRole("button", { name: /new thread/i })).toBeNull();
  expect(screen.queryByRole("heading", { name: "New thread" })).toBeNull();
  expect(screen.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    "dock-tab-intelligence",
  );

  await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
  expect(
    screen.getByRole("button", { name: /new thread/i }),
  ).toBeInTheDocument();
  await openIntelligence();
  expect(loadDockThreads).toHaveBeenCalledTimes(1);
});

it("counts the unresolved suggestions on the Intelligence tile, in words", async () => {
  mount({ initialRun: intelRun() });
  await openDock();
  const intel = screen.getByRole("tab", {
    name: "Intelligence · 2 suggestions",
  });
  expect(intel.querySelector("[data-dock-badge]")).toHaveTextContent("2");
});
```

(h) Append three new describes at the end of the file:

```tsx
// Spec §2 selection semantics: a tile is "tap an agent and talk". Same
// persona as the thread on screen is a no-op; a different one starts over.
describe("BoardDock — tile selection", () => {
  it("re-tapping the open thread's agent is a no-op; another persona starts over", async () => {
    loadDockThreads.mockResolvedValue(withThread({ agent_id: "a1" }));
    loadThreadMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
    mount();
    await openDock();
    await userEvent.click(await threadRow("About the roadmap"));
    await waitFor(() =>
      expect(chat()).toHaveAttribute("data-conversation", "c1"),
    );
    const instance = chat().getAttribute("data-instance");
    expect(screen.getByRole("tab", { name: "Morning Brief" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    expect(chat()).toHaveAttribute("data-conversation", "c1");
    expect(chat()).toHaveAttribute("data-instance", instance!);

    await userEvent.click(screen.getByRole("tab", { name: "Ask" }));
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(chat()).not.toHaveAttribute("data-instance", instance!);
    expect(window.location.search).toBe("");
  });

  it("New starts over on the persona on screen and is disabled until there is a thread", async () => {
    mount();
    await openDock();
    expect(screen.getByRole("button", { name: /new thread/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("tab", { name: "Overdue Chaser" }));
    await userEvent.click(
      screen.getByRole("button", { name: /mock started/i }),
    );
    expect(screen.getByRole("button", { name: /new thread/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /new thread/i }));
    expect(chat()).toHaveAttribute("data-conversation", "");
    expect(chat()).toHaveAttribute("data-agent", "a2");
  });

  it("selecting Intelligence by tile counts as asking for it", async () => {
    mount({ initialRun: null });
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Intelligence" }));
    await waitFor(() => expect(runBoardIntelligence).toHaveBeenCalledTimes(1));
  });

  it("pulses the answering agent's tile while its turn streams, and only then", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    expect(document.querySelector("[data-dock-presence]")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    const running = screen.getByRole("tab", {
      name: "Morning Brief · running",
    });
    expect(running.querySelector("[data-dock-presence]")).not.toBeNull();
    expect(
      screen
        .getByRole("tab", { name: "Overdue Chaser" })
        .querySelector("[data-dock-presence]"),
    ).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /mock idle/i }));
    expect(
      screen.getByRole("tab", { name: "Morning Brief" }),
    ).toBeInTheDocument();
    expect(document.querySelector("[data-dock-presence]")).toBeNull();
  });
});

// Spec §4: closed, the dock is a 48px rail of the SAME tiles. Any tile opens
// the dock on that tile. Presence and the badge stay visible.
describe("BoardDock — mini rail", () => {
  it("shows the tiles vertically at rail width, badge intact, edge bar on the right, no fetch", async () => {
    mount({ initialRun: intelRun() });
    await waitFor(() => expect(aside()).not.toBeNull());
    expect(screen.getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    expect(
      screen.getAllByRole("tab").map((t) => t.getAttribute("aria-label")),
    ).toEqual([
      "Intelligence · 2 suggestions",
      "Ask",
      "Morning Brief",
      "Overdue Chaser",
    ]);
    expect(aside()!.style.width).toBe(`${DOCK_RAIL_WIDTH}px`);
    expect(screen.getByRole("tab", { name: "Ask" }).className).toContain(
      "after:-right-2",
    );
    expect(screen.queryByRole("separator")).toBeNull();
    expect(loadDockThreads).not.toHaveBeenCalled();
  });

  it("opens on the tapped agent and starts a new thread on it", async () => {
    mount();
    await userEvent.click(
      await screen.findByRole("tab", { name: "Overdue Chaser" }),
    );
    await settled();
    expect(aside()).toHaveAttribute("data-open", "true");
    expect(screen.getByRole("tablist")).not.toHaveAttribute("aria-orientation");
    expect(chat()).toHaveAttribute("data-agent", "a2");
    expect(screen.getByRole("tab", { name: "Overdue Chaser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(loadDockThreads).toHaveBeenCalledTimes(1));
  });

  it("opens on Intelligence from the rail, rendering the cached run", async () => {
    mount({ initialRun: intelRun() });
    await userEvent.click(
      await screen.findByRole("tab", { name: /^intelligence/i }),
    );
    await settled();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "dock-tab-intelligence",
    );
    expect(screen.getByText("Three items are overdue")).toBeInTheDocument();
    expect(runBoardIntelligence).not.toHaveBeenCalled();
  });

  it("keeps the presence dot on the rail while a turn streams", async () => {
    mount();
    await openDock();
    await userEvent.click(screen.getByRole("tab", { name: "Morning Brief" }));
    await userEvent.click(screen.getByRole("button", { name: /mock busy/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /close agent dock/i }),
    );
    await settled();
    expect(
      screen
        .getByRole("tab", { name: "Morning Brief · running" })
        .querySelector("[data-dock-presence]"),
    ).not.toBeNull();
  });
});

// Spec §5: the width transition exists only while a toggle is in flight, so a
// drag or keyboard resize is instant; the two layers crossfade.
describe("BoardDock — motion", () => {
  it("animates the width only during a toggle, never during a resize", async () => {
    mount();
    await openDock();
    expect(aside()).toHaveAttribute("data-animating");
    expect(aside()!.className).toContain("transition-[width]");
    await settled();
    expect(aside()!.className).not.toContain("transition-[width]");

    const grip = screen.getByRole("separator", { name: /resize agent dock/i });
    grip.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(aside()!.style.width).toBe(`${DOCK_MIN_WIDTH + 16}px`);
    expect(aside()).not.toHaveAttribute("data-animating");
  });

  it("keeps both layer wrappers mounted and inerts the one that is leaving", async () => {
    mount();
    await waitFor(() => expect(aside()).not.toBeNull());
    const full = () => aside()!.querySelector("[data-layer='full']")!;
    const mini = () => aside()!.querySelector("[data-layer='mini']")!;
    expect(full()).toBeEmptyDOMElement();
    expect(full()).toHaveAttribute("inert");
    expect(mini()).not.toHaveAttribute("inert");

    await openDock();
    // Mid-toggle: the mini layer is still mounted but out of the a11y tree.
    expect(mini()).toHaveAttribute("inert");
    expect(mini()).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    await settled();
    expect(mini()).toBeEmptyDOMElement();
    expect(full()).not.toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/components/boards/dock/BoardDock.test.tsx`
Expected: FAIL to compile/render — `BoardDock` still builds the old `DockBodyProps` and has no tiles on the rail.

- [ ] **Step 7: Wire BoardDock — selection semantics, presence, motion, mini-rail tiles**

In `src/components/boards/dock/BoardDock.tsx` (as left by Task 1), by anchor:

(a) Replace `import type { DockAgent } from "./AgentSwitcher";` with:

```tsx
import { cn } from "@/lib/utils";
import {
  DockTiles,
  type DockAgent,
  type DockPresence,
  type DockTile,
} from "./DockTiles";
```

(b) After `const RESIZE_STEP = 16;` add:

```tsx
/** The open/close width transition (spec §5). The fallback timer that clears
 *  `animating` runs a little after it, for a `transitionend` that never comes
 *  (jsdom, or a width that did not actually change). */
const DOCK_TRANSITION_MS = 360;

/** Spec §5 layer choreography. Both wrappers stay mounted so the class flip
 *  is a real transition from a real start state. Exits are the quick half —
 *  the leaving layer is out of the way before the width settles; entrances
 *  ride ease-keystone with a delay so they start once the other has gone.
 *  Tailwind v4's translate utilities write the `translate` property. */
const LAYER = "absolute inset-y-0 right-0 left-1 flex flex-col";
const FULL_IN =
  "ease-keystone translate-x-0 opacity-100 transition-[opacity,translate] duration-[220ms] delay-[80ms]";
const FULL_OUT =
  "pointer-events-none translate-x-6 opacity-0 [transition:opacity_140ms_ease,translate_200ms_ease-in]";
const MINI_IN =
  "ease-keystone translate-x-0 opacity-100 transition-[opacity,translate] duration-[220ms] delay-[140ms]";
const MINI_OUT =
  "pointer-events-none -translate-x-2 opacity-0 [transition:opacity_120ms_ease,translate_160ms_ease-in]";

const EMPTY_PRESENCE: Readonly<Record<string, DockPresence>> = {};
```

(c) Right after `const narrow = useNarrowViewport();` add:

```tsx
/**
 * Open/close WITH the width transition. The transition class is applied
 * only while a toggle is in flight, so a drag-resize — which also changes
 * the width — stays instant (§5). Cleared on the aside's own
 * `transitionend` for `width`, or by the fallback timer.
 */
const [animating, setAnimating] = useState(false);
const animationFallback = useRef<number | null>(null);
const toggleOpen = useCallback(
  (next: boolean) => {
    setAnimating(true);
    setOpen(next);
    if (animationFallback.current !== null) {
      window.clearTimeout(animationFallback.current);
    }
    animationFallback.current = window.setTimeout(
      () => setAnimating(false),
      DOCK_TRANSITION_MS + 40,
    );
  },
  [setOpen],
);
const onTransitionEnd = (e: React.TransitionEvent<HTMLElement>) => {
  // Children's opacity/translate transitions bubble here too.
  if (e.target !== e.currentTarget || e.propertyName !== "width") return;
  if (animationFallback.current !== null) {
    window.clearTimeout(animationFallback.current);
    animationFallback.current = null;
  }
  setAnimating(false);
};
useEffect(
  () => () => {
    if (animationFallback.current !== null) {
      window.clearTimeout(animationFallback.current);
    }
  },
  [],
);

/** The persona whose turn is streaming, for the presence dot (§2, phase 1:
 *  only the mounted chat's turn — scheduled runs are out of scope). */
const [streamingPersona, setStreamingPersona] = useState<string | null>(null);
```

(d) In the `openRequest` effect, change `setOpen(true);` to `toggleOpen(true);` and its dependency array to `[boardId, consumeOpen, openRequest, toggleOpen, setTab]`.

(e) Right after `const agentNames = Object.fromEntries(agents.map((a) => [a.id, a.name]));` add (and delete the identical `activeThread`/`openPersona` block that Task 1 left further down, just above `const body`):

```tsx
const activeThread =
  boardThreads.find((t) => t.id === activeId) ??
  agentThreads.find((t) => t.id === activeId) ??
  null;
// Mid-thread the band reports the OPEN thread's persona, not the one queued
// for the next new thread. Falls back to "Ask" for an agent outside this
// user's roster.
const openPersona = activeThread?.agent_id ?? null;
/**
 * The persona the reader is looking at. This one value drives the active
 * tile, the title kicker, what New starts over on, and the "does this tile
 * differ" test in `selectTile`.
 */
const currentPersona: string | null = activeThread
  ? openPersona && agentNames[openPersona]
    ? openPersona
    : null
  : agentId;
```

(f) Replace the `startNew` and `changeAgent` callbacks (from `const startNew = useCallback(() => {` through the end of `changeAgent`) with:

```tsx
/**
 * Start over on `persona`: a fresh chat instance with no thread. New uses
 * it with the persona on screen; a tile tap uses it with a different one —
 * "tap an agent and talk" (§2), replacing the locked select.
 */
const startNewAs = useCallback((persona: string | null) => {
  selectToken.current++;
  setAgentId(persona);
  setActiveId(null);
  setMessages([]);
  setThreadLoading(false);
  setChatInstance((n) => n + 1);
  untitled.current = false;
  deepLinkPending.current = false;
  syncThreadParam(null);
}, []);

/**
 * §2 selection semantics. Intelligence is the ask that counts as "opened
 * this session" (same rule as the old tab). Ask/agent tiles switch to Chat
 * and, when the persona differs from the one on screen, start a new thread
 * on it. Same persona: a no-op, so a stray click never throws away the open
 * thread.
 */
const selectTile = useCallback(
  (tile: DockTile) => {
    if (tile.kind === "intelligence") {
      changeTab("intelligence");
      return;
    }
    changeTab("chat");
    const persona = tile.kind === "agent" ? tile.agentId : null;
    if (persona !== currentPersona) startNewAs(persona);
  },
  [changeTab, currentPersona, startNewAs],
);

/** The mounted chat's turn opened or settled. The dot follows the persona
 *  on screen, which is who that chat is talking to. */
const onBusyChange = useCallback(
  (busy: boolean) => setStreamingPersona(busy ? currentPersona : null),
  [currentPersona],
);
const presence: Readonly<Record<string, DockPresence>> = streamingPersona
  ? { [streamingPersona]: "running" }
  : EMPTY_PRESENCE;
```

(g) In the `body` object: delete the `switcherValue: …`, `switcherLocked: …`, `onAgentChange: changeAgent,` and `onTabChange: changeTab,` entries; change `onNew: startNew,` to `onNew: () => startNewAs(currentPersona),`; and add these entries:

```tsx
    tileAgentId: currentPersona,
    presence,
    onSelectTile: selectTile,
    activeThread,
    onBusyChange,
```

(h) Replace the portalled `<aside>…</aside>` (everything between `return createPortal(` and `slot,`) with:

```tsx
    <aside
      aria-label="Agent dock"
      data-open={open}
      data-animating={animating || undefined}
      onTransitionEnd={onTransitionEnd}
      className={cn(
        "relative flex min-w-0 shrink-0 flex-col overflow-hidden",
        animating && "ease-keystone transition-[width] duration-[360ms]",
      )}
      style={{ width: open ? shownWidth : DOCK_RAIL_WIDTH }}
    >
      {/* Two layers, one aside (§5). The wrappers are ALWAYS mounted so the
          open/closed class flip is a real transition; their contents mount
          only while their side is showing or leaving, so a closed dock never
          mounts the chat (whose composer autofocuses) and the keyboard never
          meets two tablists. `inert` + aria-hidden take the leaving layer
          out of the tab order and the a11y tree for the crossfade. */}
      <div
        data-layer="full"
        inert={open ? undefined : true}
        aria-hidden={open ? undefined : true}
        className={cn(LAYER, open ? FULL_IN : FULL_OUT)}
      >
        {open || animating ? (
          <>
            {/* Hairlines brighten rather than thicken: the grip is invisible
                until you reach for it, then it is the border going bright. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize agent dock"
              aria-valuenow={shownWidth}
              aria-valuemin={DOCK_MIN_WIDTH}
              aria-valuemax={DOCK_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setWidth(width + RESIZE_STEP);
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  setWidth(width - RESIZE_STEP);
                }
              }}
              className="hover:bg-border-hover focus-visible:bg-border-bright absolute inset-y-0 left-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none bg-transparent outline-none"
            />
            <DockBody {...body} onClose={() => toggleOpen(false)} />
          </>
        ) : null}
      </div>
      <div
        data-layer="mini"
        inert={open ? true : undefined}
        aria-hidden={open ? true : undefined}
        className={cn(
          LAYER,
          "items-center gap-2.5 pt-3",
          open ? MINI_OUT : MINI_IN,
        )}
      >
        {!open || animating ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open agent dock"
              className="text-muted-foreground hover:text-foreground size-8 shrink-0"
              onClick={() => toggleOpen(true)}
            >
              <PanelRightOpen className="size-4" />
            </Button>
            {/* The same tiles, vertical (§4): any tile opens the dock ON it. */}
            <DockTiles
              agents={agents}
              tab={tab}
              agentId={currentPersona}
              badge={unresolvedCount(run ?? null)}
              presence={presence}
              orientation="vertical"
              onSelect={(tile) => {
                selectTile(tile);
                toggleOpen(true);
              }}
            />
          </>
        ) : null}
      </div>
    </aside>,
```

(i) In the docblock, after the "Placement (spec §1)" paragraph Task 1 added, append:

```
 *
 * Motion (spec §5) is CSS: the width transition is applied only while a
 * toggle is in flight (`animating`), and the full/mini layers crossfade as
 * always-mounted wrappers whose contents mount on demand.
```

- [ ] **Step 8: Run the dock suites, typecheck, lint**

Run: `pnpm vitest run src/components/boards/dock && pnpm typecheck && pnpm lint`
Expected: PASS / clean. `DockTabs.test.tsx` and `AgentSwitcher.test.tsx` still pass (their components exist until Task 5). If `pnpm typecheck` reports `inert` as an unknown prop, the installed `@types/react` is older than React 19's typings — fix by spelling it `{...{ inert: open ? undefined : true }}`; do not cast to `any`.

- [ ] **Step 9: Run the full test suite once**

Run: `pnpm test`
Expected: PASS — in particular `src/test/static-shell.test.ts`, `src/app/app-shell-structure.test.ts`, `src/app/scroll-containers.test.ts` and the `intelligence/*` suites are untouched and green.

- [ ] **Step 10: Commit (orchestrator, by path)**

```bash
git add src/components/boards/dock/DockBody.tsx src/components/boards/dock/DockBody.test.tsx \
  src/components/boards/dock/BoardDock.tsx src/components/boards/dock/BoardDock.test.tsx
git commit -m "feat(boards): dock atmosphere with tile band, title row, threads ledger, mini rail and motion

The dock body is band → title row → threads ledger (collapsed by default) →
transcript on the wash → raised composer. Tapping an agent tile starts a new
thread on that persona; re-tapping the open thread's agent is a no-op; the
answering agent's dot pulses while its turn streams. Closed, the dock is a
48px rail of the same tiles that opens on whichever one is tapped. The width
transition runs only during a toggle, so resizing stays instant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

---

### Task 5: Retire `DockTabs` and `AgentSwitcher`, full gate, `/updates` entry

**Files:**

- Delete: `src/components/boards/dock/DockTabs.tsx`, `src/components/boards/dock/DockTabs.test.tsx`, `src/components/boards/dock/AgentSwitcher.tsx`, `src/components/boards/dock/AgentSwitcher.test.tsx`
- Modify: `src/lib/changelog/generated.ts` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: Task 4 (nothing imports the retired files any more — `DockBody`/`BoardDock` import `DockAgent` from `./DockTiles`).
- Produces: a repo with no `DockTabs`/`AgentSwitcher`; a `Changelog:` trailer in history and a regenerated `generated.ts`.

- [ ] **Step 1: Prove nothing imports the retired modules**

Run: `grep -rn "from \"./DockTabs\"\|from \"./AgentSwitcher\"\|dock/DockTabs\"\|dock/AgentSwitcher\"" src --include='*.ts' --include='*.tsx' | grep -v "src/components/boards/dock/DockTabs\.test\|src/components/boards/dock/AgentSwitcher\.test"`
Expected: no output. (If a line appears, Task 4 missed an import — fix it there, in `DockBody.tsx`/`BoardDock.tsx`, before deleting anything. Prose mentions of the old names in docblocks are fine and expected — `DockTiles.tsx` says what it replaced.)

- [ ] **Step 2: Delete the four files**

```bash
git rm src/components/boards/dock/DockTabs.tsx src/components/boards/dock/DockTabs.test.tsx \
  src/components/boards/dock/AgentSwitcher.tsx src/components/boards/dock/AgentSwitcher.test.tsx
```

- [ ] **Step 3: Verify the keyboard contract survived the move**

Run: `pnpm vitest run src/components/boards/dock/DockTiles.test.tsx -t keyboard`
Expected: PASS — the roving-tabindex / ArrowLeft-Right / Home-End behaviour `DockTabs.test.tsx` used to pin now lives in `DockTiles — keyboard`.

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. `pnpm build` is the one that would catch a stale import path in a `"use server"` boundary or a Tailwind class that does not compile — `starting:`, the `:has()` variant and `[transition:…]` were compile-checked while planning, so a failure here is a typo.

- [ ] **Step 5: Commit the retirement with the `/updates` entry**

The `Changelog:` trailer must sit in the trailer block with the other two trailers (a git trailer is a `Key: value` line in the last paragraph); user-facing wording only, no component names.

```bash
git commit -m "refactor(boards): retire the dock pill tabs and the native agent switcher

The tile band replaces both: dock-tiles carries the roving-tabindex keyboard
logic the pill tabs had, and picking a persona is a tile tap instead of a
select that was locked mid-thread.

Changelog: improved | Your agents front and centre in the board dock | The board's agent dock now sits beside the board on the app background and puts Intelligence, Ask and each of your agents in one row of tiles. Tap an agent to start talking to it, watch its dot pulse while it answers, fold the thread list out of the way, and collapse the whole dock to a thin rail of the same tiles.
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

- [ ] **Step 6: Regenerate and commit the changelog**

```bash
pnpm changelog:gen
git diff --stat -- src/lib/changelog/generated.ts   # expect: one new entry, today's date
pnpm vitest run src/lib/changelog
git add src/lib/changelog/generated.ts
git commit -m "chore(changelog): regenerate generated.ts

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01QFLLWHqBYfG7yCTT7ML6bp"
```

(`scripts/finish-task.sh` also regenerates and commits `generated.ts` if it drifted, so a second run is a no-op.)

- [ ] **Step 7: Finish the task**

From inside `.claude/worktrees/agent-dock-atmosphere`: `scripts/finish-task.sh` — it rebases onto the latest `develop`, re-runs the four gates against the merged state, merges into `develop`, pushes, and removes the worktree + branch. Then `/wrapup` with the "How to test" section below.

---

## Execution DAG

**Dependency graph**

| Task                                     | Depends on | Why                                                                                                                                                         |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 slot + portal + mini-rail shell       | —          | Touches `app-shell.tsx`, `use-dock-state.ts`, `BoardDock.tsx` (structure only), `page.tsx`.                                                                 |
| T2 `DockTiles` + `pulse-ring`            | —          | New files + `globals.css`; nothing imports it yet.                                                                                                          |
| T3 `surface` prop + `onBusyChange`       | —          | `src/components/ai/ask/*` only.                                                                                                                             |
| T4 `DockBody` relayout + wiring + motion | T1, T2, T3 | Imports `DockTiles`/`dockTileId`/`DockPresence` (T2), passes `surface`/`onBusyChange` (T3), builds on the portal/layer contract and `DOCK_RAIL_WIDTH` (T1). |
| T5 retire + gate + changelog             | T4         | Deleting `AgentSwitcher.tsx` is only safe once T4 re-pointed the `DockAgent` import.                                                                        |

**Parallel batches**

- **Batch 1 — T1 ‖ T2 ‖ T3.** Three agents in the one worktree. Disjoint files: T1 = `app-shell*`, `use-dock-state*`, `BoardDock*`, `page.tsx`; T2 = `DockTiles*`, `globals.css`, `globals.motion.test.ts`; T3 = `ai/ask/*`. Agents do not commit; the orchestrator reviews each and runs its commit step by path (T1, T2, T3 in any order).
- **Batch 2 — T4.** One agent, after all three Batch-1 commits are in.
- **Batch 3 — T5.** One agent (or the orchestrator), after T4.

**Critical path:** T2 → T4 → T5 (T2 is the largest Batch-1 task; T4 is the largest overall). Wall-clock floor ≈ T2 + T4 + T5.

**Shared-file hazards:** none inside a batch. Across batches T4 edits `BoardDock.tsx`/`BoardDock.test.tsx` that T1 edited — sequential by construction. `database.types.ts` and migrations are untouched.

---

## Self-review (done while writing; issues fixed inline)

**Spec coverage** — every numbered section maps to a task: §1 placement → T1 (slot, portal, `:has()` rule, `left-1` gutter, mobile unchanged, page wrapper comment); §2 `DockTiles` → T2 (model, tablist a11y, 32/26px tiles, edge bar, marks, badge, presence dot, tooltips) + T4 (selection semantics, New/Close on the band); §3 chat finish → T3 (`surface` on `AskChat`/`MessageList`/`Composer`, user pill, initial tile, composer as the raised surface, notice without hairlines) + T4 (band, title row, threads ledger `max-h-48`, error line, `IntelligenceTab` untouched); §4 mini rail → T1 (48px shell) + T4 (vertical tiles, edge bar on the right, open-on-tile); §5 motion → T4 (`transition-[width]` only while `data-animating`, two layers, delays) + T3 (per-turn stagger, composer rise) + T2 (`pulse-ring`); §6 state/budget → T1 (`DOCK_RAIL_WIDTH`, hook unchanged), T4 (ledger + portal target as component state, zero fetches, no router); §7 tokens → T2 (keyframe, no new colours); §8 a11y → T2 (tablist, tooltips = aria-labels, presence/badge in words), T4 (`inert` on the leaving layer, separator hidden on the rail, focus rings on tiles/ledger/composer); §9 tests → each task's RED steps; the retirement list → T5.

**Placeholder scan** — no "TBD/TODO/similar to", every code step carries the code; every referenced symbol (`dockTileId`, `DockPresence`, `ChatSurface`, `onBusyChange`, `toggleOpen`, `startNewAs`, `currentPersona`, `settled()`, `openThreads()`, `stubNarrow()`, `aside()`) is defined in the task that produces it or an earlier one.

**Type consistency** — `DockTile` uses `kind` (not `id`) everywhere; `DockBodyProps` in T4's Produces block matches the T4 implementation and the T4 test factory field-for-field; `presence` is `Readonly<Record<string, DockPresence>>` in T2, T4 and `BoardDock`; the chat panel id `dock-panel-chat` / intelligence `dock-panel-intelligence` match `DockTiles.panelIdFor`, `DockBody` and `IntelligenceTab`'s existing root; every transition string uses `translate`, not `transform`.

**Spec ambiguities resolved (state them in the closing message):**

1. §1 says both "a `data-dock` attribute the portal sets" and "pure CSS, no state" — the plan uses the pure-CSS `:has()` variant only, no attribute.
2. `DockTile` is spelled as a `kind` discriminated union (`{ kind: "agent"; agentId }`) rather than the spec's pseudo-code `{ id: agentId }`, which would collapse into `{ id: string }` in TypeScript.
3. Presence needs to know when a turn on an _existing_ thread starts; `onStarted` only fires for new threads, so T3 adds `onBusyChange(boolean)` to `AskChat` (fired in the one-turn guard and its `finally`).
4. The composer helper copy stays `⌘↵ to send` (spec: "the `<Kicker>` it is today"); the prototype's `↵ send · ⇧↵ newline` would change send behaviour, which is out of scope.
5. The threads ledger folds when a thread is picked (walkthrough step 4, "the ledger folds again on click").
6. `ThinkingIndicator` is unchanged — §3 lists only `MessageList`/`Composer`.
7. Entrances use `@starting-style` transitions rather than extra keyframes, so §7's "only `pulse-ring` is new" holds.

---

## How to test (closing walkthrough — put this in the `/wrapup` note too)

Pull `develop`, `pnpm dev`, sign in, open a board on a desktop-width window; check dark and light.

1. **Placement:** the dock is no longer inside the board card — it sits to the right of the card on the periwinkle wash with no divider, and the card's right gutter matches its left.
2. **Band:** tiles read Intelligence · Ask · your agents; hovering shows names; the active tile has a periwinkle bar under it. Press → / ← to move (focus and selection move together); Home/End jump to the ends.
3. **Talk:** click an agent tile — a new thread starts on that agent; the title row reads "New thread" with the agent's name as the kicker; ask something; the agent's tile dot pulses while it answers and stops when the answer lands. Click the same tile again — nothing changes. Click Ask — a new plain thread.
4. **Threads:** click the THREADS ledger — the list unfolds under the title (count on the right); pick an older thread — the ledger folds again and the transcript shows that thread; its title and persona are in the title row.
5. **Collapse:** click the close icon — the column folds to a thin rail of the same tiles over ~0.4s; drag the left edge of the open dock — it resizes instantly (no easing). Click any tile in the rail — it opens on that tile.
6. **Intelligence:** the first tile shows the suggestion count ("Intelligence · N suggestions" on hover); clicking it opens the Intelligence body on the wash, unchanged inside; New is hidden on that tab.
7. **Phone width:** narrow the window below 768px — the floating button still opens the full-screen sheet with the same interior (band, title, ledger, transcript).
8. **`/ask`:** open `/ask` — the centred column, muted user bubbles and the composer strip with its top hairline are exactly as before.
9. **`/updates`:** the new "Your agents front and centre in the board dock" entry appears under today's date.
