# Agent PDF Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a personal agent one new agent-only tool verb, `create_pdf`, that renders Markdown it authored into a PDF via the existing headless-Chromium renderer and attaches it to an item.

**Architecture:** The model emits **Markdown**, never HTML. `parseMarkdown` (`src/lib/boards/markdown.ts`, already pure and unit-tested) turns it into a closed, typed AST; a new pure `renderBlocksToHtml` escapes every value into HTML; a new pure `buildAgentPdfHtml` wraps that in a self-contained document with server-owned CSS that references no external resource; the existing `renderHtmlToPdf` (unmodified) turns it into bytes. The bytes never touch base64 or `attach_file` — a new `uploadAndRegisterAttachment` in `attachment-core.ts` uploads to Storage and calls `createAttachmentCore` directly. The verb reuses the existing `files.write` capability and is wired with one array entry.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript strict, Supabase (Postgres + RLS + Storage), Zod 4, Vitest 4. Already installed and used: `playwright-core`, `@sparticuz/chromium` (both in `next.config.ts:24` `serverExternalPackages`). **No new dependency is added.**

**Spec:** `docs/superpowers/specs/2026-08-27-agent-pdf-output-design.md`

## Global Constraints

- **No new npm dependency.** No markdown library, no sanitizer. Reuse `src/lib/boards/markdown.ts`.
- **No new agent capability.** `create_pdf` declares `capability: "files.write"`. Do **not** touch `src/lib/agents/capabilities.ts`, `capability-copy.ts`, `CapabilityToggles.tsx` or `AgentEditor.tsx`.
- **Do not modify** `src/lib/agents/run-loop.ts`, `src/lib/agents/document-inject.ts` (owned by the concurrent 2c slice) **or `src/lib/reports/pdf.ts`** (shared with report export).
- **`@/lib/reports/pdf` is imported LAZILY** (`await import(...)`) in `create-pdf.ts` — never statically. `import type { PdfOptions }` is fine (erased). Reason: `AGENT_ONLY_DESCRIPTORS` is in `/settings/agents`'s module graph; a static import drags Chromium into it. Precedent: `src/lib/reports/export-html.tsx:14-18`.
- **`ActionResult` / `fail` are imported from `src/lib/actions/result.ts`.** Never re-declared locally.
- **Validate at boundaries with Zod.** TypeScript strict; no `any`.
- **RLS is the security boundary.** Every read/write in this slice goes through the agent-owner's bridged client (`ctx.getClient()`), resolved **exactly once** per invocation (`src/lib/mcp/tools/shared.ts:11-14`).
- **No schema change, no migration, no `db:types` regeneration** — this slice adds no table and no column.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Lowercase commit subjects. **Stage explicitly by path** — never `git add -A`.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass before `scripts/finish-task.sh`.
- Exact values, used verbatim below: `MAX_SOURCE_BYTES = 131_072`; `MAX_ATTACHMENT_BYTES = 52_428_800`; `RENDER_TIMEOUT_MS = 45_000`; `PDF_MIME = "application/pdf"`; `landscape: false`.

---

## Execution DAG (working agreement #6)

**Dependency graph**

```
Task 1 (renderBlocksToHtml) ─┐
                             ├─> Task 3 (buildAgentPdfHtml) ─┐
Task 2 (uploadAndRegister…) ─────────────────────────────────┼─> Task 4 (create_pdf) ─> Task 6 (wiring) ─> Task 7 (gates + finish)
Task 5 (approval sentence) ──────────────────────────────────────────────────────────┘
```

- Task 1 depends on nothing.
- Task 2 depends on nothing.
- Task 3 depends on Task 1 (`renderBlocksToHtml`).
- Task 4 depends on Tasks 2 and 3.
- Task 5 depends on nothing (pure; keyed only by tool name + input shape).
- Task 6 depends on Tasks 4 and 5.
- Task 7 depends on Task 6.

**Parallel batches**

| Batch | Tasks       | Notes                                           |
| ----- | ----------- | ----------------------------------------------- |
| B1    | **1, 2, 5** | Three disjoint file sets. Genuinely concurrent. |
| B2    | 3           |                                                 |
| B3    | 4           |                                                 |
| B4    | 6           |                                                 |
| B5    | 7           |                                                 |

**Critical path:** 1 → 3 → 4 → 6 → 7 (five tasks). That is the wall-clock floor.

**Scheduling recommendation:** the whole slice is ~6 small files in two directories. Dispatching B1 as three parallel agents is legitimate (`superpowers:dispatching-parallel-agents`) but the coordination cost is comparable to the work; a single session executing 1→2→5→3→4→6→7 sequentially is the pragmatic default. If B1 **is** dispatched in parallel, the three tasks touch disjoint files (`src/lib/boards/*`, `src/lib/collaboration/*` + `src/lib/mcp/tools/*`, `src/lib/agents/proposal-summary*`) and need no worktree isolation beyond this slice's own.

---

## File Structure

**Create:**

| File                                                 | Responsibility                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/markdown-html.ts`                    | `renderBlocksToHtml(Block[]) → string`. Pure, no `server-only`. Escapes every text, code and href value. |
| `src/lib/boards/markdown-html.test.ts`               | Unit tests, including the escaping/injection cases.                                                      |
| `src/lib/agents/pdf-document.ts`                     | `AGENT_PDF_CSS` + `buildAgentPdfHtml(markdown) → string`. Pure, no `server-only`.                        |
| `src/lib/agents/pdf-document.test.ts`                | Unit tests, including "references no external resource".                                                 |
| `src/lib/agents/create-pdf.ts`                       | `makeCreatePdfDescriptor(deps)` + `createPdfDescriptor`. The factory is the test seam.                   |
| `src/lib/agents/create-pdf.test.ts`                  | Unit tests with fake `render` / `attach`. No Chromium.                                                   |
| `src/lib/agents/proposal-actions.create-pdf.test.ts` | Approve path end-to-end through the REAL descriptor, with `@/lib/reports/pdf` mocked.                    |

**Modify:**

| File                                            | Change                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/collaboration/attachment-core.ts`      | Add `MAX_ATTACHMENT_BYTES` + `uploadAndRegisterAttachment`.                                                                                                  |
| `src/lib/collaboration/attachment-core.test.ts` | Append a `describe` for the new helper. The file exists; its local `makeClient` fake has no Storage surface, so the new block uses `makeFakeClient` instead. |
| `src/lib/mcp/tools/attach-file.ts`              | Inline branch delegates to `uploadAndRegisterAttachment`. Behaviour unchanged.                                                                               |
| `src/lib/mcp/tools/create-attachment-upload.ts` | Local `MAX_BYTES` becomes an import of `MAX_ATTACHMENT_BYTES`.                                                                                               |
| `src/lib/agents/proposal-summary.ts`            | Add the `create_pdf` case to `sentenceFor`.                                                                                                                  |
| `src/lib/agents/proposal-summary.test.ts`       | Tests for that case.                                                                                                                                         |
| `src/lib/agents/agent-only-tools.ts`            | Append `createPdfDescriptor` to `AGENT_ONLY_DESCRIPTORS`.                                                                                                    |
| `src/lib/agents/agent-only-tools.test.ts`       | `NAMES` gains `"create_pdf"`; add its capability/scope assertion.                                                                                            |
| `src/app/api/ai/personal-agent/route.ts`        | `export const maxDuration = 300;` (one line — see §13 Q2 of the spec).                                                                                       |

---

### Task 1: `renderBlocksToHtml` — the Markdown AST → escaped HTML renderer

**Files:**

- Create: `src/lib/boards/markdown-html.ts`
- Create: `src/lib/boards/markdown-html.test.ts`

**Interfaces:**

