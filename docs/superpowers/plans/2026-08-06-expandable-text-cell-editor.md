# Expandable Text Cell Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a `text` cell opens a large panel anchored over that cell with Write/Preview tabs, an autosizing textarea, and a Markdown formatting toolbar — so text columns can hold real paragraphs.

**Architecture:** The stored value stays `{ text: string }`; formatting is Markdown living inside that same string, so the eight modules that read it as plain text need no changes. All parsing/transform logic lives in one pure module (`src/lib/boards/markdown.ts`) with no React, which is where the exhaustive tests go. Three thin React layers sit on top: a preview renderer, the panel, and a one-line swap in the `CellEditor` switch.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, `radix-ui` (unified package) Popover, Vitest + Testing Library, Zod.

**Spec:** [`docs/superpowers/specs/2026-08-06-expandable-text-cell-editor-design.md`](../specs/2026-08-06-expandable-text-cell-editor-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **This is UI work — load the `pulse-ui` skill before writing any component**, per working agreement #3. Monochrome chrome, single periwinkle accent, radius 14, brightening hairlines. Tasks 2, 3 and 5 are component work.
- **This is Next.js 16.** Confirm any framework API against `node_modules/next/dist/docs/` before using it. All files here are client-side (`"use client"`), so this mostly means: do not add Server Actions, do not touch `next/headers`.
- **TypeScript strict. No `any`.** If a cast is unavoidable, justify it in a comment.
- **No new npm dependencies.** The Markdown parser is in-house by decision (spec §3.2). Do not install `react-markdown`, `remark-*`, `marked`, `dompurify`, or a tabs library.
- **No `dangerouslySetInnerHTML` anywhere in this feature.** The preview emits React elements. This is what makes the XSS surface structurally zero, not merely sanitized.
- **Radix is imported from the unified package:** `import { Popover as PopoverPrimitive } from "radix-ui"` — but you should use the project wrappers in `@/components/ui/popover` (`Popover`, `PopoverContent`, `PopoverAnchor`), not the primitive directly.
- **Commit identity is pinned.** Every commit must be authored `Danijel Jovanovic <info@synapse-solutions.ai>`. `start-task.sh` sets this in the worktree; do not override it.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- **Run gates from inside the worktree:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Supported Markdown action set is closed** — exactly these nine, no others:
  `bold`, `italic`, `strikethrough`, `heading`, `bulletList`, `numberedList`, `link`, `inlineCode`, `quote`.
- **Text value cap is exactly `20_000` characters.**

---

## File Structure

| File                                                             | Responsibility                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/markdown.ts`                                     | **Create.** Pure core: `stripMarkdown`, `applyMarkdown`, `parseMarkdown`, and the `MarkdownAction` / `Block` / `Inline` types. No React import. |
| `src/lib/boards/markdown.test.ts`                                | **Create.** Exhaustive table-driven tests for the above.                                                                                        |
| `src/components/boards/cells/editors/MarkdownPreview.tsx`        | **Create.** Renders a `Block[]` to React elements. No state, no props beyond `blocks`.                                                          |
| `src/components/boards/cells/editors/MarkdownPreview.test.tsx`   | **Create.** Rendering + link-safety tests.                                                                                                      |
| `src/components/boards/cells/editors/LongTextEditor.tsx`         | **Create.** The anchored panel: tabs, textarea, toolbar, keyboard and save semantics.                                                           |
| `src/components/boards/cells/editors/LongTextEditor.test.tsx`    | **Create.** Behaviour tests.                                                                                                                    |
| `src/components/boards/cells/index.tsx:14-21`                    | **Modify.** `TextCell` renders `stripMarkdown(...)`.                                                                                            |
| `src/lib/validations/boards.ts:144`                              | **Modify.** `textValueSchema` gains `.max(20_000)`.                                                                                             |
| `src/components/boards/cells/editors/index.tsx:109-126, 660-668` | **Modify.** Delete `TextEditor`, route `case "text"` to `LongTextEditor`.                                                                       |
| `src/components/boards/table/EditableCell.tsx:174`               | **Modify.** Pass `columnName={column.name}` to `CellEditor`.                                                                                    |
| `src/lib/validations/boards.test.ts`                             | **Modify.** Add the `textValueSchema` cap tests.                                                                                                |
| `src/components/boards/cells/cells.test.tsx`                     | **Modify.** Existing `TextCell` assertions.                                                                                                     |
| `src/components/boards/cells/editors/editors.test.tsx`           | **Modify.** Delete the `TextEditor` describe block and its import.                                                                              |

---

## Execution DAG

```
Task 1  markdown.ts + tests                          (no deps)
   │
   ├── Task 2  MarkdownPreview                       (needs 1)
   └── Task 4  TextCell strip + textValueSchema cap   (needs 1)
          │
       Task 3  LongTextEditor                        (needs 1, 2)
          │
       Task 5  Wire into CellEditor                  (needs 3)
```

**Edges:** 2←1 · 4←1 · 3←{1,2} · 5←3
**Parallel batches:** `[1]` → `[2, 4]` → `[3]` → `[5]`
**Critical path:** 1 → 2 → 3 → 5 (four waves). Task 4 is free parallelism and gates nothing.

Tasks 2 and 4 touch disjoint files, so they can run as concurrent agents in the same worktree without conflict.

---

## Task 1: The pure Markdown core

**Files:**

- Create: `src/lib/boards/markdown.ts`
- Test: `src/lib/boards/markdown.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type MarkdownAction =
    | "bold"
    | "italic"
    | "strikethrough"
    | "heading"
    | "bulletList"
    | "numberedList"
    | "link"
    | "inlineCode"
    | "quote";

  export type Inline =
    | { type: "text"; value: string }
    | { type: "bold"; children: Inline[] }
    | { type: "italic"; children: Inline[] }
    | { type: "strikethrough"; children: Inline[] }
    | { type: "code"; value: string }
    | { type: "link"; href: string; children: Inline[] };

  export type Block =
    | { type: "paragraph"; children: Inline[] }
    | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
    | { type: "quote"; children: Inline[] }
    | { type: "bulletList"; items: Inline[][] }
    | { type: "numberedList"; items: Inline[][] };

  export type Selection = { text: string; selStart: number; selEnd: number };

  export function stripMarkdown(md: string): string;
  export function applyMarkdown(
    text: string,
    selStart: number,
    selEnd: number,
    action: MarkdownAction,
  ): Selection;
  export function parseMarkdown(md: string): Block[];
  ```

### Design notes for the implementer

Three independent functions. Do not try to build `stripMarkdown` on top of `parseMarkdown` — `stripMarkdown` runs on every visible text cell on every board render and must stay a cheap regex pass with an early-out.

`applyMarkdown` splits by action shape:

- **Wrap actions** (`bold` `**`, `italic` `*`, `strikethrough` `~~`, `inlineCode` `` ` ``): if the selection is already surrounded by the marks, remove them (toggle); otherwise add them. Empty selection inserts both marks and puts the caret between them.
- **Line-prefix actions** (`heading` `### `, `bulletList` `- `, `numberedList` `1. `, `quote` `> `): expand the selection to whole lines, then toggle the prefix on every line in range. `numberedList` numbers sequentially from 1.
- **`link`**: produces `[selection](url)` with the caret selecting the literal `url` placeholder so the user types over it. Empty selection produces `[text](url)` with `text` selected.

