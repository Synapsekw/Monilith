---
type: session
date: 2026-07-05-1904
branch: develop
trigger: wrapup
status: complete
tags: [session, boards, hydration, ssr, bugfix]
related:
  - "[[2026-07-05-gotcha-50-tolocaledatestring-undefined-locale-hydration-mismatch]]"
  - "[[2026-07-05-1227-boards-summary-ui-polish]]"
---

# Fix board date hydration mismatch (`toLocaleDateString(undefined)`)

## What changed

Root-caused and fixed the recurring board hydration error (`FooterValue`: server `"Jan 1"` vs client
`"1 Jan"`). Cause: `toLocaleDateString(undefined, …)` resolves to the runtime's default locale, which
differs Node (`en-US`) vs browser — a classic SSR-of-a-client-component mismatch. Pinned `"en-US"`
(the existing board convention) at all three affected call sites:

- `src/components/boards/FooterCell.tsx` `fmtDate` (the one in the stack trace)
- `src/components/boards/RollupCell.tsx` `fmt` (collapsed-parent rollup)
- `src/components/boards/cells/index.tsx` `DateCell` (the leaf cell the footer mirrors)

Fixed all three deliberately — the footer mirrors the leaf `DateCell`, so pinning only the footer
would have left a second live mismatch. Full write-up in [[2026-07-05-gotcha-50-tolocaledatestring-undefined-locale-hydration-mismatch]].

## Why

The prior session (`2026-07-05-1227`) had flagged this as an open thread — "small fix = pin an
explicit locale; consider an ADR/gotcha if it recurs." It recurred, so it got fixed + documented.

## Verification

`pnpm typecheck` clean · `pnpm lint` clean (only pre-existing warnings) · `pnpm test` — 338 board test
files, 2404 tests pass. No new imports / no RSC-surface change, so build unaffected.

## How to test (for the user)

1. Set your browser language to a non-US, day-first English (e.g. English (UK)) and reload a board
   with a date column and a summary/rollup footer.
2. The console hydration error on the footer date is gone; dates render consistently as `Jan 1`
   (month-first, same on server and client).

## Open threads

- Latent `toLocale*(undefined, …)` instances left outside this bug's blast radius:
  `lib/dashboards/widget-resolve.ts:146-147`, `TimeTrackingCell.tsx:472` (client-only popover, likely
  safe), and several `feedback/` components. Pin `"en-US"` if any ever SSR a date.
- Changes are uncommitted on `develop` at wrap time (trivial-edit exemption) unless committed since.

## Next session entry point

`develop → main` promotion still pending (per north-star §3). No follow-up needed on this fix.
