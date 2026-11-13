---
type: session
date: 2026-10-14-2047
branch: develop
trigger: wrapup
status: complete
tags: [session, landing, mobile]
related: ["[[2026-10-14-1904-landing-mono-latency-repair]]"]
---

# Landing mobile arrows and assembly repair

## What changed

- Replaced emoji-capable landing, pricing and Mono arrows with decorative vectors; labels and validated links remain safe. Source `f4b03503`, regression adjustment `f2bbaff5`.
- Mobile artwork now pins below the header during its own stable-svh runway, completes before release, and reverses on upward scroll. Reduced motion keeps a completed still shape without a runway; easing uses elapsed time.
- `finish-task.sh` passed typecheck, lint (5 existing warnings), 8,086 tests / 1 skipped, build and DEV ledger 176/176; merged as `f1157a8b`, task worktree/branch removed. `/updates` entry generated.
- PR #137 merged without conflicts after develop/PR CI passed, under standing owner authorization. Main `581449a3`, Vercel production READY; develop healed/pushed `0528a291`. Post-merge main CI 38602621476 pending.

## Why

On iPhone Chrome, Unicode arrows could become emoji and the mobile pieces completed their join after scrolling offscreen. The old progress formula also moved with browser toolbar height.

## How to test (for the user)

1. Reload https://www.monolith.works/landing in iPhone Chrome. CTA arrows and pricing bullets should appear as simple line icons; open Mono to check his prompt and send arrows.
2. Scroll slowly through the hero: artwork stays below the header until all four pieces join. Scroll back up to separate them; continue down to leave the artwork normally.
3. With Reduce Motion enabled, reload: the artwork is already assembled and there is no long animation runway.

## Open threads

- Live responsive checks passed at 390×844; local checks also covered 375×667, short 667×375, and desktop 1440×900. Actual iPhone hardware acceptance remains for the owner; no physical-device test claimed.
- Separate Vercel CLI preview returned “Not authorized”; authenticated project inspection worked. Normal GitHub production deployment succeeded. Local board JSON refreshed; cloud Artifact tool unavailable. Obsidian CLI link check returned no output.
- Post-merge main CI 38602621476 pending; prior folder walkthrough/backlog remains unchanged.

## Next session entry point

Start with the owner's iPhone acceptance and this release: https://github.com/Synapsekw/Monilith/pull/137. Evidence: `Documents/Monolith/artifacts/mobile-fix/landing-mobile-arrows.jpg` and `landing-mobile-assembled.jpg`. No model, credential or database changes.