`parseMarkdown` is line-based: group consecutive lines into blocks, then run one inline pass per block. Precedence for inline: code spans first (their contents are literal), then links, then `**`, then `~~`, then `*`.

**Link safety lives here, not in the renderer.** `parseMarkdown` must call `isHttpUrl` from `@/lib/validations/boards` and, when the href fails, emit the whole construct as `{ type: "text", value: "[label](href)" }` rather than a link node. That way no component can accidentally render an unsafe href.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/boards/markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyMarkdown, parseMarkdown, stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  it("returns plain text unchanged (fast path)", () => {
    expect(stripMarkdown("just some words")).toBe("just some words");
  });

  it("returns an empty string unchanged", () => {
    expect(stripMarkdown("")).toBe("");
  });

  it.each([
    ["**bold**", "bold"],
    ["*italic*", "italic"],
    ["~~struck~~", "struck"],
    ["`code`", "code"],
    ["### Heading", "Heading"],
    ["- item", "item"],
    ["1. item", "item"],
    ["> quoted", "quoted"],
    ["[label](https://x.com)", "label"],
    ["**bold** and *italic*", "bold and italic"],
  ])("strips %s", (input, expected) => {
    expect(stripMarkdown(input)).toBe(expected);
  });

  it("flattens newlines to single spaces", () => {
    expect(stripMarkdown("**Q3 goals**\n- ship billing\n- fix auth")).toBe(
      "Q3 goals ship billing fix auth",
    );
  });

  it("collapses runs of whitespace left behind by stripping", () => {
    expect(stripMarkdown("a\n\n\nb")).toBe("a b");
  });
});

describe("applyMarkdown — wrap actions", () => {
  it("wraps a selection in bold marks and keeps it selected", () => {
    // "hello world", selecting "world" (6..11)
    expect(applyMarkdown("hello world", 6, 11, "bold")).toEqual({
      text: "hello **world**",
      selStart: 8,
      selEnd: 13,
    });
  });

  it("unwraps an already-bold selection (toggle)", () => {
    expect(applyMarkdown("hello **world**", 8, 13, "bold")).toEqual({
      text: "hello world",
      selStart: 6,
      selEnd: 11,
    });
  });

  it("inserts marks and places the caret between them on an empty selection", () => {
    expect(applyMarkdown("hi ", 3, 3, "bold")).toEqual({
      text: "hi ****",
      selStart: 5,
      selEnd: 5,
    });
  });

  it("wraps with italic marks", () => {
    expect(applyMarkdown("ab", 0, 2, "italic")).toEqual({
      text: "*ab*",
      selStart: 1,
      selEnd: 3,
    });
  });

  it("wraps with strikethrough marks", () => {
    expect(applyMarkdown("ab", 0, 2, "strikethrough")).toEqual({
      text: "~~ab~~",
      selStart: 2,
      selEnd: 4,
    });
  });

  it("wraps with inline code marks", () => {
    expect(applyMarkdown("ab", 0, 2, "inlineCode")).toEqual({
      text: "`ab`",
      selStart: 1,
      selEnd: 3,
    });
  });
});

