---
type: adr
status: accepted
date: 2026-08-04
tags: [project/monolith, adr, decision, phase-10, ai, ask-pulse, personal-agents, board-dock, ux]
related:
  - "[[2026-07-12-decision-27-ask-becomes-standalone-surface]]"
  - "docs/superpowers/specs/2026-08-03-personal-agents-phase2-design.md"
  - "[[00-north-star]]"
---

# Decision 33a — The board dock reverses decision-27's "standalone surface" stance

## Context

[[2026-07-12-decision-27-ask-becomes-standalone-surface]] promoted Ask Monolith from a stateless
seam-level popup to a standalone `/ask` page, on the Phase 10 stance _"AI ships at the seams, not
as chrome."_ That was the right call for what it addressed: the product owner wanted a first-class,
ChatGPT-like destination — persisted cross-board history, multi-turn memory, streaming. A general
chat assistant untethered from any one board is not a seam; making it a popup bolted onto every page
would have been exactly the "powered-by-AI badge, glow-everything" pattern the Phase 10 design
stance names as the anti-reference. `/ask` earned its own page.

Personal Agents Phase 2 (`docs/superpowers/specs/2026-08-03-personal-agents-phase2-design.md`) now
adds a permanent, collapsible **board dock**: a right-hand panel on every board page hosting agent
conversations, scoped to that board by default, reusing `/ask`'s substrate — the same
`ai_conversations` / `ai_messages` tables, the same `/api/ask` streaming route, the same
`MessageList` and composer. The spec's own "ADR owed" section names the conflict directly: _"This
slice reverses decision-27 … A permanent board dock is chrome … it must be written as an explicit
new ADR before merge, not left as silent drift."_ This note is that ADR.

## Decision

**Ship the board dock alongside `/ask`, not instead of it.** Decision-27's placement rule —
"the seam, not a popup on every page" — no longer holds for board-scoped conversation, and this
ADR records the reversal, its scope, and what is not touched.

## Why decision-27 was right, and why this case is different

Decision-27's target was a general, cross-board destination: something that needs its own memory,
its own history rail, its own place to persist a conversation that outlives any single page view.
That is a home, not a seam, and it earned the standalone page for exactly that reason.

A board-scoped conversation is a different shape of thing. Its entire value is that the board is
**already on screen**: the dock narrows the board rather than navigating away from it, and because
the conversation is opened with `board_id` already known, the model skips the
`list_boards` → `get_board_overview` round-trip it would otherwise need just to figure out which
board the user means. That is the textbook description of "intelligence surfaced where work already
happens" — the seam decision-27 itself said AI should ship at.

A permanent dock is nonetheless **chrome** in the plain sense: it is present, collapsed, on every
board load, for every user, whether or not they ever open it. Calling it "just a seam" and moving on
would be the silent drift the design spec's own ADR-owed section warned against. The honest position
is that both things are true at once — it is a seam in placement and a piece of permanent UI in
footprint — and this ADR is the record that the tension was seen and weighed, not missed.

## What is preserved

- **`/ask` is unchanged and still owns cross-board conversation.** It remains the destination for
  general, board-agnostic chat and for cross-board agent briefing threads. The dock surfaces only
  the 5 most recent agent threads; the full list stays reachable from `/ask`'s existing rail, which
  needs no change because these are owner-scoped rows like any other.
- **One engine, not two.** Both surfaces run through the same `ai_conversations` / `ai_messages`
  schema and the same `/api/ask` route — an extension (`board_id`, `agent_id`, `run_id`,
  `visibility`), not a parallel chat subsystem. Decision-27's warning about duplicated AI plumbing
  is exactly what this reuse avoids.
- **The "chrome tax" objection does not apply here.** Decision-27's placement rule exists to stop
  every page from paying for AI it doesn't use. The dock is collapsed by default and issues **zero**
  requests until opened — first paint on a board that never opens it costs nothing, per the Phase 2
  spec's performance budget. The chrome is present but inert until asked for.

## What would reverse this back

- **The dock goes unused.** If usage telemetry after a bake-in period shows the dock is rarely or
  never opened, the permanent-chrome cost stops being justified and it should be removed in favor of
  `/ask` alone.
- **The dock measurably degrades board load or interaction.** If the collapsed dock's presence (not
  its opened state) regresses board page load, interaction latency, or triggers the horizontal-scroll
  class of bug it was built to avoid, and that cannot be fixed without abandoning the narrows-the-board
  placement, the seam argument above no longer holds.
- **The two surfaces drift apart.** If the dock and `/ask` stop sharing the same message/composer
  components and proposal-resolution path — each growing its own divergent chat implementation — the
  "one engine, not two" premise this decision rests on is gone, and the dock should be re-evaluated
  as a genuinely separate subsystem rather than an extension.

## Consequences

- Decision-27's "seams, not chrome" placement rule is now scoped: it governs *general* AI surfaces
  reaching for their own destination, not board-scoped conversation anchored to work already on
  screen. Future AI surfaces should ask which category they fall into rather than citing decision-27
  as a blanket rule against any persistent UI.
- `/ask` and the board dock are now two read paths over one schema; a future change to conversation
  persistence, streaming, or proposal handling must be verified against both.
- Tracked in [[00-north-star]] alongside the Personal Agents Phase 2 work.
