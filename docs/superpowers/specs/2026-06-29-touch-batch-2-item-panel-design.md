# TOUCH Batch 2 — Item Detail Panel iPad touch-ergonomics pass

**Date:** 2026-06-29
**Status:** Spec + plan written — awaiting review
**Scope owner:** Danijel Jovanovic
**Parent spec:** `docs/superpowers/specs/2026-06-26-ipad-touch-optimization-design.md` (Batch 2, surface ⑦ "Item Panel")
**Worktree / branch:** `.claude/worktrees/touch-item-panel` / `task/touch-item-panel`

---

## 1. Goal

Make the **Item Detail Panel** fully usable by a finger on an iPad. The panel already
opens full-bleed on small viewports (it is a shadcn `Sheet`), so this is purely an
**input-ergonomics** pass, not a layout-reflow pass:

1. Replace every **hover-only affordance** (`opacity-0 group-hover:opacity-100`, the
   `opacity-60 hover:opacity-100` delete) with the shared **always-on-touch / hover-on-mouse**
   convention so file and update actions are reachable without a hover.
2. Give every interactive control a **≥44px hit area on a coarse pointer** (Apple HIG),
   without changing its desktop footprint.

No new server round-trips, no new queries, no layout reflow. iPad-first (portrait 768px and
landscape 1024px); phone reflow stays out of scope per the parent spec.

## 2. Scope — the surface (code-verified)

Self-contained directory `src/components/boards/item-panel/` (~1,621 LOC incl. tests). The
panel is a tabbed `Sheet` (Fields / Updates / Activity / Files). Touch-relevant files:

| File                      | Touch debt found                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ItemPanel.tsx`           | Tab bar buttons are raw `<button class="px-3 py-2">` (~36px tall) — under 44px on touch. The shell itself.                                                   |
| `AttachmentCard.tsx`      | Gallery overlay: `bg-background/70 … opacity-0 … group-hover:opacity-100` wrapping raw `<button>` Preview / Download / Delete icons (`size-4`). Hover-gated. |
| `AttachmentRow.tsx`       | List row: `… opacity-0 … group-hover:opacity-100` wrapping raw `<button>` Preview / Download / Delete icons. Hover-gated.                                    |
| `FilePreviewLightbox.tsx` | Header action buttons (Open / Download / Delete) + nav arrows (`ChevronLeft`/`Right`) are raw `<button>` icons (`size-4` / `size-6`), no coarse sizing.      |
| `FilesTab.tsx`            | Gallery/list view-toggle is raw `<button class="px-2 py-1">` (icon-only, ~28px). The drop-zone + "Add files" already use the `Button` primitive (touch-OK).  |
| `UpdatesTab.tsx`          | Per-update Delete is `<button class="opacity-60 hover:opacity-100">` — low-affordance, no touch reveal, small target.                                        |

Not in scope (verified no touch debt or out of this surface's responsibility): `ActivityRow`,
`ActivityTab`, `MentionTextarea` (a `<textarea>`, native target), `PdfPreview` (canvas
renderer, no controls). The Fields tab is static metadata + two cells (`CreatedByCell`,
`CreatedAtCell`) with no interactive affordances.

### What "this surface has no `TODO(touch-batch-2)` markers" means

Confirmed: the item-panel directory is a **fresh, untouched surface** — no prior touch
annotations. There is also no merged precedent of a Batch-2 surface adopting `RevealOnHover`
yet (`grep` shows only the primitive + its own test use it). This slice is one of the first
real consumers of the foundation; follow the foundation's intended API exactly (below).

## 3. Foundation primitives to ADOPT (read-only — do NOT modify)

Batch 1 (the foundation) is merged. This slice **consumes** it; it must not touch these files.

1. **`src/components/ui/reveal-on-hover.tsx`** — `<RevealOnHover>`. A `<div>` that is
   `opacity-100` on a coarse pointer and `opacity-0 … group-hover:opacity-100
