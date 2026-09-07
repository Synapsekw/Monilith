# MCP write surface — boards, structure, and the planning layer

Date: 2026-09-07
Status: approved (design), not yet planned

## Problem

The MCP catalog serves 24 tools. Nineteen are reads. The five writes are
`create_item`, `update_item`, `create_attachment_upload`, `attach_file` and
`log_time_allocation` — every one of them writes _item data into structure a
human already built_.

So an agent can fill a board and can never make one. It cannot add a column,
create a group, open a view, build a dashboard, or file a report. The gap is
not a missing feature here and there; it is the whole structural half of the
product, and it is the reason an agent cannot carry a piece of work end to end
without a human doing the setup first.

Three consequences follow, and they compound:

1. **Autonomy stops at the shape of the data.** "Track this quarter's hiring"
   is not a request an agent can act on. It can only add rows to a board whose
   columns someone else chose.
2. **The two transports inherit the same ceiling.** `ToolDescriptor` is served
   to both the MCP server and the in-app agent runtime, so a connected Claude
   Desktop and a 07:00 scheduled agent are equally unable to build anything.
3. **The planning layer is read-only in full.** Goals, portfolios, dashboards
   and reports have `list_*`/`get_*` tools and no writes at all.

## Outcome

An agent — scheduled, or a human's MCP client — can build a board from nothing:
create it, give it columns with real settings, group it, fill it, open views on
it, wire automations, and roll it up into a dashboard, a report, a goal and a
portfolio. Everything it can break is recoverable from Trash.

## Non-goals

- **No new tables, columns or RPCs.** Every operation here already exists as a
  server action against existing tables. This spec exposes them; it does not
  extend the model.

  It does need **one DDL-only migration**, because the capability vocabulary is
  not merely a TypeScript array: `user_agents_capabilities_known` and
  `org_ai_settings_ceiling_known` are CHECK constraints that enumerate it
  literally. Both must be widened or no agent can be granted the new
  capabilities and no admin can tick them. Not one row of user data is read or
  written — see §3.

- **No hard delete or purge from any agent-reachable path.** See §5.
- **No change to RLS.** RLS remains the security boundary and is untouched.
  Every new tool runs on the same RLS-scoped client the existing ones use.
- **No sharing, membership, or org-admin writes.** `shareBoard`,
  `unshareBoard`, org member management and the capability ceiling stay
  human-only. An agent that can grant board access is an agent that can widen
  its own blast radius.
- **No spreadsheet import/export** (`commitImport`, `exportBoard`). File-shaped
  bulk mutation is its own problem with its own failure modes.

---

## 1. Shape: grouped dispatch

Exposing ~45 operations as ~45 tools would take the catalog to 69. Tool-choice
accuracy degrades measurably past roughly forty on most clients, and the
consent UI becomes a wall. So the new surface is **twelve grouped-dispatch
tools**, each taking an `action` discriminant.

Ten `manage_*` tools plus `describe_schema` join the catalog;
`manage_automation` is agent-only (§9). The catalog goes **24 → 35**.

| Tool                | Actions                                                                         | Catalog?       |
| ------------------- | ------------------------------------------------------------------------------- | -------------- |
| `manage_board`      | create · rename · archive · restore · duplicate                                 | yes            |
| `manage_group`      | create (batch) · rename · reorder · recolor · archive · restore                 | yes            |
| `manage_column`     | create (batch) · rename · configure · reorder · resize · delete · remove_option | yes            |
| `manage_item`       | archive · restore · move · reorder · add_subitem                                | yes            |
| `manage_view`       | create · update · delete                                                        | yes            |
| `manage_goal`       | create · update · delete · set_links                                            | yes            |
| `manage_portfolio`  | create · add_board · remove_board · update_placement                            | yes            |
| `manage_dashboard`  | create · rename · duplicate · delete · save_layout                              | yes            |
| `manage_widget`     | create · update_config · delete                                                 | yes            |
| `manage_report`     | create · save · set_scope · delete                                              | yes            |
| `describe_schema`   | _(read; no capability)_                                                         | yes            |
| `manage_automation` | create · update · delete                                                        | **agent-only** |

`create_item` and `update_item` keep their names and their current single-item
input, and `create_item` gains an optional batch form (§6).

### Input shape

