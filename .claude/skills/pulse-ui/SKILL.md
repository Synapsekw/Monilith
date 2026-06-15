---
name: pulse-ui
description: Use when building or styling any Pulse UI — React components, pages, shadcn primitives, board/table/kanban surfaces, item panels, forms, or anything visual — to apply Pulse's monochromatic + single-accent design system and component conventions. Complements the generic frontend-design skill with this project's specific tokens, shadcn/Tailwind v4 patterns, and app primitives.
---

# Pulse UI

Pulse's look is **monochromatic chrome + one configurable accent**, Linear-grade restraint
applied to a colorful (Monday-style) category. Build on shadcn/ui + Tailwind v4. Pair with the
`frontend-design` skill for craft; this skill is the project-specific source of truth.

## Core principle

**Chrome is strictly monochrome. Color is earned.** Navigation, surfaces, borders, and text
use neutrals only. The single brand accent (`--brand` → `primary`/`ring`) marks primary
actions and focus. The status palette is the _one_ sanctioned multi-color set, and only for
status/label cells — never for chrome.

## Design tokens (defined in `src/app/globals.css`, light + dark)

Always style with semantic tokens, never raw Tailwind colors (`bg-zinc-800`, `text-blue-500`
are forbidden in app code). Use the utility, not the CSS var, in JSX.

| Need                                  | Token / utility                                             | Notes                                 |
| ------------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| Page background                       | `bg-background` `text-foreground`                           | base canvas                           |
| Raised surface (cards, panels, cells) | `bg-surface` / `bg-surface-muted`                           | `card`/`popover` also map to surfaces |
| Secondary text                        | `text-muted-foreground`                                     | labels, hints, metadata               |
| Hairline divider / outline            | `border` (uses `--border`)                                  | hairline in dark, subtle in light     |
| Primary action / active               | `bg-primary text-primary-foreground`                        | **this is the brand accent**          |
| Focus ring                            | `ring-ring` / `focus-visible:ring-2`                        | brand-colored, AA visible             |
| Subtle hover (chrome)                 | `hover:bg-accent`                                           | monochrome gray, NOT brand            |
| Brand (explicit)                      | `bg-brand` / `text-brand`                                   | alias of primary; prefer `primary`    |
| Status labels only                    | `bg-status-{gray,blue,green,yellow,orange,red,purple,teal}` | the only multicolor surface           |

Radius: `rounded-md` default (tokens scale from `--radius` 0.625rem). Font: Geist via
`font-sans` / `font-mono`. Spacing: 4px grid. Icons: **lucide-react**, `size-4` (16px) inline,
`size-3.5` in dense rows. `text-destructive` is allowed for danger actions/menu items (it's a
semantic token, not raw color) — that's the only non-status color beyond the brand.

## Status & priority color semantics (normative — keep consistent across the app)

`StatusColor` is the union of the eight status tokens. Define/import it centrally; don't invent
ad-hoc mappings.

```ts
export type StatusColor =
  | "gray"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "teal";
```

| Domain concept                  | Color    |
| ------------------------------- | -------- |
| Done / success / on-track       | `green`  |
| In progress / active / info     | `blue`   |
| Not started / neutral / backlog | `gray`   |
| At risk / needs attention       | `yellow` |
| Blocked / overdue / stuck       | `red`    |
| Waiting / on hold               | `orange` |
| Review / QA                     | `purple` |
| Planning / discovery            | `teal`   |

Priority maps: `Low=gray`, `Medium=blue`, `High=orange`, `Urgent=red`. User-defined statuses
pick from this palette (Monday-style); these are the defaults for system states.

## Conventions

- **Server Components by default.** Add `"use client"` only for interactivity (state, effects,
  handlers, dnd, forms). Mutations go through Server Actions (RLS is the real boundary).
- **shadcn first.** Reuse `src/components/ui/*` (button, card, dialog, dropdown-menu, input,
  label, command, separator, tooltip, textarea, input-group). Add more with
  `yes '' | pnpm dlx shadcn@latest add <name> -y`. Compose with `cn()` from `@/lib/utils`.
- **Theming:** class-based dark mode via next-themes (no-flash already wired in
  `providers.tsx`). Never hardcode a theme; tokens handle both. Respect
  `prefers-reduced-motion` (handled globally in globals.css).
- **Motion:** Framer Motion, 150–250ms, ease-out; subtle. Panels/drawers slide, drag gives
  feedback, optimistic UI. Never animate chrome gratuitously.
- **Accessibility (WCAG AA):** every interactive element keyboard-reachable, visible
  `focus-visible` ring, `aria-label`/`sr-only` text for icon-only controls, `aria-invalid` on
  errored fields. Monochrome + accent makes contrast tight — verify AA, don't convey state by
  color alone (pair status color with text/icon).
- **Density:** generous whitespace, but board/table surfaces are information-dense — compact
  rows, hairline separators, truncation with tooltips.

## App primitives

Existing: `AppShell` (sidebar + topbar, optional `user`/`org`/`workspaces`), `CommandPalette`
(⌘K), `ThemeToggle`, `auth/AuthForm`, `onboarding/OnboardingForm`. Use `AppShell` as the
authed layout frame.

Planned (build as reusable, single-purpose, well-typed components in `src/components/`):
`BoardTable`, `StatusCell`, `PersonCell`, `DateCell`, `ItemPanel`, `ViewSwitcher`. Each: one
clear purpose, typed props, no cross-org data assumptions (data is RLS-scoped server-side).

## Quick patterns

```tsx
// Status label — the ONE place color is allowed. Pair color with text (not color-only).
// a11y: plain span + the label text carries meaning; no role="status" (that's a live region).
function StatusCell({ label, color }: { label: string; color: StatusColor }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-white",
        `bg-status-${color}`,
      )}
    >
      {label}
    </span>
  );
}
```

```tsx
// Surface card with hairline border — monochrome chrome.
<div className="bg-surface rounded-md border p-4">…</div>
```

**Row / cell density & menus:** icon-only row controls use a ghost `Button size="icon"` shrunk
to `size-7` (28px); wrap them in a `Tooltip` for discoverability. In a `DropdownMenu`, put a
`DropdownMenuSeparator` before destructive items and style those with `text-destructive`.

**Motion:** Radix/shadcn built-in animations (dropdown, dialog, popover, tooltip) are the
standard — don't re-wrap them in Framer Motion. Reserve Framer for bespoke motion: side panels
/ drawers, drag feedback, optimistic transitions (150–250ms, ease-out).

## Common mistakes

- Using raw colors (`bg-slate-50`, `text-indigo-600`) instead of semantic tokens. → tokens only.
- Coloring chrome with the brand (vivid sidebars/headers). → chrome stays neutral; brand = actions/focus.
- `getSession()` for auth gating in UI. → use server `getUser()` (see auth/session helpers).
- Marking a whole file `"use client"` to use one handler. → push the client boundary to the leaf.
- Conveying status by color alone. → always add a label/icon (AA + colorblind).
- Hand-rolling a primitive shadcn already provides. → reuse `src/components/ui/*`.