- Consumes: `Block`, `Inline` types from `src/lib/boards/markdown.ts` (type-only import); `parseMarkdown` in the tests.
- Produces: `export function renderBlocksToHtml(blocks: Block[]): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/boards/markdown-html.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import { renderBlocksToHtml } from "./markdown-html";

/** The real parser, so these tests pin the PAIR — a node kind the parser can
 *  emit that the renderer drops would pass a hand-built-AST test. */
const html = (md: string) => renderBlocksToHtml(parseMarkdown(md));

describe("renderBlocksToHtml", () => {
  it("renders every block kind", () => {
    expect(html("# Title")).toBe("<h1>Title</h1>");
    expect(html("## Sub")).toBe("<h2>Sub</h2>");
    expect(html("### Minor")).toBe("<h3>Minor</h3>");
    expect(html("plain words")).toBe("<p>plain words</p>");
    expect(html("> quoted")).toBe("<blockquote>quoted</blockquote>");
    expect(html("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(html("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("renders every inline kind, nested", () => {
    expect(html("**bold *inner* end**")).toBe(
      "<p><strong>bold <em>inner</em> end</strong></p>",
    );
    expect(html("~~gone~~")).toBe("<p><del>gone</del></p>");
    expect(html("`code`")).toBe("<p><code>code</code></p>");
    expect(html("[label](https://example.com/x)")).toBe(
      '<p><a href="https://example.com/x">label</a></p>',
    );
  });

  it("escapes markup in text so authored HTML can never execute", () => {
    expect(html("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(html('<img src=x onerror="alert(1)">')).not.toContain("<img");
    expect(html("a & b")).toBe("<p>a &amp; b</p>");
    expect(html('say "hi"')).toBe("<p>say &quot;hi&quot;</p>");
  });

  it("escapes inside code spans too", () => {
    expect(html("`<b>&</b>`")).toBe(
      "<p><code>&lt;b&gt;&amp;&lt;/b&gt;</code></p>",
    );
  });

  // parseMarkdown downgrades an unsafe scheme to literal text (markdown.ts:470)
  // before the renderer sees it. This pins that the PAIR holds the property.
  it("never emits a javascript: or data: href", () => {
    const js = html("[x](javascript:alert(1))");
    expect(js).not.toContain("<a");
    expect(js).toContain("javascript:alert(1)");
    expect(html("[x](data:text/html;base64,PHNjcmlwdD4=)")).not.toContain("<a");
  });

  it("escapes a quote injected into an http href", () => {
    const out = html('[x](https://e.com/?a="onmouseover="alert(1))');
    expect(out).not.toContain('onmouseover="');
    expect(out).toContain("&quot;");
  });

  it("returns an empty string for no blocks", () => {
    expect(renderBlocksToHtml([])).toBe("");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/boards/markdown-html.test.ts
```

Expected: FAIL — `Failed to resolve import "./markdown-html"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/boards/markdown-html.ts`:

```ts
import type { Block, Inline } from "./markdown";

/**
 * The Markdown AST from `./markdown`, rendered to an HTML string.
 *
 * The React counterpart is `MarkdownPreview.tsx`; neither is derivable from the
 * other (JSX for the cell editor, a string for headless Chromium's
 * `setContent`). This one lives HERE, beside the module that owns the AST, so
 * that adding a `Block`/`Inline` variant fails to typecheck in the sibling file
 * rather than silently vanishing from a rendered document.
 *
 * SECURITY, and it is the whole reason this module is shaped like this: its
 * input is MODEL-AUTHORED text (`create_pdf`), which under prompt injection is
 * attacker-authored. Every value that reaches the output is escaped, so a
 * document can contain no tag, no attribute and no external reference the AST
 * cannot express — and the AST has no image, script or raw-HTML node at all.
 * The rendered document therefore fetches NOTHING, which is what makes it safe
 * to hand to a browser that would happily resolve an `<img src="http://…">`
 * from inside our own function.
 *
 * Pure, synchronous, no DOM, no `server-only`.
 */

/**
 * Local by design. `src/lib/digest/render.ts:16` and
 * `src/lib/agents/briefing-render.ts:41` each keep their own copy; a shared
 * helper is a reasonable future extraction, but it would edit two email
 * renderers that are not part of this change.
 */
function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Recurses: bold/italic/strikethrough/link nodes nest arbitrarily. */
function renderInline(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "text":
          return escapeHtml(node.value);
        case "bold":
          return `<strong>${renderInline(node.children)}</strong>`;
        case "italic":
          return `<em>${renderInline(node.children)}</em>`;
        case "strikethrough":
          return `<del>${renderInline(node.children)}</del>`;
        case "code":
          return `<code>${escapeHtml(node.value)}</code>`;
        case "link":
          // `parseMarkdown` has already refused any non-http(s) scheme
          // (markdown.ts:470) — a `link` node is known-safe by the time it
          // arrives. The href is escaped anyway: that is the second layer, and
          // it is what stops a quote inside a legitimate https URL from
          // breaking out of the attribute.
          return `<a href="${escapeHtml(node.href)}">${renderInline(node.children)}</a>`;
      }
    })
    .join("");
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${renderInline(block.children)}</p>`;
    case "heading":
      return `<h${block.level}>${renderInline(block.children)}</h${block.level}>`;
    case "quote":
      return `<blockquote>${renderInline(block.children)}</blockquote>`;
    case "bulletList":
      return `<ul>${block.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</ul>`;
    case "numberedList":
      return `<ol>${block.items.map((i) => `<li>${renderInline(i)}</li>`).join("")}</ol>`;
  }
}