describe("applyMarkdown — line-prefix actions", () => {
  it("prefixes a single line with a bullet", () => {
    expect(applyMarkdown("one", 0, 3, "bulletList")).toEqual({
      text: "- one",
      selStart: 2,
      selEnd: 5,
    });
  });

  it("prefixes every line of a multi-line selection", () => {
    expect(applyMarkdown("one\ntwo", 0, 7, "bulletList").text).toBe(
      "- one\n- two",
    );
  });

  it("removes the prefix when every line already has it (toggle)", () => {
    expect(applyMarkdown("- one\n- two", 0, 11, "bulletList").text).toBe(
      "one\ntwo",
    );
  });

  it("numbers a numbered list sequentially from 1", () => {
    expect(applyMarkdown("a\nb\nc", 0, 5, "numberedList").text).toBe(
      "1. a\n2. b\n3. c",
    );
  });

  it("expands a mid-line caret to the whole line", () => {
    // caret sits inside "two" with no selection
    expect(applyMarkdown("one\ntwo", 5, 5, "quote").text).toBe("one\n> two");
  });

  it("prefixes with a heading", () => {
    expect(applyMarkdown("Title", 0, 5, "heading").text).toBe("### Title");
  });
});

describe("applyMarkdown — link", () => {
  it("wraps the selection as a link label and selects the url placeholder", () => {
    const r = applyMarkdown("see docs", 4, 8, "link");
    expect(r.text).toBe("see [docs](url)");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("url");
  });

  it("inserts a full template on an empty selection and selects the label", () => {
    const r = applyMarkdown("", 0, 0, "link");
    expect(r.text).toBe("[text](url)");
    expect(r.text.slice(r.selStart, r.selEnd)).toBe("text");
  });
});

