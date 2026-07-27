---
type: decision
date: 2026-07-12
status: accepted
tags: [decision, phase-10, ai, ask-pulse, product, ux]
related:
  [
    "[[2026-07-05-decision-26-ai-platform-dual-billing]]",
    "[[2026-07-11-2116-ai-e1-hybrid-gateway-ask-pulse]]",
    "[[00-north-star]]",
    "[[platform-roadmap]]",
  ]
---

# decision-27: Ask Monolith becomes a standalone full-page chat surface

## Context

Phase 10 E1 shipped **Ask Monolith** as a stateless shadcn `Dialog` — a single question, a single
answer, no memory — opened from ⌘K + a header button (`src/components/ai/ask/AskPulse.tsx`). This
followed the Phase 10 **design stance** in the scope doc: _"AI ships at the seams, not as chrome …
intelligence surfaced where work already happens,"_ with _"a general chat assistant untethered from
a board/workspace"_ listed **out of scope**, and [[2026-07-05-decision-26-ai-platform-dual-billing]]
explicitly deferring **conversation memory** and **streaming**.

The product owner has now decided Ask should be a **first-class destination** that works like
ChatGPT: a dedicated page in the side navigation with persisted conversation history, multi-turn
memory, streaming answers, and (later) the ability to act on the workspace — not just a popup.

## Decision

**Promote Ask Monolith from a seam-level popup to a standalone `/ask` page**, and accept the scope this
implies:

1. **Standalone surface.** A dedicated `/ask` route in the side nav (layout "B": entering Ask swaps
   the Monolith nav rail for a conversation-history rail, with a "Back to Monolith" link). The popup is
   **retired**; ⌘K "Ask Monolith…" navigates to the page.
2. **Persisted, per-user, cross-board history.** New `ai_conversations` + `ai_messages` tables with
   **owner-scoped RLS** (a user reads/writes only their own conversations). This reverses the
   "conversation memory deferred" call in decision-26.
3. **Multi-turn with a rolling summary.** Recent turns verbatim; older turns folded into a stored
   summary so per-turn token cost stays bounded.
4. **Token streaming** via a session-authed **Route Handler** (`/api/ask`) — the **one deliberate
   exception** to "Server Actions for all mutations" (streaming isn't expressible as a Server Action
   return); every actual mutation stays a Server Action. Reverses the "streaming deferred" call in
   decision-26.
5. **Phased build.** Phase 1 = read-only chat page (reuses the existing gateway/metering/entitlement
   - read-tool loop). Phase 2 = confirm-before-execute **write actions** — effectively E3 F6 pulled
     forward, keeping the non-negotiable human gate.

## Why the reversal is acceptable

- The **anti-reference** in `vault/product.md` was "powered-by-AI badges, glow-everything." A calm,
  focused chat page is not that — the personality (**Calm · Capable · Crisp**, no glow/badges) is
  preserved; only the _placement_ changes from "only at the seams" to "also has a home."
- Everything underneath is **reuse**: the gateway (`runAi`), entitlement (`requireAiEntitlement`),
  metering (`ai_usage`), and the RLS-scoped read-tool loop all stand; this adds a route, a schema,
  streaming plumbing, and UI — not a new AI subsystem.
- RLS remains the boundary: conversations/messages are user-owned content, so owner-scoped RLS
  writes (not service-client confinement) are the right guard — no privilege-escalation surface like
  `org_ai_settings` had.

## Consequences

- Roadmap updated: [[00-north-star]] §2 (Phase 10 bullet) + §3 "Next", and [[platform-roadmap]]
  Phase 10 note now carry "Ask Monolith full-page (queued, not started)."
- Spec: `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md`.
  Phase-1 plan (12 TDD tasks + execution DAG):
  `docs/superpowers/plans/2026-07-12-ask-pulse-full-page-conversational.md`.
- **Not started** — queued Phase 10 work, pickable via `/whats-next`. Phase 2 (write actions) gets
  its own plan after Phase 1 ships and teaches us.
- Supersedes decision-26's deferral of conversation memory and streaming (those are now in scope for
  this surface). Decision-26's billing/gateway/BYO architecture is otherwise unchanged.
