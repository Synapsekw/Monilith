# Folder Command Center Layouts — Design

**Date:** 2026-09-24
**Status:** Approved (spec 1 of 3)
**Supersedes nothing.** Extends the Folder Command Center shipped 2026-09-15 (`d0aa29ae`).

## 1. Problem

Every folder renders the same hard-coded command center: six fixed KPI cards
(Complete, Gap to plan, Overdue, Due this week, Blocked, Stale), a planned-vs-completed
burn chart, Status by board, Needs attention, Intelligence, Next milestones, and the
fixed tab strip Overview · Stages · Boards · People.

That shape is project-management-shaped. On a CRM folder it is wrong: "Gap to plan" and
"Next milestones" are meaningless for a sales pipeline, and the metrics a CRM needs —
pipeline value (sum of a currency column), deals per stage, win rate — cannot be
expressed at all, because the KPI catalogue is a closed set of item-status counts.

Only the folded-in dashboards below the fold (`YourWidgets`, the AI wizard, six widget
kinds) are configurable today.

## 2. Goal

A folder's command center is configurable per folder — which panels appear, in what
order, what the KPI row measures, and which tabs exist — editable manually, and later
proposable by AI. An untouched folder must render exactly as it does today.

## 3. Chosen approach

The Overview tab becomes a canvas. The six existing panels are re-expressed as
**folder-native section types** fed by the existing folder RPCs (cheap, folder-wide,
already tested), and they sit in the same grid as ordinary dashboard widgets bound to the
folder's boards. One drag model, one config schema, one future AI generator.

Rejected alternatives:

- **Config-driven built-ins only** (toggle/reorder the six panels, nothing else). Ships
  fastest, but leaves the CRM case unsolved — the metric catalogue stays closed.
- **Two zones** (fixed panels on top, free canvas below). Cheap and safe, but the
  complaint is precisely that the _top_ is wrong on a CRM folder.

The work is decomposed into three specs. This document is spec 1.

| Spec     | Scope                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 1 (this) | Layout table + config schema + presets + read path + manual editing of built-in sections + config-driven tabs |
| 2        | Folder-scoped widget sections; cross-board metrics                                                            |
| 3        | AI proposes a layout; user reviews and applies                                                                |

## 4. Data model

```sql
create table public.folder_layouts (
  folder_id  uuid primary key references public.folders(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  preset     text not null default 'project',   -- provenance of the seed
  config     jsonb not null,
  version    integer not null default 1,        -- optimistic-concurrency token
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint folder_layouts_config_size check (pg_column_size(config) <= 32768)
);
```

The primary key is `folder_id`: one layout per folder.

RLS mirrors `public.folders` exactly — read when `org_id in (select public.auth_user_orgs())`,
insert/update/delete when `public.is_org_member(org_id)` and the referenced folder belongs
to that org. This is a plain table read; no SECURITY DEFINER RPC is required.

**Absence is meaningful.** No row means the `project` preset, which is today's layout
byte-for-byte. There is no backfill migration and no change to any existing folder until
someone customizes it.

The migration is minted with `scripts/new-migration.sh`, applied to DEV through the
`supabase-dev` MCP with the same version and name, and verified with `pnpm db:ledger-check`.
Types are regenerated and committed in the same change.

### 4.1 Config schema

Validated by Zod in `src/lib/validations/folder-layout.ts`:

```ts
{
  v: 1,
  tabs: [                                   // at most 6
    {
      id: string,                           // slug, unique within the config
      label: string,                        // 1..24 chars
      kind: "canvas" | "stages" | "boards" | "people",
      sections?: Section[]                  // canvas tabs only, at most 24
    }
  ]
}

type Section =
  | { id, type: "builtin",
      panel: "kpis" | "burn" | "boardStatus" | "attention" | "intelligence" | "milestones",
      title?: string,
      props?: Record<string, unknown>,      // kpis: { cards: KpiKey[] }, ordered, at most 6
      layout: { x, y, w, h } }
  | { id, type: "widget", widgetId: uuid, layout }
```

