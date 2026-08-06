# Expandable text cell editor with Markdown formatting — design

**Date:** 2026-08-06
**Status:** Approved, ready for planning
**Scope:** The `text` column kind only. No new column kind, no migration, no schema version bump.

## 1. Problem

The `text` column is the only free-form column Pulse has, and it is editable through a single-line
`<Input>`:

```tsx
// src/components/boards/cells/editors/index.tsx:109
export function TextEditor({ value, onCommit, onCancel }: EditorProps<{ text: string }>) {
  const [text, setText] = useState(value?.text ?? "");
  const onKey = useCommitKeys(() => onCommit({ text }), onCancel);
  return <Input autoFocus value={text} … className="h-8" />;
}
```

Two consequences make the column unusable for anything longer than a few words:

1. **You cannot see what you are writing.** The editor is `h-8` and column-width. A paragraph is a
   single scrolling line.
2. **You cannot write a paragraph at all.** `useCommitKeys` (`editors/index.tsx:55`) binds `Enter`
   to commit, so there is no way to enter a line break. The stored value is structurally
   single-line.

The column is documented and used as the place for descriptions, notes and context. It should
support paragraphs, and it should support light formatting.

## 2. Approach

**Clicking a text cell opens a floating panel anchored over the cell**, large enough to write in
and free to overlap neighbouring cells. It has a Write/Preview tab pair, an autosizing textarea,
and a formatting toolbar. Closing it saves. The panel is transient — there is no discard path.

**Formatting is Markdown stored in the existing `text` string.** The toolbar inserts syntax
(`**bold**`, `- item`); the Preview tab renders it.

### 2.1 Why Markdown in the same field

`textValueSchema` is `z.object({ text: z.string() })` (`src/lib/validations/boards.ts:144`), and
eight modules read that string as plain text:

| Module                                     | Use                                     |
| ------------------------------------------ | --------------------------------------- |
| `src/lib/boards/board-filter.ts`           | contains / equals / is-empty / sort key |
| `src/lib/boards/spreadsheet/cell-codec.ts` | clipboard copy-paste                    |
| `src/lib/ai/embeddings/index-actions.ts`   | semantic search indexing                |
| `src/lib/ai/column-fill/actions.ts`        | AI column fill                          |
| `src/lib/ai/item-assist/actions.ts`        | item assist context                     |
| `src/lib/dashboards/list-rows.ts`          | dashboard list widget                   |
| `src/lib/reports/shape.ts`                 | report blocks                           |
| `src/lib/boards/templates.ts`              | template payloads                       |

Markdown is plain text. `**Q3 goals**\n- ship billing` filters, sorts, embeds, exports and pastes
correctly with **zero changes to any of these**. A structured document (HTML or a ProseMirror JSON
doc) would require a second stored field, a migration, a derived plain-text mirror, and an edit to
all eight call sites. That cost buys nothing the user asked for.

### 2.2 Storage

Unchanged shape, one added bound:

```ts
export const textValueSchema = z.object({ text: z.string().max(20_000) });
```

A paragraph editor invites large pastes into a `jsonb` column. 20,000 characters is far above any
legitimate cell and far below anything that would strain the row. The editor surfaces a character
counter as the value approaches the cap, so the bound is visible before it is enforced.

## 3. Components

### 3.1 `src/lib/boards/markdown.ts` — the pure core

No React. This module holds everything worth testing exhaustively.

```ts
/** Strip Markdown marks and flatten to one line, for the collapsed cell. */
export function stripMarkdown(md: string): string;

/** Every toolbar button and keyboard shortcut is one call to this. */
export function applyMarkdown(
  text: string,
  selStart: number,
  selEnd: number,
  action: MarkdownAction,
): { text: string; selStart: number; selEnd: number };

/** Block/inline AST for the preview renderer. */
export function parseMarkdown(md: string): Block[];
```

`stripMarkdown` takes a **fast path**: when the input contains no Markdown metacharacter it is
returned unchanged, so the common short-text case costs one regex test per cell render.

`applyMarkdown` must handle four cases per action, and each is a test:

- **wrap** — selection gains surrounding marks
- **unwrap** — pressing **B** on already-bold text removes the marks (idempotent toggle)
- **line prefix** — `- `, `1. `, `> `, `### ` applied across every line of a multi-line selection
- **empty selection** — marks inserted, caret placed between them

The supported action set is closed: `bold`, `italic`, `strikethrough`, `heading`, `bulletList`,
`numberedList`, `link`, `inlineCode`, `quote`.

### 3.2 `MarkdownPreview` — the renderer

Renders `parseMarkdown`'s AST to React elements. **No `dangerouslySetInnerHTML` anywhere**, which
makes the HTML-injection surface structurally zero rather than sanitized-away. Link `href`s pass
through the existing `isHttpUrl` guard (`src/lib/validations/boards.ts`) — a `javascript:` URL
renders as inert text, not an anchor.

#### Why in-house rather than `react-markdown`

Considered and rejected: `react-markdown` + `remark-gfm` (~40KB gzipped). The supported subset is
fixed and small, an in-house renderer emits React elements so there is no injection path at all,
and `isHttpUrl` already exists for link safety. Adding a dependency for nine formatting marks is
disproportionate in a codebase whose working agreement is "grep before writing a helper."

The honest counter-argument is that hand-rolled Markdown parsers get nested emphasis, escaping and
list continuation subtly wrong. The mitigation is that `parseMarkdown` is pure, its subset is
closed, and it gets table-driven fixture tests including adversarial inputs. **If the parser proves
troublesome during implementation, swapping in `react-markdown` is a contained change** — it
replaces `parseMarkdown` + `MarkdownPreview` and touches nothing else, because `stripMarkdown` and
`applyMarkdown` are independent of it.

