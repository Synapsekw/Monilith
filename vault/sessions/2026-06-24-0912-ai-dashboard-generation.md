---
type: session
date: 2026-06-24-0912
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, dashboards, phase-8]
related:
  - "[[2026-06-24-gotcha-45-structured-output-permissive-config-empties]]"
  - "[[2026-06-23-1953-dashboards-polish-v2]]"
---

# AI dashboard generation (Opus 4.8)

## What changed

- New `src/lib/ai/` module: `anthropic.ts` (client + `MODEL=claude-opus-4-8`), `board-snapshot.ts`
  (schema + aggregate stats, **no raw cell values**), `proposal-schema.ts` (oneOf schema +
  validator/repairer + `packLayout`), `generate.ts` (structured output via `messages.parse` +
  `jsonSchemaOutputFormat`), `actions.ts` (4 server actions composing existing dashboard RPCs).
- New UI `src/components/dashboards/ai/`: `GenerateWithAiButton` (Sparkles entry in `DashboardsNav`),
  `AiDashboardWizard` (pick board → approve summary → generate → push `?review=1`), `AiReviewBanner`
  (Keep / Discard / Regenerate on the live dashboard). Wired into `DashboardsNav` + the dashboard page.
- Built subagent-driven (8 TDD tasks, parallel batches per the DAG) in worktree `task/ai-dashboard-gen`,
  merged to develop (`1dca0a5`). Added `@anthropic-ai/sdk`; `ANTHROPIC_API_KEY` server-only.
- **Post-merge fix (`79aefdc`):** generation only ever produced an empty list — root-caused to a
  permissive `config` in the structured-output schema (model emits `{}`). Fully specified per-kind
  configs via `oneOf` + required fields; dropped `layout` from the model schema to stay under
  Anthropic's 24 optional-param limit. See [[2026-06-24-gotcha-45-structured-output-permissive-config-empties]].

## Why

Phase 8 dashboards were powerful but manual. This adds an AI layer that reads a board's shape
(schema + stats only, privacy-preserving — the LLM designs structure; existing RPCs compute the
numbers) and proposes a complete dashboard, lowering the blank-canvas cost of building one.

## How to test (for the user)

1. Pull `develop`; restart the dev server (`ANTHROPIC_API_KEY` must be in `.env.local`).
2. Sidebar → Dashboards → click the **✨ Generate with AI** button next to **+**.
3. Pick a board with data (status/date/numbers columns) → **Next** → review the summary → **Generate**.
4. Expect to land on a new dashboard with **4–6 widgets** (count card + charts + battery), not a bare
   list. Use the top banner to **Keep**, **Discard**, or **Regenerate**.

## Open threads

- For production, add `ANTHROPIC_API_KEY` to Vercel (Production + Preview) before promoting.
- Generation quality is good on status/date boards; revisit prompt heuristics for text-heavy boards.

## Next session entry point

AI dashboard generation is shipped + verified on `develop`. Next: `/promote` the develop bundle
(now includes AI generation) and add `ANTHROPIC_API_KEY` to Vercel, or continue Phase 9.3/9.4.
