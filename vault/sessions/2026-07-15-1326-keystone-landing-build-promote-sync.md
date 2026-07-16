---
type: session
date: 2026-07-15-1326
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-14-2127-whats-next-triage-promote-batch2]]"
---

# Keystone marketing landing: build, promote, prod sync

## What changed

- **Reviewed the E5 + Landing scoping specs** (from the prior session). Landing: green-light. E5: sound but flagged risks to fold into its plan before building (ANN-then-RLS recall gap in `match_items`; the platform-bot `auth.users` seed is the riskiest item, defer Autopilot/F14; embedding-cost-for-BYO is an owner decision; build Ask Pulse full-page before E5's B3 since both touch `src/lib/ai/ask/tools.ts`).
- **Built the full Keystone marketing landing — pivoted Option S → Option L per owner.** Kept the existing hero (`MonolithScene` + WebGL light-rays + the Option S restyle) untouched; added sections below it: product showcase (board Table), a varied feature section (flagship Views row + an AI/automations **bento grid** + a 3-up Plan/Goals/Time icon-card row, to break the repetitive-row monotony), a client-side view-switcher (0 refetch), a 12-cell capability grid, a vision note, and a waitlist CTA, over a restrained periwinkle gradient atmosphere blended from the hero's near-black. Real UI via Keystone-token mockups (screenshots deferred). New files: `landing-sections`, `landing-mocks`, `landing-reveal`, `landing-view-switcher` (+ tests). Fixed the wordmark font (Nunito, not Nunito Sans) and rendered the real cleaved-monolith mark + slab-I. Iterated in-browser via dev server + Playwright screenshots; explored 3 subagent-built HTML prototypes first.
- **Merged to develop** (`b4ca9ff` + merge `f022349`); all four gates green. Then **promoted develop → main** (PR `#63`, `main` @ `6027f38`); Vercel prod deploy green.
- **`/sync-prod`:** prod was missing migration `20260712153317` (org-delete vault-secret trigger) — the vault claim it had been applied to prod was **stale/false**. Applied it via `supabase db push`, then ran the full dev → prod data + storage replace. Parity verified: orgs 14, boards 11, items 376, users 14, storage.objects 11 (all match).

## Why

The landing was the last public surface not speaking Keystone. The owner wanted a real feature-showcasing marketing page (invite-only voice, no fabricated pricing/proof), not just a hero restyle — hence the Option L pivot, built on top of the real hero so it never deviates from the shipped brand. Promoting + syncing puts it live in production with current data behind it.

## How to test (for the user)

Production is live and synced. 1) Open the prod domain root (`/`) and `/landing` → the MONOLITH hero (light-rays) is unchanged; scroll down. 2) Confirm the varied feature section: flagship Views row → bento grid ("The workspace thinks with you.") → "Zoom out from tasks to outcomes." icon cards. 3) Click the **Table / Kanban / Calendar / Timeline** view-switcher → mock swaps instantly, no reload. 4) Scroll to the capability grid, vision note, and waitlist CTA (periwinkle glow). 5) Narrow the window (stacks, no h-scroll); toggle reduced-motion (sections show immediately). Signed-in `/landing` swaps the section CTA to "Open Monolith" → `/boards`.

## Open threads

- **`task/e5-agentic-semantic` worktree still parked** (uncommitted E5 spec) — review/build (fold the review risks into its plan first) or clean up.
- Landing used faithful **mockups**, not real product screenshots — swap real shots in later if wanted.
- Stale-vault correction logged: `20260712153317` was NOT actually on prod until this session.
- **Prod DB password printed to terminal scrollback** during the `db push` — consider rotating in the Supabase dashboard (optional).
- `/sync-prod` full-replace model still valid (guard passed: prod orgs/users ⊆ dev) — expires when prod gains an independent signup.

## Next session entry point

Prod is live + data-synced; `develop == main` in sync. Pick a roadmap build: **Ask Pulse full-page** (plan ready, build before E5), **E6** billing or **PF** (plans ready), or refine + build **E5** after folding this session's review risks into its plan.
