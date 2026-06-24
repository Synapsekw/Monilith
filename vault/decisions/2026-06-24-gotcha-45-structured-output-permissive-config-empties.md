---
type: adr
date: 2026-06-24
status: accepted
tags: [decision, gotcha, ai, anthropic, structured-output]
related:
  - "[[2026-06-24-0912-ai-dashboard-generation]]"
---

# Gotcha 45: a permissive field in a structured-output schema makes the model emit it empty

## Context

AI dashboard generation asks Opus 4.8 for a `DashboardProposal` via Anthropic **structured output**
(`messages.parse` + `output_config.format` = `jsonSchemaOutputFormat(PROPOSAL_JSON_SCHEMA)`). The
schema declared each widget's `config` as a permissive object:

```js
config: { type: "object", additionalProperties: true }   // <-- the bug
```

Every generation collapsed to a single empty `list` widget. Evidence (debug harness against a real
board with 2 status + 2 date columns): the model returned `{kind:"number", config:{}}`,
`{kind:"chart", config:{}}`, … — **all configs `{}`** — so `validateProposal` dropped them all; only
`list` survived because its Zod schema fully defaults (`columnIds:[]`, `limit:25`).

## Decision / what to do

**Under strict structured output the model obeys the SCHEMA, not the prompt prose.** A field that is
permissive/optional in the schema gets satisfied with its _minimal_ valid value (`{}`/omitted),
no matter how detailed the system prompt is. So **put the real shape in the schema**:

- Fully specify each widget kind's config via `oneOf`, with the discriminating fields **required**
  (`agg` for number; `chartType`+`primary`+`measure` for chart; `groupColumnId` for battery;
  `columnIds` for list). The grammar then _forces_ complete configs.
- Keep `columnId`s as plain `string`s and re-check them against the snapshot in `validateProposal`
  (the schema can't enumerate per-board UUIDs).

## Rationale

The prompt is advisory; the compiled grammar is binding. The model's _intent_ was always fine (great
titles: "Tasks by Stage", "Stage by Stakeholder") — only the schema-bound plumbing was empty.

## Consequences

- Positive: generations now return 4–6 complete, valid widgets (count card + charts + battery), zero
  dropped. Regression guards pin both invariants in `proposal-schema.test.ts`.
- Negative / watch: Anthropic's grammar **rejects schemas with >24 optional parameters** (`400
invalid_request_error`). A per-widget `layout` (x/y/w/h × 4 `oneOf` branches = 16 optional) blew
  past it, so `layout` was dropped from the model schema entirely — `packLayout()` re-flows the grid
  from per-kind default sizes. Adding optional fields back must respect the 24 budget (there's a test
  that counts them).
- Open follow-up: if we ever want the model to size/place widgets, encode layout as a small set of
  **required** fields, not optional ones.

## Related

- [[2026-06-24-0912-ai-dashboard-generation]]