Each tool's `inputSchema` is a Zod **discriminated union on `action`**, so an
action's required fields are required only for that action — a model cannot
send `{action: "rename"}` with no `name`, and the SDK rejects it before the
handler runs, exactly as it does for every existing tool.

```ts
z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    workspaceId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("rename"),
    boardId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ action: z.literal("archive"), boardId: z.string().uuid() }),
  // …
]);
```

`ToolDescriptor.inputSchema` is typed `z.ZodRawShape` and MCP's
`registerTool` wants a raw shape, not a `ZodObject`. A discriminated union is
neither. **The descriptor therefore carries a raw shape whose `action` is a
`z.enum`, and the union is applied inside `invoke` as the first statement** —
one `safeParse`, its error returned as an ordinary tool failure. This keeps
`registerDescriptor` and `buildAgentTools` unchanged, and is the single
deviation from "the SDK validates before the handler" that grouped dispatch
costs. It is stated here so no implementer discovers it as a surprise.

## 2. Descriptor layer: three fields go per-action

`descriptor.ts` gains no new concepts, only a scalar-or-map widening. All 24
existing descriptors keep their current scalar form and are not edited.

```ts
export type ToolDescriptor = {
  // …
  capability: AgentCapability | null | Record<string, AgentCapability | null>;
  scope: ToolScope | Record<string, ToolScope>;
  /** Actions that create a new top-level object, addressing no existing
   *  board. Refused when the agent's board_scope is narrowed (§4). */
  unscopedCreateActions?: readonly string[];
};
```

Two resolvers live beside the type, and **every consumer goes through them** —
no consumer reads `d.capability` or `d.scope` directly again:

```ts
export function capabilityFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): AgentCapability | null;
export function scopeFor(
  d: ToolDescriptor,
  input: Record<string, unknown>,
): ToolScope;
```

Both read `input.action` when the field is a map. **A map miss fails closed**:
`capabilityFor` returns the most restrictive capability present in the map
rather than `null`, because returning `null` would mark an unrecognised action
as a capability-free read and let it execute ungated. An action absent from the
map cannot occur — the union rejects it first — but the resolver must not
depend on that for its safety.

Four consumers must be updated together, and the fourth is easy to miss:

| Consumer                                      | Today                                  | Change                                                           |
| --------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| `grant-gate.ts`                               | `d.capability`                         | `capabilityFor(d, toolCall.input)` — it already receives `input` |
| `board-scope-guard.ts` `resolveTargetBoardId` | `descriptor.scope`                     | `scopeFor(d, input)`                                             |
| `proposal-targets.ts` `KIND_BY_SCOPE`         | per-tool scope map                     | per-**call** scope, resolved from the stored proposal input      |
| `mcp-tools-table.tsx`                         | `d.capability === null ? read : write` | `read` only when every value in the map is `null`                |

### New scopes

`TOOL_SCOPES` gains `columnId`, `viewId` and `automationId`, each with a
one-row indexed lookup in `resolveTargetBoardId` mirroring the existing
`groupId` branch. Dashboards, widgets, goals, portfolios and reports stay
`"none"` — the reasoning already written into `descriptor.ts` for
`get_dashboard`/`get_report` applies unchanged: they span many boards, so "in
scope" has no single answer, and RLS is their sole boundary.

`proposal-targets.ts` gains `column`, `view` and `automation` target kinds so
an approval card can still say _which_ object a proposal names.

## 3. Capability vocabulary

Two additions to `AGENT_CAPABILITIES`:

```ts
"board.structure"; // create and configure the shape of things
"board.destroy"; // archive a container, or delete a leaf object
```

`board.write` keeps its exact present meaning — item data, nothing else. An
owner who has granted only `board.write` sees **no** behavioural change: their
agent still cannot add a column.

`CAPABILITY_COPY` gains both, in the established voice:

- **`board.structure`** — "Build and change board structure." / "This agent can
  create boards, and add or reconfigure their groups, columns, views,
  dashboards and reports."
- **`board.destroy`** — "Remove things." / "This agent can move boards, groups
  and items to Trash, and delete columns, views, widgets and reports outright.
  Anything in Trash can be restored by you."

Action → capability, in full:

