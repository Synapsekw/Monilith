# Ask Pulse — Full-Page Conversational AI — Design

**Date:** 2026-07-12
**Slug:** `ask-pulse-full-page-conversational`
**Status:** Design approved (owner sign-off 2026-07-12); ready for `writing-plans`
**Phase:** 10 (AI & Agents) — expands Epic 1's Ask Pulse (F5) and pulls in E3 conversational actions (F6)
**Companion:** brainstorm layout mockups in `.superpowers/brainstorm/` (Option B selected)

## Why this exists

Today "Ask Pulse" is a **stateless shadcn `Dialog`** (`src/components/ai/ask/AskPulse.tsx`) — a single question, a single answer, no memory, opened from ⌘K + a header button. The product owner wants Ask to be a **first-class destination**: a dedicated page in the side navigation that works like ChatGPT — persisted conversation history, multi-turn memory, streaming answers, and (phase 2) the ability to _act_ on the workspace, not just read it.

This is a **deliberate reversal** of the Phase 10 scope's original "AI at the seams, no standalone chat assistant" stance (`docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`, "Out of scope" + "Design stance"). The owner has explicitly chosen to make Ask a standalone surface. That reversal is recorded as an ADR alongside this spec. The _design personality_ still holds — Calm · Capable · Crisp, no glow/badges — the change is only that Ask now has a home of its own.

## What already exists (reused, not rebuilt)

- **Gateway + metering:** `src/lib/ai/gateway.ts` (`resolveAiAdapter`, `runAi`), `entitlement.ts` (`requireAiEntitlement`), `pricing.ts`, `record_ai_usage` RPC. Every AI call already routes through this chokepoint and meters into `ai_usage`.
- **Ask engine:** `src/lib/ai/ask/ask.ts` (Anthropic tool-use loop), `ask/tools.ts` (RLS-scoped read tools over boards/items/cells), `ask/actions.ts` (entitlement-gated server action).
- **Entitlement model:** `org_ai_settings` (`ai_mode = off | managed | org_byo | per_user`), Anthropic-gated for tool use (`supportsTools`).
- **Shell:** side nav in `src/components/shell/sidebar-nav.tsx` (+ `sidebar-nav-data.tsx`), mobile equivalent `mobile-nav.tsx`; ⌘K in `src/components/command-palette.tsx`; UI store `src/stores/ui.ts`.

What is **net-new**: the `/ask` route + chat UI, conversation persistence (schema), multi-turn context management with rolling summarization, token streaming, and (phase 2) write tools + confirm-before-execute UX.

## Phasing (one design, two builds)

- **Phase 1 — read-only conversational Ask.** `/ask` page (layout B), persisted cross-board history, multi-turn memory with rolling summary, token streaming. Read-only; reuses today's read tools. A complete, shippable ChatGPT-like experience.
- **Phase 2 — write actions.** Ask proposes create/update actions that render as a **confirm-before-execute** card; nothing mutates without an explicit click. This is the planned E3 "Conversational Actions" epic, built on phase 1's shell.

Phase 1 ships and is usable on its own. Phase 2 is additive and shares the same route, schema, and streaming path.

## 1. Layout & routing — Option B ("history replaces the nav on Ask")

