---
type: session
date: 2026-11-13-1232
branch: develop
trigger: wrapup
status: complete
tags: [session, performance]
related:
  - "[[2026-11-13-decision-43-functions-run-in-the-databases-region]]"
  - "[[2026-11-13-gotcha-109-the-promotion-delta-window-and-ci-watcher-both-have-blind-spots]]"
---

# Performance audit, Tokyo function region, and quick-wins batch 1

## What changed

- **Audit (read-only, 5 parallel agents):** server rendering/caching, client bundle, runtime render cost, database, and mutation/navigation latency. Headline: the database is not slow (0.05–10 ms per query); server wait was round-trips crossing the Pacific, plus avoidable sequential chains, double renders after actions, and ~70 KB gz of zod locales on every page.
- **Region fix, live (PR #147, `3e0ee963`):** `vercel.json` `"regions": ["hnd1"]`. Functions ran in `iad1` while the live DEV database is in `ap-northeast-1`. Median function duration: `/boards/[boardId]` 2,693 → 283 ms, `/my-work` 1,932 → 275 ms, `/folders/[folderId]` 2,432 → 503 ms (after-numbers are a thin first-hour sample). See [[2026-11-13-decision-43-functions-run-in-the-databases-region]].
- **PR #147 also shipped five Dependabot bumps nobody described** (`@anthropic-ai/sdk` 0.123 → 1.1, `@hookform/resolvers` 5 → 6, `framer-motion`, `@sparticuz/chromium`, `dotenv`). See [[2026-11-13-gotcha-109-the-promotion-delta-window-and-ci-watcher-both-have-blind-spots]].
- **Quick-wins batch 1, on `develop` (`26dc4feb` + `43771bee`), PR #149 open:** 35 commits from four parallel implementers in their own worktrees, a serial zod codemod, a whole-branch review and three review fixes. Settings static shell; parallel cell-edit reads; `/` straight to the last board (document loads only); 30 redundant `router.refresh()` calls removed; path revalidations replaced by tags; local JWT verify in 8 hot actions; Gantt resize commits once; rAF column resize; dialog blur removed; zod 127 → 32 KB gz; recharts, board dialogs, calendar and new-board dialog lazy; `framer-motion` and `ogl` removed.
- **Announced on `/updates`:** one "improved" entry for faster loading and smoother boards.

## Why

The owner asked for the app to feel faster and smoother. The audit turned that into a ranked list with measurements, and the first two steps were the ones with the best ratio of effect to risk: move compute next to the data, then remove waste that needed no design decisions.

## How to test (for the user)

Pull `develop`, `pnpm install`, `pnpm dev`, open `http://localhost:3000` (live DEV data — only make edits you would keep). After PR #149 is merged the same steps apply on `www.monolith.works`.

1. Go to `/` — you land directly on your last board.
2. Hard-reload `/settings/profile` — sidebar and settings nav appear at once; "Members" pops in a moment later for admins.
3. Gantt view on a board with dated items: drag a bar's right edge — it follows in day steps, saves once on release, no flicker back.
4. Table view: drag a column border — smooth, and the width sticks on release.
5. Open Share, then ⋯ → Automations, Import, Trash — each opens after a brief first-time load; the page behind is dimmed, not blurred; reopening keeps state.
6. Trigger a delete confirmation — check the darker scrim in light and dark themes.
7. Click a date cell — short skeleton, then the calendar; arrow keys work.
8. Open an item — the panel slides in faster.
9. Rename a board from the sidebar, move one to a folder, create a folder — the sidebar updates once, no second flash.
10. Edit a cell on `/time`, leave the page immediately, press Back — the new value shows.
11. Sign out and in — you land on a board, never an empty page.
12. Production only, from PR #147's dependency bumps: submit the login form with an invalid email (validation message appears), run one AI action, export one PDF report.

Browser-checked by the agent: steps 1, 2 and the Share dialog in 5. The rest is covered by tests only.

## Open threads

- **PR #149 awaits the owner's manual merge.** After it: heal `develop`, watch the deploy, re-measure route medians against the baseline above.
- Step 12 (login validation, AI action, PDF export on production) is unverified since PR #147.
- Behaviour changes accepted in batch 1: alert-dialog scrim 10% + blur → 50%; workload admin flag up to 5 min stale and no longer excludes a deactivated admin (UI only); a non-owner's board rename can show the old name in other members' pickers for up to 60 s.
- Bugs found by the audit, not fixed: `item_dependencies` is subscribed in three places but is not in the `supabase_realtime` publication; the hosted PostgREST "Max rows" may clamp the board payload at 1,000 rows (largest board today: 859 cells) — check the Supabase API settings; board A → B → A re-shows a stale client cache.
- Nothing stops a future `import { z } from "zod"` from bringing the locales back — no lint rule yet.
- `scripts/watch-ci.sh` and `/promote`'s delta window both need repair (gotcha-109).

## Next session entry point

Verify PR #149 merged and re-measure. Then batch 2 from the audit: AI Server Actions to streaming route handlers (they block the action queue), a bulk-edit RPC (N × 3 round-trips today), `GroupSection`/Kanban re-render comparators, the sidebar data chain, and the board revisit cache; batch 3 is the folder rollup RPC rewrite plus database housekeeping (GIN index on assignees, cron history prune, publication fix).
