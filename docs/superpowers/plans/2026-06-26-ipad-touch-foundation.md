# iPad Touch Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared touch-ergonomics primitives that every Pulse board surface will consume to reach full authoring parity on iPad.

**Architecture:** A small set of framework-level primitives — a `useCoarsePointer()` hook (the single source of truth for "is this a touch context"), touch-aware dnd-kit sensors (long-press lift), a `<DragHandle>` primitive (the precision-drag exception), a `<RevealOnHover>` wrapper (hover-only actions become always-visible on touch), `pointer-coarse:` sizing on the `ui/` primitives (≥44px hit targets), and a touch-aware tooltip. No layout reflow, no new routes, **zero new server round-trips**. This is **Batch 1 (critical path)** of the iPad spec; all surface work depends on it.

**Tech Stack:** Next.js 16 (App Router, RSC/PPR), React 19, Tailwind v4 (built-in `pointer-coarse`/`pointer-fine` variants), shadcn/ui (radix), dnd-kit 6.3.1, Vitest (jsdom) + @testing-library/react.

**Worktree:** Build in a dedicated worktree on `task/touch-foundation` (`scripts/start-task.sh touch-foundation`), per the working agreement. Finish with `scripts/finish-task.sh` (gates + merge to `develop`).

**Spec:** `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md`

**Note on the provider:** the spec mentioned a `<TouchProvider>`. We implement the hook with `useSyncExternalStore` over a `matchMedia('(pointer: coarse)')` store, which is SSR-safe and needs **no** provider/context (YAGNI). The "single source of truth" property is preserved — every caller reads the same media query.

---

### Task 1: `useCoarsePointer()` hook

**Files:**

- Create: `src/lib/hooks/use-coarse-pointer.ts`
- Test: `src/lib/hooks/use-coarse-pointer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/hooks/use-coarse-pointer.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useCoarsePointer } from "./use-coarse-pointer";

type Listener = (e: { matches: boolean }) => void;

/** Replace window.matchMedia with a controllable coarse/fine pointer mock. */
function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() {
      return matches;
    },
    media: "(pointer: coarse)",
    onchange: null,
    addEventListener: (_: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_: string, cb: Listener) => listeners.delete(cb),
    addListener: (cb: Listener) => listeners.add(cb),
    removeListener: (cb: Listener) => listeners.delete(cb),
    dispatchEvent: () => false,
  };
  window.matchMedia = vi
    .fn()
    .mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("returns true when the pointer is coarse (touch)", () => {
  mockMatchMedia(true);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(true);
});

test("returns false when the pointer is fine (mouse/trackpad)", () => {
  mockMatchMedia(false);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);
});

test("reacts when the active pointer changes", () => {
  const mm = mockMatchMedia(false);
  const { result } = renderHook(() => useCoarsePointer());
  expect(result.current).toBe(false);
  act(() => {
    mm.set(true);
  });
  expect(result.current).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/hooks/use-coarse-pointer.test.ts`
Expected: FAIL — `Failed to resolve import "./use-coarse-pointer"` / `useCoarsePointer is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/hooks/use-coarse-pointer.ts
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(pointer: coarse)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

// SSR/first-paint default: assume a fine pointer so we render the desktop
// affordances, then hydrate to the real value. Avoids a touch-styled flash on
// desktop and keeps RSC/PPR output stable.
function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` when the primary pointer is coarse (finger). Backed by
 * `matchMedia('(pointer: coarse)')`, NOT user-agent sniffing — an iPad with a
 * trackpad correctly reports a fine pointer and keeps desktop affordances.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/hooks/use-coarse-pointer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hooks/use-coarse-pointer.ts src/lib/hooks/use-coarse-pointer.test.ts
git commit -m "feat(touch): useCoarsePointer hook (matchMedia pointer:coarse)"
```

---

### Task 2: Touch-aware dnd-kit sensors

**Files:**

- Create: `src/lib/dnd/sensors.ts`
- Test: `src/lib/dnd/sensors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/dnd/sensors.test.ts
import { renderHook } from "@testing-library/react";
import { PointerSensor, TouchSensor } from "@dnd-kit/core";
import { expect, test } from "vitest";
import { useTouchAwareSensors } from "./sensors";