| Capability          | Actions                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `board.structure`   | every `create`, `rename`, `configure`, `reorder`, `resize`, `recolor`, `duplicate`, `update`, `save`, `save_layout`, `set_scope`, `set_links`, `add_board`, `update_placement`, `restore`, `move`, `add_subitem` |
| `board.destroy`     | every `archive`, `delete`, `remove_option`, `remove_board`                                                                                                                                                       |
| `automation.create` | all three `manage_automation` actions                                                                                                                                                                            |

`restore` is `board.structure`, not `board.destroy`: undoing a removal is not a
removal, and an agent able to clean up after itself is strictly safer than one
that can only archive.

### The ceiling is the default deny, and it already works

Effective permission is `granted ∩ ceiling ∩ RLS`. `org_ai_settings.agent_capability_ceiling`
reads as `[]` when null, and no org's ceiling can contain a capability that did
not exist when it was set. **Both new capabilities are therefore denied for
every existing org on day one, with no migration and no backfill**, and open
only when an admin ticks them in `OrgAgentCeiling`. This is the same
installable-but-inert posture agent memory shipped under, and it is deliberate:
the feature lands dark and an admin turns it on.

`grant-gate.ts` checks the ceiling _before_ the grant and records no proposal
when the ceiling refuses — unchanged, and it means a structure call in an org
that has not opted in produces a clean denial rather than an approval card
nobody can approve.

Three rules the migration must follow, all precedent from
`20260905045106_agent_delegate_and_usage_run_id.sql` (the `agent.delegate`
ship) and `20260827095748_agent_memory.sql` before it:

1. **Widen both CHECK constraints** so an admin _can_ tick the new
   capabilities.
2. **Do not backfill existing ceilings.** The DEV database holds real,
   user-facing data (decision-32); a data-modifying statement against it is
   reviewed and run on its own, never as a side effect of a feature branch. The
   exact `update` is recorded verbatim in the migration's header comment,
   unexecuted, so it is reviewable in the diff and runnable later.
3. **Do not touch the column DEFAULT**, and do not touch
   `DEFAULT_ORG_AI_SETTINGS.agentCapabilityCeiling` in
   `src/lib/ai/org-settings.ts` — a frozen five-string literal that is
   deliberately _not_ derived from `AGENT_CAPABILITIES`. Widening either hands
   structure writes to every future org silently. The two must stay
   byte-identical; `org-settings.test.ts` pins it.

## 4. Board scope and the create hole

`board_scope` narrows board-**addressed** calls. A create addresses no existing
board, so scope has nothing to catch it on: an agent scoped to boards A and B
could create board C.

**Rule: when `scope.mode === "list"`, every action named in
`unscopedCreateActions` is refused**, before the handler, in the same wrapper
that enforces board scope:

> `This agent is scoped to specific boards, so it cannot create new ones. Ask its owner to widen its scope.`

The refusal names the fix, so the model reports it rather than retrying. An
`all`-scope agent creates freely.

`unscopedCreateActions` covers `manage_board{create}`, `manage_dashboard{create}`,
`manage_portfolio{create}`, `manage_goal{create}` and `manage_report{create}`.
It does **not** cover `manage_group{create}` or `manage_column{create}` — those
take a `boardId` and are caught by ordinary scope resolution.

Auto-widening was rejected in both its forms. Persistent widening lets an agent
edit its own permission config, which is an escalation primitive a prompt
injection can drive one board at a time. Run-local widening avoids that but
introduces mutable per-run scope state threaded through the wrapper, for a case
an owner can resolve in one click.

This is a real capability limit and the agent editor's board-scope help text
must say so plainly rather than overpromise.

## 5. What may be destroyed

| Object                                 | Agent may              | Agent may not |
| -------------------------------------- | ---------------------- | ------------- |
| Board                                  | archive, restore       | delete, purge |
| Group                                  | archive, restore       | delete, purge |
| Item                                   | archive, restore, move | delete, purge |
| Column                                 | delete                 | —             |
| View, widget, report, goal, automation | delete                 | —             |
| Portfolio board link                   | remove                 | —             |

Containers are archive-only because `deleteBoard` is a **hard** delete: it
cascades, and it frees the board's Storage objects through
`removeAttachmentObjects`. An MCP handler that hard-deleted without replicating
that cleanup would orphan every attachment object on the board — invisible
quota loss with no error. Archiving is an `archived_at` update with no such
tail, and it is reversible.