### 3.3 `LongTextEditor` — the panel

Radix `Popover` + `PopoverAnchor` pinned to the cell — the same pattern `PopoverSurface`
(`editors/index.tsx:77`) already uses for Status/People/Dropdown. That inheritance matters: it
portals to `document.body`, escaping the board's nested `overflow-auto` scroll containers, and
flips/shifts near viewport edges so the panel is never clipped at the bottom or right of the board.

Sizing: `w-[min(36rem,var(--radix-popover-content-available-width))]`, textarea `min-h-[12rem]`,
autosizing up to `var(--radix-popover-content-available-height)`. It overlaps neighbouring cells by
design.

Layout, top to bottom: column name + `Write | Preview` tabs + close button · textarea or preview ·
toolbar row (**B** · _I_ · ~~S~~ · H · • · 1. · link · code · quote).

**Keyboard and save semantics** — every exit path commits; there is no way to lose work:

| Input                        | Result                  |
| ---------------------------- | ----------------------- |
| `Enter`                      | newline (never commits) |
| `Esc`                        | save + close            |
| `⌘/Ctrl+Enter`               | save + close            |
| outside click / close button | save + close            |
| `⌘/Ctrl+B`, `⌘/Ctrl+I`       | bold / italic           |

`Esc` saving is a **deliberate departure** from `useCommitKeys`, where `Esc` discards. In a
single-line input a discarded value is a word; in a paragraph editor it is the user's work. The
asymmetry is the point, and it is why `LongTextEditor` does not reuse `useCommitKeys`.

### 3.4 `TextCell` — the collapsed cell

```tsx
// src/components/boards/cells/index.tsx:14 — currently renders value.text raw
<span className="truncate text-sm">{stripMarkdown(value?.text ?? "")}</span>
```

`TextCell` is the single renderer behind the table, Kanban cards, the Calendar agenda, Mirror cells
and Rollup cells, so this one change makes Markdown read cleanly on all five surfaces.

## 4. Non-goals

- **Table rows do not grow to fit paragraphs.** Row height stays fixed; the panel is where long
  text is read and written. This keeps table layout and scrolling behaviour unchanged.
- **The item panel and Kanban stay read-only for text.** `CellEditor` has exactly one mount point
  (`src/components/boards/table/EditableCell.tsx:174`) and keeps it.
- **No new `long_text` column kind.** The existing `text` kind is upgraded in place, so every text
  column that already exists gains this on ship.

## 5. Performance & data-fetching budget

Per working agreement #5:

| Interaction                                   | Server round-trips                                                 |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Open the panel                                | **0** — the value is already in the board cache                    |
| Type / toggle Write↔Preview / use the toolbar | **0** — local component state                                      |
| Close (save)                                  | **1** — the existing `setCell` optimistic Server Action, unchanged |

Nothing here changes server data shape, so no revalidation changes are needed. The panel does not
alter URL state, so the `<Link>`/router refetch trap (gotcha-09) does not apply.

The one new per-render cost is `stripMarkdown` on every visible text cell. It is O(n) over short
strings with a metacharacter fast path, and `EditableCell` is already `memo`'d, so it does not
regress board render. Reads remain bounded by the existing board query — this feature adds no
query.

## 6. Testing

| File                                                          | Covers                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/markdown.test.ts`                             | `stripMarkdown` cases incl. fast path; `applyMarkdown` selection math for all four cases × nine actions; `parseMarkdown` fixtures incl. `javascript:` links and nested emphasis |
| `src/components/boards/cells/editors/LongTextEditor.test.tsx` | opens on cell click; `Enter` inserts a newline; toolbar wraps and unwraps a selection; Preview renders; all four save paths commit                                              |
| `src/components/boards/cells/editors/editors.test.tsx`        | **existing** — currently asserts single-line `TextEditor` behaviour; updated                                                                                                    |
| `src/components/boards/cells/cells.test.tsx`                  | **existing** — updated for `TextCell` stripping                                                                                                                                 |

The two existing suites will fail until updated. That failure is the signal that the swap is
complete, not an accident.

## 7. Execution DAG

Per working agreement #6.

```
Task 1  markdown.ts + tests                        (no deps)
   │
   ├── Task 2  MarkdownPreview                     (needs 1)
   └── Task 4  TextCell strip + textValueSchema cap (needs 1)
          │
       Task 3  LongTextEditor                      (needs 1, 2)
          │
       Task 5  Wire into CellEditor / EditableCell (needs 3)
```

**Dependency edges:** 2←1 · 4←1 · 3←{1,2} · 5←3

**Parallel batches:** `[1]` → `[2, 4]` → `[3]` → `[5]`

**Critical path:** 1 → 2 → 3 → 5 (four waves). Task 4 is free parallelism against the batch-2 slot
and never gates anything downstream.

## 8. How to test (manual acceptance)

1. Pull `develop` and open any board with a text column (add one via **+** → **Text** if needed).
2. Click a text cell. A panel opens over the cell, wider and taller than the column.
3. Type two paragraphs, pressing `Enter` between them. The text does **not** commit on `Enter`.
4. Select a word, click **B**. It becomes `**word**`. Click **B** again — the marks are removed.
5. Switch to **Preview**. The bold word renders bold and `- ` lines render as bullets.
6. Press `Esc`. The panel closes and the text is **saved** — reopen the cell to confirm.
7. The collapsed cell shows the text on one line with no `**` or `-` characters visible.
8. Filter the board on that column with a word from the middle of the paragraph — it matches.
