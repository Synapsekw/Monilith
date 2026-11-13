# Unified assistant: follow-ups after Plan A

Collected from the task reviews, the whole-branch review and the live
acceptance run of `task/assistant-runtime` (2026-11-13). Nothing here blocked
the merge into `develop`. Items marked **before promotion** should be closed or
consciously accepted before `develop` is promoted to `main`.

## Before promotion

- Run acceptance checks 6 (a non-Anthropic model), 7 (an old thread with an
  unresolved proposal card), 9 (step limit) and 8 with a person in two
  organisations. Script and results:
  `docs/superpowers/plans/2026-11-13-unified-assistant-acceptance.md`.
- Fix `create_goal` and `create_portfolio` in the database: both choose an
  organisation with `limit 1` and ignore the one requested. The assistant
  refuses these creates until then (`src/lib/assistant/unsupported.ts`). Check
  whether the Goals and Portfolios pages are affected for people in more than
  one organisation.
- Decide whether cross-board semantic search, which the old chat offered
  through `semantic_search_items`, should return. The catalog's `search_items`
  needs a board id.

## Plan B (dock on every page) should include

- Focus for item, folder, dashboard and My Work; the client sending
  `{ kind, id }`; folding the Intelligence tab into the dock.
- Organisation checks on calls addressed by board, item or workspace id.
  Today only calls that take an `orgId` are pinned; `list_boards` still returns
  boards from every organisation the person belongs to, and a dashboard create
  that names a workspace is refused outright.
- Claim-first resolution of a batch, so a failure to record the result after
  changes ran cannot leave the card open after a reload.
- A bounded board read for the focus snapshot in place of the full payload.
- Row labels for threads with no board in focus, and for tools the describer
  does not cover (`src/lib/assistant/describe.ts` returns null and the card
  falls back to a generic line).
- Per-descriptor shape validation at stage time for grouped tools, so an
  invalid action fails while the model can still correct it.

## Small hardening items

- Preamble: narrow "trust the outcome turn" to its Applied / Not applied /
  Failed / Dismissed status; the row text in it is data.
- Quote the item name in `update_item` labels; escape embedded quotes.
- A member with no name renders as "Someone" in a label; return null instead.
- Include a link's display text in its label.
- `create_item` with both `name` and `items` gets a label, then fails at Apply.
- Tests still missing: the members-read failure branch in the route; a
  `fullName` containing "@"; `workspaceId: ""` and case variants in
  `unsupported.test.ts`; stage and Apply refusals for portfolio and dashboard;
  the card's error state; the 120-character title cap; the step separator,
  stream error and status event in the runtime.
- `AskChat.test.tsx` fixtures still use the old "Done — …" outcome wording.
- `capabilityFor` in `src/lib/mcp/tools/descriptor.ts` uses `in`, which matches
  prototype keys. It fails closed (staged, then rejected at Apply) but labels
  such a call as a plain write. Use `Object.hasOwn`.
- `hitStepCap` is true when step 12 ends naturally with text.
- The rolling-summary cursor does not advance when the model returns the same
  summary text, so the fold is repeated on later turns.
- A turn whose model text is only whitespace shows leading whitespace live.
- `resolveBatch` in `AskChat` guards on state, not a ref; the server refuses a
  second Apply.
- Applied changes appear in activity as the person's own. Marking them as made
  through the assistant needs a schema change.

## Sub-projects still open

- 0: signup approval (every new account waits for a platform admin).
- 3: saved agents on this runtime (run now, schedule, events, teammate mention,
  loud failures). The one scheduled agent in the live database has failed daily
  since September with `Invalid Refresh Token`.
- 4: retire the proposal queue, capability grants, orchestrator, delegation,
  agent memory, Autopilot and the old Ask loop.
- 5: a platform OpenAI key in managed mode with layered caps.