Leaf objects get real deletes: their loss is bounded, their recreation is
cheap, and an agent that cannot remove a column it just got wrong leaves debris
a human must clean up. `delete_column`'s cell cascade is a foreign key, not an
application concern.

**Purge stays human-only, in the Trash UI.** No tool, on either transport,
permanently destroys anything.

## 6. Batch creates

Board-building is sequential by nature: eight columns, four groups, thirty
items is ~45 round trips, each one a full model turn and each one rotating the
OAuth bridge secret in `getRequestClient`. The rate limit (120/min) is not the
binding constraint; latency and token cost are.

Creates therefore take an array, capped at 50, and report **per-entry**
outcomes — the `create_item`/`fieldErrors` precedent extended one level:

```
manage_column { action: "create", boardId, columns: [ {...}, {...} ] }
→ { created: [{ id, name, kind }, …], errors: [{ index: 1, error: "…" }] }
```

`isError` is set only when **every** entry failed, matching `create_item`
exactly. A partial success is a success with a report attached, never a silent
all-or-nothing — and never a lie in the other direction.

Batching applies to `manage_column{create}`, `manage_group{create}` and
`create_item`. Updates and deletes stay single-target: a half-applied update is
ambiguous in a way a half-applied create is not.

`create_item`'s batch form is **additive** — `{groupId, name, fields}` keeps
working byte-for-byte, and `{groupId, items: [...]}` is the new alternative.
Existing MCP clients and existing agent instructions are unaffected.

## 7. Core extraction

MCP handlers cannot call the server actions: actions resolve their client from
cookies (`createClient()`, `getUser()`), MCP resolves it from the OAuth bridge.
Today `create_item` reimplements against the bridged client, and that is
tolerable at five tools. At fifty it is the dominant risk — the owner-only
guards, `defaultColumn`'s per-kind settings, `columnSettingsSchema` validation
and `midpoint` positioning would each get a second copy, drifting silently past
`tsc`.

So for **each operation this spec exposes**, the body moves down one layer:

```
src/lib/boards/core/{board,group,column,item,view}.ts
src/lib/{dashboards,goals,portfolios,reports}/core.ts
src/lib/boards/automation-core.ts        (exists — extend)
```

```ts
// core
export async function createColumnCore(
  supabase: SupabaseClient<Database>,
  actorId: string,
  input: { boardId: string; kind: ColumnKind; name?: string;
           settings?: Record<string, unknown> },
): Promise<ActionResult<{ column: Tables<"columns"> }>>

// server action                       // MCP descriptor
const supabase = await createClient();  const supabase = await ctx.getClient();
const r = await createColumnCore(…);    return toToolResult(
revalidate…;                              await createColumnCore(…));
return r;
```

Cores return `ActionResult` — the repo's canonical result shape, unchanged. One
new shared helper, `toToolResult(ActionResult) → ToolResult`, in
`src/lib/mcp/tools/shared.ts`, so no descriptor hand-rolls the
`{content:[{type:"text",…}], isError}` envelope again.

Untouched server actions stay exactly as they are. This is extraction scoped to
what is being exposed, not a refactor of the app.

### `getBoardAccess` must become injectable

`getBoardAccess` (`src/lib/boards/queries.ts`) is the owner-only guard on board
archive/restore, and it calls **both** `getUser()` and `createClient()` — two
cookie dependencies. Ported naively, the MCP path silently loses the guard,
which matters because the guard is documented defence-in-depth against
RLS-filtered updates returning a _lying success_ on zero rows.

So it splits:

```ts
export async function getBoardAccessCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  boardId: string,
): Promise<"owner" | "editor" | "viewer" | null>;
```

with the existing `getBoardAccess(boardId)` becoming a two-line wrapper. The
MCP side passes `ctx.actorId`, which `mcpActorId` guarantees matches the
bridged token's subject.

This is the single highest-risk item in the spec and its test — an MCP
archive by a non-owner must be refused with the same message — is not optional.

## 8. The proposal path

A denied write does not vanish: `grant-gate.ts` records it as a proposal the
owner can approve for up to seven days, and `proposal-summary.ts` derives —
server-side, from validated input only — the sentence the owner reads.