describe("parseMarkdown", () => {
  it("parses a paragraph", () => {
    expect(parseMarkdown("hello")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "hello" }] },
    ]);
  });

  it("parses bold inside a paragraph", () => {
    expect(parseMarkdown("a **b** c")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "a " },
          { type: "bold", children: [{ type: "text", value: "b" }] },
          { type: "text", value: " c" },
        ],
      },
    ]);
  });

  it("parses heading levels", () => {
    expect(parseMarkdown("# A")[0]).toMatchObject({
      type: "heading",
      level: 1,
    });
    expect(parseMarkdown("## A")[0]).toMatchObject({
      type: "heading",
      level: 2,
    });
    expect(parseMarkdown("### A")[0]).toMatchObject({
      type: "heading",
      level: 3,
    });
  });

  it("groups consecutive bullet lines into one list block", () => {
    expect(parseMarkdown("- a\n- b")).toEqual([
      {
        type: "bulletList",
        items: [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
      },
    ]);
  });

  it("groups consecutive numbered lines into one list block", () => {
    expect(parseMarkdown("1. a\n2. b")[0]).toMatchObject({
      type: "numberedList",
    });
  });

  it("parses a quote block", () => {
    expect(parseMarkdown("> q")[0]).toMatchObject({ type: "quote" });
  });

  it("treats code span contents as literal, not markup", () => {
    expect(parseMarkdown("`**not bold**`")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "code", value: "**not bold**" }],
      },
    ]);
  });

  it("parses a safe http link", () => {
    expect(parseMarkdown("[x](https://example.com)")).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            href: "https://example.com",
            children: [{ type: "text", value: "x" }],
          },
        ],
      },
    ]);
  });

  it("refuses a javascript: url and emits it as literal text", () => {
    expect(parseMarkdown("[x](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "[x](javascript:alert(1))" }],
      },
    ]);
  });

  it("refuses a data: url and emits it as literal text", () => {
    const blocks = parseMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
    expect(blocks[0]).toMatchObject({ type: "paragraph" });
    expect(JSON.stringify(blocks)).not.toContain('"link"');
  });

  it("leaves an unmatched mark as literal text", () => {
    expect(parseMarkdown("a ** b")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "a ** b" }] },
    ]);
  });

  it("returns no blocks for an empty string", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  it("does not lose text when blocks change type", () => {
    const blocks = parseMarkdown("intro\n- a\noutro");
    expect(blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "bulletList",
      "paragraph",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/lib/boards/markdown.test.ts
```

Expected: FAIL — `Failed to resolve import "./markdown"`.

- [ ] **Step 3: Implement `src/lib/boards/markdown.ts`**

Write the module so every test above passes. Requirements the tests encode, restated so you do not have to reverse-engineer them:

- `stripMarkdown` early-returns the input when `!/[*_~`>\[\]#\n-]/.test(md)`, then otherwise: drops line prefixes (`#{1,3} `, `- `, `\d+\. `, `> `), unwraps `\*_`/`_`/`~~`/`` ` ``, reduces `[label](href)`to`label`, replaces `\n`with a space, collapses`\s+` to one space, and trims.
- `applyMarkdown` returns the **new** caret/selection offsets, not the old ones. The wrap-toggle check must look at the characters immediately outside the selection, so `applyMarkdown("hello **world**", 8, 13, "bold")` — where the selection is exactly `world` — detects the surrounding `**` and removes it.
- `parseMarkdown` calls `isHttpUrl` from `@/lib/validations/boards` for every link href and degrades a failing link to literal text.

Add a file-header comment stating that this module is pure, has no React import, and is the single place Markdown behaviour is defined — and that `stripMarkdown` runs per visible cell so its fast path must be preserved.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run src/lib/boards/markdown.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Verify the module stayed pure**

```bash
grep -n "react\|React" src/lib/boards/markdown.ts
```

Expected: no output. If there is output, the module has picked up a React dependency and must be corrected — the whole point of this file is that it is testable without a DOM.

- [ ] **Step 6: Run the gates**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/markdown.ts src/lib/boards/markdown.test.ts
git commit -m "feat(boards): pure markdown core for text cells

stripMarkdown for collapsed cells, applyMarkdown for toolbar actions,
parseMarkdown for the preview AST. Link hrefs are gated through
isHttpUrl at parse time so no renderer can emit an unsafe href."
```

---

## Task 2: `MarkdownPreview`

**Files:**

- Create: `src/components/boards/cells/editors/MarkdownPreview.tsx`
- Test: `src/components/boards/cells/editors/MarkdownPreview.test.tsx`

**Interfaces:**

- Consumes: `parseMarkdown`, and the `Block` / `Inline` types from `@/lib/boards/markdown` (Task 1).
- Produces:
  ```ts
  export function MarkdownPreview({
    markdown,
  }: {
    markdown: string;
  }): React.JSX.Element;
  ```

### Design notes for the implementer

Load the `pulse-ui` skill first. This is a small reading surface inside a panel: prose sizing `text-sm`, muted foreground for quote blocks, the periwinkle accent reserved for links only. Do not introduce new colour tokens.

The component takes raw `markdown` (not `Block[]`) so callers never touch the AST. Call `parseMarkdown` inside a `useMemo` keyed on `markdown`, because it re-runs on every keystroke while the Preview tab is open.

Render an empty-state line when `parseMarkdown` returns `[]`, so the tab is never a blank void.

**No `dangerouslySetInnerHTML`.** Links render as `<a>` with `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/boards/cells/editors/MarkdownPreview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders bold text in a <strong>", () => {
    const { container } = render(<MarkdownPreview markdown="**hi**" />);
    expect(container.querySelector("strong")?.textContent).toBe("hi");
  });

  it("renders italic text in an <em>", () => {
    const { container } = render(<MarkdownPreview markdown="*hi*" />);
    expect(container.querySelector("em")?.textContent).toBe("hi");
  });

  it("renders strikethrough in a <del>", () => {
    const { container } = render(<MarkdownPreview markdown="~~hi~~" />);
    expect(container.querySelector("del")?.textContent).toBe("hi");
  });

  it("renders an inline code span in a <code>", () => {
    const { container } = render(<MarkdownPreview markdown="`x`" />);
    expect(container.querySelector("code")?.textContent).toBe("x");
  });

  it("renders a bullet list as a <ul> with one <li> per item", () => {
    const { container } = render(<MarkdownPreview markdown={"- a\n- b"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("renders a numbered list as an <ol>", () => {
    const { container } = render(<MarkdownPreview markdown={"1. a\n2. b"} />);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders a heading at the right level", () => {
    render(<MarkdownPreview markdown="## Title" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Title",
    );
  });

  it("renders a quote as a <blockquote>", () => {
    const { container } = render(<MarkdownPreview markdown="> q" />);
    expect(container.querySelector("blockquote")?.textContent).toBe("q");
  });

  it("renders a safe link with noopener and a blank target", () => {
    render(<MarkdownPreview markdown="[x](https://example.com)" />);
    const a = screen.getByRole("link", { name: "x" });
    expect(a).toHaveAttribute("href", "https://example.com");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(a).toHaveAttribute("target", "_blank");
  });

  it("does not render an anchor for a javascript: url", () => {
    render(<MarkdownPreview markdown="[x](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
  });

  it("shows an empty-state line for empty markdown", () => {
    render(<MarkdownPreview markdown="" />);
    expect(screen.getByText(/nothing to preview/i)).toBeInTheDocument();
  });

  it("preserves paragraph order", () => {
    const { container } = render(
      <MarkdownPreview markdown={"first\n\nsecond"} />,
    );
    expect(container.textContent).toBe("firstsecond");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/components/boards/cells/editors/MarkdownPreview.test.tsx
```

Expected: FAIL — `Failed to resolve import "./MarkdownPreview"`.

- [ ] **Step 3: Implement `MarkdownPreview.tsx`**

Start the file with `"use client";`. Structure it as two functions: a recursive `renderInline(nodes: Inline[])` returning `React.ReactNode`, and the exported `MarkdownPreview` that switches over block types. Give every mapped element a stable `key` from its index — the AST is regenerated wholesale on each keystroke, so index keys are correct here and will not cause state bugs (these nodes hold no state).

The empty state must contain the literal text `Nothing to preview` so the test matches.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run src/components/boards/cells/editors/MarkdownPreview.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 5: Verify no raw HTML injection path exists**

```bash
grep -rn "dangerouslySetInnerHTML" src/components/boards/cells/editors/
```

Expected: no output.

- [ ] **Step 6: Run the gates**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/editors/MarkdownPreview.tsx src/components/boards/cells/editors/MarkdownPreview.test.tsx
git commit -m "feat(boards): MarkdownPreview renderer for text cells

Renders the parseMarkdown AST to React elements. No
dangerouslySetInnerHTML, so the HTML-injection surface is structurally
zero rather than sanitized away."
```

---

## Task 3: `LongTextEditor` panel

**Files:**

- Create: `src/components/boards/cells/editors/LongTextEditor.tsx`
- Test: `src/components/boards/cells/editors/LongTextEditor.test.tsx`

**Interfaces:**

- Consumes: `applyMarkdown` and the `MarkdownAction` type from `@/lib/boards/markdown` (Task 1); `MarkdownPreview` from `./MarkdownPreview` (Task 2); `Popover`, `PopoverContent`, `PopoverAnchor` from `@/components/ui/popover`; `Textarea` from `@/components/ui/textarea`.
- Produces:
  ```ts
  export function LongTextEditor(props: {
    value: { text: string } | null;
    settings: Record<string, unknown>;
    onCommit: (value: { text: string }) => void;
    onCancel: () => void;
    columnName?: string;
  }): React.JSX.Element;
  ```
  The prop shape deliberately matches the existing `EditorProps<{ text: string }>` contract in `editors/index.tsx:45` so the `CellEditor` switch in Task 5 is a drop-in swap. `columnName` is new and optional.

### Design notes for the implementer

Load the `pulse-ui` skill first.

**Structure.** `Popover open` + `PopoverAnchor className="absolute inset-0"` + `PopoverContent` — copy the shape of `PopoverSurface` at `src/components/boards/cells/editors/index.tsx:77-107`, which already solves portalling out of the board's nested `overflow-auto` containers and edge collision. Do not reimplement positioning.

Sizing on `PopoverContent`:

```
w-[min(36rem,var(--radix-popover-content-available-width))]
```

and the textarea `min-h-[12rem]` with a `max-h` derived from `var(--radix-popover-content-available-height)`. `Textarea` already has `field-sizing-content`, which gives autosizing for free — do not hand-roll a scrollHeight measurement.

**Layout** — header (column name · `Write | Preview` · close button), body (textarea or preview), footer (toolbar).

**Tabs without a dependency.** There is no `tabs.tsx` in `src/components/ui` and you must not add one. Build two buttons with `role="tab"`, `aria-selected`, inside a `role="tablist"`. The tests below select them by role and name.

**Save semantics — every exit path commits. There is no discard path.**

| Input                       | Behaviour                          |
| --------------------------- | ---------------------------------- |
| `Enter`                     | inserts a newline; must NOT commit |
| `Escape`                    | commit + close                     |
| `Cmd/Ctrl+Enter`            | commit + close                     |
| outside click, close button | commit + close                     |
| `Cmd/Ctrl+B` / `Cmd/Ctrl+I` | bold / italic                      |

Do **not** import `useCommitKeys` (`editors/index.tsx:55`). It binds `Enter` to commit and `Escape` to cancel — the exact opposite of what this panel needs. Add a comment on the keydown handler saying so, because the departure will otherwise read as an oversight to the next person.

Commit means `onCommit({ text })`. `onCancel` is only reachable if the value is unchanged — call `onCancel()` instead of `onCommit` when `text === (value?.text ?? "")` to avoid a pointless write.

**Toolbar.** Nine buttons in order: bold, italic, strikethrough, heading, bulletList, numberedList, link, inlineCode, quote. Each has an `aria-label` matching its action name in sentence case (`"Bold"`, `"Bullet list"`, `"Numbered list"`, `"Inline code"`, …). Each handler: read `selectionStart`/`selectionEnd` off the textarea ref, call `applyMarkdown`, `setText` the result, then restore the returned selection in a `requestAnimationFrame` (React will have re-rendered the value by then) and refocus the textarea. Toolbar buttons must use `onMouseDown` with `preventDefault` so clicking one does not blur the textarea and lose the selection.

**Character cap.** Cap the textarea at `20_000` via `maxLength`. Show a counter in the footer only when `text.length > 19_000`, formatted `19,240 / 20,000`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/boards/cells/editors/LongTextEditor.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LongTextEditor } from "./LongTextEditor";

function setup(overrides: Partial<Parameters<typeof LongTextEditor>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <LongTextEditor
      value={{ text: "old" }}
      settings={{}}
      onCommit={onCommit}
      onCancel={onCancel}
      columnName="Description"
      {...overrides}
    />,
  );
  return { onCommit, onCancel };
}

describe("LongTextEditor — panel", () => {
  it("seeds the textarea with the current value", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveValue("old");
  });

  it("shows the column name", () => {
    setup();
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("opens on the Write tab", () => {
    setup();
    expect(screen.getByRole("tab", { name: /write/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("LongTextEditor — save semantics", () => {
  it("inserts a newline on Enter without committing", async () => {
    const { onCommit } = setup({ value: { text: "" } });
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "one{Enter}two");
    expect(ta).toHaveValue("one\ntwo");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits and does not cancel on Escape", async () => {
    const { onCommit, onCancel } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er{Escape}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("commits on Cmd/Ctrl+Enter", async () => {
    const { onCommit } = setup();
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("commits when the close button is pressed", async () => {
    const { onCommit } = setup();
    await userEvent.click(screen.getByRole("textbox"));
    await userEvent.type(screen.getByRole("textbox"), "er");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });

  it("cancels instead of committing when the text is unchanged", async () => {
    const { onCommit, onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("LongTextEditor — toolbar", () => {
  it("wraps the selection in bold marks", async () => {
    setup({ value: { text: "hello world" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(6, 11);
    await userEvent.click(screen.getByRole("button", { name: /^bold$/i }));
    expect(ta).toHaveValue("hello **world**");
  });

  it("unwraps an already-bold selection on a second press", async () => {
    setup({ value: { text: "hello **world**" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(8, 13);
    await userEvent.click(screen.getByRole("button", { name: /^bold$/i }));
    expect(ta).toHaveValue("hello world");
  });

  it("prefixes selected lines with bullets", async () => {
    setup({ value: { text: "a\nb" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(0, 3);
    await userEvent.click(screen.getByRole("button", { name: /bullet list/i }));
    expect(ta).toHaveValue("- a\n- b");
  });

  it("applies bold via the keyboard shortcut", async () => {
    setup({ value: { text: "ab" } });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.setSelectionRange(0, 2);
    await userEvent.keyboard("{Control>}b{/Control}");
    expect(ta).toHaveValue("**ab**");
  });

  it("exposes all nine formatting actions", () => {
    setup();
    for (const name of [
      /^bold$/i,
      /^italic$/i,
      /strikethrough/i,
      /heading/i,
      /bullet list/i,
      /numbered list/i,
      /^link$/i,
      /inline code/i,
      /quote/i,
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

describe("LongTextEditor — preview", () => {
  it("renders formatted output on the Preview tab", async () => {
    setup({ value: { text: "**bold**" } });
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("hides the textarea while previewing and restores it on Write", async () => {
    setup();
    await userEvent.click(screen.getByRole("tab", { name: /preview/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /write/i }));
    expect(screen.getByRole("textbox")).toHaveValue("old");
  });
});

describe("LongTextEditor — cap", () => {
  it("caps the textarea at 20000 characters", () => {
    setup();
    expect(screen.getByRole("textbox")).toHaveAttribute("maxLength", "20000");
  });

  it("hides the counter well below the cap", () => {
    setup();
    expect(screen.queryByText(/\/ 20,000/)).not.toBeInTheDocument();
  });

  it("shows the counter as the cap approaches", () => {
    setup({ value: { text: "x".repeat(19_500) } });
    expect(screen.getByText(/19,500 \/ 20,000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/components/boards/cells/editors/LongTextEditor.test.tsx
```

Expected: FAIL — `Failed to resolve import "./LongTextEditor"`.

- [ ] **Step 3: Implement `LongTextEditor.tsx`**

Start with `"use client";`. Build it to satisfy every test above and the design notes. Note two things the tests pin down that are easy to get wrong:

1. The Preview tab **unmounts** the textarea (`queryByRole("textbox")` must return null), and switching back to Write restores the current text — so `text` state lives in the parent component, not in the textarea.
2. `Escape` must not propagate to Radix's own dismiss handling in a way that skips the commit. Handle `Escape` in the textarea's `onKeyDown`, commit there, and let the close follow — or intercept `onEscapeKeyDown` on `PopoverContent` and commit before closing. Either is fine; the test only asserts `onCommit` fired and `onCancel` did not.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run src/components/boards/cells/editors/LongTextEditor.test.tsx
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the gates**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/cells/editors/LongTextEditor.tsx src/components/boards/cells/editors/LongTextEditor.test.tsx
git commit -m "feat(boards): LongTextEditor panel for text cells

Anchored Radix popover with Write/Preview tabs, an autosizing textarea
and a nine-action markdown toolbar. Every exit path commits — Escape
saves rather than discarding, deliberately departing from
useCommitKeys, because a discarded paragraph is real lost work."
```

---

## Task 4: Strip Markdown in the collapsed cell, cap the stored value

**Files:**

- Modify: `src/components/boards/cells/index.tsx:14-21`
- Modify: `src/lib/validations/boards.ts:144`
- Test: `src/components/boards/cells/cells.test.tsx` (modify)

**Interfaces:**

- Consumes: `stripMarkdown` from `@/lib/boards/markdown` (Task 1).
- Produces: nothing other tasks depend on. This task gates nothing and can run concurrently with Task 2.

### Design notes for the implementer

`TextCell` is the single renderer behind the table, Mirror cells and Rollup cells, so this one edit fixes Markdown legibility on all three surfaces.

Add `title={stripped}` so the full single-line text is available on hover, since the cell truncates.

The schema cap is a one-token change and applies to the cell editor and the MCP `create_item` / `update_item` text writes. Spreadsheet import writes via RPC and is not covered by this cap.

- [ ] **Step 1: Write the failing tests**

In `src/components/boards/cells/cells.test.tsx`, **replace** the existing block at lines 84-92:

```tsx
it("TextCell shows the text value", () => {
  render(<TextCell value={{ text: "Hello" }} settings={{}} />);
  expect(screen.getByText("Hello")).toBeInTheDocument();
});

it("TextCell renders an empty cell when value is null", () => {
  const { container } = render(<TextCell value={null} settings={{}} />);
  expect(container.textContent).toBe("");
});
```

with:

```tsx
it("TextCell shows the text value", () => {
  render(<TextCell value={{ text: "Hello" }} settings={{}} />);
  expect(screen.getByText("Hello")).toBeInTheDocument();
});

it("TextCell renders an empty cell when value is null", () => {
  const { container } = render(<TextCell value={null} settings={{}} />);
  expect(container.textContent).toBe("");
});

it("TextCell strips markdown syntax from the collapsed view", () => {
  render(<TextCell value={{ text: "**Q3 goals**" }} settings={{}} />);
  expect(screen.getByText("Q3 goals")).toBeInTheDocument();
  expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
});

it("TextCell flattens a multi-line value to one line", () => {
  const { container } = render(
    <TextCell value={{ text: "**Q3 goals**\n- ship billing" }} settings={{}} />,
  );
  expect(container.textContent).toBe("Q3 goals ship billing");
});

it("TextCell exposes the full stripped text as a title for hover", () => {
  const { container } = render(
    <TextCell value={{ text: "- a\n- b" }} settings={{}} />,
  );
  expect(container.querySelector("span")).toHaveAttribute("title", "a b");
});
```

Then append this describe block to the existing `src/lib/validations/boards.test.ts`. Add `textValueSchema` to that file's existing import from `./boards` rather than adding a second import statement:

```ts
describe("textValueSchema cap", () => {
  it("accepts a value at exactly the cap", () => {
    expect(
      textValueSchema.safeParse({ text: "x".repeat(20_000) }).success,
    ).toBe(true);
  });

  it("rejects a value one character over the cap", () => {
    expect(
      textValueSchema.safeParse({ text: "x".repeat(20_001) }).success,
    ).toBe(false);
  });

  it("still accepts an empty string", () => {
    expect(textValueSchema.safeParse({ text: "" }).success).toBe(true);
  });

  it("still accepts multi-line markdown", () => {
    expect(textValueSchema.safeParse({ text: "**a**\n- b\n- c" }).success).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/components/boards/cells/cells.test.tsx src/lib/validations/boards.test.ts
```

Expected: FAIL — the strip tests fail because `TextCell` still renders raw text; the cap test fails because `z.string()` accepts 20,001 characters.

- [ ] **Step 3: Implement both changes**

`src/components/boards/cells/index.tsx` — add the import and rewrite `TextCell`:

```tsx
import { stripMarkdown } from "@/lib/boards/markdown";

/**
 * Collapsed text cell. Text columns hold Markdown (see LongTextEditor), so the
 * resting view strips the syntax and flattens to one line — this renderer also
 * backs Mirror and Rollup cells.
 */
export function TextCell({
  value,
}: {
  value: { text: string } | null;
  settings: Settings;
}) {
  const text = stripMarkdown(value?.text ?? "");
  return (
    <span className="truncate text-sm" title={text || undefined}>
      {text}
    </span>
  );
}
```

`src/lib/validations/boards.ts:144`:

```ts
// Text cells hold Markdown in this one string (see the LongTextEditor panel).
// The cap bounds jsonb growth on the paths that validate through this schema —
// the cell editor and the MCP create_item / update_item text writes. Spreadsheet
// import writes via RPC and is not covered by this cap.
export const textValueSchema = z.object({ text: z.string().max(20_000) });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run src/components/boards/cells/cells.test.tsx src/lib/validations/boards.test.ts
```

Expected: PASS.

- [ ] **Step 5: Verify no other suite regressed on the stripping change**

`TextCell` backs three surfaces, so run everything that renders it:

```bash
pnpm vitest run src/components/boards
```

Expected: PASS. If a Kanban or Calendar test asserted raw Markdown in a fixture, update that fixture — do not weaken `stripMarkdown`.

- [ ] **Step 6: Run the gates**

```bash
pnpm typecheck && pnpm lint
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/index.tsx src/components/boards/cells/cells.test.tsx src/lib/validations/boards.ts src/lib/validations/boards.test.ts
git commit -m "feat(boards): strip markdown in collapsed text cells, cap value at 20k

TextCell backs the table, Kanban, Calendar agenda, Mirror and Rollup, so
stripping here makes markdown read cleanly on all five. The schema cap
bounds jsonb growth across every write path, not just the editor."
```

---

## Task 5: Wire the panel into `CellEditor`

**Files:**

- Modify: `src/components/boards/cells/editors/index.tsx:109-126` (delete `TextEditor`)
- Modify: `src/components/boards/cells/editors/index.tsx:660-668` (`case "text"`)
- Modify: `src/components/boards/cells/editors/editors.test.tsx` (delete the `TextEditor` describe block + import)

**Interfaces:**

- Consumes: `LongTextEditor` from `./LongTextEditor` (Task 3).
- Produces: the finished feature. Nothing depends on this task.

### Design notes for the implementer

`CellEditor` is mounted in exactly one place — `src/components/boards/table/EditableCell.tsx:174` — so this switch change is the whole wiring job. `EditableCell` already renders the editor inside `<div className="relative …">`, which is the positioning context `PopoverAnchor className="absolute inset-0"` needs. **No change to `EditableCell.tsx` is required**; confirm that by reading it rather than assuming.

`CellEditor` does not currently receive the column name. Adding a `columnName` prop means touching `EditableCell` too. Do it — the header reads much better with it, and it is a two-line change: add `columnName?: string` to the `CellEditor` prop type and pass `columnName={column.name}` at the `EditableCell.tsx:174` call site.

Delete `TextEditor` entirely rather than leaving it unused — `pnpm lint` will fail on an unused export only if it is also unimported, so remove it and its now-dead `useCommitKeys` usage cleanly. Check whether `useCommitKeys` still has other callers before removing anything else:

```bash
grep -n "useCommitKeys" src/components/boards/cells/editors/index.tsx
```

It has several other callers (Numbers, Link, Email, Phone) — so keep the helper, remove only `TextEditor`.

- [ ] **Step 1: Update the existing test file**

In `src/components/boards/cells/editors/editors.test.tsx`:

1. Remove `TextEditor` from the import list at the top (lines 4-16).
2. Delete the entire `describe("TextEditor", …)` block (lines 24-58).
3. Add this block in its place, exercising the wiring through `CellEditor`:

```tsx
describe("CellEditor routes text cells to the long-text panel", () => {
  it("renders the panel with tabs and a toolbar, not a single-line input", () => {
    render(
      <CellEditor
        kind="text"
        value={{ text: "old" }}
        settings={{}}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
        columnName="Notes"
      />,
    );
    expect(screen.getByRole("tab", { name: /write/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^bold$/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("commits the edited text through onCommit", async () => {
    const onCommit = vi.fn();
    render(
      <CellEditor
        kind="text"
        value={{ text: "old" }}
        settings={{}}
        onCommit={onCommit}
        onCancel={vi.fn()}
        columnName="Notes"
      />,
    );
    const ta = screen.getByRole("textbox");
    await userEvent.click(ta);
    await userEvent.type(ta, "er{Escape}");
    expect(onCommit).toHaveBeenCalledWith({ text: "older" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/components/boards/cells/editors/editors.test.tsx
```

Expected: FAIL — `CellEditor` still renders the single-line `TextEditor`, so `getByRole("tab")` finds nothing, and `columnName` is not a valid prop (a type error at build, a runtime no-op in the test).

- [ ] **Step 3: Make the change**

In `src/components/boards/cells/editors/index.tsx`:

1. Add `import { LongTextEditor } from "./LongTextEditor";`
2. Delete the `TextEditor` function (lines 109-126).
3. Add `columnName?: string;` to the `CellEditor` prop type.
4. Replace the `case "text"` arm:

```tsx
    case "text":
      return (
        <LongTextEditor
          value={value as { text: string } | null}
          settings={settings}
          onCommit={onCommit}
          onCancel={onCancel}
          columnName={columnName}
        />
      );
```

In `src/components/boards/table/EditableCell.tsx`, add `columnName={column.name}` to the `<CellEditor …>` call at line 174.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm vitest run src/components/boards/cells/editors/editors.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Verify nothing else referenced the deleted export**

```bash
grep -rn "TextEditor" src/ | grep -v "LongTextEditor"
```

Expected: no output. Any hit is a broken import that must be fixed now.

- [ ] **Step 6: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. This is the completion bar from working agreement #4 — do not proceed to the next step on a partial pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/cells/editors/index.tsx src/components/boards/cells/editors/editors.test.tsx src/components/boards/table/EditableCell.tsx
git commit -m "feat(boards): route text cells to the LongTextEditor panel

Replaces the single-line TextEditor in the CellEditor switch and passes
the column name through for the panel header. CellEditor has one mount
point (EditableCell), so this is the whole wiring change."
```

- [ ] **Step 8: Verify in the running app**

```bash
pnpm dev
```

Walk the manual acceptance path from spec §8 — open a board with a text column, click a cell, type two paragraphs, bold a word, toggle it off, check Preview, press `Escape`, confirm the value saved and the collapsed cell shows no `**`. Then filter the board on a word from the middle of the paragraph and confirm it matches.

- [ ] **Step 9: Finish the task**

From inside the worktree:

```bash
scripts/finish-task.sh
```

This rebases onto the latest `develop`, re-runs all four gates against the merged state, merges, pushes, and removes the worktree and branch. The task is not complete until this succeeds.

---

## Self-Review

**Spec coverage:**

| Spec section                                                                                                         | Task                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| §2.1 Markdown in the same field (no consumer changes)                                                                | Task 1 — verified by the strip/parse tests; no consumer files appear in any task's file list                  |
| §2.2 Storage cap `20_000`                                                                                            | Task 4, step 3                                                                                                |
| §3.1 `stripMarkdown` / `applyMarkdown` / `parseMarkdown`, fast path, four `applyMarkdown` cases, nine closed actions | Task 1                                                                                                        |
| §3.2 `MarkdownPreview`, no `dangerouslySetInnerHTML`, `isHttpUrl` gating                                             | Task 1 (gating at parse time) + Task 2 (renderer + grep check)                                                |
| §3.3 Anchored panel, sizing, layout, keyboard/save table, `Esc` departure from `useCommitKeys`                       | Task 3                                                                                                        |
| §3.4 `TextCell` stripping across three surfaces                                                                      | Task 4                                                                                                        |
| §4 Non-goals: no row growth, no item-panel editing, no new column kind                                               | Honoured — no task touches row height, `ItemPanel`, or `column-kinds.ts`                                      |
| §5 Performance budget: 0 round-trips on open/type, 1 on close                                                        | Honoured — no task adds a query or Server Action; Task 5 reuses the existing `setCell` path in `EditableCell` |
| §6 Testing table                                                                                                     | Tasks 1-5; all four named files covered                                                                       |
| §7 Execution DAG                                                                                                     | Reproduced above with matching edges and batches                                                              |
| §8 Manual acceptance                                                                                                 | Task 5, step 8                                                                                                |

No gaps.

**Placeholder scan:** Clean. Every code step carries real code, and every file path was verified to exist before being referenced — including `src/lib/validations/boards.test.ts`, which the cap tests append to.

**Type consistency:** `MarkdownAction`, `Block`, `Inline`, `Selection` are declared once in Task 1 and referenced by exactly those names in Tasks 2 and 3. `stripMarkdown` / `applyMarkdown` / `parseMarkdown` keep identical signatures across Tasks 1, 2, 3 and 4. `LongTextEditor`'s prop shape declared in Task 3 matches the call site written in Task 5, including the new optional `columnName`. `MarkdownPreview` takes `markdown: string` in both its own task and its Task 3 consumer.