focus-within:opacity-100` on a fine pointer (reads `useCoarsePointer()` internally). Drop-in
   replacement for the hand-rolled `opacity-0 group-hover:opacity-100` blocks. **Must sit inside
   a `group` ancestor** so the hover variant resolves — both `AttachmentCard` and
   `AttachmentRow` already declare `className="group …"` on their root, so the wrapper resolves
   for free.

2. **`src/lib/hooks/use-coarse-pointer.ts`** — `useCoarsePointer()`. SSR-safe (`false` on the
   server → desktop affordances, hydrate to real value). We consume it **transitively** through
   `RevealOnHover`; we do **not** call it directly in this slice (no per-component branching
   needed once buttons route through the primitives below).

3. **`src/components/ui/button.tsx`** — the `Button` primitive. **This is how we get 44px for
   free.** Every `size` / `icon-*` variant already carries a `pointer-coarse:h-11` /
   `pointer-coarse:size-11` class (Tailwind v4's built-in `pointer-coarse:` variant →
   `@media (pointer: coarse)`). So migrating a raw `<button><Icon/></button>` to
   `<Button variant="ghost" size="icon-sm">` yields a 28px desktop target that **auto-grows to
   44px under a finger** with zero bespoke CSS. This is the canonical fix for every raw icon
   button in scope.

4. **`useTouchAwareSensors()` / dnd sensors** — available but **NOT used here.** The panel has
   no dnd reorder. File upload is a native `<input type=file>` + an HTML5 drag-drop drop-zone
   (desktop drag-a-file-in), neither of which is a dnd-kit pointer drag. No sensor wiring needed.

## 4. Design — the two mechanical transforms

This slice is two repeated transforms applied across six files. No new components, no new
state, no new props.

### Transform A — hover-overlay → `<RevealOnHover>`

Wherever a block uses `opacity-0 … group-hover:opacity-100` (or the `opacity-60 hover:` delete)
to gate action controls, replace the wrapper with `<RevealOnHover>` so the controls are
**always visible on touch** and unchanged (hover-gated) on mouse. Applies to: `AttachmentCard`
overlay, `AttachmentRow` action cluster, `UpdatesTab` per-update delete.

- `AttachmentCard`: the `<div class="bg-background/70 absolute inset-0 … opacity-0 …
group-hover:opacity-100">` becomes `<RevealOnHover className="bg-background/70 absolute
inset-0 flex items-center justify-center gap-2">`. (Keep `bg-background/70` so the overlay
  still scrims the thumbnail when revealed on touch.)
- `AttachmentRow`: the `<div class="… opacity-0 … group-hover:opacity-100">` action cluster
  becomes `<RevealOnHover className="flex shrink-0 items-center gap-2">`.
- `UpdatesTab`: the per-update `<button class="opacity-60 hover:opacity-100">Delete</button>`
  is wrapped — `<RevealOnHover>` around the (now `Button`-ified, Transform B) delete control.
  Drop the hand-rolled `opacity-60 hover:opacity-100`.

### Transform B — raw `<button>` icon → `Button` primitive (44px on coarse)

Every raw icon `<button>` in scope is replaced with the shadcn `Button` primitive so it inherits
`pointer-coarse:size-11`. Mapping:

- **Icon-only action buttons** (Preview / Download / Delete / Open-in-new-tab / nav arrows):
  `<Button variant="ghost" size="icon-sm" aria-label="…" onClick={…}><Icon className="size-4"/></Button>`.
  Destructive ones (Delete) use `variant="ghost"` with the existing `hover:text-destructive`
  intent preserved via className, or `variant="destructive"` where a filled affordance reads
  better — keep it **ghost** to match the current restrained look (pulse-ui: chrome stays
  monochrome; destructive is a token, not a filled button here).
