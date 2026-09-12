---
type: session
date: 2026-09-12-0936
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-11-1945-sidebar-keystone-polish]]"
  - "[[2026-09-12-0159-agent-dock-review-repairs]]"
---

# The card's hairline is the collapse control

## What changed

- **Four rounds of in-browser prototypes before any code.** Six placements, then variations of the
  two the owner liked (bow / grip), then four takes on how far the light travels. The owner picked
  **S4 — edge + glow**. Served gallery under the session scratchpad, not the repo.
- **`src/lib/ui/seam-path.ts`** — a pure builder for the card's outline. Two paths per edge, both
  starting at the MIDDLE of it (one up, one down), so one dash growing from each origin opens the
  light evenly and reaches both corners together. Lengths are computed analytically, not read with
  `getTotalLength()` — which jsdom does not implement at all. Chromium's own measurement of the
  rendered path agrees to **0.005px** (220.4064 vs 220.402).
- **`CardSeam` + `SidebarSeam` + `DockSeam`**, `--seam-glow`, and the `.seam-*` state rules in
  `globals.css`. Hover/focus state is CSS (`:has()`), so a pointer crossing the gutter costs no
  React render. `<main>` gained a positioned frame (`#app-card-frame`) for the overlay; it keeps its
  own radius, border, shadow and scrolling.
- **Both old controls retired**: the brand-row chevron and the dock's header/rail buttons. The
  dock's edge already WAS its resize grip, so they are now one object — click folds, drag resizes,
  arrow keys resize; >4px or >400ms is a resize and never a fold. `role="separator"` only while
  open; the cap is a real nested `<button>`.
- Merged `5c4f8719` → `7bb2d483`. 18 files, +1177/−119. Gates green: typecheck, lint, **7,646
  tests**, production build, static shell still 18.8KB.
- Announced on `/updates` (backdated to today, `improved`).

## Why

The two toggles sat in different places and neither was near the edge it moved, which the owner
raised directly. Putting the control ON the seam also let the dock stop carrying two affordances on
a 4px gutter.

## How to test (for the user)

1. `git checkout develop && git pull && pnpm install && pnpm dev`; open any board.
2. Confirm what is GONE: no chevron beside the MONOLITH wordmark, no close button in the dock
   header, no open button atop the dock's 48px rail.
3. Hover the 30px tick at the middle of the card's LEFT edge — the light should run the full edge,
   round both corners, stop at the tangent points, and bloom. A chevron chip appears at the middle.
4. Click it: the rail folds to 56px and the chevron flips. Click again to expand. `⌘\` still works.
5. Same on the RIGHT edge: click opens the agent dock, click again closes it.
6. With the dock open, DRAG the right edge — it resizes and must **not** fold on release.
7. Tab to the chip: the seam lights on focus and the chip takes a ring; Enter folds. With the dock
   open, Tab to the edge and press ←/→ to resize.
8. Toggle light/dark — in light the bloom is an ink haze; check it reads as lit, not just paler.
9. On iPad: both chips are permanently visible and the target is 44×44 at the midpoint — NOT the
   full edge, so board rows keep their left gutter.

## Open threads

- **Nothing has been seen in an authenticated browser this session.** The nine steps above are owed,
  and they stack on the walkthroughs already owed from the three previous sessions.
- Judgement call worth a second opinion at step 3: the cap is opaque and centred on the line, so it
  visibly **breaks** the lit seam. One line in `SEAM_CAP` reverts it to a continuous stroke.
- `/updates` still has a gap on **2026-08-27** (agent memory, `create_pdf`). Deliberately not
  announced here: memory shipped inert (0 of 9 orgs), and announcing what does not work yet is the
  thing the convention forbids.

## Next session entry point

Run the owed browser passes against `develop` — this seam's nine steps, then the Phase 2 / agent-dock
/ sidebar walkthroughs — and take the latency measurement. Then promote.
