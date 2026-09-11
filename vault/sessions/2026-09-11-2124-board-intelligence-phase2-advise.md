---
type: session
date: 2026-09-11-2124
branch: develop
trigger: wrapup
status: complete
tags: [session, board-intelligence]
related:
  - "[[2026-09-11-1757-board-intelligence-phase1-orient]]"
  - "[[2026-09-11-1945-sidebar-keystone-polish]]"
---

# Board Intelligence Phase 2 (Advise) built and merged; Phase 1 promoted

## What changed

- Promoted `develop → main` as PR #121 (Board Intelligence Phase 1, 21 commits): main CI green, Vercel `state=success` on `148b3c6f`, `www.monolith.works/updates` serving "Board intelligence strip"; squash divergence healed (`ff4170db`). The handover pre-approved the merge, so no gate prompt.
- Wrote the Phase 2 plan (`docs/superpowers/plans/2026-09-11-board-intelligence-phase-2-advise.md`, 9 tasks + DAG, 12 recorded deviations from the spec) and built it subagent-driven: waves of parallel implementers in **per-task worktrees** cut from the task branch, rebased + fast-forwarded after each review. Merged to `develop` at `1dbc19fd` (19 commits, 64 files).
- Shipped: `board_intelligence_runs` cache + `item_activities.source` + the `apply_intelligence_cells` RPC (migration `20260911144351`, DEV ledger 163/163, MCP mis-stamp reconciled); `src/lib/ai/board-intelligence/` (schema, board-checked validation, transcript, prompt, generate, run/dismiss, apply/undo); the dock's Chat | Intelligence tabs with brief, cards, Apply/Undo/Dismiss; the strip's "Catch me up" pill and "updated Xm ago"; a Zustand bridge store; the Phase 1 rule residuals (rule inside frozen columns, off the selection bar, radius-aware).
- Every task review found something real (RLS-silent clear, uncapped labels failing the read closed, cell edits not invalidating the cache, active-org vs board-org, double-click apply, stale undo); the whole-branch review then found a Critical none of them could: `computeSignals` emits one `overloaded` signal per person, so boards with ≥7 overloaded people produced >10 signals, the server's own payload failed `payloadSchema.max(10)` after the metered call, and nothing was cached — a permanent, paid failure. Also a plan defect: `set_due` preserved `end`, so a ranged overdue item stayed overdue. Both fixed in one wave before merge.
- `/updates` announced "Board brief and suggestions" (trailer on `89b92956`). The 2026-08-27 coverage gap (agent memory / create_pdf) is deliberately unannounced: memory is inert in every org.
- Memory: `parallel-implementers-need-own-worktrees`.
- **Post-merge incident, found by the owner on the first click:** "Couldn't read this board." Root cause was not Phase 2 — `ai@7.0.92` (dependabot #112, 2026-09-07) rejects a system-role message inside `messages`, and the Anthropic adapter built one for the cache breakpoint, so every Anthropic-routed structured feature had been failing in production for four days with nothing logged. Fixed on `develop` (`60ac97aa`: system prompt rides `instructions`; a real-`generateObject` regression test with a fake `fetch`; the run action now logs its cause, `f0ab8a24`). ADR [[2026-09-11-gotcha-99-a-dependency-bump-can-flip-a-default-no-test-exercises]]. Announced on `/updates` as a fix.

## Why

Phase 1 gave boards deterministic signals; Phase 2 turns them into an on-demand brief with suggestions a person can apply in one click and undo, cached per user so the model runs at most once per half hour of edits. It is the critical path of the four-phase spec (Act and Ask build on the run and the dock tab).


Setup: pull `develop`, `pnpm dev`, sign in as an org member who is owner/editor of a board with a Status column, a Date column, a People column and a few items (make one overdue, one "Stuck"). AI must be enabled for the org (Settings → AI). Do steps 2–8 first in Table view, then repeat step 5 as a viewer.

1. **Strip.** Open the board. The Intelligence row under the header now ends with a "Catch me up" pill on the right. No "updated …" meta yet (no brief exists for you on this board).
2. **Catch me up.** Click the pill. The dock opens on a new **Intelligence** tab (a Chat | Intelligence pair at the top of the dock; the agent picker and "+ New" only show on Chat). The tab shows skeleton lines and two skeleton cards under "Reading the board", then a short plain-prose brief under the kicker "Last 7 days" with a timestamp, and up to five suggestion cards under "Suggested · N". The footer reads "Read-only until you apply · <model> · <tokens> tokens". The strip now shows "updated just now".
3. **Badge.** Switch to Chat and back: the Intelligence tab carries the unresolved count (e.g. "Intelligence 3"); switching tabs never reloads the chat threads.
4. **Why?** On a card click "why?": a popover lists the item names the suggestion rests on.
5. **Apply + Undo.** On a card whose primary button says "Mark <item> as <status>" (or "Set Due to <date>" / "Reassign … to <name>"), click it. For a "Set Due" on an item with a date RANGE, the END moves to the new date (the start never passes it) so the row stops being overdue. The row updates immediately without a reload, the card disappears, the badge drops by one, and a toast "Applied · Undo" shows for 8 seconds. Click **Undo**: the cell returns to its previous value (an empty cell becomes empty again) and the card comes back. Open the item's Activity Log: both edits are there, attributed to you.
6. **Dismiss.** Click "Dismiss" on a card: it disappears at once and the badge drops. Reload the page: it stays dismissed.
7. **Show rows.** A card with a "Show <kind> rows" button (for an overloaded person it reads "Show overloaded rows · <name>"): click it — the matching chip on the strip becomes active and the board narrows to those rows (the URL gains `?intel=<kind>` or `?intel=overloaded:<userId>`). While any Apply/Dismiss is in flight, the write buttons on every card are disabled; "Show … rows" and "why?" stay live.
8. **Auto-run rule.** Leave the dock open on the Intelligence tab and reload the page: no new brief is generated on load (the strip meta and cards come from the cached row; with no row you see the empty state and the "Catch me up" button). Only your click (tab, pill, Refresh) triggers a run.
9. **Cache and refresh.** Click "Catch me up" again within 30 minutes without editing anything: the brief comes back instantly (no model call, no new tokens). Edit any cell, then click it again: a new brief is generated. After 30 minutes a ghost "Refresh" button appears next to the timestamp; the old brief stays on screen while the refresh runs.
10. **Viewer.** Open the same board as a viewer: the tab shows the brief and cards, but no Apply/secondary buttons — only "Dismiss", "why?" and "Show … rows"; the footer reads "Read-only · …". "Catch me up" still works.
11. **Nudge.** Apply a "Nudge <name>" card: an update appears on the item authored by you with the suggested message, and the target gets a mention notification. Undo removes the update.
12. **Row rule polish (Phase 1 residuals).** With a chip active in Table view, scroll horizontally: the 2px rule stays inside the frozen name column. Select a matching row: the periwinkle wash shows without the 3px selection bar. Start renaming a matching row: the rule stays. In Kanban, the rule follows the card's rounded corner.
12. `/updates` lists "Board brief and suggestions" under 2026-09-11 (after promotion, on www.monolith.works/updates).

Not verified in a browser this session: the Chrome extension was disconnected and the e2e provisioner refuses DEV, so steps 2–11 rest on the test suites (7505 tests) plus the reviews; step 11's paint order needs your eyes.

## Open threads

- **STILL FAILING after the adapter fix (owner retry, end of session):** "Catch me up" hangs ~2 minutes, then the same generic error. Not diagnosed — the `[intelligence] run failed` log line was not captured, and it is unconfirmed that the retry ran the pulled `develop`. Suspects, ranked: Anthropic call running to `MAX_OUTPUT_TOKENS = 16000` with thinking on (the summarize path needed `thinking: disabled`), an SDK retry loop on 529, `NoObjectGeneratedError` (the JSON schema's `type: ["string","null"]` arrays are new to this repo), or the OpenAI non-strict path. First move next session: get that log line.
- Browser visual pass NOT done (Chrome extension disconnected; the e2e provisioner refuses DEV by design). Steps 2–12 above are the owed manual check; step 12's paint order first.
- **Promote soon:** production's Anthropic structured features are broken until `develop` (`8aedef66`) reaches `main`. `develop` is ahead by Phase 2, the sidebar Keystone polish and this fix; migration `20260911144351` is on DEV, not PROD.
- Follow-up: the OpenAI, compatible and Google adapters still pass the deprecated `system` option; move them to `instructions` and give each a real-`generateObject` wire test.
- Deferred by review, none blocking: `revertSuggestion` does not tie the client-held before-values to the applied action's cells (editor-only, audit label only); "Catch me up" can scroll out of view on a narrow strip; the strip meta appears one render after mount; the full run row rides the RSC payload on every board load; `board_intelligence_runs` has no retention (decide deliberately); the prompt's MEMBERS block is uncapped; undo runs outside `startTransition`; hook error lost on tab switch.
- Phases 3 (Act: `assign_person` automation + "Always do this") and 4 (Ask: inline Q&A) are specced, not planned.

## Next session entry point

Promote `develop → main` first thing (the Anthropic fix is a production incident), then run this walkthrough and the sidebar one against production, then `writing-plans` for Phase 3 (Act) from spec §5.