- **Lightbox nav arrows** (`size-6` chevrons): `<Button variant="ghost" size="icon"
aria-label="Previous"/"Next">` — keep the absolute positioning classes via `className`,
  keep the `ChevronLeft/Right size-6`.
- **`FilesTab` view-toggle** (gallery / list): these are a segmented control (`aria-pressed`).
  Convert each to `<Button variant="ghost" size="icon-sm" aria-pressed={…}
className={mode === "x" ? "bg-accent" : "text-muted-foreground"}>` inside the existing
  `flex rounded-md border` group. Preserve `aria-pressed` and `aria-label` exactly (the
  existing `FilesTab.test.tsx` asserts on `aria-label`/pressed).
- **`ItemPanel` tab bar** (Fields/Updates/Activity/Files): these are a tab strip, not icon
  buttons. Keep them as buttons but bump the touch target: add `min-h-11 pointer-coarse:min-h-11`
  (≥44px) — simplest is to add `pointer-coarse:py-3` or an explicit `pointer-coarse:min-h-11`
  to the existing `px-3 py-2` so they reach 44px on touch without growing on desktop. Keep the
  active underline (`border-primary border-b-2`) and `capitalize` styling. (Using the `Button`
  primitive here would fight the underline-tab look, so a direct `pointer-coarse:` class is the
  right call — same mechanism, no primitive.)

### Accessibility & visual invariants (pulse-ui)

- **Every icon-only control keeps its `aria-label`** (Preview / Download / Delete / Open in new
  tab / Previous / Next / Gallery view / List view). The `Button` primitive does not add one —
  carry the existing `aria-label` across verbatim. Existing tests assert these.
- **Monochrome chrome.** Use `variant="ghost"`; do not introduce brand-colored buttons.
  `text-destructive` on delete is the only earned color (already a semantic token).
- **No layout reflow.** Desktop sizes are unchanged (`size-7`/`size-8` equivalents); only the
  `pointer-coarse:` media layer grows them. Gallery grid (`grid-cols-2`), list rows, lightbox
  dialog (`sm:max-w-3xl`) are untouched.
- Keep `focus-visible` rings (the `Button` primitive already provides them — a strict upgrade
  over the raw `<button>`s, which had none).

## 5. Data-fetching & performance budget (working-agreement #5)

| Question                                                           | Answer                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **What loads on first paint vs. each interaction?**                | Unchanged. Opening the panel is already 0 round-trips; the Files query stays **lazy** (`filesOpened = tab === "files"` in `ItemPanel.tsx`) and fires only on first Files-tab open. We add nothing.                                                                                                                                     |
| **Do these interactions change server data?**                      | The ergonomics changes themselves are **0 new server round-trips** — pure client CSS/visibility. The actions they expose (upload / delete attachment, delete update) are the **existing Server Actions** routed through the existing mutation hooks (`useAttachmentMutations`, `useUpdateMutations`); their revalidation is unchanged. |
| **In-page toggles (gallery/list view, tab switch) → round-trips?** | **0.** View mode and active tab are local `useState`; switching them re-renders client-side only. (Tab switch can lazily trigger the one-time Files fetch, which already exists — not new.)                                                                                                                                            |
| **Is the hot-path read bounded/indexed?**                          | Not touched by this slice. Attachments/updates reads are the existing collaboration-cache reads; we add no query, no `select *`, no growth.                                                                                                                                                                                            |

**Net: first-paint and per-interaction server cost is identical to today.**

## 6. Disjointness from the parallel Batch-2 passes (working-agreement #6)

This surface is **fully isolated** from the concurrent Table / Nav / Kanban / Gantt / Calendar
/ Dashboard / Cmd-menu passes:

- **Own directory.** Every file touched is under `src/components/boards/item-panel/`. No other
  Batch-2 surface writes there.
- **Only shared, read-only dependencies.** It consumes `reveal-on-hover.tsx`, `button.tsx`,
  `use-coarse-pointer.ts` — all merged foundation, **modified by none of the parallel slices**.
