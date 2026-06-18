# Board Templates — design spec

**Date:** 2026-06-18
**Phase:** 8 (Dashboards + templates + ⌘K polish) — templates slice
**Status:** approved, ready for plan
**Related:** master spec `2026-06-14-pulse-design.md` §7 (phase 8); donor reuse map
`vault/decisions/2026-06-16-decision-08-dark-first-monday-reskin.md`

## 1. Goal & scope

Let a user create a new board pre-populated from a **built-in catalog** of templates, instead of
only the bare Group-1 + Status/Owner/Date board that `create_board` seeds today.

**In scope (MVP):**

- A fixed, code-defined catalog of four templates: **Blank**, **Sprint planning**, **Content
  calendar**, **Sales CRM** (ported from the donor prototype's `lib/templates.ts`).
- Each template seeds its **columns + groups + a few illustrative example items** (Monday-style;
  the user edits/deletes the samples).
- A template **picker** in the sidebar "New board" flow.

**Explicitly out of scope (deferred):**

- User **save-as-template** / custom org-scoped templates (would need a new table + RLS + capture
  logic). Not now.
- Exposing templates through the ⌘K command palette — that lands in the **next** Phase-8 slice
  (⌘K polish).
- Any new column kind. Pulse has six kinds and we map the donor's extras down (see §3).

## 2. Architecture & data flow

```
Catalog (static TS)  ──drives──▶  Template picker (client, 0 fetch)
src/lib/boards/templates.ts          (cards in the New-board dialog)
        │                                    │ user picks a template + names it
        │                                    ▼
        └──────────────────────▶  createBoardFromTemplate (Server Action)
                                   · Zod-validates input
                                   · resolves date offsets → concrete ISO dates
                                             │  one round-trip
                                             ▼
                                   create_board_from_template RPC
                                   (security definer · membership-checked · atomic)
                                   seeds board → groups → columns → items → cell_values
                                              → Main Table view
                                             │ returns the board row
                                             ▼
                                   router.push(/boards/:id)   ← new server data, RSC load (expected)
```

**Single source of truth:** the TS catalog drives _both_ the picker cards (icon/name/description)
and the seed payload. Adding or editing a template = editing one TS object.

## 3. Catalog — `src/lib/boards/templates.ts`

Typed, static module. Templates are **structural**: they use **local string refs**, not uuids — the
RPC mints the real uuids at seed time (see §5). Shape (illustrative):

```ts
type TemplateOption = { ref: string; label: string; color: string };
type TemplateColumn = {
  ref: string; // local, e.g. "c_status"
  kind: ColumnKind; // one of Pulse's six kinds
  name: string;
  options?: TemplateOption[]; // status / dropdown only
  settings?: { unit?: string; precision?: number }; // numbers only
};
type TemplateGroup = { ref: string; name: string; color: string };
type TemplateCellValue =
  | { optionRef: string } // status  -> resolves to {optionId}
  | { optionRefs: string[] } // dropdown -> resolves to {optionIds}
  | { dateOffset: number; endOffset?: number } // date -> {date, end?} ISO from today
  | { n: number } // numbers -> {n}
  | { text: string }; // text    -> {text}
type TemplateItem = {
  groupRef: string;
  name: string;
  cells: Record<string /* columnRef */, TemplateCellValue>;
};
type BoardTemplate = {
  id: string;
  name: string;
  icon: string;
  description: string;
  columns: TemplateColumn[];
  groups: TemplateGroup[];
  items: TemplateItem[];
};

export const BOARD_TEMPLATES: BoardTemplate[] = [
  /* … */
];
```

### Kind mapping (donor → Pulse's six kinds)

Pulse kinds: `text, status, people, date, numbers, dropdown`. The donor uses four kinds Pulse does
not have; map them:

| Donor kind | Pulse kind | Notes                                               |
| ---------- | ---------- | --------------------------------------------------- |
| `progress` | `numbers`  | `settings.unit = '%'`                               |
| `timeline` | `date`     | uses the date value's optional `end` → a date range |
| `link`     | `text`     | plain text URL                                      |
| `priority` | `status`   | options Hot / Warm / Cold                           |

### The four templates

- **Blank** — Group 1 + Status / Owner(people) / Date. No items. (Behaviourally identical to today's
  `create_board`, but routed through the new path so there is one code route.)
- **Sprint planning** — groups Backlog / In Sprint / Done · columns Status, Owner(people),
  Points(numbers), Progress(numbers `%`), Sprint(date range) · 4 sample items.
- **Content calendar** — groups Ideas / In Progress / Published · columns Stage(status),
  Writer(people), Channel(dropdown), Publish(date), Draft(text) · 4 sample items.
- **Sales CRM** — groups Leads / In Play / Closed · columns Stage(status), Rep(people), Deal
  size(numbers `$`), Priority(status: Hot/Warm/Cold), Close date(date) · 4 sample items.

### Date & people handling

- **Date cells store offsets from today** (`{ dateOffset, endOffset? }`). The Server Action resolves
  them to concrete ISO dates at call time, so sample dates always look current relative to creation.
- **People cells seed empty** (`userIds: []`) — we cannot guess org members. The donor's
  owner/rep/writer assignments are dropped; the People column is still created.

## 4. Server Action — `createBoardFromTemplate`

In `src/lib/boards/actions.ts`, alongside `createBoard`. Signature:

```ts
createBoardFromTemplate(input: { workspaceId: string; templateId: string; name: string })
  : Promise<ActionResult<{ boardId: string }>>
```

Steps:

1. Zod-validate input (`workspaceId` uuid, `templateId` ∈ catalog ids, `name` non-empty/trimmed).
2. Look up the template in `BOARD_TEMPLATES`; unknown id → fail.
3. Resolve each date cell's offsets to ISO (`today + offset`) and assemble the structural jsonb
   payload (columns/groups/items with their local refs intact).
4. Call `supabase.rpc("create_board_from_template", { p_workspace_id, p_name, p_template })`.
5. On success `revalidatePath("/", "layout")` (sidebar) and return `{ boardId }`.

Trust note: the template structure is code-defined, but the action still validates its own input and
the RPC is the real security boundary (membership check + org derivation).

## 5. RPC — `create_board_from_template`

New versioned migration in `supabase/migrations/`. Mirrors `create_board`:

- `returns public.boards language plpgsql security definer set search_path = ''`.
- Auth check (`auth.uid()` not null → else `42501`); derive `org_id` from the workspace; `42501` if
  not `is_org_member`; `P0002` if the workspace is missing.
- **Atomic** (a function body is one transaction): seed in order
  1. `boards` row (org-scoped, `created_by = auth.uid()`),
  2. `groups` — mint a uuid per group, keep a local-ref → uuid map,
  3. `columns` — mint a uuid per column (with `settings` passed through), keep a ref → uuid map,
  4. `items` — mint a uuid per item, resolve `groupRef` via the group map,
  5. `cell_values` — resolve `columnRef` via the column map; `value` jsonb is passed through
     already kind-shaped by the action (status `{optionId}`, dropdown `{optionIds}`, date
     `{date,end?}`, numbers `{n}`, text `{text}`),
  6. `board_views` — one Main Table view (matching `create_board`).
- `return` the new board row.

`create_board` remains untouched (still used by tests and as the plain RPC); the UI moves to the new
function, with Blank routed through it.

Post-migration: `pnpm db:types` and commit the regenerated `database.types.ts` in the same PR; run
advisors (pin `search_path`, as the dashboards functions do).

## 6. Picker UI

The sidebar "New board" dialog (`src/components/boards/BoardsNav.tsx`) grows from a name-only form
into a small **gallery**:

- A grid of **template cards** — icon, name, one-line description — sourced from `BOARD_TEMPLATES`.
- **Blank** is selected by default; selecting a card highlights it.
- A **name** field, pre-filled with the selected template's name, editable.
- "Create board" → `createBoardFromTemplate({ workspaceId, templateId, name })`, then
  `router.push(/boards/:id)` + `router.refresh()` (same as today's flow).

Selecting/browsing templates is pure client state — **no server round-trips** until "Create board".
Built with the **pulse-ui** and **frontend-design** skills (mandatory for UI work).

## 7. Testing

- **Catalog integrity** (unit, `templates.test.ts`): every item's `groupRef` resolves to a defined
  group; every cell's `columnRef` resolves to a defined column; every `optionRef`/`optionRefs`
  resolves to an option on that column; cell value shape matches the column kind; all kinds are valid
  Pulse kinds.
- **Server Action** (unit, in `actions.test.ts`): input validation; unknown `templateId` fails; date
  offsets resolve to ISO; the assembled payload is well-formed.
- **Integration (live RLS)**: a member calling the RPC gets a fully-seeded board (correct groups,
  columns, items, cell values, and a Main Table view); a cross-org/non-member call is denied with
  `42501`.
- **Component** (picker): renders a card per template, defaults to Blank, selecting a card + submit
  calls the action with the chosen `templateId` and name.
- **e2e**: create from "Sprint planning" → land on the new board → see the three groups, five
  columns, and the sample rows.

Gate before "done": `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus the live RLS
integration and e2e above, and advisors clean.

## 8. Risks & open notes

- **Local-ref → uuid mapping in plpgsql** is the trickiest part of the RPC; keep templates small
  (≤5 columns, ≤3 groups, ≤4 items) so the mapping stays simple. The plan should nail the exact SQL.
- **People assignments dropped** — acceptable for MVP; revisit if/when we add member-aware seeding.
- **`create_board` duplication** — two RPCs now seed boards. Accepted to avoid touching the
  battle-tested `create_board`; if Blank-via-new-path proves stable we can later retire the old one.
- Sample-item **dates** drift only at creation time (offsets resolved once); that is intended.
