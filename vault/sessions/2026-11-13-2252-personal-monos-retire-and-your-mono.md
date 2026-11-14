---
type: session
date: 2026-11-13-2252
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, mono, agents]
related:
  - "[[2026-11-13-decision-44-mono-identity-session]]"
  - "[[2026-11-13-1254-unified-assistant-runtime-plan-a]]"
---

# Personal Monos: old agents retired, your Mono in the app

## What changed

- **Design:** spec `docs/superpowers/specs/2026-11-13-personal-monos-design.md`. Every person gets one agent, a "Mono" (name + colour), powered by their own API key or a connected Claude/ChatGPT. It is directed only by its owner and never talks to other Monos. The org assistant is unchanged.
- **Plan 1 merged (`269463c0`), retiring the old agent system.**
  - Migration `stop_personal_agents` disabled all 27 `user_agents` (not 1 as assumed), dropped the orchestrator seed trigger and unscheduled both sweeps.
  - Agent personas, tiles and summons are gone from `/ask`, the dock and comments, along with agent settings, Autopilot and the agent routes.
  - About 160 files deleted, tables kept for now.
  - The Mono session spike passed; see [[2026-11-13-decision-44-mono-identity-session]].
  - `MonoAvatar` was ported from the landing Mono.
  - Marketing copy no longer sells retired features, and the `NewBoardDialog` test flake is fixed.
- **Plan 2A merged (`72476e8c`), putting your Mono in the app.**
  - 9 migrations on DEV: the `agent` org role, `monos`, `org_monos`, board access that follows the owner, the owner-only People-cell guard, a notification drop, no boards created by Monos, `ai_conversations.mono_id`, and an hourly session prune.
  - New UI: the My Mono rail tab, Mono identity in People cells, pickers, @mentions and authorship, and Settings → My Mono. Mono chat runs as the Mono on the owner's key.
- **Reviews caught real defects before merge.** Each was found by a review, not by tests:
  - The People-cell guard broke every teammate edit, because the app writes with an upsert and the guard never saw the existing value.
  - Two security holes: `profiles.is_agent` was self-writable, and any editor could rewrite `boards.created_by`.
  - A board creator could grant someone else's Mono onto a board.
- `/updates`: announced the agent retirement only. Monos are deliberately not announced, because they have had no live run yet.

## Why

The old agent system was big and unused: 26 seeded orchestrators that never ran, and Aria, which failed silently for two months on refresh-token rotation. The owner chose one agent per person on the shared runtime.

## How to test (for the user)

1. Pull `develop`, run `pnpm dev`, sign in at `http://localhost:3000`.
2. Settings → Profile: change your name and theme. Both save. This is the first live use of `profiles_freeze_agent`.
3. Open a board, open the right rail, pick My Mono, then choose a name and colour. The Mono appears dozing, with a Wake-up card.
4. Add an Anthropic or OpenAI key in Settings → AI. The rail status line says it runs on your key.
5. Toggle "On this board", then assign the Mono in a People cell. It shows the pebble avatar, an "Agent" chip and "<you>'s Mono".
6. Chat in My Mono: ask for a comment or an item change, then confirm the card. Item activity shows the Mono as the author.
7. Ask it to create a board. That row errors ("A Mono cannot create boards").
8. As a teammate (second account): your Mono is not in their pickers, they can still edit a cell that holds it, and adding it is refused with "Only its owner can assign a Mono."

## Open threads

- **Plan 2A had no live run.** The owner chose to merge without one: the LAN sign-in failed on the `next dev` cross-origin block. Run the steps above before promoting.
- **Security:** the owner's password reached a URL query string during that attempt. The dev log was deleted. The owner should rotate the password and clear the Chrome history entries.
- **Plan 2B is not written.** It covers:
  - the inbox, wake-ups, `mono_runs` and the job route;
  - `auto` writes, approvals and the conformance test;
  - MCP "Drive my Mono" and `get_my_assignments`;
  - prompts and `boards.assistant_playbook`;
  - unit D, dropping the old tables.
- **Must land before Monos reach managed or org-BYO orgs:**
  - meter personal-key turns at 0 credits;
  - skip the `ask_pulse` entitlement gate for Mono turns;
  - exclude `role='agent'` from seat counts and `platform_search_users`.
- **2B rule:** the inbox trigger must re-check mention ownership via `is_agent`/`monos`, never trust `mention.kind`.
- **Minors left open:**
  - My Work, portfolios and item search show a Mono in a People cell as unknown;
  - the colour radios lack roving tabindex;
  - the Files tab uploader is not Mono-labelled;
  - the landing "Agent dock" gallery screenshot.

## Next session entry point

Do the Plan 2A live run first (the steps above, ideally `pnpm build && pnpm start` on localhost). Then write Plan 2B from the spec's units B, A, C and P.
