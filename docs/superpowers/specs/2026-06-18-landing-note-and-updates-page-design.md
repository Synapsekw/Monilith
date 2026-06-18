# Landing dev-note + public `/updates` page

- **Date:** 2026-06-18
- **Status:** Approved (design), pending spec review
- **Author:** Danijel Jovanovic (with Claude)

## Problem

Monolith is invite-only and under active development, but the public landing
page communicates none of that. Visitors get no signal that the product is
early-stage, and there is no public place to see what has shipped.

We want two things:

1. A small, tasteful note on the landing page that Monolith is **in active
   development** and **invitation only**.
2. A separate **public** page (outside the authenticated app) that shows
   product updates — a "what's new" changelog.

## Prior art

`mubarak-ai` ships a public `/updates` changelog. Its approach is **fully
automated**: a `generate-changelog.ts` script reads git history (conventional
commits), runs it through a parser with a ~39-pattern "jargon filter" that
strips internal/technical lines, and writes a committed
`changelog.generated.json`. A pre-commit hook regenerates it each commit; the
public page statically imports the JSON and renders a timeline with
`new` / `fixed` / `improved` badges. ~360 lines of parser tests back it.

We deliberately **do not** port that machinery now (see Decisions). We keep the
**same data shape** so auto-generation can be added later without touching the
page or components.

## Decisions

| Decision                | Choice                                                       | Why                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Updates content source  | **Hand-written / curated**                                   | Earliest stage, invite-only. Full editorial control over public wording, zero risk of leaking internal jargon, lightest to build. The jargon-filter heuristic is imperfect and not worth it yet. |
| Data shape              | Mirror Mubarak's (`date`, `kind`, text)                      | Lets us bolt on git auto-generation later without changing the page/components.                                                                                                                  |
| Landing note placement  | **Status pill above the wordmark** + **minimal hero footer** | Pill (`In active development`) reads first without competing with the CTAs; footer carries `Invitation only` (left) and an `Updates →` link (right).                                             |
| Updates discoverability | **Linked from the landing** (footer `Updates →`)             | Page is public regardless; the link makes it findable for logged-out visitors.                                                                                                                   |
| Page styling            | Reuse the dark hero aesthetic, not the app shell             | `/updates` is a public marketing-ish page, not part of the authenticated product.                                                                                                                |
| Badge palette           | **Pulse monochromatic + single-accent**                      | Not Mubarak's gold/blue/emerald. Accent for `new`; muted/outline for `improved`/`fixed`. Exact tokens from the `pulse-ui` skill at build time.                                                   |

## Architecture & components

### Landing hero (`src/components/landing/`)

`monolith-scene.tsx` (client, framer-motion) and `monolith-hero.tsx` (server):

- **Status pill** — a new `motion.span` (or small badge element) rendered as the
  first staggered `item`, above the `MONOLITH` wordmark: a soft dot + the text
  `In active development`. Joins the existing `container`/`item` reveal; frozen
  under `prefers-reduced-motion` like the rest of the scene.
- **Hero footer** — a slim row pinned to the bottom of the scene:
  - Left: muted text `Invitation only`.
  - Right: `Updates →` link to `/updates`.
  - Styled with the same theme-independent fixed light values the CTAs use
    (the hero is always-dark), so it stays legible over the topography backdrop.
- No change to auth logic or the CTA derivation in `MonolithHero`. The footer
  link is the only new navigation. When `signedIn`, the footer/pill still
  render (the `/landing` splash) — copy is identical; only the CTA differs, as
  today.

### Public route (`src/app/updates/page.tsx`)

- **Server Component**, public. No middleware exists in the repo (auth is
  page-level — the root page renders the hero when logged out), so nothing
  gates this route.
- `export const metadata` — title `Updates · Monolith`, a short description.
- Self-contained dark page (does **not** use `AppShell`): centered, max-width
  column, a back-to-home affordance (link to `/`), and a header:
  _"What's new — Monolith is in active development, newest first."_
- Renders `<ChangelogTimeline entries={...} />` from curated data. Fully
  static: no DB, no data fetching, no client JS beyond styling needs.