test("exposes a mouse PointerSensor and a long-press TouchSensor", () => {
  const { result } = renderHook(() => useTouchAwareSensors());
  const sensors = result.current;

  const pointer = sensors.find((s) => s.sensor === PointerSensor);
  const touch = sensors.find((s) => s.sensor === TouchSensor);

  expect(pointer).toBeDefined();
  expect(pointer?.options.activationConstraint).toEqual({ distance: 6 });

  expect(touch).toBeDefined();
  // 200ms hold "lifts" the item; an 8px move within that window scrolls instead.
  expect(touch?.options.activationConstraint).toEqual({
    delay: 200,
    tolerance: 8,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/dnd/sensors.test.ts`
Expected: FAIL — `Failed to resolve import "./sensors"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/dnd/sensors.ts
"use client";

import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/**
 * Shared dnd-kit sensors for every Pulse drag surface (Kanban, Table rows,
 * Gantt bars, dashboard widgets). Replaces the per-component
 * `useSensors(useSensor(PointerSensor, { distance: 6 }))` calls so touch
 * behaviour is configured in exactly one place.
 *
 * - PointerSensor (mouse/trackpad): 6px move before a drag starts (unchanged).
 * - TouchSensor (finger): 200ms long-press "lift" + 8px tolerance, so a quick
 *   swipe scrolls and a deliberate hold drags. See the iPad touch spec.
 */
export function useTouchAwareSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/dnd/sensors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dnd/sensors.ts src/lib/dnd/sensors.test.ts
git commit -m "feat(touch): shared touch-aware dnd-kit sensors (long-press lift)"
```

---

### Task 3: `<DragHandle>` primitive

The explicit-handle exception for precision drags (Gantt resize, Table column resize). Slim on desktop, ≥44px hit area under a finger.

**Files:**

- Create: `src/components/ui/drag-handle.tsx`
- Test: `src/components/ui/drag-handle.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/drag-handle.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DragHandle } from "./drag-handle";

test("renders an accessible button with a coarse-pointer 44px target", () => {
  render(<DragHandle />);
  const handle = screen.getByRole("button", { name: "Drag to reorder" });
  // size-11 == 44px (2.75rem) — only applied under (pointer: coarse).
  expect(handle.className).toContain("pointer-coarse:size-11");
  // touch-action:none so dragging from the handle never scrolls the page.
  expect(handle.className).toContain("touch-none");
});

test("forwards dnd-kit listeners/attributes (e.g. onPointerDown)", () => {
  const onPointerDown = vi.fn();
  render(<DragHandle onPointerDown={onPointerDown} />);
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Drag to reorder" }),
  );
  expect(onPointerDown).toHaveBeenCalledTimes(1);
});

test("accepts a custom aria-label", () => {
  render(<DragHandle aria-label="Resize column" />);
  expect(
    screen.getByRole("button", { name: "Resize column" }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/drag-handle.test.tsx`
Expected: FAIL — `Failed to resolve import "./drag-handle"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/drag-handle.tsx
import * as React from "react";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Slim drag grip with a guaranteed ≥44px touch target on coarse pointers
 * (Apple HIG). Spread dnd-kit `listeners`/`attributes` onto it for the
 * precision-drag surfaces that opt out of long-press (Gantt bar resize, Table
 * column resize). `touch-none` keeps a drag-from-handle from scrolling.
 */
function DragHandle({
  className,
  "aria-label": ariaLabel = "Drag to reorder",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="drag-handle"
      aria-label={ariaLabel}
      className={cn(
        "text-muted-foreground/60 hover:text-foreground focus-visible:ring-ring inline-flex cursor-grab touch-none items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing",
        "size-5 pointer-coarse:size-11",
        className,
      )}
      {...props}
    >
      <GripVertical className="size-4" />
    </button>
  );
}

export { DragHandle };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/drag-handle.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/drag-handle.tsx src/components/ui/drag-handle.test.tsx
git commit -m "feat(touch): DragHandle primitive (slim on desktop, 44px on touch)"
```

---

### Task 4: `<RevealOnHover>` wrapper

Replaces ad-hoc `opacity-0 group-hover:opacity-100` action affordances. Hover-reveal for mouse; **always visible** on touch.

**Files:**

- Create: `src/components/ui/reveal-on-hover.tsx`
- Test: `src/components/ui/reveal-on-hover.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/reveal-on-hover.test.tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RevealOnHover } from "./reveal-on-hover";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useCoarsePointer).mockReset();
});

test("is always visible on a coarse pointer (no hover gating)", () => {
  vi.mocked(useCoarsePointer).mockReturnValue(true);
  render(
    <RevealOnHover>
      <button>Edit</button>
    </RevealOnHover>,
  );
  const wrap = screen.getByText("Edit").parentElement as HTMLElement;
  expect(wrap.className).toContain("opacity-100");
  expect(wrap.className).not.toContain("group-hover");
});

test("is hover-gated on a fine pointer", () => {
  vi.mocked(useCoarsePointer).mockReturnValue(false);
  render(
    <RevealOnHover>
      <button>Edit</button>
    </RevealOnHover>,
  );
  const wrap = screen.getByText("Edit").parentElement as HTMLElement;
  expect(wrap.className).toContain("opacity-0");
  expect(wrap.className).toContain("group-hover:opacity-100");
  // keyboard users still get it
  expect(wrap.className).toContain("focus-within:opacity-100");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/reveal-on-hover.test.tsx`
Expected: FAIL — `Failed to resolve import "./reveal-on-hover"`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/ui/reveal-on-hover.tsx
"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

/**
 * Wraps row/card actions that reveal on hover for mouse users but must stay
 * ALWAYS visible on touch (a finger can't hover). Place inside a `group`
 * ancestor so the hover variant resolves. Replaces hand-rolled
 * `opacity-0 group-hover:opacity-100` blocks across the board surfaces.
 */
function RevealOnHover({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const coarse = useCoarsePointer();
  return (
    <div
      data-slot="reveal-on-hover"
      data-coarse={coarse || undefined}
      className={cn(
        coarse
          ? "opacity-100"
          : "opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { RevealOnHover };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/reveal-on-hover.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/reveal-on-hover.tsx src/components/ui/reveal-on-hover.test.tsx
git commit -m "feat(touch): RevealOnHover wrapper (hover on mouse, always-on for touch)"
```

---

### Task 5: `pointer-coarse:` touch-target sizing on the Button primitive

Bump interactive primitives to a ≥44px hit area **only** under a coarse pointer, via Tailwind's built-in `pointer-coarse:` variant — desktop sizing is untouched. Button is the highest-leverage primitive (icon buttons across every toolbar/row).

**Files:**

- Modify: `src/components/ui/button.tsx:23-35` (the `size` variants)
- Test: `src/components/ui/button.touch.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/button.touch.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./button";

// 44px == size-11 / h-11. We assert the coarse-pointer variant is present in
// the class string (the media query itself only resolves in a real browser).
test("icon button gets a 44px target under a coarse pointer", () => {
  render(
    <Button size="icon" aria-label="More">
      <span />
    </Button>,
  );
  expect(screen.getByRole("button", { name: "More" }).className).toContain(
    "pointer-coarse:size-11",
  );
});

test("default button gets a 44px height under a coarse pointer", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" }).className).toContain(
    "pointer-coarse:h-11",
  );
});

test("desktop sizing is unchanged (still h-8 by default)", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" }).className).toContain(
    "h-8",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/button.touch.test.tsx`
Expected: FAIL — class strings do not yet contain `pointer-coarse:*`.

- [ ] **Step 3: Apply the change**

Edit `src/components/ui/button.tsx`, replacing the `size` block (lines 23-35) with the version below. Each variant gains a `pointer-coarse:` minimum; height variants bump to `h-11`, square icon variants to `size-11`, and icon glyphs scale up so they aren't lost in the larger target.

```ts
      size: {
        default:
          "h-8 pointer-coarse:h-11 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 pointer-coarse:h-11 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 pointer-coarse:h-11 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 pointer-coarse:h-11 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8 pointer-coarse:size-11",
        "icon-xs":
          "size-6 pointer-coarse:size-11 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 pointer-coarse:size-11 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 pointer-coarse:size-11",
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/button.touch.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify the variant actually compiles in the build**

Run: `pnpm build`
Expected: build succeeds. (Confirms Tailwind v4 emits the `pointer-coarse:` utilities — they're a built-in media variant, so no config change is needed.)

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/button.tsx src/components/ui/button.touch.test.tsx
git commit -m "feat(touch): 44px tap targets on Button under pointer:coarse"
```

---

### Task 6: Touch-aware tooltip

On a coarse pointer, suppress hover tooltips (no hover exists; a long-press tooltip would fight the drag "lift"). Controlled `open` usage is untouched. Logic is extracted to a pure, unit-tested helper.

**Files:**

- Create: `src/components/ui/tooltip-open.ts`
- Test: `src/components/ui/tooltip-open.test.ts`
- Modify: `src/components/ui/tooltip.tsx:21-25` (the `Tooltip` root)

- [ ] **Step 1: Write the failing test**

```ts
// src/components/ui/tooltip-open.test.ts
import { expect, test } from "vitest";
import { resolveTooltipOpen } from "./tooltip-open";

test("suppresses hover tooltips on a coarse pointer", () => {
  expect(resolveTooltipOpen(true, undefined)).toBe(false);
});

test("leaves tooltips uncontrolled on a fine pointer", () => {
  expect(resolveTooltipOpen(false, undefined)).toBeUndefined();
});

test("always respects an explicit controlled `open`", () => {
  expect(resolveTooltipOpen(true, true)).toBe(true);
  expect(resolveTooltipOpen(true, false)).toBe(false);
  expect(resolveTooltipOpen(false, true)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/ui/tooltip-open.test.ts`
Expected: FAIL — `Failed to resolve import "./tooltip-open"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/ui/tooltip-open.ts

/**
 * Decide the `open` prop for a Tooltip given the pointer type.
 * - Controlled usage (`open` provided) always wins.
 * - Otherwise on a coarse pointer force `open=false` (touch has no hover, and a
 *   long-press tooltip would fight the drag "lift"); essential info should live
 *   in an always-visible label on touch.
 * - On a fine pointer return `undefined` to keep Radix's default hover behavior.
 */
export function resolveTooltipOpen(
  coarse: boolean,
  open?: boolean,
): boolean | undefined {
  if (open !== undefined) return open;
  return coarse ? false : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/ui/tooltip-open.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the helper into the Tooltip root**

In `src/components/ui/tooltip.tsx`, add the imports and update `Tooltip`:

```tsx
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";
import { resolveTooltipOpen } from "./tooltip-open";

function Tooltip({
  open,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const coarse = useCoarsePointer();
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      open={resolveTooltipOpen(coarse, open)}
      {...props}
    />
  );
}
```

(`tooltip.tsx` is already `"use client"`, so the hook is safe here.)

- [ ] **Step 6: Run the full tooltip + foundation suite**

Run: `pnpm vitest run src/components/ui/tooltip-open.test.ts src/lib/hooks src/lib/dnd src/components/ui/drag-handle.test.tsx src/components/ui/reveal-on-hover.test.tsx`
Expected: PASS (all foundation tests green).

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/tooltip-open.ts src/components/ui/tooltip-open.test.ts src/components/ui/tooltip.tsx
git commit -m "feat(touch): suppress hover tooltips on coarse pointers"
```

---

### Task 7: Adopt shared sensors in one surface (Kanban) as the reference integration

Prove the foundation end-to-end by replacing Kanban's local sensor config with `useTouchAwareSensors()`. This is the smallest real consumer and becomes the pattern the Batch-2 surface plans copy. (Table/Gantt/etc. are migrated in their own Batch-2 plans, not here.)

**Files:**

- Modify: `src/components/boards/KanbanBoard.tsx:146-148` (sensor setup) and its `@dnd-kit/core` import (line 14 region — drop the now-unused `PointerSensor`, `useSensor`, `useSensors` if no longer referenced)
- Test: extend `src/components/boards/KanbanBoard.test.tsx` (or create `KanbanBoard.touch.test.tsx` if the existing file's harness is heavy)

- [ ] **Step 1: Write the failing test**

Add to the Kanban test file. It asserts the board renders its `DndContext` wired with the shared touch-aware sensors. Mock the sensors module so the assertion is about _wiring_, not dnd internals:

```tsx
// src/components/boards/KanbanBoard.touch.test.tsx
import { expect, test, vi } from "vitest";
import { useTouchAwareSensors } from "@/lib/dnd/sensors";

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});

test("Kanban board uses the shared touch-aware sensors", () => {
  // Render the board with whatever minimal fixture the existing
  // KanbanBoard.test.tsx already constructs (reuse its setup/helpers).
  // ... renderKanban(minimalFixture) ...
  expect(useTouchAwareSensors).toHaveBeenCalled();
});
```

> Implementer note: reuse the fixture/render helper already in `KanbanBoard.test.tsx`. If that harness can't mount cheaply in isolation, keep this assertion in the existing file where the fixtures live rather than a new file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/KanbanBoard.touch.test.tsx`
Expected: FAIL — `useTouchAwareSensors` is never called (board still uses local `useSensors`).

- [ ] **Step 3: Apply the change**

In `src/components/boards/KanbanBoard.tsx`, replace the local sensor setup:

```tsx
// remove:
//   const sensors = useSensors(
//     useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
//   );

import { useTouchAwareSensors } from "@/lib/dnd/sensors";
// ...
const sensors = useTouchAwareSensors();
```

Then prune `PointerSensor`, `useSensor`, `useSensors` from the `@dnd-kit/core` import if they're no longer used elsewhere in the file (keep `DndContext`, `useDraggable`, `useDroppable`, types).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/boards/KanbanBoard.touch.test.tsx`
Expected: PASS. Also run the existing board tests: `pnpm vitest run src/components/boards/KanbanBoard.test.tsx` → PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/KanbanBoard.tsx src/components/boards/KanbanBoard.touch.test.tsx
git commit -m "feat(touch): Kanban adopts shared touch-aware sensors (reference integration)"
```

---

### Task 8: Full gates + finish

- [ ] **Step 1: Run the complete gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four pass. Fix anything red before proceeding (e.g. unused-import lint errors from Task 7's prune).

- [ ] **Step 2: Finish the task (auto-rebase onto develop, gate, merge, clean up)**

Run: `scripts/finish-task.sh`
Expected: rebases `task/touch-foundation` onto latest `develop`, re-runs gates against the merged state, merges to `develop`, pushes, removes the worktree and branch. If it stops on a real rebase conflict, resolve `git rebase develop` and re-run.

---

## Self-Review

**Spec coverage** (against `2026-06-26-ipad-touch-optimization-design.md` → "Architecture — the touch foundation"):

- `useCoarsePointer()` / single source of truth → Task 1 (provider dropped in favor of `useSyncExternalStore`; rationale noted in header). ✅
- Touch-target sizing ≥44px on `ui/` primitives → Task 5 (Button; `pointer-coarse:` variant pattern that the remaining primitives — dropdown-menu item, etc. — follow in their own surface plans via the same one-line variant). ✅
- Hover→reveal pattern → Task 4. ✅
- dnd-kit `TouchSensor` (200ms/8px) + `<DragHandle>` → Tasks 2 & 3. ✅
- Tooltip → touch-aware fallback → Task 6. ✅
- "Produces" interfaces consumed by Batch 2 → all of the above are exported from stable paths; Task 7 demonstrates real consumption. ✅
- Tests mandatory (working-agreement #4) → every task is TDD; Task 8 runs all four gates. ✅
- Zero new server round-trips (working-agreement #5) → all changes are client primitives; no queries touched. ✅

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one soft spot — Task 7's reuse of the existing Kanban fixture — is explicitly flagged with an implementer note rather than left silent, because the exact fixture lives in a 75KB-adjacent test we adopt rather than reinvent.

**Type consistency:** `useCoarsePointer(): boolean` (Task 1) is consumed unchanged in Tasks 4 & 6. `useTouchAwareSensors()` (Task 2) is consumed in Task 7. `resolveTooltipOpen(coarse, open)` (Task 6) signature matches its call site. `DragHandle` (Task 3) is a forward-compatible `button` — consumed later by Gantt/Table surface plans.

## What this plan does NOT cover (deferred to Batch-2 surface plans)

Per the execution DAG, each surface is its own `task/<name>` worktree + plan, **written against the merged foundation API** (so signatures are real, not guessed): ② Board Table, ③ Kanban (full pass — Task 7 only swaps sensors), ④ Gantt (+zoom controls), ① Nav, ⑤ Calendar, ⑥ Dashboard, ⑦ Item Panel, ⑧ Command palette/menus. Also deferred per spec: Playwright iPad E2E matrix and the phone project.