/** Blocks joined by a newline — readable output, no layout effect in HTML. */
export function renderBlocksToHtml(blocks: Block[]): string {
  return blocks.map(renderBlock).join("\n");
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm vitest run --project unit src/lib/boards/markdown-html.test.ts
```

Expected: PASS, 7 tests.

If the href-escaping test fails because `parseMarkdown` split the construct
differently than assumed, adjust the **test's** input string (not the escaping)
until it produces a single `link` node with a quote in the href — the property
under test is "a quote in an href cannot break out of the attribute".

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/markdown-html.ts src/lib/boards/markdown-html.test.ts
git commit -m "feat(markdown): render the markdown ast to escaped html"
```

---

### Task 2: `uploadAndRegisterAttachment` — one implementation of upload-then-register

**Files:**

- Modify: `src/lib/collaboration/attachment-core.ts`
- Modify: `src/lib/collaboration/attachment-core.test.ts` (append; the file already covers `attachmentPathPrefix` and `createAttachmentCore` with a local fake)
- Modify: `src/lib/mcp/tools/attach-file.ts:51-133`
- Modify: `src/lib/mcp/tools/create-attachment-upload.ts:10-11`

**Interfaces:**

- Consumes: `resolveItemScope`, `createAttachmentCore` (same module); `buildStoragePath`, `buildColumnFilePath` from `./attachments-path`; `ActionResult` / `fail` from `@/lib/actions/result`.
- Produces:
  - `export const MAX_ATTACHMENT_BYTES = 52_428_800;`
  - `export async function uploadAndRegisterAttachment(supabase: SupabaseClient<Database>, input: { itemId: string; columnId?: string; fileName: string; mimeType: string; bytes: Uint8Array }, actorId: string): Promise<ActionResult<{ attachmentId: string; storagePath: string; sizeBytes: number }>>`

**Hard gate for this task:** `src/lib/mcp/tools/attach-file.test.ts` must pass **unmodified**. If a case fails, fix the helper, not the test. If a case encodes an ordering that genuinely cannot be preserved, stop and report rather than editing it.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/collaboration/attachment-core.test.ts`. The file already
exists and already defines `ACTOR` and `ITEM` at the top — **reuse those, do not
redeclare them** — and extend its existing import of `./attachment-core` with
the two new names. The new `describe` needs Storage, which the file's local
`makeClient` fake does not model, so it imports the shared fake instead:

```ts
// merge into the file's existing imports
import { makeFakeClient } from "@/test/mcp-fake-client";
import {
  attachmentPathPrefix,
  createAttachmentCore,
  MAX_ATTACHMENT_BYTES,
  uploadAndRegisterAttachment,
} from "./attachment-core";

// ACTOR and ITEM already exist at the top of this file; only COLUMN is new.
const COLUMN = "22222222-2222-4222-8222-222222222222";
const bytes = (s: string) => new TextEncoder().encode(s);

/** `makeFakeClient` hands back `getClient`; this helper resolves it once, the
 *  way a tool handler does. */
async function client(spec: Parameters<typeof makeFakeClient>[0] = {}) {
  const fake = makeFakeClient(spec);
  return { supabase: await fake.getClient(), calls: fake.calls };
}

describe("uploadAndRegisterAttachment", () => {
  it("uploads then registers, and reports the server's own byte count", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "report.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hello world"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.sizeBytes).toBe(11);
    expect(r.data.attachmentId).toBe("a1");
    expect(calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(calls.attachments[0]).toMatchObject({
      mime_type: "application/pdf",
      size_bytes: 11,
      uploaded_by: ACTOR,
    });
  });

  it("removes the uploaded object when registering fails", async () => {
    const { supabase, calls } = await client({
      attachmentInsert: { data: null, error: { message: "denied" } },
    });
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(calls.storage.map((s) => s.op)).toEqual(["upload", "remove"]);
  });

  it("nests a column-scoped object one level deeper", async () => {
    const { supabase } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        columnId: COLUMN,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.storagePath).toContain(`/${ITEM}/${COLUMN}/`);
  });

  it("refuses empty bytes before touching Storage", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(0),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    expect(calls.storage).toHaveLength(0);
  });

  it("refuses bytes over the bucket ceiling before touching Storage", async () => {
    const { supabase, calls } = await client();
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("50 MB");
    expect(calls.storage).toHaveLength(0);
  });

  it("reports Item not found when the item is not visible", async () => {
    const { supabase, calls } = await client({
      itemScope: { data: null, error: null },
    });
    const r = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: ITEM,
        fileName: "a.pdf",
        mimeType: "application/pdf",
        bytes: bytes("hi"),
      },
      ACTOR,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Item not found.");
    expect(calls.storage).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/collaboration/attachment-core.test.ts
```

Expected: FAIL — `uploadAndRegisterAttachment` is not exported.

Note: `makeFakeClient`'s default `itemScope` is
`{ org_id: "o1", board_id: "b1" }` (`src/test/mcp-fake-client.ts:141`), which is
why the assertions above match on the `/<item>/<column>/` segment rather than on
a whole path — the `uuid-` prefix `buildStoragePath` adds
(`attachments-path.ts:43`) is random by design.

- [ ] **Step 3: Add the helper**

In `src/lib/collaboration/attachment-core.ts`, extend the import block and
append the function:

```ts
import { buildColumnFilePath, buildStoragePath } from "./attachments-path";
```

```ts
/** The `attachments` bucket ceiling, mirrored from the bucket + check
 *  constraint. Exported so the one number has one home: the MCP upload-ticket
 *  tool reports it to callers, and this module enforces it. */
export const MAX_ATTACHMENT_BYTES = 52_428_800;

/**
 * Upload bytes the SERVER produced and register them as an attachment.
 *
 * The counterpart to `createAttachmentCore` for callers that hold the bytes
 * rather than a storage path: it owns the whole upload → register → clean-up-on
 * -failure sequence, which is the part a second copy would most plausibly get
 * wrong (an orphaned object in the bucket with no row pointing at it).
 *
 * NOTHING ABOUT THE STORED ROW IS CALLER-ASSERTED except the file name, and
 * that is sanitised into the object key by `attachments-path.ts`. `sizeBytes`
 * is this function's own count of the buffer it uploaded; `mimeType` is chosen
 * by the calling tool from a closed set, never by a model. That is the same
 * property `attach_file` states as "size and type are read from storage, not
 * from you", reached from the other side: we are the writer, so our count IS
 * the storage truth and re-reading it would be a network call to learn a number
 * we just produced.
 *
 * Callers: `attachFileHandler`'s inline branch (`src/lib/mcp/tools/attach-file.ts`)
 * and `create_pdf` (`src/lib/agents/create-pdf.ts`).
 */
export async function uploadAndRegisterAttachment(
  supabase: SupabaseClient<Database>,
  input: {
    itemId: string;
    columnId?: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  },
  actorId: string,
): Promise<
  ActionResult<{ attachmentId: string; storagePath: string; sizeBytes: number }>
> {
  const sizeBytes = input.bytes.byteLength;
  // Both guards run BEFORE any network call: a refusal that costs nothing is
  // the difference between an actionable message and a Storage error the
  // caller cannot interpret.
  if (sizeBytes === 0) return fail("There are no bytes to attach.");
  if (sizeBytes > MAX_ATTACHMENT_BYTES)
    return fail(
      `That file is ${sizeBytes} bytes; the attachments bucket accepts up to 50 MB.`,
    );

  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return fail("Item not found.");

  const storagePath = input.columnId
    ? buildColumnFilePath({
        orgId: scope.orgId,
        boardId: scope.boardId,
        itemId: input.itemId,
        columnId: input.columnId,
        fileName: input.fileName,
      })
    : buildStoragePath({
        orgId: scope.orgId,
        boardId: scope.boardId,
        itemId: input.itemId,
        fileName: input.fileName,
      });

  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(storagePath, input.bytes, { contentType: input.mimeType });
  if (upErr) return fail(upErr.message);

  const registered = await createAttachmentCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: input.columnId,
      storagePath,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes,
    },
    actorId,
  );
  if (!registered.ok) {
    // We wrote these bytes, so we own them: leaving them behind would orphan an
    // object no row references and no UI can reach.
    await supabase.storage.from("attachments").remove([storagePath]);
    return fail(registered.error);
  }

  return {
    ok: true,
    data: {
      attachmentId: registered.data.attachmentId,
      storagePath,
      sizeBytes,
    },
  };
}
```

- [ ] **Step 4: Run the new tests**

```bash
pnpm vitest run --project unit src/lib/collaboration/attachment-core.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Point `attach_file`'s inline branch at the helper**

In `src/lib/mcp/tools/attach-file.ts`, replace the body of `attachFileHandler`
between the exactly-one-of guard and the `createAttachmentCore` call so the
inline branch delegates and the `storagePath` branch is untouched:

```ts
export async function attachFileHandler(
  getClient: GetClient,
  input: AttachFileInput,
  actorId: string,
): Promise<ToolResult> {
  const hasPath = input.storagePath !== undefined;
  const hasInline = input.contentBase64 !== undefined;
  if (hasPath === hasInline)
    return err(
      "Provide exactly one of `storagePath` (after uploading to a " +
        "create_attachment_upload URL) or `contentBase64` (files under 128 KB).",
    );

  const supabase = await getClient();

  if (hasInline) {
    const bytes = decodeBase64(input.contentBase64 ?? "");
    if (!bytes || bytes.byteLength === 0)
      return err("`contentBase64` is empty or not valid base64.");
    if (bytes.byteLength > MAX_INLINE_BYTES)
      return err(
        `Inline content is ${bytes.byteLength} bytes; the limit is 128 KB. ` +
          "Use create_attachment_upload for larger files.",
      );

    // One implementation of upload → register → clean up on failure, shared
    // with `create_pdf`. Only this branch owns the bytes it wrote, which is why
    // only this branch gets the clean-up (see the storagePath branch below).
    const registered = await uploadAndRegisterAttachment(
      supabase,
      {
        itemId: input.itemId,
        columnId: input.columnId,
        fileName: input.fileName,
        mimeType: input.mimeType ?? DEFAULT_MIME,
        bytes,
      },
      actorId,
    );
    if (!registered.ok) return err(registered.error);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            attachmentId: registered.data.attachmentId,
            storagePath: registered.data.storagePath,
            fileName: input.fileName,
            sizeBytes: registered.data.sizeBytes,
            mimeType: input.mimeType ?? DEFAULT_MIME,
          }),
        },
      ],
    };
  }

  // --- storagePath branch: unchanged. The bytes are the CALLER's, so size and
  // mime come from Storage and a failed register must NOT delete them.
  const scope = await resolveItemScope(supabase, input.itemId);
  if (!scope) return err("Item not found.");

  const prefix = attachmentPathPrefix({
    orgId: scope.orgId,
    boardId: scope.boardId,
    itemId: input.itemId,
    columnId: input.columnId,
  });

  const storagePath = input.storagePath ?? "";
  if (!storagePath.startsWith(prefix))
    return err("Storage path does not match this item.");

  const { data: info, error: infoErr } = await supabase.storage
    .from("attachments")
    .info(storagePath);
  if (infoErr || !info)
    return err(
      "No uploaded object at that storagePath. Upload the bytes to the " +
        "`uploadUrl` from create_attachment_upload first (tickets expire " +
        "after 2 hours).",
    );
  if (typeof info.size !== "number" || info.size <= 0)
    return err("Uploaded object reports no size.");
  const sizeBytes = info.size;
  const mimeType = info.contentType ?? input.mimeType ?? DEFAULT_MIME;

  const registered = await createAttachmentCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: input.columnId,
      storagePath,
      fileName: input.fileName,
      mimeType,
      sizeBytes,
    },
    actorId,
  );
  if (!registered.ok) return err(registered.error);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          attachmentId: registered.data.attachmentId,
          storagePath,
          fileName: input.fileName,
          sizeBytes,
          mimeType,
        }),
      },
    ],
  };
}
```

Update the imports at the top of the file: `uploadAndRegisterAttachment` joins
the `@/lib/collaboration/attachment-core` import; `buildColumnFilePath` and
`buildStoragePath` are no longer used here — **delete that import** (`pnpm lint`
fails on unused imports).

- [ ] **Step 6: Prove `attach_file` did not change behaviour**

```bash
pnpm vitest run --project unit src/lib/mcp/tools/attach-file.test.ts
```

Expected: PASS, **with the test file unmodified**. Confirm with
`git diff --stat src/lib/mcp/tools/attach-file.test.ts` — it must be empty.

- [ ] **Step 7: Canonicalise the bucket ceiling**

In `src/lib/mcp/tools/create-attachment-upload.ts`, delete the local
`MAX_BYTES` const (lines 10-11) and import the shared one, keeping the name used
in the response body:

```ts
import {
  MAX_ATTACHMENT_BYTES,
  resolveItemScope,
} from "@/lib/collaboration/attachment-core";
```

and replace the single `maxBytes: MAX_BYTES,` with `maxBytes: MAX_ATTACHMENT_BYTES,`.

```bash
pnpm vitest run --project unit src/lib/mcp/tools/create-attachment-upload.test.ts
```

Expected: PASS unmodified (its test pins the number in the JSON).

- [ ] **Step 8: Commit**

```bash
git add src/lib/collaboration/attachment-core.ts \
        src/lib/collaboration/attachment-core.test.ts \
        src/lib/mcp/tools/attach-file.ts \
        src/lib/mcp/tools/create-attachment-upload.ts
git commit -m "refactor(attachments): one upload-then-register implementation"
```

---

### Task 3: `buildAgentPdfHtml` — the printable document shell

**Files:**

- Create: `src/lib/agents/pdf-document.ts`
- Create: `src/lib/agents/pdf-document.test.ts`

**Interfaces:**

- Consumes: `parseMarkdown` (`@/lib/boards/markdown`), `renderBlocksToHtml` (Task 1).
- Produces: `export const AGENT_PDF_CSS: string`, `export function buildAgentPdfHtml(markdown: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agents/pdf-document.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AGENT_PDF_CSS, buildAgentPdfHtml } from "./pdf-document";

describe("buildAgentPdfHtml", () => {
  it("produces one self-contained document", () => {
    const html = buildAgentPdfHtml("# Title\n\nBody text.");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body text.</p>");
    expect(html.endsWith("</html>")).toBe(true);
  });

  it("inlines the stylesheet rather than linking one", () => {
    const html = buildAgentPdfHtml("x");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
  });

  /**
   * THE load-bearing test. `renderHtmlToPdf` runs `setContent(..., { waitUntil:
   * "networkidle" })`, so anything this document references, Chromium fetches —
   * from inside our own function, with our own network position. The document
   * must reference nothing.
   */
  it("references no external resource", () => {
    const html = buildAgentPdfHtml(
      "# T\n\n<img src=http://169.254.169.254/latest/meta-data/>\n\n" +
        "<script src='https://evil.example/x.js'></script>\n\n" +
        "<iframe src='https://evil.example'></iframe>",
    );
    expect(html).not.toMatch(/<img|<script|<iframe|<link|<object|<embed/i);
    expect(html).not.toMatch(/url\(|@import|@font-face/i);
  });

  it("keeps the stylesheet free of anything fetchable", () => {
    expect(AGENT_PDF_CSS).not.toMatch(/url\(|@import|@font-face/i);
  });

  it("still produces a valid document for empty markdown", () => {
    const html = buildAgentPdfHtml("");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.endsWith("</html>")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/agents/pdf-document.test.ts
```

Expected: FAIL — `Failed to resolve import "./pdf-document"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agents/pdf-document.ts`:

```ts
import { parseMarkdown } from "@/lib/boards/markdown";
import { renderBlocksToHtml } from "@/lib/boards/markdown-html";

/**
 * The printable document an agent's Markdown becomes.
 *
 * Self-contained BY REQUIREMENT, not by preference: `renderHtmlToPdf`
 * (`src/lib/reports/pdf.ts:31`) calls `setContent(..., { waitUntil:
 * "networkidle" })`, so every reference in this document would be fetched by
 * Chromium from inside our serverless function. The AST cannot express an
 * image, a script or raw HTML, the renderer escapes everything, and the CSS
 * below carries no `url(`, `@import` or `@font-face` — so there is nothing to
 * fetch and `networkidle` settles immediately.
 *
 * Visual register deliberately matches `src/lib/reports/report-css.ts` (same
 * system sans, same ink/muted/rule palette, hierarchy from size and weight
 * rather than a typeface) without importing it: that stylesheet is written
 * around the report's own block classes, none of which this markup uses.
 *
 * Pure and dependency-free — no `server-only`, no DOM.
 */
export const AGENT_PDF_CSS = `
  :root { --ink:#1a1c22; --muted:#7c8290; --line:#e7e8ee; --peri:#5866c4; }
  * { box-sizing:border-box; }
  body {
    margin:0; color:var(--ink); background:#fff;
    font:12.5px/1.65 -apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .doc { padding:0 2mm; }
  h1,h2,h3 { line-height:1.25; letter-spacing:-.01em; margin:0 0 8px; page-break-after:avoid; }
  h1 { font-size:26px; font-weight:700; margin-top:0; padding-bottom:10px; border-bottom:2px solid var(--ink); }
  h2 { font-size:17px; font-weight:600; margin-top:22px; }
  h3 { font-size:11px; font-weight:600; margin-top:16px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
  p { margin:0 0 10px; }
  ul,ol { margin:0 0 10px; padding-left:20px; }
  li { margin:0 0 4px; }
  blockquote { margin:0 0 12px; padding-left:11px; border-left:2px solid var(--peri); color:#3a3f4b; }
  code {
    font:11.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
    background:#f4f5f8; border:1px solid var(--line); border-radius:3px; padding:0 3px;
  }
  a { color:var(--peri); text-decoration:none; }
  strong { font-weight:600; }
  del { color:var(--muted); }
`;

/** Markdown → one complete, self-contained HTML document. */
export function buildAgentPdfHtml(markdown: string): string {
  const body = renderBlocksToHtml(parseMarkdown(markdown));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<style>${AGENT_PDF_CSS}</style></head>` +
    `<body><main class="doc">${body}</main></body></html>`
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm vitest run --project unit src/lib/agents/pdf-document.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/pdf-document.ts src/lib/agents/pdf-document.test.ts
git commit -m "feat(agents): printable document shell for agent-authored pdfs"
```

---

### Task 4: The `create_pdf` tool

**Files:**

- Create: `src/lib/agents/create-pdf.ts`
- Create: `src/lib/agents/create-pdf.test.ts`

**Interfaces:**

- Consumes: `buildAgentPdfHtml` (Task 3); `uploadAndRegisterAttachment`, `resolveItemScope` (Task 2); `PdfOptions` (type only, `@/lib/reports/pdf`); `ToolDescriptor`, `ToolResult`.
- Produces:
  - `export type RenderPdf = (html: string, opts: PdfOptions) => Promise<Buffer>;`
  - `export function makeCreatePdfDescriptor(deps: { render: RenderPdf; attach: typeof uploadAndRegisterAttachment }): ToolDescriptor`
  - `export const createPdfDescriptor: ToolDescriptor`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agents/create-pdf.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";
import type { uploadAndRegisterAttachment } from "@/lib/collaboration/attachment-core";
import type { ToolInvokeContext } from "@/lib/mcp/tools/descriptor";
import { makeCreatePdfDescriptor, type RenderPdf } from "./create-pdf";

const ITEM = "11111111-1111-4111-8111-111111111111";
const COLUMN = "22222222-2222-4222-8222-222222222222";
const ACTOR = "00000000-0000-4000-8000-000000000001";

type Attach = typeof uploadAndRegisterAttachment;

const PDF = Buffer.from("%PDF-1.4 pretend");

function ctx(
  spec: Parameters<typeof makeFakeClient>[0] = {},
): ToolInvokeContext {
  const fake = makeFakeClient(spec);
  return { getClient: fake.getClient, actorId: ACTOR };
}

const okRender: RenderPdf = async () => PDF;
const okAttach: Attach = async () => ({
  ok: true,
  data: {
    attachmentId: "att-1",
    storagePath: "o1/b1/i1/x.pdf",
    sizeBytes: PDF.byteLength,
  },
});

const spyRender = () => vi.fn<RenderPdf>(okRender);
const spyAttach = () => vi.fn<Attach>(okAttach);

function tool(deps: { render?: RenderPdf; attach?: Attach } = {}) {
  return makeCreatePdfDescriptor({
    render: deps.render ?? okRender,
    attach: deps.attach ?? okAttach,
  });
}

describe("create_pdf", () => {
  it("declares the capability and scope the grant gate keys off", () => {
    expect(tool()).toMatchObject({
      name: "create_pdf",
      capability: "files.write",
      scope: "itemId",
    });
  });

  it("renders portrait A4 and attaches the bytes as application/pdf", async () => {
    const render = spyRender();
    const attach = spyAttach();
    const r = await tool({ render, attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "q3-review",
      content: "# Q3\n\nAll good.",
    });
    expect(r.isError).toBeUndefined();
    // The renderer is handed our own document and the fixed orientation.
    expect(render.mock.calls[0][0]).toContain("<h1>Q3</h1>");
    expect(render.mock.calls[0][1]).toEqual({ landscape: false });
    // Nothing about the stored row is model-asserted except the name.
    expect(attach.mock.calls[0][1]).toMatchObject({
      itemId: ITEM,
      fileName: "q3-review.pdf",
      mimeType: "application/pdf",
    });
    expect(attach.mock.calls[0][1].bytes).toBe(PDF);
    expect(attach.mock.calls[0][2]).toBe(ACTOR);
    expect(JSON.parse(r.content[0].text)).toMatchObject({
      ok: true,
      attachmentId: "att-1",
      fileName: "q3-review.pdf",
      bytes: PDF.byteLength,
    });
  });

  it("passes columnId through so a Files column can be targeted", async () => {
    const attach = spyAttach();
    await tool({ attach }).invoke(ctx(), {
      itemId: ITEM,
      columnId: COLUMN,
      fileName: "a",
      content: "x",
    });
    expect(attach.mock.calls[0][1]).toMatchObject({ columnId: COLUMN });
  });

  it("does not double-append an extension the caller already supplied", async () => {
    const attach = spyAttach();
    await tool({ attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "BRIEF.PDF",
      content: "x",
    });
    expect(attach.mock.calls[0][1].fileName).toBe("BRIEF.PDF");
  });

  it("refuses source over 128 KB BEFORE launching a browser", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x".repeat(131_073),
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/128 KB/);
    expect(render).not.toHaveBeenCalled();
  });

  it("accepts source exactly at the ceiling", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x".repeat(131_072),
    });
    expect(r.isError).toBeUndefined();
    expect(render).toHaveBeenCalledTimes(1);
  });

  // A hallucinated id must not cost a Chromium launch.
  it("fails fast on an unknown item without rendering", async () => {
    const render = spyRender();
    const r = await tool({ render }).invoke(
      ctx({ itemScope: { data: null, error: null } }),
      { itemId: ITEM, fileName: "a", content: "x" },
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Item not found.");
    expect(render).not.toHaveBeenCalled();
  });

  it("surfaces a render failure as an actionable tool error", async () => {
    const attach = spyAttach();
    const r = await tool({
      render: async () => {
        throw new Error("Chromium exited");
      },
      attach,
    }).invoke(ctx(), { itemId: ITEM, fileName: "a", content: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Chromium exited");
    expect(attach).not.toHaveBeenCalled();
  });

  it("gives up on a render that overruns, and a late rejection does not throw", async () => {
    vi.useFakeTimers();
    let reject: (e: Error) => void = () => {};
    const render: RenderPdf = () =>
      new Promise<Buffer>((_, rej) => {
        reject = rej;
      });
    const attach = spyAttach();
    const pending = tool({ render, attach }).invoke(ctx(), {
      itemId: ITEM,
      fileName: "a",
      content: "x",
    });
    await vi.advanceTimersByTimeAsync(45_000);
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/45 seconds/);
    expect(attach).not.toHaveBeenCalled();
    // The abandoned render settling later must not become an unhandled
    // rejection that takes the whole run down.
    reject(new Error("too late"));
    await vi.advanceTimersByTimeAsync(0);
    vi.useRealTimers();
  });

  it("surfaces the attach helper's failure verbatim", async () => {
    const r = await tool({
      attach: async () => ({ ok: false, error: "Invalid file column." }),
    }).invoke(ctx(), { itemId: ITEM, fileName: "a", content: "x" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("Invalid file column.");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/agents/create-pdf.test.ts
```

Expected: FAIL — `Failed to resolve import "./create-pdf"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agents/create-pdf.ts`:

```ts
import { z } from "zod";
import type { PdfOptions } from "@/lib/reports/pdf";
import {
  resolveItemScope,
  uploadAndRegisterAttachment,
} from "@/lib/collaboration/attachment-core";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";
import { buildAgentPdfHtml } from "./pdf-document";

/** Server-chosen, never model-supplied — the same closed-set discipline
 *  `FILE_FORMATS` applies in `create-file.ts`. */
const PDF_MIME = "application/pdf";

/**
 * The ceiling on the MARKDOWN SOURCE, and it is the same 131_072 as
 * `create-file.ts:25` for the same reason, duplicated as a literal for the
 * reason stated there: it bounds what one tool call carries and what a
 * proposal row stores for up to seven days.
 *
 * It is deliberately NOT a ceiling on the PDF. Those bytes are produced by
 * Chromium inside this invocation, never emitted by a model and never carried
 * across a tool boundary, so they cost no context; they are bounded instead by
 * `MAX_ATTACHMENT_BYTES` (the bucket's own 50 MB) inside
 * `uploadAndRegisterAttachment`. Two quantities, two ceilings, two rationales.
 */
const MAX_SOURCE_BYTES = 131_072;

/**
 * How long one render may take before this tool gives up.
 *
 * The agent run route inherits the platform's function timeout; this bound sits
 * inside it so a pathological document degrades ONE STEP (`tools.ts` turns the
 * refusal into `{ error }` and the loop continues) instead of killing an
 * unattended 07:00 run that still has a briefing to write and send.
 */
const RENDER_TIMEOUT_MS = 45_000;

export type RenderPdf = (html: string, opts: PdfOptions) => Promise<Buffer>;

const createPdfInput = {
  itemId: z.string().uuid(),
  columnId: z.string().uuid().optional(),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1),
};

type CreatePdfInput = {
  itemId: string;
  columnId?: string;
  fileName: string;
  content: string;
};

function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

const TIMED_OUT = Symbol("pdf-render-timeout");

/**
 * Resolve `work`, or `TIMED_OUT` if it takes longer than `ms`.
 *
 * The losing promise is NOT cancellable — Chromium keeps going until its own
 * `finally` closes the browser — so it gets a no-op catch: a rejection landing
 * after the race has been decided would otherwise be an unhandled rejection,
 * which in Node can take the process with it. The timer is `unref`'d and
 * cleared so it can never hold the function open on the success path.
 */
async function raceTimeout<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Builds the `create_pdf` descriptor over an injected renderer and attacher.
 *
 * The factory IS the dependency seam, exactly as in `create-file.ts:65-74`:
 * `ToolDescriptor.invoke` takes `(ctx, input)` and nothing else, so a test
 * builds its own descriptor rather than passing a fake third argument — which
 * is what keeps headless Chromium out of the unit suite entirely.
 */
export function makeCreatePdfDescriptor(deps: {
  render: RenderPdf;
  attach: typeof uploadAndRegisterAttachment;
}): ToolDescriptor {
  return {
    name: "create_pdf",
    title: "Create PDF",
    description:
      "Write a report as a PDF and attach it to an item. Put the document's " +
      "MARKDOWN in `content` — headings (#, ##, ###), paragraphs, bullet and " +
      "numbered lists, > quotes, **bold**, *italic*, `code` and [links]" +
      "(https://…). Do NOT write HTML: any tag you type appears in the PDF as " +
      "literal text. Tables and images are not supported. The server renders " +
      "the document to A4 portrait and stores it; `.pdf` is appended to " +
      "`fileName` unless you already included it. Omit `columnId` for an " +
      "item-level attachment, or pass a Files column's id to write into that " +
      "cell. Source is limited to 128 KB of Markdown. The result reports the " +
      "new attachment's `attachmentId` — use it to refer to this file in any " +
      "later call — and the stored PDF's byte count.",
    inputSchema: createPdfInput,
    capability: "files.write",
    scope: "itemId",
    invoke: async (ctx, raw): Promise<ToolResult> => {
      // Validated against `inputSchema` by both transports before we get here.
      const input = raw as CreatePdfInput;

      const fileName = input.fileName.toLowerCase().endsWith(".pdf")
        ? input.fileName
        : `${input.fileName}.pdf`;

      const sourceBytes = Buffer.byteLength(input.content, "utf8");
      // Refuse HERE, with the limit named, and before anything expensive.
      if (sourceBytes > MAX_SOURCE_BYTES)
        return err(
          `That document is ${sourceBytes} bytes; create_pdf accepts up to ` +
            "128 KB of Markdown source. Write a shorter document, or split " +
            "it across several files.",
        );

      // Exactly once per invocation (shared.ts:11-14): each call charges the
      // rate limit and rotates the OAuth bridge secret.
      const supabase = await ctx.getClient();

      // The id is MODEL-CHOSEN and may not exist. One indexed PK read here is
      // far cheaper than discovering it after a 5-45s browser launch — and the
      // read is the same one `uploadAndRegisterAttachment` and
      // `createAttachmentCore` each repeat, which is not skippable there
      // (attachment-core.ts:59-62: re-deriving tenancy IS the spoof guard).
      const scope = await resolveItemScope(supabase, input.itemId);
      if (!scope) return err("Item not found.");

      const html = buildAgentPdfHtml(input.content);

      let pdf: Buffer;
      try {
        const rendered = await raceTimeout(
          // Portrait A4 always: the supported Markdown has no wide block, and
          // fixing it here keeps `src/lib/reports/pdf.ts` — shared with report
          // export — untouched by this feature.
          deps.render(html, { landscape: false }),
          RENDER_TIMEOUT_MS,
        );
        if (rendered === TIMED_OUT)
          return err(
            "Rendering that document took longer than 45 seconds. Try a " +
              "shorter document.",
          );
        pdf = rendered;
      } catch (e) {
        return err(
          e instanceof Error ? e.message : "Could not render the PDF.",
        );
      }

      const registered = await deps.attach(
        supabase,
        {
          itemId: input.itemId,
          columnId: input.columnId,
          fileName,
          mimeType: PDF_MIME,
          bytes: pdf,
        },
        ctx.actorId,
      );
      if (!registered.ok) return err(registered.error);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              attachmentId: registered.data.attachmentId,
              fileName,
              // The REAL stored size, straight off the typed result — this path
              // never stringifies the id, so it needs no defensive re-parse of
              // its own output the way `create_file` does.
              bytes: registered.data.sizeBytes,
            }),
          },
        ],
      };
    },
  };
}

export const createPdfDescriptor = makeCreatePdfDescriptor({
  /**
   * LAZY on purpose. `AGENT_ONLY_DESCRIPTORS` is imported by
   * `proposal-actions.ts` and `proposal-targets.ts`, which `/settings/agents`
   * renders; a static import would pull `playwright-core` and
   * `@sparticuz/chromium` into that route's module graph for a page that never
   * renders a PDF. Same reason `export-html.tsx:14-18` defers
   * `react-dom/server`. The `PdfOptions` import above is type-only and erased.
   */
  render: async (html, opts) =>
    (await import("@/lib/reports/pdf")).renderHtmlToPdf(html, opts),
  attach: uploadAndRegisterAttachment,
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm vitest run --project unit src/lib/agents/create-pdf.test.ts
```

Expected: PASS, 10 tests.

If the fake-timer test hangs, the cause is `await ctx.getClient()` resolving on
a microtask the fake timers do not advance — add `await vi.advanceTimersByTimeAsync(0)`
before the 45 s advance rather than reaching for real timers.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/create-pdf.ts src/lib/agents/create-pdf.test.ts
git commit -m "feat(agents): create_pdf tool renders markdown to an attached pdf"
```

---

### Task 5: The approval sentence

**Files:**

- Modify: `src/lib/agents/proposal-summary.ts` (add a case before `default:` in `sentenceFor`, ~line 348)
- Modify: `src/lib/agents/proposal-summary.test.ts`

**Interfaces:**

- Consumes: the module's existing private helpers `str`, `quoted`, `formatBytes`, `utf8Bytes`.
- Produces: `summariseProposal("create_pdf", input)` returns a sentence instead of the `Run create_pdf.` fallback.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/agents/proposal-summary.test.ts` (match the file's existing
`describe`/import style — read it first):

```ts
describe("summariseProposal — create_pdf", () => {
  it("names the file that will exist and the size of the SOURCE", () => {
    expect(
      summariseProposal("create_pdf", {
        itemId: "11111111-1111-4111-8111-111111111111",
        fileName: "q3-review",
        content: "x".repeat(4300),
      }),
    ).toBe(
      'Render "q3-review.pdf" from 4.2 KB of Markdown and attach it to an item.',
    );
  });

  it("does not double-append an extension the model already supplied", () => {
    expect(
      summariseProposal("create_pdf", { fileName: "brief.PDF", content: "x" }),
    ).toContain('"brief.PDF"');
  });

  // The PDF does not exist until approval renders it, so any output size on
  // this card would be a guess presented as a fact — the same rule attach_file's
  // storagePath branch already follows.
  it("states no output size", () => {
    const s = summariseProposal("create_pdf", {
      fileName: "a",
      content: "x".repeat(1000),
    });
    expect(s).toContain("of Markdown");
    expect(s).not.toMatch(/PDF is|resulting|output/i);
  });

  it("falls back to Run create_pdf. when the input is unreadable", () => {
    expect(summariseProposal("create_pdf", { fileName: "a" })).toBe(
      "Run create_pdf.",
    );
    expect(summariseProposal("create_pdf", { content: "x" })).toBe(
      "Run create_pdf.",
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/agents/proposal-summary.test.ts
```

Expected: FAIL — the first three cases receive `"Run create_pdf."`.

- [ ] **Step 3: Add the case**

In `src/lib/agents/proposal-summary.ts`, insert immediately after the
`case "create_file":` block and before `case "log_time_allocation":`:

```ts
    case "create_pdf": {
      const fileName = str(input, "fileName");
      const content = typeof input.content === "string" ? input.content : null;
      if (!fileName || content === null) return undefined;
      // Mirrors create-pdf.ts: the tool appends `.pdf` unless the model already
      // did. The card must name the file that will exist.
      const named = fileName.toLowerCase().endsWith(".pdf")
        ? fileName
        : `${fileName}.pdf`;
      // The SOURCE size, never the PDF's. The document does not exist until
      // approving this proposal renders it, so an output size here would be a
      // guess presented as a fact — the same reason `attach_file`'s
      // storagePath branch states none.
      return `Render ${quoted(named)} from ${formatBytes(utf8Bytes(content))} of Markdown and attach it to an item.`;
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm vitest run --project unit src/lib/agents/proposal-summary.test.ts
```

Expected: PASS — the whole file, including its existing cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/proposal-summary.ts src/lib/agents/proposal-summary.test.ts
git commit -m "feat(agents): describe a create_pdf proposal on the approval card"
```

---

### Task 6: Wiring — offer the tool, gate it, approve it

**Files:**

- Modify: `src/lib/agents/agent-only-tools.ts:20-23`
- Modify: `src/lib/agents/agent-only-tools.test.ts:25` (the `NAMES` const) and its capability assertion
- Create: `src/lib/agents/proposal-actions.create-pdf.test.ts`
- Modify: `src/app/api/ai/personal-agent/route.ts` (one added line)

**Interfaces:**

- Consumes: `createPdfDescriptor` (Task 4), the `create_pdf` summary case (Task 5).
- Produces: `create_pdf` present in `AGENT_ONLY_DESCRIPTORS`, therefore in `buildAgentTools`, `makeGrantGate`, `DESCRIPTORS_BY_NAME` (`proposal-actions.ts:124`) and `SCOPE_BY_TOOL` (`proposal-targets.ts:67`) — all through the one composition, with no further call site.

- [ ] **Step 1: Extend the wiring test first**

In `src/lib/agents/agent-only-tools.test.ts`, change line 25 and the capability
assertion:

```ts
const NAMES = ["create_file", "create_automation", "create_pdf"];
```

and inside the `"declares the capabilities the grant gate keys off"` test, after
the `create_automation` assertion, add:

```ts
expect(byName.get("create_pdf")).toMatchObject({
  capability: "files.write",
  scope: "itemId",
});
```

Also update the first test's title to mention the third tool.

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm vitest run --project unit src/lib/agents/agent-only-tools.test.ts
```

Expected: FAIL — `create_pdf` is neither offered by `buildAgentTools` nor found
in `byName`.

- [ ] **Step 3: Wire the descriptor**

In `src/lib/agents/agent-only-tools.ts`:

```ts
import { createPdfDescriptor } from "./create-pdf";
```

```ts
export const AGENT_ONLY_DESCRIPTORS: readonly ToolDescriptor[] = [
  createFileDescriptor,
  createAutomationDescriptor,
  createPdfDescriptor,
];
```

Extend the module docstring's second paragraph so the third tool is explained
rather than merely present:

```
 * a caller that emits a document as text in the same turn, `create_automation`
 * is a standing, org-visible side effect that belongs behind the agent's
 * capability grant rather than a generic bearer token, and `create_pdf` renders
 * a document the CALLER authored in the same turn — a remote MCP client that
 * already holds bytes wants `attach_file`, not a Chromium launch.
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
pnpm vitest run --project unit src/lib/agents/agent-only-tools.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the approve-path test through the REAL descriptor**

Create `src/lib/agents/proposal-actions.create-pdf.test.ts`. It mirrors the
recipe in `proposal-actions.real-descriptor.test.ts` (read that file first —
same mocks, same `beforeEach` shape) but drives `create_pdf`, which needs the
attachment-shaped fake client rather than the automation one, and so cannot
share that file's module-level `fake`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeClient } from "@/test/mcp-fake-client";

/**
 * The approve path END TO END through the REAL `create_pdf` descriptor.
 *
 * `proposal-actions.test.ts` mocks `./tool-descriptors` wholesale, so nothing
 * there ever drives a real tool. `proposal-actions.real-descriptor.test.ts`
 * joins that seam for `create_automation`; this file joins it for `create_pdf`,
 * which needs a different client fake (Storage + attachments rather than
 * automation rules) and therefore its own module-level mock.
 *
 * Only Chromium is mocked. The descriptor, its schema re-validation, the
 * markdown pipeline and the attachment write are all real.
 */

const requireUser = vi.fn();
const getProposalForDecision = vi.fn();
const claimProposalDecision = vi.fn();
const settleProposalOutcome = vi.fn();

let fake = makeFakeClient({});

vi.mock("@/lib/auth/session", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake.getClient(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./proposals-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./proposals-db")>()),
  getProposalForDecision: (...a: unknown[]) => getProposalForDecision(...a),
  claimProposalDecision: (...a: unknown[]) => claimProposalDecision(...a),
  settleProposalOutcome: (...a: unknown[]) => settleProposalOutcome(...a),
}));
// The one thing that must not really happen in a unit run.
vi.mock("@/lib/reports/pdf", () => ({
  renderHtmlToPdf: vi.fn(async () => Buffer.from("%PDF-1.4 pretend")),
}));

const { decideProposal } = await import("./proposal-actions");

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const DAY_MS = 24 * 60 * 60 * 1000;

function proposal(input: Record<string, unknown>) {
  return {
    id: PROPOSAL_ID,
    userAgentId: "agent-1",
    runId: "run-1",
    orgId: "org-1",
    ownerId: OWNER,
    capability: "files.write",
    toolName: "create_pdf",
    toolCallId: "call-1",
    input,
    summary: "…",
    status: "pending",
    expiresAt: new Date(Date.now() + 6 * DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - DAY_MS).toISOString(),
    result: null,
  };
}

beforeEach(() => {
  fake = makeFakeClient({});
  requireUser.mockReset().mockResolvedValue({ id: OWNER });
  getProposalForDecision.mockReset();
  claimProposalDecision.mockReset().mockResolvedValue(true);
  settleProposalOutcome.mockReset().mockResolvedValue(true);
});

describe("decideProposal — create_pdf", () => {
  it("renders and attaches when the owner approves", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ itemId: ITEM, fileName: "brief", content: "# Hi\n\nThere." }),
    );
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(r.ok).toBe(true);
    expect(fake.calls.storage.map((s) => s.op)).toEqual(["upload"]);
    expect(fake.calls.attachments[0]).toMatchObject({
      mime_type: "application/pdf",
      // The APPROVER is the actor, exactly as for every other approved tool.
      uploaded_by: OWNER,
    });
  });

  // Step 5 of decideProposal: a blob stored days ago is re-validated against
  // the tool's CURRENT schema before anything executes.
  it("refuses a stored blob that no longer satisfies the schema", async () => {
    getProposalForDecision.mockResolvedValue(
      proposal({ itemId: ITEM, fileName: "brief" }),
    );
    const r = await decideProposal({ id: PROPOSAL_ID, approve: true });
    expect(r.ok).toBe(false);
    expect(fake.calls.storage).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run it**

```bash
pnpm vitest run --project unit src/lib/agents/proposal-actions.create-pdf.test.ts
```

Expected: PASS, 2 tests. If `makeFakeClient`'s `getClient` is single-use or
counts invocations, hold one resolved client in the mock closure instead of
calling `fake.getClient()` per `createClient` call — read `src/test/mcp-fake-client.ts`
before adjusting, and adjust the **test**, never the handler's one-call rule.

- [ ] **Step 7: Give the render room to finish**

At the top of `src/app/api/ai/personal-agent/route.ts`, below the imports and
above `const FEATURE = "personal_agent_run";`, add:

```ts
/**
 * A run may now launch headless Chromium (`create_pdf`), which is by far the
 * slowest thing one step can do. The tool bounds a single render at 45 s and
 * degrades that step rather than the run — but only if the platform gives the
 * function room to reach that bound; a function killed underneath it loses the
 * whole run and leaves a CLAIM_PLACEHOLDER audit row. Stated explicitly here
 * rather than inherited from a platform default that can change.
 */
export const maxDuration = 300;
```

**If the owner declined this change** (spec §13 Q2), skip this step entirely —
nothing else in the slice depends on it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents/agent-only-tools.ts \
        src/lib/agents/agent-only-tools.test.ts \
        src/lib/agents/proposal-actions.create-pdf.test.ts \
        src/app/api/ai/personal-agent/route.ts
git commit -m "feat(agents): offer create_pdf to personal agents"
```

---

### Task 7: Gates, real render, and closure

**Files:** none created; this task verifies.

**Interfaces:**

- Consumes: everything above.
- Produces: a merged `develop` and a deleted worktree.

- [ ] **Step 1: Run the full gates**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. `pnpm test` runs the `unit`, `conformance` and
`fixtures` projects; the integration project is skipped without `PULSE_TEST_DB`.

- [ ] **Step 2: Prove a real PDF actually renders (once, locally)**

The unit suite never launches a browser, so exercise the real renderer through
the real pipeline once. Requires local Google Chrome (`pdf.ts:26` uses
`channel: "chrome"` off-serverless).

```bash
cat > /tmp/pdf-smoke.ts <<'TS'
import { writeFileSync } from "node:fs";
import { buildAgentPdfHtml } from "@/lib/agents/pdf-document";
import { renderHtmlToPdf } from "@/lib/reports/pdf";

const md = `# Weekly status

Three things moved this week.

## Shipped
- Board folders
- **Agent** documents

> Next week: the PDF verb.

Inline \`code\` and a [link](https://monolith.works).`;

const bytes = await renderHtmlToPdf(buildAgentPdfHtml(md), { landscape: false });
console.log("bytes:", bytes.byteLength, "header:", bytes.subarray(0, 4).toString("latin1"));
writeFileSync("/tmp/pdf-smoke.pdf", bytes);
TS
pnpm tsx /tmp/pdf-smoke.ts && open /tmp/pdf-smoke.pdf
```

Expected: `header: %PDF`, a non-trivial byte count, and a document whose
headings, list, quote, bold, inline code and link all render. Delete
`/tmp/pdf-smoke.ts` and `/tmp/pdf-smoke.pdf` afterwards — neither is committed.

- [ ] **Step 3: Confirm the settings route did not gain Chromium**

```bash
grep -rn "playwright\|sparticuz" src/lib/agents/create-pdf.ts
```

Expected: no static `import` of either — only the `await import("@/lib/reports/pdf")`
inside `createPdfDescriptor`, and the type-only `PdfOptions` import.

- [ ] **Step 4: Confirm nothing owned by the concurrent slice was touched**

```bash
git diff --stat origin/develop... -- \
  src/lib/agents/run-loop.ts src/lib/agents/document-inject.ts \
  src/lib/agents/capabilities.ts src/lib/agents/capability-copy.ts \
  src/components/agents/AgentEditor.tsx src/components/agents/CapabilityToggles.tsx \
  src/lib/reports/pdf.ts
```

Expected: empty output.

- [ ] **Step 5: Finish the task**

From inside the worktree:

```bash
scripts/finish-task.sh
```

It rebases onto the latest `develop`, re-runs the gates against the merged
state, merges, pushes, and removes the worktree and branch. A task is not
complete until this has succeeded.

- [ ] **Step 6: Hand the user the manual-test walkthrough**

Reproduce spec §14 verbatim in the closing message and in the `/wrapup` session
note, under "How to test".

---

## Self-review

**Spec coverage**

| Spec section                               | Task                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| §3.2 two ceilings                          | Task 4 (`MAX_SOURCE_BYTES`), Task 2 (`MAX_ATTACHMENT_BYTES`)                                |
| §3.4 nothing caller-asserted               | Task 2 Step 3 + Task 4 test "renders portrait A4 and attaches the bytes as application/pdf" |
| §4 descriptor, input, output, error table  | Task 4                                                                                      |
| §5 markdown-only pipeline + escaping       | Tasks 1 and 3                                                                               |
| §6.1 timeout, both measures                | Task 4 (`raceTimeout`), Task 6 Step 7 (`maxDuration`)                                       |
| §6.2 fixed A4 portrait, `pdf.ts` untouched | Task 4 + Task 7 Step 4                                                                      |
| §7.1 `files.write` reused                  | Task 4 descriptor + Task 6 Step 1 assertion                                                 |
| §7.2 approval sentence                     | Task 5                                                                                      |
| §8 attachment write path                   | Task 2                                                                                      |
| §9(a) lazy Chromium import                 | Task 4 + Task 7 Step 3                                                                      |
| §9(c) bounded indexed reads                | Task 4 (single `resolveItemScope` pre-check, documented)                                    |
| §11 testing                                | Tasks 1-6, each TDD                                                                         |
| §14 manual acceptance                      | Task 7 Step 6                                                                               |

**Placeholders:** none. Every code step carries the code; every test step
carries the assertions; the two "if this fails, do X" notes name a concrete
adjustment and forbid the wrong fix.

**Type consistency:** `renderBlocksToHtml(Block[]) → string` (Task 1) is what
Task 3 calls. `uploadAndRegisterAttachment(supabase, {itemId, columnId?,
fileName, mimeType, bytes}, actorId) → ActionResult<{attachmentId, storagePath,
sizeBytes}>` (Task 2) is the shape Task 2 Step 5 and Task 4 both call and the
shape Task 4's `okAttach` fake returns. `RenderPdf = (html, PdfOptions) =>
Promise<Buffer>` (Task 4) matches `renderHtmlToPdf`'s real signature
(`pdf.ts:14-17`). `create_pdf` / `files.write` / `itemId` are spelled
identically in Tasks 4, 5 and 6.