Grid rects use the same 12-column `GridRect` math as `DashboardCanvas` (react-grid-layout
v2), so spec 2's widget sections drop into the same grid without a layout migration.

The `widget` branch ships in the schema in spec 1 even though nothing writes it yet. This
avoids a config version bump between phases.

`KpiKey` in spec 1 is the existing closed set: `complete | gap | overdue | dueThisWeek |
blocked | stale`. Column-derived metrics arrive in spec 2 as widget sections, not as new
KPI keys.

**A malformed config must never fail the page.** A config that fails Zod is logged
server-side and the folder falls back to its preset — the same degradation posture the
folder RPC panels already use for a failed read.

### 4.2 Presets

Presets live in code (`src/lib/folders/presets.ts`), not in the database. Seeding a folder
means copying the preset object into `config` on first save.

| Preset    | Shape                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project` | Today's layout exactly: six KPI cards, burn, status by board, attention, intelligence, milestones; tabs Overview · Stages · Boards · People                      |
| `crm`     | KPIs Complete / Overdue / Due this week; attention, status by board, intelligence; no burn, no milestones; tabs Overview · Pipeline (`stages`, renamed) · Boards |
| `support` | KPIs Overdue / Due this week / Blocked / Stale; attention, status by board; no burn, no milestones                                                               |
| `blank`   | One empty canvas tab plus Boards                                                                                                                                 |

## 5. Read path and performance budget

`buildFolderPayload` keeps its two-wave shape; one read moves between waves.

- **Wave A** (parallel, as today): `getFolderHead`, `folder_rollup`, `folder_attention`,
  and the new `folder_layouts` primary-key read.
- **Wave B** (parallel, already exists for briefs and members): briefs, members, and
  `folder_burn` — now conditional on the resolved layout.

A project folder pays nothing extra: `folder_burn` runs in parallel with the briefs read,
which already waited on the head read.

**The burn gate has two consumers, not one.** `folder_burn` feeds both the Overview burn
section and the Stages tab's own chart (`src/components/folders/tabs/Stages.tsx:70`). The
RPC is skipped only when the resolved layout has **no `burn` section in any canvas tab and
no tab of kind `stages`**. Gating on the section alone would leave a folder that kept its
stages tab rendering a permanently failed chart.

`resolveLayout(row): FolderLayout` is a pure function — absent row, invalid JSON, partial
config, and unknown panel keys all resolve to a valid layout — and is unit-tested without
a database.

**In-page budget (working agreement #5).** Tab, stage and board selection remain client
state mirrored into the URL with `history.replaceState`: zero server round-trips. Edit
mode is client state too (`?edit=1`, replaceState); dragging, hiding, reordering and
renaming mutate local draft state only. Nothing reaches the server until Save.

**The one mutation.** `saveFolderLayout` is a Server Action taking the whole config; it
validates with Zod, writes the row, calls `updateTag(foldersTag(orgId))`, and the client
calls `router.refresh()`. It returns `ActionResult` from `src/lib/actions/result.ts`.
Concurrency is last-write-wins guarded by `version`: a stale version returns
"This layout changed — reload" instead of silently clobbering another member's edit.

**Bounds.** The hot-path read is a primary-key lookup on an indexed column over a jsonb
value capped at 32 KB by both Zod and a database CHECK; at most 6 tabs and 24 sections per
tab.

## 6. Editing surface

`HeaderActions`' overflow menu gains **Customize**, which sets `?edit=1` and swaps the
Overview canvas into edit mode.

- Each section gains a drag handle, a hide toggle, and inline title rename, using the same
  react-grid-layout v2 grid as `DashboardCanvas`.
- A **Sections** side sheet lists hidden sections with Add-back buttons. This is also how
  a user discovers panels their preset left out.
- The KPI section opens a drag-ordered checkbox list of the six metric keys, at most six
  selected.
- A sticky footer offers `Reset to preset ▾` (Project / CRM / Support / Blank), Cancel, and
  Save. Cancel discards draft state. Reset replaces the whole config; the only undo is
  picking another preset, which is accepted for spec 1.

Hidden panels are simply not rendered. Empty states and the inline Retry on a failed RPC
panel carry over unchanged.

**Permissions.** Any org member can customize, matching `folders` RLS. A folder is a
shared object, so one member's edit changes the folder for everyone in the org.

Visual styling is settled at build time through the `pulse-ui` and `frontend-design`
skills (working agreement #3). This spec fixes behaviour, not pixels.

## 7. Tabs

`TabStrip`'s hard-coded `TABS` array becomes a render of `config.tabs`. In edit mode a tab
can be renamed, hidden, reordered, or added (canvas kind only in spec 1). The `stages`,
`boards` and `people` tabs are singleton built-ins: they can be hidden but not duplicated.
Per-tab counts keep their current wiring, selected by tab kind.

**URL contract.** `?tab=` now carries a tab id from the config rather than a fixed enum.
`commandTabSchema` becomes "a known slug or any tab id present in this folder's config",
and an unknown id falls back to the first tab. Existing deep links keep working because
the preset tab ids are exactly the current slugs (`overview`, `stages`, `boards`, `people`).

## 8. Testing

Written and executed before the feature is considered done (working agreement #4).

**Unit.** `resolveLayout` across absent row, invalid JSON, partial config and unknown panel
keys; every preset object; Zod bounds (tab count, section count, label length, KPI count,
32 KB cap); draft reducers for hide, reorder, rename and reset; payload pruning — assert
`folder_burn` is _not_ called when the layout has neither a burn section nor a `stages`
tab, and _is_ called when it has either one alone.

**Component.** `CommandCenter` rendered from a CRM config shows no burn and no milestones
and labels the stages tab "Pipeline"; edit-mode interactions (hide, reorder, rename, KPI
selection, cancel, save); a no-refetch test asserting `router.push` and `router.refresh`
are never called for tab, stage, board, hide or drag interactions — the precedent is
`src/components/folders/command-center-state.test.tsx`.

**Integration (RLS).** `folder_layouts` cross-tenant read and write denial, member read and
write, and cascade on folder delete, mirroring
`src/lib/folders/folders.rls.integration.test.ts`.

**Regression proof.** The existing folder test suite stays green with no test edits for a
default folder. If an existing test has to change, a default folder's render changed, and
that is a bug in the change rather than in the test.

All four gates must pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## 9. Units of work (input to the plan's execution DAG)

These are the independent pieces; the implementation plan turns them into batches.

- **(a) Migration** — `folder_layouts` table, RLS policies, grants, regenerated types.
- **(b) Schema and presets** — Zod config schema, preset objects, `resolveLayout`. Pure;
  no dependency on (a).
- **(c) Payload wiring** — layout read in wave A, conditional `folder_burn` in wave B,
  `FolderPayload.layout`. Depends on (a) and (b).
- **(d) Config-driven render** — `TabStrip` and the Overview canvas render from the
  resolved layout; URL tab contract. Depends on (b).
- **(e) Edit mode and save** — edit-mode UI, Sections sheet, KPI picker, footer,
  `saveFolderLayout` action with `version` guard. Depends on (a) and (d).

(b) and (a) can run concurrently; (c) and (d) can run concurrently once both land; (e) is
the critical path's tail.

## 10. Out of scope (deferred to specs 2 and 3)

- Folder-scoped widget sections and cross-board metrics. Spec 2 fans the existing
  single-board dashboard RPCs out per board server-side (capped at 25 boards) and merges
  buckets, rather than minting `p_board_ids uuid[]` variants of five SQL functions; columns
  are resolved by **name + kind** across the folder's boards, the same matching trick
  `buildStages` uses for groups.
- AI-proposed layouts. Spec 3 extends `src/lib/ai/proposal-schema.ts` to a multi-board
  snapshot and the tab/section config, with a preview and an explicit Apply.
- Org-level reusable layout templates. The per-folder row is deliberately independent; a
  later phase may promote a folder's layout into a template.
- Chat-style incremental AI edits to an existing layout.