- New routes: `src/app/(app)/ask/page.tsx` (new chat) and `src/app/(app)/ask/[conversationId]/page.tsx` (an existing conversation).
- **On Ask, the Pulse nav rail is replaced by a conversation rail:** "New chat" button, list of the user's past conversations (most-recent first), and a "← Back to Pulse" link that restores the normal nav. Main area = message thread (scrollable) + a sticky composer at the bottom.
- New **"Ask" nav entry** (Sparkles icon) added to `sidebar-nav.tsx` (HOME section) and `mobile-nav.tsx`.
- **Conversation switching / new chat is client state + History API** (`window.history.pushState('/ask/[id]')`), NOT a `<Link>`/router navigation. Switching between already-loaded conversations must not re-run RSC queries (AGENTS.md #5, gotcha-09). First paint loads the conversation list + the active thread; switching is client-driven; only _sending_, _renaming_, _deleting_ hit the server.
- UI built with the **`pulse-ui`** design system (dark-first, periwinkle accent, mono kickers, radius-14) — load `pulse-ui` + `frontend-design` skills before building the components.

## 2. Data model (new migration — DEV first, then `sync-prod`)

**`ai_conversations`**
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `org_id` | uuid | FK org; RLS scope |
| `user_id` | uuid | owner; FK auth user |
| `workspace_id` | uuid null | active workspace at creation (for read-tool scoping) |
| `title` | text | auto-generated from first exchange; user-renamable |
| `summary` | text null | rolling summary of compacted older turns (see §3) |
| `summarized_upto` | timestamptz null | messages at/before this are represented by `summary` |
| `created_at` / `updated_at` | timestamptz | `updated_at` bumped on each new message |

Index: `(user_id, updated_at desc)`.

**`ai_messages`**
| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `conversation_id` | uuid | FK `ai_conversations` on delete cascade |
| `role` | text | `'user' \| 'assistant'` |
| `content` | text | rendered message text |
| `tool_trace` | jsonb null | tools consulted / (phase 2) proposed & executed actions, for transparency + re-render |
| `created_at` | timestamptz | |

Index: `(conversation_id, created_at)`.

**RLS (default-deny, both tables):** a row is visible/writable only when `user_id = auth.uid()` AND the user belongs to `org_id` (reuse `has_org_role`). No cross-tenant, no cross-user. `ai_messages` policies join to the parent conversation. Writes go through Server Actions that re-assert ownership; the client never writes these tables directly (same confinement pattern as `org_ai_settings`).

Regenerate `src/types/database.types.ts` (`supabase-dev` MCP) in the same PR.

## 3. Chat flow & multi-turn context (rolling summary)

**Sending a message:**

1. Server Action persists the user message and (if new) creates the conversation.
2. The streaming endpoint (§4) assembles the model context as **`[rolling summary] + [recent verbatim messages]`**:
   - Recent turns (under a token/message budget) are sent verbatim.
   - Older turns beyond the budget are represented by `ai_conversations.summary`; `summarized_upto` marks the boundary.
   - When the verbatim tail grows past the budget, the turns that fall out are folded into `summary` via a cheap summarization call, and `summarized_upto` advances. This keeps per-turn token cost bounded while preserving long-conversation memory — this is the "smarter" context the owner chose over a naive last-N window.
3. The tool-use loop (existing `ask.ts`, generalized to accept a message array + summary) runs; assistant tokens **stream** to the client.
4. On completion: assistant message + `tool_trace` persisted, `updated_at` bumped, usage metered via the existing gateway path.

**Titling:** after the first exchange, a cheap model call generates a short title (fallback: truncated first message). Rename + delete are Server Actions.

**Out of v1:** pinning, folders, full-text search over conversations, per-message edit/branch (YAGNI).

## 4. Streaming architecture — one documented exception

Token streaming requires a **Route Handler**, not a Server Action: `src/app/api/ask/route.ts` returns a streamed `ReadableStream` produced by the gateway (raw Anthropic `.stream()`), while still capturing the final `message.usage` to meter. `requireAiEntitlement(orgId, 'ask')` is checked at the top of the handler; the provider must be Anthropic (`supportsTools`) or the handler returns a clean "needs an Anthropic key" error.

**All mutations remain Server Actions** — create/rename/delete conversation, persist user & assistant messages, update rolling summary. The streaming completion is the **single deliberate exception** to AGENTS.md's "Server Actions for all mutations," justified because streaming is not expressible as a Server Action return; this is called out explicitly in the plan and in code comments.

## 5. Phase 2 — write actions (confirm-before-execute)

- Add **write tools** to the loop over existing create/update RPCs (create item, set status/owner/dates, etc.).
- When the model proposes an action, the assistant turn renders a **confirmation card** in the thread: a human-readable summary ("Create task 'Ship v2' due Fri, owner Dana, in Backlog") with **[Approve] / [Cancel]**. Nothing executes until Approve is clicked — the non-negotiable human gate from the Phase 10 scope.
- On Approve → a Server Action runs the RPC (RLS enforced) → the result is posted back into the thread and recorded in `tool_trace`. On Cancel → the proposal is dismissed, no write.
- Multiple proposed actions in one turn are each individually confirmable.

## 6. Retire the popup

- Remove the header `AskPulseTrigger`, the `AskPulse` dialog, `AskPulseHost`, and the `askPulseOpen` flag in `src/stores/ui.ts`.
- The ⌘K **"Ask Pulse…"** entry **navigates to `/ask`** instead of opening a modal, prefilling any typed text as the first message — so the fast entry point survives, it just lands on the real page.
- Update `app-shell.tsx` wiring and the affected tests.

## 7. Performance & data-fetching budget (AGENTS.md #5)

- **First paint:** conversation list (bounded, indexed `(user_id, updated_at desc)`) + the active conversation's messages (bounded per conversation). Nothing else.
- **Interactions:** switching conversations / starting a new chat = **0 RSC navigations** (client state + History API). Server round-trips only on explicit **send / rename / delete**.
- **Reads are bounded & indexed:** no unbounded `select *`; long threads paginate/virtualize if needed; the rolling summary caps model-context growth.
- **Metering:** each send is one metered gateway call; multi-turn increases tokens, which the rolling summary bounds.

## 8. Testing (all four gates green before merge)

- **RLS integration** (`ai-conversations.rls.integration.test.ts`, rolled-back txn on DEV, skips without `PULSE_TEST_DB`): cross-user and cross-org isolation on both tables.
- **Unit:** context assembler (verbatim tail + summary boundary + fold-in), titling, tool-trace persistence, entitlement gating on the route.
- **Component:** composer, streaming render, conversation rail (list/new/switch/rename/delete), and (phase 2) the confirm card (approve executes, cancel is a no-op).
- **Streaming endpoint:** entitlement rejection, provider-not-capable, happy-path stream + usage capture.

## 9. Out of scope (v1)

Semantic search / RAG over items (E5 F15), file/attachment uploads, sharing or exporting conversations, voice input, per-message editing/branching, conversation folders/search, multi-provider streaming beyond Anthropic.

## 10. Execution DAG (for the plan)

- **Phase 1 batch (mostly parallel after the schema):** (1) migration + types + RLS tests → unblocks the rest; then in parallel: (2) streaming route + gateway streaming + context assembler, (3) conversation Server Actions (create/rename/delete/persist) + titling, (4) `/ask` page + conversation rail + composer + streaming render (`pulse-ui`), (5) nav entry + ⌘K repoint + popup removal.
- **Critical path:** schema → context/streaming engine → chat page.
- **Phase 2:** write tools → confirm-card UX → approve/execute action — sequential, on top of shipped phase 1.

## 11. Closure

- Migration authored on DEV via `supabase-dev` MCP; `sync-prod` when promoting.
- ADR recorded for the "Ask becomes a standalone surface" reversal of the Phase 10 design stance.
- North-star §3 + `vault/moc/platform-roadmap.md` updated to reflect Ask's expansion.
- "How to test" walkthrough handed to the user at merge.