That module switches on `toolName`. Grouped dispatch means it must switch on
`toolName` **and** `action`, and every new action needs a branch. This is
roughly fifty new summary branches and it is the largest single block of work
in the spec. It is also non-negotiable: the module's stated property is that
the sentence describes the call that will really run, and its fallback —
`Run <tool>.` — would render _"Run manage_board."_ for an archive. An owner
cannot consent to that.

Every branch obeys the existing rules: pure, never throwing, model-chosen text
passed through `oneLine` and quote-escaped, output under 500 characters.

`proposal-targets.ts` resolves the target from `descriptor.scope`; per §2 it
resolves from `scopeFor(d, row.input)` instead, and gains the three new kinds.
Its one-bounded-read-per-kind property is preserved: three more kinds means
three more `id IN (…)` reads for a whole page, never one per card.

## 9. Automations stay agent-only

`create_automation` is deliberately **not** in the MCP catalog. The reason is
written into `agent-only-tools.ts`: an automation is a standing, org-visible
side effect, and it belongs behind an agent's capability grant rather than a
generic bearer token that any connected MCP client holds.

That reasoning is unchanged by this spec, and this spec does not overturn it.
`manage_automation` therefore **replaces `createAutomationDescriptor` inside
`AGENT_ONLY_DESCRIPTORS`**, gaining `update` and `delete` under the existing
`automation.create` capability. It is never registered on the MCP server.

Consequence, stated so it is not a surprise: a human's Claude Desktop can build
a board, fill it, and open views and dashboards on it, but cannot create an
automation. Only a scheduled agent, holding a granted capability inside an org
whose ceiling permits it, can.

`proposal-summary.ts` already has a `create_automation` branch; it moves to the
`manage_automation` switch and keeps its wording for the create action.

## 10. The MCP transport has no capability gate

Worth stating plainly, because this spec widens what the sentence covers:
`capability` is enforced **only** in the agent runtime, by `grant-gate.ts`.
`registerDescriptor` ignores it. Over MCP, a connected client acts _as the
user_, and the boundary is the user's own RLS plus the OAuth consent they gave
at connect time.

So an MCP client that the user has authorised gains the full structure surface
at once. That is correct — it is the user acting through a tool of their
choosing, and they can do all of it in the web UI — but it is why §5's
archive-only rule is not merely an agent-safety measure. It is what keeps a
confused MCP client's worst outcome recoverable, and it is the reason purge is
excluded on both transports rather than gated on one.

`mcp-tools-table.tsx` (settings → MCP) renders each tool's read/write
classification from the descriptor, so all eleven new tools appear there as
writes with no extra work beyond the map-aware derivation in §2.

## 11. `describe_schema`

One read tool, `capability: null`, `scope: "none"`, taking an optional `topic`:
`column_kinds | view_types | widget_kinds | report_shapes | automation_recipes | all`
(default `all`).

It returns, per entry, the settings shape, a minimal working example, and any
constraint the shape cannot express — the pattern `column-meta.ts` already
established for cell values:

```
describe_schema({ topic: "column_kinds" })
→ { status: { settings: '{ options: [{ id, label, color }] }',
              example:  { options: [ { id: "todo", label: "To Do", color: "gray" },
                                     { id: "done", label: "Done", color: "green" } ] },
              note: "ids are yours; cells store optionId" },
    relation: { settings: '{ target_board_id }',
                note: "the target board must be readable to you" },
    … }
```

It is **static** — no database read, no client, no rate-limit-relevant cost.
That is what lets it be capability-free and called freely at the start of any
build.

Its anti-drift suite mirrors `column-meta.test.ts`: the test enumerates
`ColumnKind`, the view types, the widget kinds and the report shapes from their
own declarations and fails if any is missing a description. A kind added
without a description breaks the build rather than shipping a vocabulary the
model cannot use.

## 12. Performance & data-fetching budget (working agreement #5)

MCP is not a page, but the budget applies to every read this adds.

- **First paint / per interaction.** Not applicable — the only UI this spec
  touches is `CapabilityToggles`, `OrgAgentCeiling` and `mcp-tools-table.tsx`,
  all three of which render from static arrays and issue no query.
- **Server data.** Every action mutates server data by definition. Server
  actions revalidate exactly as they do today (the core extraction moves the
  body, never the `revalidate` call). The MCP path revalidates nothing — it has
  no Next.js cache to invalidate — and the web client picks changes up through
  the existing Realtime subscriptions on `boards`, `groups`, `columns`,
  `items` and `cell_values`.
