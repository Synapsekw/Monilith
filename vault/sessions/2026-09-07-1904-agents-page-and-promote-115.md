---
type: session
date: 2026-09-07-1904
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-07-1726-mcp-write-surface-35-tools]]"
---

# The Agents page — per-message routing, agent knowledge in chat, a split and folded rail

## What changed

- **`/ask` became Agents**, built subagent-driven from a spec + 13-task plan
  (`docs/superpowers/specs/2026-09-07-agents-page-design.md`,
  `docs/superpowers/plans/2026-09-07-agents-page.md`). 21 commits on `task/agents-page`, merged as
  `9836b410`; then `task/rail-buckets` (`e3adbe5a`) for the collapsible age buckets.
- **Per-message routing, sticky.** New `ai_messages.agent_id` records who each turn belongs to.
  A leading `@handle` routes the turn and the choice persists; the header chip switches it, or
  hands the thread back to the plain assistant. `persona-routing.ts` is the one rule, called by
  the Server Action and the composer alike so they cannot disagree.
- **Agents answer with their own knowledge in chat** — documents + memory through the SAME
  `documentBudget` → `selectDocuments`/`selectMemory` → `composeSystemPrompt` path a scheduled
  run uses (`agent-knowledge.ts`). Read-only by owner ruling: no memory writes, no capability
  grants in chat.
- **The rail split and folded.** Chats and briefings are two separately-bounded reads over two
  new partial indexes; chats fold into Today / Last week / Two weeks ago / Older, Today open and
  the rest collapsed with a count. Search unfolds everything so a match cannot hide.
- **Promoted as PR #115** (25 commits, `main` @ `4dba7aaa`), squash divergence healed
  (`9cc71045`). Six `/updates` entries announced for it — this is a user-visible promotion,
  unlike the MCP one before it.
- **`composePersona` deleted** as dead code (its `<agent_instructions>` containment is superseded
  by the nonce-keyed marker), and its inline sanitiser shared as `src/lib/ai/prompt-sanitize.ts`
  with the containment test restored.

## Why

Addressing an agent only worked as the first word of a brand-new chat, because the persona was a
column chosen at thread creation; a handle typed mid-thread was refused outright. Meanwhile every
scheduled run wrote a briefing thread into the same undifferentiated rail, so a daily agent pushed
real conversations off the list. The surface had the agents but not the conversation.

## How to test (for the user)

1. Pull `develop` (or use production — this is live). Open **Agents** in the sidebar.
2. Send `@<handle> what is overdue?`. The composer's helper line names who will answer before you
   send; the answer is stamped with that agent, as is the header chip.
3. Send a follow-up with **no** handle — the same agent answers (sticky).
4. Click the header chip, pick another agent, send again: that agent answers now. Pick **Monolith
   assistant** and send: the answer is stamped "Monolith". Reload — all of it still reads correctly.
5. Attach a reference document to an agent in Settings → **Agent setup**, then ask that agent
   something only the document says.
6. In the rail: chats sit under **Today / Last week / Two weeks ago / Older**, Today open and the
   rest folded with a count; daily reports live in a collapsed **Briefings** section. Type in the
   search box — every section unfolds and the briefings count reflects what will show.

## Open threads

- **The final whole-branch review is what caught the blocking defect**, again: the header switcher
  was decorative because `currentPersonaFrom` gave the last user turn precedence over the column
  `setConversationAgent` wrote. Per-task reviews passed both halves; only the whole-branch pass saw
  the contradiction. The plan itself specified both, unreconciled — a plan can be internally
  inconsistent and every task still be "done".
- Deferred minors, none blocking: a stale comment in `api/ask/route.ts`; a cosmetic pre-reload
  mislabel in the narrow "agent disabled mid-thread" window; a non-owner viewing a shared board
  thread sees "Monolith" instead of the owner's agent names (rosters are owner-scoped).
- The RLS integration case for `ai_messages.agent_id` is structurally correct but SKIPs in this
  env (decision-25, no Tier-1 test project).
- E6 Stripe remains the only open AI epic, still blocked on a test-mode key.

## Next session entry point

Production is live with the Agents page; nothing is in flight and no worktrees are open. Next is
either E6 Stripe (owner-blocked) or the deferred minors above, which are a single small sweep.