- **No shared mutable state, no shared route, no shared store.** Therefore it can run in its own
  `task/touch-item-panel` worktree **concurrently** with the other Batch-2 surfaces with zero
  merge contention beyond trivial import-ordering. It is an independent unit in the Batch-2
  parallel wave (parent spec's "Light lane", surface ⑦).

## 7. Test plan (working-agreement #4 — mandatory, written & executed)

Follow the existing item-panel Vitest/jsdom + Testing-Library conventions (see
`AttachmentCard.test.tsx`, `FilesTab.test.tsx`). jsdom can't simulate touch physics, so we
assert the **rendered contract**, mirroring how `reveal-on-hover.test.tsx` does it: mock
`useCoarsePointer` and assert visibility classes.

**Per-file coarse-pointer assertions (new/extended tests):**

1. **`AttachmentCard.test.tsx`** (extend): with `useCoarsePointer → true`, the overlay wrapper
   renders `opacity-100` and **not** `group-hover:opacity-100`; the Preview/Download/Delete
   buttons are present (`getByRole("button", { name: … })`). With `→ false`, wrapper is
   `opacity-0 group-hover:opacity-100`. (Keep the existing previewable/non-previewable cases.)
2. **`AttachmentRow.test.tsx`** (new — no test today): same coarse/fine visibility contract for
   the action cluster; assert the three `aria-label`s resolve.
3. **`UpdatesTab.test.tsx`** (extend): with coarse pointer, the per-update "Delete update"
   control is visible (not `opacity-60`-gated) and clickable → calls `onDelete(id)`. With fine
   pointer, it is hover-gated.
4. **`FilesTab.test.tsx`** (extend): the gallery/list toggle buttons still expose
   `aria-label="Gallery view"`/`"List view"` and `aria-pressed`, and toggling `mode` still
   switches `AttachmentCard`↔`AttachmentRow` rendering (regression guard that the `Button`
   swap preserved the segmented-control semantics the existing test relies on).
5. **`FilePreviewLightbox.test.tsx`** (extend): the header actions (Open in new tab / Download /
   Delete) and the Previous/Next nav controls resolve by `aria-label` and fire their handlers;
   keyboard ←/→/Esc still navigate/close (assert the existing handlers are intact after the
   `Button` swap).
6. **`ItemPanel.test.tsx`** (extend): the four tab buttons render and switch tab on click
   (regression guard that the `pointer-coarse:` sizing tweak didn't break tab switching).

> jsdom note: `pointer-coarse:` sizing is a CSS media-query class and is **not** evaluated by
> jsdom layout, so we assert on **class presence** (e.g. the button carries `data-size="icon-sm"`
> / the coarse class string) rather than measured pixel height. Pixel-level 44px verification is
> the manual iPad check (§9) and the deferred Playwright iPad matrix (parent spec).

**Mocking pattern (matches `reveal-on-hover.test.tsx`):**

```tsx
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));
// per test: vi.mocked(useCoarsePointer).mockReturnValue(true | false)
```

**Gates (per task, all must pass):**

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # ESLint
pnpm test        # Vitest
pnpm build       # production build
```

---

# Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Item Detail Panel touch-usable on iPad by adopting `<RevealOnHover>` for
hover-only action affordances and routing raw icon `<button>`s through the `Button` primitive
(which carries `pointer-coarse:` 44px sizing), across six files in
`src/components/boards/item-panel/`.

**Architecture:** Two mechanical transforms (Transform A: hover-overlay → `RevealOnHover`;
Transform B: raw `<button>` → `Button` primitive) applied per-file. Each file is an independent
unit with its own test. No new components, props, state, queries, or server round-trips.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 (`pointer-coarse:` variant),
shadcn/ui `Button`, lucide-react, Vitest + Testing Library (jsdom).

---

## File structure (locked decomposition)

| File                                                       | Change                                              |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `src/components/boards/item-panel/AttachmentCard.tsx`      | Transform A (overlay) + B (3 icon buttons)          |
| `src/components/boards/item-panel/AttachmentRow.tsx`       | Transform A (cluster) + B (3 icon buttons)          |
| `src/components/boards/item-panel/UpdatesTab.tsx`          | Transform A + B (per-update Delete)                 |
| `src/components/boards/item-panel/FilePreviewLightbox.tsx` | Transform B (3 header actions + 2 nav arrows)       |
| `src/components/boards/item-panel/FilesTab.tsx`            | Transform B (gallery/list toggle)                   |
| `src/components/boards/item-panel/ItemPanel.tsx`           | `pointer-coarse:` 44px on tab strip                 |
| Sibling `*.test.tsx` for each of the above                 | New/extended coarse-pointer + regression assertions |

Each task is **TDD**: write/extend the failing test, watch it fail, make the change, watch it
pass, commit. Stage **only** the two files per task (`git add <component> <test>`) — never
`git add -A` (working agreement: commit your own work only).

---

### Task 1: `AttachmentCard` — overlay reveal + 44px icon buttons

**Files:**

- Modify: `src/components/boards/item-panel/AttachmentCard.tsx`
- Test: `src/components/boards/item-panel/AttachmentCard.test.tsx` (extend)

- [ ] **Step 1 — Write failing tests.** Add to `AttachmentCard.test.tsx`: mock
      `useCoarsePointer`; (a) coarse → the overlay wrapper has class `opacity-100` and NOT
      `group-hover:opacity-100`; (b) fine → wrapper has `opacity-0` and `group-hover:opacity-100`.
      Reuse the `att()` factory already in the file. Find the overlay via the Preview button's
      closest `[data-slot="reveal-on-hover"]`.

```tsx
vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

it("shows action overlay always-on for a coarse pointer", () => {
  vi.mocked(useCoarsePointer).mockReturnValue(true);
  render(
    <AttachmentCard
      attachment={att({ mime_type: "image/png", file_name: "a.png" })}
      members={[]}
      canDelete
      onPreview={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  const overlay = screen
    .getByRole("button", { name: "Download" })
    .closest('[data-slot="reveal-on-hover"]') as HTMLElement;
  expect(overlay.className).toContain("opacity-100");
  expect(overlay.className).not.toContain("group-hover");
});
```

- [ ] **Step 2 — Run, expect FAIL.** `pnpm test AttachmentCard` → fails (no `reveal-on-hover`
      slot yet).
- [ ] **Step 3 — Apply Transform A + B.** Import `{ RevealOnHover }` from
      `@/components/ui/reveal-on-hover` and `{ Button }` from `@/components/ui/button`. Replace the
      `<div className="bg-background/70 absolute inset-0 … opacity-0 … group-hover:opacity-100">`
      with `<RevealOnHover className="bg-background/70 absolute inset-0 flex items-center
justify-center gap-2">`. Replace each inner `<button …><Icon className="size-4"/></button>`
      with `<Button variant="ghost" size="icon-sm" aria-label="Preview"|"Download"|"Delete"
onClick={…}><Icon className="size-4"/></Button>`, preserving each `aria-label` and the
      `hover:text-destructive` intent on Delete (via `className="text-muted-foreground
hover:text-destructive"`).
- [ ] **Step 4 — Run, expect PASS.** `pnpm test AttachmentCard` (existing previewable/zip cases
      still green).
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/AttachmentCard.tsx
src/components/boards/item-panel/AttachmentCard.test.tsx && git commit -m "feat(boards): touch-reveal + 44px actions on AttachmentCard"`

### Task 2: `AttachmentRow` — cluster reveal + 44px icon buttons

**Files:**

- Modify: `src/components/boards/item-panel/AttachmentRow.tsx`
- Test: `src/components/boards/item-panel/AttachmentRow.test.tsx` (**new**)

- [ ] **Step 1 — Write failing tests.** Create `AttachmentRow.test.tsx` (mirror
      `AttachmentCard.test.tsx`'s `att()` factory and imports). Assert: (a) all three actions
      resolve by `aria-label` (Preview/Download/Delete; Preview only when `canPreviewInline`);
      (b) coarse → action cluster wrapper is `opacity-100`, not `group-hover`; (c) fine →
      `opacity-0 group-hover:opacity-100`.
- [ ] **Step 2 — Run, expect FAIL.** `pnpm test AttachmentRow` → fails (file/slot absent).
- [ ] **Step 3 — Apply Transform A + B.** Import `RevealOnHover` + `Button`. Replace the
      `<div className="flex shrink-0 items-center gap-2 opacity-0 … group-hover:opacity-100">`
      with `<RevealOnHover className="flex shrink-0 items-center gap-2">`. Convert the three inner
      `<button>`s to `<Button variant="ghost" size="icon-sm" aria-label=…>` keeping icons + labels.
- [ ] **Step 4 — Run, expect PASS.** `pnpm test AttachmentRow`.
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/AttachmentRow.tsx
src/components/boards/item-panel/AttachmentRow.test.tsx && git commit -m "feat(boards): touch-reveal + 44px actions on AttachmentRow"`

### Task 3: `UpdatesTab` — per-update Delete reveal + target size

**Files:**

- Modify: `src/components/boards/item-panel/UpdatesTab.tsx`
- Test: `src/components/boards/item-panel/UpdatesTab.test.tsx` (extend)

- [ ] **Step 1 — Write failing test.** Mock `useCoarsePointer`. Render `UpdatesTab` with a
      one-update `cache`. Coarse → the "Delete update" control is visible (wrapper `opacity-100`,
      not `opacity-60`/`group-hover`) and clicking it calls `onDelete(u.id)`. (Keep existing cases.)
- [ ] **Step 2 — Run, expect FAIL.** `pnpm test UpdatesTab`.
- [ ] **Step 3 — Apply Transform A + B.** Wrap the delete control in `<RevealOnHover>` and
      convert `<button class="opacity-60 hover:opacity-100" aria-label="Delete update">Delete</button>`
      to `<Button variant="ghost" size="sm" aria-label="Delete update" onClick={() => onDelete(u.id)}>
Delete</Button>` (text button, `size="sm"` → `pointer-coarse:h-11`). Drop the hand-rolled
      `opacity-60 hover:opacity-100`.
- [ ] **Step 4 — Run, expect PASS.** `pnpm test UpdatesTab`.
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/UpdatesTab.tsx
src/components/boards/item-panel/UpdatesTab.test.tsx && git commit -m "feat(boards): touch-reveal + sized delete on UpdatesTab"`

### Task 4: `FilePreviewLightbox` — 44px header actions + nav arrows

**Files:**

- Modify: `src/components/boards/item-panel/FilePreviewLightbox.tsx`
- Test: `src/components/boards/item-panel/FilePreviewLightbox.test.tsx` (extend)

- [ ] **Step 1 — Write failing test.** Render the lightbox at a middle index (so both Previous
      and Next exist). Assert each of "Open in new tab", "Download", "Delete" (when
      `currentUserId === uploaded_by`), "Previous", "Next" resolves by `aria-label` and fires its
      handler on click (`onDownload`/`onDelete`/`onIndexChange`). Assert the `Button` primitive is
      used (e.g. `getByRole("button", { name: "Next" })` has `data-slot="button"`).
- [ ] **Step 2 — Run, expect FAIL.** `pnpm test FilePreviewLightbox`.
- [ ] **Step 3 — Apply Transform B.** Import `Button`. Convert the three header action
      `<button>`s to `<Button variant="ghost" size="icon-sm" aria-label=…>` (keep `size-4` icons,
      `hover:text-destructive` on Delete). Convert the two nav `<button>`s to `<Button
variant="ghost" size="icon" aria-label="Previous"|"Next" className="absolute top-1/2
left-2|right-2 -translate-y-1/2">` keeping the `ChevronLeft/Right size-6`. Leave the keyboard
      `useEffect` (←/→/Esc) and PDF-URL effect untouched.
- [ ] **Step 4 — Run, expect PASS.** `pnpm test FilePreviewLightbox` (existing cases green).
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/FilePreviewLightbox.tsx
src/components/boards/item-panel/FilePreviewLightbox.test.tsx && git commit -m "feat(boards): 44px lightbox actions + nav for touch"`

### Task 5: `FilesTab` — gallery/list toggle as sized buttons

**Files:**

- Modify: `src/components/boards/item-panel/FilesTab.tsx`
- Test: `src/components/boards/item-panel/FilesTab.test.tsx` (extend)

- [ ] **Step 1 — Write failing test.** Assert the toggle buttons still expose
      `aria-label="Gallery view"`/`"List view"` with `aria-pressed`, are the `Button` primitive
      (`data-slot="button"`), and clicking "List view" swaps rendering from `AttachmentCard` (gallery
      grid) to `AttachmentRow` rows for a non-empty cache. Reuse the file's `att()` factory + `base`.
- [ ] **Step 2 — Run, expect FAIL.** `pnpm test FilesTab`.
- [ ] **Step 3 — Apply Transform B.** Convert the two toggle `<button class="px-2 py-1 …">`s to
      `<Button variant="ghost" size="icon-sm" aria-label="Gallery view"|"List view"
aria-pressed={mode === "gallery"|"list"} onClick={…} className={mode === "x" ? "bg-accent" :
"text-muted-foreground"}>` inside the existing `flex rounded-md border` wrapper. Keep the
      `LayoutGrid`/`List` `size-4` icons. (The "Add files" `Button` and the native file `<input>`
      already meet the bar — leave them.)
- [ ] **Step 4 — Run, expect PASS.** `pnpm test FilesTab` (empty-state + mode-switch cases green).
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/FilesTab.tsx
src/components/boards/item-panel/FilesTab.test.tsx && git commit -m "feat(boards): 44px gallery/list toggle on FilesTab"`

### Task 6: `ItemPanel` — 44px tab strip on coarse pointer

**Files:**

- Modify: `src/components/boards/item-panel/ItemPanel.tsx`
- Test: `src/components/boards/item-panel/ItemPanel.test.tsx` (extend)

- [ ] **Step 1 — Write failing test.** Add a regression assertion: the four tab buttons
      (Fields / Updates / Activity Log / Files) render, and clicking a tab switches the visible
      panel content (e.g. click "Files" → the Files tab content appears). Assert each tab button's
      className includes the coarse sizing token (e.g. `pointer-coarse:min-h-11`). Reuse the
      `renderPanel`/`ctx` harness already in the file.
- [ ] **Step 2 — Run, expect FAIL.** `pnpm test ItemPanel` (class assertion fails).
- [ ] **Step 3 — Apply the sizing tweak.** On the tab-strip `<button>` className, append
      `min-h-11 pointer-coarse:min-h-11` (or `pointer-coarse:py-3`) so each tab reaches ≥44px on a
      coarse pointer without growing on desktop. Keep `px-3 py-2 text-sm capitalize`, the active
      `border-primary border-b-2 font-medium`, and the existing onClick/setTab logic verbatim.
      (Do **not** route these through `Button` — it would conflict with the underline-tab styling.)
- [ ] **Step 4 — Run, expect PASS.** `pnpm test ItemPanel`.
- [ ] **Step 5 — Commit.** `git add src/components/boards/item-panel/ItemPanel.tsx
src/components/boards/item-panel/ItemPanel.test.tsx && git commit -m "feat(boards): 44px item-panel tab strip on touch"`

### Task 7: Full-gate verification + finish

**Files:** none (verification only).

- [ ] **Step 1 — Run the full gate.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` —
      all four must pass. Fix any fallout in-place (re-run the gate).
- [ ] **Step 2 — Manual iPad sanity (if a device/emulator is available).** Walk §9 below.
- [ ] **Step 3 — Finish the task.** Run `scripts/finish-task.sh` from inside the worktree
      (rebases onto `develop`, re-gates, merges, cleans up the worktree + branch). Then hand the
      user the §9 "How to test" walkthrough.

---

## Execution DAG (working-agreement #6)

```
Tasks 1–6  ── all independent (one file + its sibling test each, no shared edits) ──┐
                                                                                     ├─> Task 7 (full gate + finish)
   T1 AttachmentCard   T2 AttachmentRow   T3 UpdatesTab                              │
   T4 FilePreviewLightbox   T5 FilesTab   T6 ItemPanel  ───────────────────────────┘
```

- **Dependency graph:** Task 7 depends on Tasks 1–6. Tasks 1–6 depend on **nothing** (and only
  on the already-merged foundation). No edge exists between any of 1–6 — each touches a
  different component file + its own test; `FilesTab` (T5) imports `AttachmentCard`/`AttachmentRow`
  but only at the type/usage level, and T1/T2 don't change those import signatures, so there is
  no ordering constraint.
- **Parallel batches:**
  - **Batch A (concurrent):** Tasks 1, 2, 3, 4, 5, 6 — six independent units.
  - **Batch B:** Task 7 (gate + finish), after Batch A.
- **Critical path / wall-clock floor:** one Batch-A task (the slowest of T1–T6; likely T4
  `FilePreviewLightbox`, the most controls) **→** Task 7. So the floor is ~2 task-lengths, not 7.

**Intra-slice concurrency note:** Tasks 1–6 edit disjoint files, so they _can_ be dispatched as
parallel subagents within this one worktree (`subagent-driven-development` /
`dispatching-parallel-agents`) without clobbering each other — no nested worktrees needed since
the files don't overlap. Whether to parallelize is the executor's call; the gate (Task 7) is the
single serialization point.

> This whole slice is itself one node in the **parent** Batch-2 wave (parent spec §"Execution
> DAG", surface ⑦, Light lane) and runs concurrently with the Table/Nav/Kanban/Gantt/Calendar/
> Dashboard/Cmd-menu slices in their own worktrees — see §6 (disjointness).

---

## 9. How to test this (manual acceptance — for the closing walkthrough)

On an **iPad** (or Chrome DevTools device emulation with `(pointer: coarse)`, e.g. an iPad
profile), against the merged `develop`:

1. Open any board → tap an item to open the **Item Detail Panel** (Sheet).
2. **Tab strip:** the four tabs (Fields / Updates / Activity Log / Files) are comfortably
   tappable (≈44px tall); tapping switches tabs with no full-page reload.
3. **Files tab → Gallery:** each file card's **Preview / Download / Delete** icons are
   **already visible** (no hover needed) and each is an easy ≈44px tap target. Tap Preview →
   lightbox opens.
4. **Lightbox:** the **Previous/Next** arrows and the **Open / Download / Delete** header
   actions are all finger-sized and tappable; ←/→/Esc still work with a keyboard if attached.
5. **Files tab → List view:** tap the **List** toggle (sized, with the gallery/list segmented
   control); each row's Preview/Download/Delete actions are visible and tappable without hover.
6. **Updates tab:** add an update, then confirm its **Delete** control is visible (not faint /
   hover-only) and tappable.
7. **Desktop regression (mouse):** on a normal desktop, row/card actions are still
   **hover-revealed** (hidden until hover) and controls are their original compact size — no
   visual change from before.

**Expected throughout:** no layout shift, no new network requests on view/tab toggles (verify in
the Network tab — only the one lazy Files fetch on first Files-tab open, as today).
