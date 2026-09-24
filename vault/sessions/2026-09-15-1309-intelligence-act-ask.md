---
type: session
date: 2026-09-15-1309
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["2026-09-15-gotcha-108-now-is-fixed-per-transaction-so-two-engine-runs-are-indistinguishable"]
---

# Board Intelligence — Act and Ask

## What changed

- **Phases 3 (Act) and 4 (Ask) merged to `develop` as `fbc335b7`** — 9 tasks, 24 commits, 45 files, ~4400 added lines, built by parallel implementers in one worktree each off `task/intel-act-ask`.
- **Act:** a new `assign_person` automation action (Zod member → `_automation_run` branch in migration `20260915062952` → `AssignPersonRow` → rule-list sentence → `recipeItemCreatedAssignPerson`), the pure `ruleDraftFor` mapper, and an **"Always do this"** button that hands a prefilled draft to the header's automation editor through a third nonce-stamped store command.
- **Ask:** `POST /api/board-intelligence/ask` running the proven Ask tool loop with a new `toolset: "read-only"` (two board-read tools, no writer), a composer holding at most five ephemeral Q/A pairs, and `openQaInChat` promoting one pair into a real board thread — the answer persisted verbatim, never re-generated.
- **Spec and plan written first** (`2026-09-13-board-intelligence-act-ask-design.md`, `2026-09-15-board-intelligence-act-ask.md`), each corrected mid-flight: the action chain lives in `_automation_run`, not `tg_run_automations`; `useAskStream` is not reusable (only `readAskStream`, now generic); the gate is `canApply`, not org-admin.
- **The migration was applied, version-reconciled and live-verified on DEV** in a rolled-back transaction — six outcomes including "replaces, does not append" — because the Tier-1 suite that was supposed to prove it **can never run here**. Recorded as [[2026-09-15-gotcha-108-now-is-fixed-per-transaction-so-two-engine-runs-are-indistinguishable]].
- Announced three `/updates` entries for the ship date; nine per-task branches deleted.
- **Promoted the same session as PR #128** (40 commits) — `main` @ `2ca821a7`, live and verified by content: `/updates` serves all three new entries. Squash divergence healed (`e8d7e929`, `-s ours`, tree byte-identical). A `gotcha` number collision surfaced in the promotion delta and was fixed first: the parallel session had minted `gotcha-107` after this worktree was cut, so mine became **`gotcha-108`**.

## Why

Phases 1 and 2 let a board explain itself and suggest work. Act closes the loop — a suggestion becomes a standing rule the board keeps applying — and Ask lets the reader interrogate the brief they are looking at without leaving the dock. The separation is the design: Intelligence suggests and explains, the automations engine executes, and Intelligence never executes a rule.

## How to test (for the user)

1. `git checkout develop && git pull`, then `pnpm dev`. Open a board that has a **date**, a **people** and a **status** column.
2. Open the dock → **Intelligence** → **Catch me up**, and wait for the brief.
3. On a suggestion card, click **Always do this**. The Automations dialog opens already filled in — check the sentence at the top describes what the card offered. Save it, then reopen **Automations** from the board header: the rule is listed and editable.
4. On a **reassign** card the rule should read "When an item is created … assign `<person>` in `<people column>`". Create a new item and confirm the people column fills with that person.
5. Back in **Intelligence**, type a question in the composer at the bottom ("what slipped this week?"). The answer streams in under the suggestions.
6. Click **Open in Chat** on that answer. The dock switches to Chat on a new thread whose first two turns are your question and that same answer, word for word. Click it twice quickly — you should get **one** thread, not two.
7. Reload: the Q/A pairs are gone (never persisted); the promoted thread is still in the ledger.
8. **Look at these two with your eyes** — jsdom cannot: on a board with **no** cached brief, the greyed composer plus "Catch me up first…" at the bottom should read as an explanation, not a second call-to-action competing with the "Catch me up" button above it; and on a board with a **short brief and no suggestions**, the composer-then-meta-line footer should look deliberately bottom-docked, not oddly gapped.

## Open threads

- **Promoted and live** (PR #128, `main` @ `2ca821a7`). The DEV-only migrations, including this feature's `20260915062952`, are still not on the PROD database — `/sync-prod` was deliberately declined.
- `model-request-shape.test.ts` counts a prose `runAi({…})` in a comment as a call site — it cost this branch a red suite, and worse, the same false positive can **hide** a genuinely unmetered feature key. One-line fix (`stripComments` when building `SOURCE_FILES`), may surface other offenders.
- The shipped `automations.percent-sync.integration.test.ts` deletes auth users without deleting their orgs; `organizations.created_by` has no cascade, so it silently orphans users and org data on every run against a real test DB. This branch fixed only its own new suite.
- Deferred and justified: the engine's throwing `::uuid` casts (unreachable behind uuid validation on both boundaries) discarding sibling actions' outcomes; only a card's primary action is offered as a rule; raw provider error text reaching the browser; the inert `workspaceId` check on the ask route; zero metering when a turn throws mid-loop.

## Next session entry point

The promotion is done, so what is left is the owed browser pass on the two Intelligence-tab layouts (step 8 above, now against production), then the `model-request-shape` scan fix and the `percent-sync` teardown defect — both small, both named above.
