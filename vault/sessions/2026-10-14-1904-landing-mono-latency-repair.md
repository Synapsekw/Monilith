---
type: session
date: 2026-10-14-1904
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-14-1805-mono-production-release]]"]
---

# Landing scrollbar and Mono latency repair

## What changed
- Fixed the light root scrollbar shown in the owner's Chrome screenshot, scoped to the landing page; workspace theme isolation and desktop/mobile overflow verified.
- Reduced normal Mono chat from 17 to 10 serialized storage waits, preserving quota ordering, CAS recovery and contact idempotency. Added meaningful red/green regressions; 8,081 tests / 1 skipped, typecheck/lint/build and ledger 176/176 passed.
- Placed only Mono in Vercel Tokyo (`hnd1`) beside its existing database. PR #136 merged without conflicts under explicit owner authorization at `ce263ad3`; Vercel deployment `HRzaham6Q4LFYdMUQb9c92Ysnuyf` is live. Develop healed/pushed at `29e2474e`; task worktree/branch removed. Post-merge main CI 38587753000 passed.
- Production replies measured 4.399s / 3.232s, versus earlier 8.388–13.374s samples; Preview also showed follow-up variability near 10s. Announced the scrollbar fix and reduced waiting in `/updates`; model and owner-confirmed Grok flow unchanged.

## Why
The landing inherited a light document scrollbar, while Mono paid for extra database round trips between Virginia and Tokyo. The repair preserves the approved design and durable contact flow.

## How to test (for the user)
1. Open https://www.monolith.works/landing in Chrome, hard-refresh with Cmd+Shift+R, then scroll to Pricing. The right track should stay dark, without a white strip or sideways overflow.
2. Open Mono and ask “What is Monolith?” followed by “Can a team use it without AI?” Expect real replies and a responsive chat; timings vary. Contact review and explicit send remain unchanged.

## Open threads
- No release blockers remain. No credential or database changes are needed. Local board JSON refreshed; cloud board deployment tool unavailable. Obsidian link-rot check unavailable because the app is not running. Unrelated session drafts preserved.

## Next session entry point
See `docs/operations/mono-vercel-preview.md` and `docs/superpowers/plans/2026-10-14-landing-mono-polish.md` for release evidence. If long-tail reply delays persist, measure storage and provider phases separately before changing models.
