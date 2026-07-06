---
type: adr
date: 2026-07-05
status: accepted
tags: [decision, gotcha, boards, hydration, ssr, i18n, dates]
related:
  - "[[2026-07-05-1227-boards-summary-ui-polish]]"
  - "[[2026-07-05-1904-fix-tolocaledatestring-hydration]]"
---

# Gotcha 50: `toLocaleDateString(undefined, …)` in an SSR'd client component causes a hydration mismatch

## Context

A board with a date column + column-summary footer threw a recoverable React hydration error:

```
Hydration failed because the server rendered text didn't match the client.
+ 1 Jan   (client)
- Jan 1   (server)
   at FooterValue (src/components/boards/FooterCell.tsx:92)
```

The prior session (`2026-07-05-1227`) had already spotted this in `FooterCell.fmtDate` and left it as
an open thread — "consider an ADR/gotcha if it recurs." It recurred, hence this note.

## The trap

`"use client"` does **not** mean "browser only." Client components are still **server-rendered** for
the initial HTML, then hydrated. So any value that differs between the Node runtime and the browser
runtime mismatches.

`new Date(iso).toLocaleDateString(undefined, …)` resolves `undefined` to the **runtime's default
locale**:

- Node server → typically `en-US` → `"Jan 1"` (month-first)
- User's browser → whatever their OS/browser is set to, e.g. `en-GB` → `"1 Jan"` (day-first)

Same for `toLocaleString()`/`toLocaleTimeString()` with no explicit locale, and for locale-sensitive
number formatting. The bug is **invisible to any developer whose browser defaults to `en-US`** — it
only fires for non-US-default locales, which is why it survived so long and why it "came back."

Three board cells shared the identical latent bug — and because the footer is designed to **mirror**
the leaf date cell, fixing only the one in the stack trace would have left the mirror emitting a
different string (a second live mismatch):

- `FooterCell.tsx` `fmtDate` (the one that threw)
- `RollupCell.tsx` `fmt` (collapsed-parent rollup)
- `cells/index.tsx` `DateCell` (the leaf cell the footer mirrors)

## Decision

**Never pass `undefined`/omit the locale to `toLocale*` in code that renders during SSR. Pin an
explicit locale.** We pin `"en-US"` — already the established convention across the board date
formatters (`GanttBoard`, `CalendarBoard`, `CalendarAgenda`, `TimeCard`, `MyWorkList`). This makes
server and client produce the same string regardless of the runtime default.

Fixed all three call sites above to `toLocaleDateString("en-US", …)`.

## Consequences

- A user in a day-first locale now sees `Jan 1`, not `1 Jan`. Accepted: deterministic SSR output beats
  per-user locale here, and it matches every other board date. If we ever want true per-user locale
  formatting, it must be done **client-only** (e.g. in `useEffect`/after mount) or via a
  server-provided locale snapshot passed as a prop — never by reading the ambient default at render.
- Treat `toLocale*(undefined, …)` (or the no-arg form) as a lint-worthy smell in any component that
  can SSR. Known remaining instances outside this bug's blast radius, left for now:
  `lib/dashboards/widget-resolve.ts:146-147`, `TimeTrackingCell.tsx:472` (inside a popover opened
  client-side — likely safe), and several `feedback/` components. Pin them if they ever SSR a date.
- No schema/migration; pure presentational one-line changes per file, committed straight to `develop`
  (trivial-edit exemption).

## Related

- The general class ("external/ambient changing data not sent along with the HTML") is the same family
  as other SSR determinism traps — cf. `Date.now()`/`Math.random()` at render, which the workflow
  runtime also forbids for the same resume-determinism reason.