### Curated data + types (`src/lib/changelog/`)

```ts
// types.ts
export type ChangelogKind = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  date: string; // "YYYY-MM-DD"
  kind: ChangelogKind;
  title: string;
  description?: string;
}
```

- `entries.ts` — the hand-written, newest-first array of `ChangelogEntry`,
  edited when something noteworthy ships. Seeded with a few real recent items
  (e.g. board automations, faster board loads) — phrased for end users.
- A tiny pure helper (e.g. `groupByDate(entries)`) that validates/sorts
  newest-first and groups entries sharing a date. Lives next to the data or in
  the timeline component's module — kept pure for unit testing.

### Components (`src/components/changelog/`)

- `ChangelogTimeline` — takes `entries`, groups by date (newest first), renders
  a date group per day; renders an empty state when there are none.
- `ChangelogItemBadge` — small badge per `kind`, Pulse monochromatic +
  single-accent: accent for `new`, muted/outline for `improved` and `fixed`.
- (Optional) `ChangelogDateGroup` — a date header + its items, if it keeps
  `ChangelogTimeline` clean. Mirrors Mubarak's split but only if it earns its
  keep.

## Data flow

```
src/lib/changelog/entries.ts  (hand-written, newest-first)
        │
        ▼
groupByDate() helper  (pure: validate + sort + group)
        │
        ▼
src/app/updates/page.tsx  (RSC, static)
        │
        ▼
<ChangelogTimeline> → <ChangelogDateGroup>* → <ChangelogItemBadge>*
```

Landing: `monolith-hero` (RSC) → `monolith-scene` (client) renders the pill +
footer; footer `Updates →` is a plain `<Link href="/updates">`.

## Performance & data-fetching budget

- Both the landing and `/updates` are **fully static** — content is import-time
  constant, no DB, no Supabase calls.
- **First paint only.** No tabs/filters/sorts over server data, so **0 server
  round-trips** on interaction. Compliant with
  `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md` by
  construction.
- The curated list is short; no pagination/virtualization needed.

## Error handling / edge cases

- **Empty changelog** → `ChangelogTimeline` renders an explicit empty state
  ("Nothing here yet" style), never a blank page.
- **Malformed date / bad `kind`** → the curated data is typed; TypeScript +
  the validating helper catch issues at build/test time, not runtime. The
  helper sorts defensively so out-of-order hand edits still render newest-first.
- `prefers-reduced-motion` on the hero → existing behavior preserved (pill/
  footer appear without the reveal animation).

## Testing (mandatory)

- **Unit** — `groupByDate` helper: sorts newest-first; groups multiple entries
  on the same date; handles empty input.
- **Component** — `ChangelogTimeline`: renders entries and correct badge labels
  per `kind`; renders the empty state for `[]`.
- **Landing** — extend `src/app/page.test.tsx`: assert the status-pill text
  (`In active development`) and the `Updates` link with `href="/updates"`.
- **Gate before "done":** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  all green; `/updates` and the landing visually verified.

## Out of scope (YAGNI)

- Auto-generation from git history, the jargon-filter parser, generated JSON,
  and the pre-commit hook (revisit if curation becomes a burden — the shared
  data shape makes this a drop-in later).
- RSS/Atom feed, per-entry permalinks, pagination, search/filtering.
- Email/in-app "what's new" notifications.

## Files touched

- `src/components/landing/monolith-scene.tsx` — pill + footer (edit)
- `src/components/landing/monolith-hero.tsx` — pass-through if needed (edit)
- `src/components/landing/monolith-hero.module.css` — pill/footer styles (edit)
- `src/app/updates/page.tsx` — new public route (new)
- `src/lib/changelog/types.ts` — types (new)
- `src/lib/changelog/entries.ts` — curated data + `groupByDate` helper (new)
- `src/components/changelog/ChangelogTimeline.tsx` (new)
- `src/components/changelog/ChangelogItemBadge.tsx` (new)
- `src/components/changelog/ChangelogDateGroup.tsx` — optional (new)
- Tests alongside each + `src/app/page.test.tsx` (edit)