- **Bounded, indexed reads.** Every new scope resolver is a single
  `select <fk> … eq("id", …) maybeSingle()` on a primary key. Batch creates are
  capped at 50 entries and issue one insert per entry, bounded by that cap.
  `manage_group{reorder}` and `manage_column{reorder}` use the existing
  `midpoint` positioning — a single indexed read of the neighbour, never a
  renumbering sweep. `describe_schema` reads nothing.
- **The one N-query to avoid.** A batch create must not resolve the board once
  per entry. The board is resolved **once**, before the loop, and the
  `org_id` it yields is reused for every insert — the same shape
  `createColumn` already uses for a single column.

## 13. Testing

Per tool, three layers:

1. **Unit, over the existing `mcp-fake-client.ts`.** Every action, its happy
   path and its refusal. The discriminated union's rejection of a malformed
   action is asserted once per tool.
2. **`*.rls.integration.test.ts`.** For each new write path, a second org's
   user is refused. These skip unless `PULSE_TEST_DB` is set, per the standing
   pattern, and run against DEV.
3. **Anti-drift.** `describe_schema` (§11), plus a descriptor-level suite
   asserting that every action in every union has an entry in that tool's
   capability map and scope map — a new action without a capability is caught
   at test time, not by an ungated write in production.

Three cross-cutting tests carry the most weight and belong to no single tool:

- **`capabilityFor` fails closed** on an action absent from the map, returning
  the most restrictive capability rather than `null`.
- **A non-owner MCP archive is refused** with the owner-only message (§7).
- **`proposal-summary` has a branch for every action.** The test enumerates
  actions from the descriptors and asserts none falls through to `Run <tool>.`

## 14. Independent units (for the plan's execution DAG)

**Wave 1 — the contract. Blocking; nothing else can start.**
`descriptor.ts` (widened fields, `capabilityFor`, `scopeFor`), the new
`TOOL_SCOPES` members and their resolvers, `capabilities.ts` +
`CAPABILITY_COPY`, `toToolResult`, `getBoardAccessCore`, the
`unscopedCreateActions` refusal in `buildAgentTools`, and `describe_schema`.
One agent. Every other wave consumes these interfaces.

**Wave 2 — five independent units, no shared state, one worktree each.**

| Unit | Produces                                                         |
| ---- | ---------------------------------------------------------------- |
| A    | `core/board.ts`, `core/group.ts`, `manage_board`, `manage_group` |
| B    | `core/column.ts`, `manage_column`                                |
| C    | `core/item.ts`, `manage_item`, `create_item` batch form          |
| D    | `core/view.ts`, `manage_view`, `manage_automation` (agent-only)  |
| E    | `dashboards/goals/portfolios/reports` cores + their four tools   |

Each unit owns its cores, its descriptor, its tests, and its own branches in
`proposal-summary.ts`. The units touch disjoint files with one exception:
every unit appends a line to `catalog.ts`. That is a trivial conflict, and the
orchestrator serializes merges — the standing rule for parallel worktree
batches.

**Wave 3 — integration.** `proposal-targets.ts` new kinds,
`mcp-tools-table.tsx` map-aware classification, the `CapabilityToggles` and
`OrgAgentCeiling` copy, the three cross-cutting tests from §13, and an
end-to-end test that builds a board from nothing through the tool surface.

Critical path is three waves. Wave 2 is the wall-clock floor.

## 15. Risks

- **`task/agents-page` is in flight** and its plan touches `AgentEditor`, where
  Wave 3 adds the two capability checkboxes. Landing agents-page first avoids
  rebasing Wave 3 onto a moving target. If they must overlap, Wave 3's editor
  work is the piece to serialize.
- **`proposal-summary.ts` is the largest and least interesting block** (~50
  branches) and is the most likely thing to be under-done under time pressure.
  Its anti-drift test (§13) is what stops that.
- **The union-inside-`invoke` deviation** (§1) means malformed input surfaces
  as a tool failure rather than an SDK validation error. Both reach the model
  as a failure it can act on, but the shapes differ, and a reviewer expecting
  the SDK's shape should not read this as a bug.
