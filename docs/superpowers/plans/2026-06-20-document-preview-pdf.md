# Inline PDF Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `application/pdf` attachments inline (client-side PDF.js) in the existing preview lightbox, on both the item Files tab and the board Files cell — no new backend service.

**Architecture:** A new client-only `PdfPreview` component fetches PDF bytes via a short-TTL signed URL and renders pages to `<canvas>` with PDF.js in a worker (no embedded-JS execution). `FilePreviewLightbox` gains a `kind === "pdf"` branch that lazy-loads `PdfPreview` (`next/dynamic`, `ssr: false`) and fetches the URL from a new PDF-only signing action. Card/Row gain a Preview affordance for PDFs via a pure `canPreviewInline` helper. No schema change.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, TypeScript (strict), Zod, Supabase Storage (signed URLs), `pdfjs-dist`, Vitest + @testing-library/react, Playwright.

## Global Constraints

- **No new backend service, no third-party data egress.** PDF bytes are `fetch`ed by the client and drawn to canvas; never an `<iframe>`/`<embed>`/tab pointed at a PDF. (spec §4)
- **Do not widen `isPreviewable`.** It gates the raster/video signed-`<img>` path; PDFs use the dedicated `getAttachmentPdfUrl` action only. (spec §2.3)
- **PDF.js must not execute embedded JS** — never set `enableScripting`. (spec §4)
- **`pdfjs-dist` is client-only** — imported via `next/dynamic` with `{ ssr: false }` from the lightbox; never in a server module. (spec §2.1)
- **TS strict, Zod at boundaries, Server Components by default**; this is Next.js 16 — verify framework APIs against `node_modules/next/dist/docs/` (AGENTS.md).
- **Commit hygiene:** stage explicitly by path (`git add <paths>`), never `git add -A`. Commit subjects lowercase after `type(scope):`. Co-author trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Gates before "done":** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

---

## File Structure

| File                                                            | Responsibility                             | Task       |
| --------------------------------------------------------------- | ------------------------------------------ | ---------- |
| `src/lib/collaboration/attachments-format.ts`                   | + `isPdf`, `canPreviewInline` pure helpers | A (modify) |
| `src/lib/collaboration/attachments-format.test.ts`              | + tests for the helpers                    | A (modify) |
| `src/lib/validations/collaboration-actions.ts`                  | + `attachmentPdfUrlSchema`                 | B (modify) |
| `src/lib/collaboration/actions.ts`                              | + `getAttachmentPdfUrl` action             | B (modify) |
| `src/lib/collaboration/attachments-actions.test.ts`             | + tests for the action                     | B (modify) |
| `src/components/boards/item-panel/PdfPreview.tsx`               | **New** client-only PDF.js renderer        | C (create) |
| `src/components/boards/item-panel/PdfPreview.test.tsx`          | **New** component test (pdfjs mocked)      | C (create) |
| `package.json` / lockfile                                       | + `pdfjs-dist` dependency                  | C (modify) |
| `src/components/boards/item-panel/AttachmentCard.tsx`           | Preview affordance for PDFs                | D (modify) |
| `src/components/boards/item-panel/AttachmentRow.tsx`            | Preview affordance for PDFs                | D (modify) |
| `src/components/boards/item-panel/FilePreviewLightbox.tsx`      | `kind === "pdf"` render branch + URL fetch | E (modify) |
| `src/components/boards/item-panel/FilePreviewLightbox.test.tsx` | update fallback test + add PDF-branch test | E (modify) |
| `e2e/item-pdf-preview.spec.ts`                                  | **New** upload → lightbox → canvas e2e     | F (create) |

---

## Execution DAG (per AGENTS.md §6)

**Dependency edges** (from each task's `Interfaces`):

- A — none
- B — none
- C — none
- D — depends on **A** (`canPreviewInline`)
- E — depends on **B** (`getAttachmentPdfUrl`) and **C** (`PdfPreview`)
- F — depends on **D** and **E**

**Parallel batches** (each batch = one wave of concurrent agents; tasks that mutate files run in isolated git worktrees per `superpowers:using-git-worktrees`):

- **Batch 1 (3 concurrent):** A, B, C — fully independent (different files/subsystems)
- **Batch 2 (2 concurrent):** D, E — D needs A; E needs B+C; D and E touch different files
- **Batch 3 (1):** F — needs D + E

**Critical path (wall-clock floor):** `C → E → F` (or `B → E → F`) — depth **3**. Batch 1 collapses the three independent streams (helper / signing / renderer) into one wave; only the UI convergence (E) and the end-to-end check (F) are inherently serial.

**Dispatch note:** Batch 1's three tasks and Batch 2's two tasks should each be dispatched as concurrent agents (`superpowers:dispatching-parallel-agents`), each in its own worktree, since they edit overlapping directories.

---

### Task A: `isPdf` / `canPreviewInline` helpers

Pure helpers so Card/Row/Lightbox share one definition of "can this open an inline preview" without widening the signing allow-list.

**Files:**

- Modify: `src/lib/collaboration/attachments-format.ts`
- Test: `src/lib/collaboration/attachments-format.test.ts`

**Interfaces:**

- Consumes: existing `isPreviewable(mime: string): boolean` from the same module.
- Produces:
  - `isPdf(mime: string): boolean`
  - `canPreviewInline(mime: string): boolean` — `true` for the raster/video allow-list **or** PDF. UI affordance gate only; **not** a signing gate.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/collaboration/attachments-format.test.ts`:

```ts
import { isPdf, canPreviewInline } from "./attachments-format";

describe("isPdf", () => {
  it("is true only for application/pdf (case-insensitive)", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("APPLICATION/PDF")).toBe(true);
    expect(isPdf("image/png")).toBe(false);
  });
});

describe("canPreviewInline", () => {
  it("covers the raster/video allow-list plus PDF, nothing else", () => {
    expect(canPreviewInline("image/png")).toBe(true);
    expect(canPreviewInline("video/mp4")).toBe(true);
    expect(canPreviewInline("application/pdf")).toBe(true);
    expect(canPreviewInline("image/svg+xml")).toBe(false);
    expect(canPreviewInline("application/zip")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- attachments-format`
Expected: FAIL — `isPdf`/`canPreviewInline` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/collaboration/attachments-format.ts`:

```ts
/** True only for application/pdf (case-insensitive). Pure. */
export function isPdf(mime: string): boolean {
  return mime.toLowerCase() === "application/pdf";
}

/** UI affordance gate: which attachments can open an inline lightbox preview
 *  (raster/video via signed <img>/<video>, PDF via PDF.js byte-fetch). This is
 *  NOT a signing gate — `isPreviewable` still governs the raster/video signed
 *  URLs, and PDFs are byte-fetched through `getAttachmentPdfUrl`. Pure. */
export function canPreviewInline(mime: string): boolean {
  return isPreviewable(mime) || isPdf(mime);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- attachments-format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/collaboration/attachments-format.ts src/lib/collaboration/attachments-format.test.ts
git commit -m "feat(attachments): add isPdf + canPreviewInline preview helpers"
```

---

### Task B: `getAttachmentPdfUrl` signing action

Mints a short-TTL signed URL for a PDF attachment, consumed by `fetch` → PDF.js. Rejects any non-PDF mime (defense in depth). Independent of Task A — the mime check is inlined here to keep the server stream standalone.

**Files:**

- Modify: `src/lib/validations/collaboration-actions.ts`
- Modify: `src/lib/collaboration/actions.ts`
- Test: `src/lib/collaboration/attachments-actions.test.ts`

**Interfaces:**

- Consumes: existing `PREVIEW_TTL` (300) and `ActionResult` in `actions.ts`; existing Supabase server client + Storage signing patterns.
- Produces: `getAttachmentPdfUrl(input: { attachmentId: string }): Promise<ActionResult<{ url: string }>>` — `{ ok: true, data: { url } }` on success; `{ ok: false, error }` for invalid input / not-found / non-PDF / sign failure.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/collaboration/attachments-actions.test.ts` — extend the existing import and add a `describe`:

```ts
// add getAttachmentPdfUrl to the existing import from "@/lib/collaboration/actions"

describe("getAttachmentPdfUrl", () => {
  it("signs a no-download URL for a pdf row", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              storage_path: `${ORG}/${BOARD}/${ITEM}/abc-d.pdf`,
              mime_type: "application/pdf",
            },
            error: null,
          }),
        }),
      }),
    }));
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed/pdf" },
      error: null,
    });
    const res = await getAttachmentPdfUrl({ attachmentId: ATT });
    expect(createSignedUrl).toHaveBeenCalledWith(
      `${ORG}/${BOARD}/${ITEM}/abc-d.pdf`,
      300,
    );
    expect(res).toEqual({ ok: true, data: { url: "https://signed/pdf" } });
  });

  it("rejects a non-pdf attachment without signing", async () => {
    from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { storage_path: "p/x.png", mime_type: "image/png" },
            error: null,
          }),
        }),
      }),
    }));
    const res = await getAttachmentPdfUrl({ attachmentId: ATT });
    expect(res.ok).toBe(false);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- attachments-actions`
Expected: FAIL — `getAttachmentPdfUrl` not exported.

- [ ] **Step 3a: Add the Zod schema**

Append to `src/lib/validations/collaboration-actions.ts`:

```ts
export const attachmentPdfUrlSchema = z.object({
  attachmentId: z.string().uuid(),
});
export type AttachmentPdfUrlInput = z.infer<typeof attachmentPdfUrlSchema>;
```

- [ ] **Step 3b: Add the action**

In `src/lib/collaboration/actions.ts`, add `attachmentPdfUrlSchema` to the existing import block from `@/lib/validations/collaboration-actions`, then append:

```ts
export async function getAttachmentPdfUrl(input: {
  attachmentId: string;
}): Promise<ActionResult<{ url: string }>> {
  const parsed = attachmentPdfUrlSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("attachments")
    .select("storage_path, mime_type")
    .eq("id", parsed.data.attachmentId)
    .maybeSingle();
  if (error || !row) return fail("Attachment not found.");

  // Defense in depth: the only bytes we ever sign for inline `fetch` (no
  // download disposition) are PDFs the client renders via PDF.js.
  if (row.mime_type.toLowerCase() !== "application/pdf")
    return fail("Not a previewable PDF.");

  // No `download` disposition — bytes are consumed by fetch → canvas, never
  // top-level navigation. Short TTL (shared with the gallery preview window).
  const { data: signed, error: signErr } = await supabase.storage
    .from("attachments")
    .createSignedUrl(row.storage_path, PREVIEW_TTL);
  if (signErr || !signed) return fail("Could not sign preview URL.");
  return { ok: true, data: { url: signed.signedUrl } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- attachments-actions`
Expected: PASS (both new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/collaboration-actions.ts src/lib/collaboration/actions.ts src/lib/collaboration/attachments-actions.test.ts
git commit -m "feat(attachments): add getAttachmentPdfUrl signing action (pdf-only)"
```

---

### Task C: `PdfPreview` renderer (PDF.js, client-only)

Fetches PDF bytes from a signed URL and renders all pages to canvas with PDF.js in a worker. Includes adding the `pdfjs-dist` dependency and worker config (folded in — this is the only consumer).

**Files:**

- Create: `src/components/boards/item-panel/PdfPreview.tsx`
- Create: `src/components/boards/item-panel/PdfPreview.test.tsx`
- Modify: `package.json` (+ `pdfjs-dist`)

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: `PdfPreview` — a React component, `export function PdfPreview(props: { src: string; fileName?: string }): JSX.Element`. `src` is a signed URL to PDF bytes. Renders a scrollable canvas stack with a page count and `+`/`−` zoom; on fetch/parse failure shows an inline error (the lightbox's own Download chrome remains available).

- [ ] **Step 1: Add the dependency**

Run: `pnpm add pdfjs-dist`
Expected: `pdfjs-dist` appears in `package.json` dependencies and the lockfile updates. Then **verify the worker-bundling approach for Next.js 16** against `node_modules/next/dist/docs/` (search for "worker" / "new URL" / asset imports). The `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` pattern in Step 3 is the primary approach; if the build (Step 6 of Task F / `pnpm build`) cannot resolve the worker, the documented fallback is to copy `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` into `public/` and set `workerSrc = "/pdf.worker.min.mjs"`.

- [ ] **Step 2: Write the failing test**

Create `src/components/boards/item-panel/PdfPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const render2d = vi.fn(() => ({ promise: Promise.resolve() }));
const getPage = vi.fn(async () => ({
  getViewport: () => ({ width: 120, height: 160 }),
  render: render2d,
}));
const destroy = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 2, getPage, destroy }),
  })),
}));

import { PdfPreview } from "./PdfPreview";

beforeEach(() => {
  getPage.mockClear();
  render2d.mockClear();
  global.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe("PdfPreview", () => {
  it("fetches the src, renders one canvas per page, and shows the page count", async () => {
    render(<PdfPreview src="https://signed/pdf" />);
    await waitFor(() =>
      expect(screen.getByText(/2 pages?/i)).toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledWith("https://signed/pdf");
    expect(document.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("shows an error message when parsing fails", async () => {
    const pdfjs = await import("pdfjs-dist");
    (
      pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValueOnce({ promise: Promise.reject(new Error("bad pdf")) });
    render(<PdfPreview src="https://signed/bad" />);
    await waitFor(() =>
      expect(screen.getByText(/couldn.t render this pdf/i)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 3: Write the implementation**

Create `src/components/boards/item-panel/PdfPreview.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";

// Worker asset URL. Verify against Next 16 docs (Task C, Step 1); fallback is
// a copied worker in /public.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Status = "loading" | "ready" | "error";

export function PdfPreview({ src }: { src: string; fileName?: string }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let doc: Awaited<
      ReturnType<typeof pdfjsLib.getDocument>["promise"]
    > | null = null;

    (async () => {
      try {
        setStatus("loading");
        const bytes = await (await fetch(src)).arrayBuffer();
        if (cancelled) return;
        doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        setPageCount(doc.numPages);

        const host = pagesRef.current;
        if (!host) return;
        host.replaceChildren();

        // Fit-width off the container, falling back to 1.0 (e.g. in jsdom).
        const fitWidth = host.clientWidth || 0;

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const fit = fitWidth > 0 ? fitWidth / base.width : 1;
          const viewport = page.getViewport({ scale: fit * scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = "mx-auto mb-2 max-w-full rounded shadow-sm";
          host.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue; // jsdom: no 2d context — DOM node still present
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      doc?.destroy();
    };
  }, [src, scale]);

  if (status === "error") {
    return (
      <div className="text-muted-foreground py-12 text-sm">
        Couldn’t render this PDF. Use Download above to open it.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="text-muted-foreground flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          className="hover:text-foreground"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          className="hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
        <span>
          {status === "loading"
            ? "Loading…"
            : `${pageCount} page${pageCount === 1 ? "" : "s"}`}
        </span>
      </div>
      <div ref={pagesRef} className="max-h-[60vh] w-full overflow-auto" />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- PdfPreview`
Expected: PASS (page count + 2 canvases; error case shows the message).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean (PDF.js types resolve via `pdfjs-dist`).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/boards/item-panel/PdfPreview.tsx src/components/boards/item-panel/PdfPreview.test.tsx
git commit -m "feat(attachments): add client-side PdfPreview (pdf.js) renderer"
```

---

### Task D: Preview affordance for PDFs on Card + Row

The Eye/Preview button only renders for `isPreviewable` (raster/video) today, so PDFs have no way to open the lightbox from the Files tab. Gate it on `canPreviewInline` instead.

**Files:**

- Modify: `src/components/boards/item-panel/AttachmentCard.tsx`
- Modify: `src/components/boards/item-panel/AttachmentRow.tsx`
- Test: reuse `src/components/boards/item-panel/` test files (add a focused Card test).

**Interfaces:**

- Consumes: `canPreviewInline` from Task A (`@/lib/collaboration/attachments-format`).
- Produces: nothing other tasks consume (UI only).

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/item-panel/AttachmentCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttachmentCard } from "./AttachmentCard";
import type { Tables } from "@/types/database.types";

function att(over: Partial<Tables<"attachments">> = {}): Tables<"attachments"> {
  return {
    id: "a",
    org_id: "o",
    board_id: "b",
    item_id: "i",
    update_id: null,
    column_id: null,
    uploaded_by: "u",
    storage_path: "o/b/i/a-d.pdf",
    file_name: "doc.pdf",
    mime_type: "application/pdf",
    size_bytes: 2048,
    created_at: "2026-06-20T00:00:00Z",
    ...over,
  } as Tables<"attachments">;
}

describe("AttachmentCard preview affordance", () => {
  it("shows Preview for a PDF attachment", () => {
    render(
      <AttachmentCard
        attachment={att()}
        members={[]}
        canDelete={false}
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("hides Preview for a non-previewable type (zip)", () => {
    render(
      <AttachmentCard
        attachment={att({ mime_type: "application/zip", file_name: "a.zip" })}
        members={[]}
        canDelete={false}
        onPreview={vi.fn()}
        onDownload={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
  });
});
```

> Note: confirm the `attachments` row type field names (`column_id`) against `src/types/database.types.ts` when writing the fixture; drop any field your generated type doesn't have.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- AttachmentCard`
Expected: FAIL — Preview button absent for a PDF (still gated on `isPreviewable`).

- [ ] **Step 3: Update AttachmentCard**

In `src/components/boards/item-panel/AttachmentCard.tsx`:

- Change the import to add `canPreviewInline`:

```ts
import {
  canPreviewInline,
  fileKind,
  formatSize,
  isPreviewable,
} from "@/lib/collaboration/attachments-format";
```

- Add below the existing `previewable` line:

```ts
const canPreview = canPreviewInline(attachment.mime_type);
```

- Change the Preview button guard from `{previewable && (` to `{canPreview && (`. Leave the thumbnail block (`previewable && kind === "image"`) unchanged.

- [ ] **Step 4: Update AttachmentRow**

In `src/components/boards/item-panel/AttachmentRow.tsx`:

- Change the import:

```ts
import {
  canPreviewInline,
  formatSize,
} from "@/lib/collaboration/attachments-format";
```

- Replace `const previewable = isPreviewable(attachment.mime_type);` with:

```ts
const canPreview = canPreviewInline(attachment.mime_type);
```

- Change the Preview button guard from `{previewable && (` to `{canPreview && (`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- AttachmentCard`
Expected: PASS. Also run `pnpm test -- item-panel` to confirm no Row regressions.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/item-panel/AttachmentCard.tsx src/components/boards/item-panel/AttachmentRow.tsx src/components/boards/item-panel/AttachmentCard.test.tsx
git commit -m "feat(attachments): expose inline preview affordance for pdfs"
```

---

### Task E: Lightbox PDF render branch

Add the `kind === "pdf"` branch to `FilePreviewLightbox`: lazy-load `PdfPreview` and fetch the signed URL via `getAttachmentPdfUrl`. Internal to the lightbox — no caller changes, so this lights up **both** the item Files tab (`FilesTab`) and the board Files cell (`BoardTable`, which renders the same lightbox).

**Files:**

- Modify: `src/components/boards/item-panel/FilePreviewLightbox.tsx`
- Test: `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`

**Interfaces:**

- Consumes: `getAttachmentPdfUrl` (Task B); `PdfPreview` (Task C).
- Produces: nothing other tasks consume.

- [ ] **Step 1: Update the existing tests (the PDF fallback test now changes meaning)**

In `src/components/boards/item-panel/FilePreviewLightbox.test.tsx`:

- Add mocks at the top (after imports):

```tsx
vi.mock("next/dynamic", () => ({
  default: () => (props: { src: string }) => (
    <div data-testid="pdf-preview" data-src={props.src} />
  ),
}));
vi.mock("@/lib/collaboration/actions", () => ({
  getAttachmentPdfUrl: vi.fn(async () => ({
    ok: true,
    data: { url: "https://signed/pdf" },
  })),
}));
```

- Change the existing "renders a Download fallback for a non-previewable file" test to use a genuinely non-previewable type (PDF now previews), e.g. swap the fixture to `application/zip` / `a.zip` and keep the `No inline preview` assertion.
- Add a new test:

```tsx
it("renders the PDF preview branch for a pdf attachment", async () => {
  const { getAttachmentPdfUrl } = await import("@/lib/collaboration/actions");
  const pdf = [att("p", { mime_type: "application/pdf", file_name: "p.pdf" })];
  render(
    <FilePreviewLightbox
      attachments={pdf}
      index={0}
      previewUrls={{}}
      currentUserId="u"
      onIndexChange={vi.fn()}
      onClose={vi.fn()}
      onDownload={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  const node = await screen.findByTestId("pdf-preview");
  expect(node).toHaveAttribute("data-src", "https://signed/pdf");
  expect(getAttachmentPdfUrl).toHaveBeenCalledWith({ attachmentId: "p" });
});
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `pnpm test -- FilePreviewLightbox`
Expected: FAIL — no `pdf-preview` node; `getAttachmentPdfUrl` never called.

- [ ] **Step 3: Implement the branch**

In `src/components/boards/item-panel/FilePreviewLightbox.tsx`:

- Add imports:

```tsx
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getAttachmentPdfUrl } from "@/lib/collaboration/actions";
```

(merge `useEffect`/`useState` into the existing `react` import).

- Add the lazy component above the `FilePreviewLightbox` function:

```tsx
const PdfPreview = dynamic(
  () => import("./PdfPreview").then((m) => m.PdfPreview),
  { ssr: false },
);
```

- Inside the component, **before** the `if (!current) return null;` early return (rules of hooks), add PDF-URL state. Derive the current attachment/kind locally so the effect doesn't depend on values computed after the early return:

```tsx
const [pdfUrl, setPdfUrl] = useState<string | null>(null);
const [pdfLoading, setPdfLoading] = useState(false);

useEffect(() => {
  const c = attachments[index];
  if (!c || fileKind(c.mime_type, c.file_name) !== "pdf") {
    setPdfUrl(null);
    return;
  }
  let cancelled = false;
  setPdfLoading(true);
  setPdfUrl(null);
  getAttachmentPdfUrl({ attachmentId: c.id }).then((res) => {
    if (cancelled) return;
    setPdfUrl(res.ok ? res.data.url : null);
    setPdfLoading(false);
  });
  return () => {
    cancelled = true;
  };
}, [attachments, index]);
```

- In the render ladder, insert a PDF branch **before** the final `else` fallback (after the `video` branch):

```tsx
) : kind === "pdf" ? (
  pdfUrl ? (
    <PdfPreview src={pdfUrl} fileName={current.file_name} />
  ) : (
    <div className="text-muted-foreground py-12 text-sm">
      {pdfLoading ? "Loading preview…" : "Couldn’t load preview."}
    </div>
  )
) : (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- FilePreviewLightbox`
Expected: PASS (PDF branch renders the stub with the signed URL; the zip fallback still shows "No inline preview"; arrow/escape nav unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/item-panel/FilePreviewLightbox.tsx src/components/boards/item-panel/FilePreviewLightbox.test.tsx
git commit -m "feat(attachments): render pdfs inline in the preview lightbox"
```

---

### Task F: End-to-end PDF preview + final gates

Prove the full flow against a running app: upload a PDF, open the lightbox, see a rendered canvas and page count. Then run the full gate suite.

**Files:**

- Create: `e2e/item-pdf-preview.spec.ts`

**Interfaces:**

- Consumes: the shipped feature (Tasks A–E); the existing e2e harness pattern in `e2e/item-attachments.spec.ts` (Supabase admin user creation, login → onboard → board → item flow).

- [ ] **Step 1: Write the e2e spec**

Create `e2e/item-pdf-preview.spec.ts`, modeled on `e2e/item-attachments.spec.ts` (copy its `dotenv` setup, `hasSecrets` skip, `unique`, and `beforeAll`/`afterAll` admin user lifecycle verbatim). Use this minimal single-page PDF and the assertions:

```ts
// Minimal one-page PDF. PDF.js rebuilds the xref table if offsets are off,
// so a hand-written body is sufficient for a render smoke test.
const PDF_BYTES = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 18 Tf 20 100 Td (Pulse PDF) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
trailer<< /Root 1 0 R /Size 6 >>
%%EOF`;

test("upload a PDF → lightbox renders a canvas + page count", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // ... login → onboard → create board → add item → open panel → Files tab
  //     (copy the exact steps from e2e/item-attachments.spec.ts) ...

  await panel.locator('input[type="file"]').setInputFiles({
    name: "doc.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(PDF_BYTES, "utf8"),
  });
  await expect(panel.getByText("doc.pdf")).toBeVisible({ timeout: 30_000 });

  // Open the lightbox via the now-available Preview affordance.
  await panel.getByText("doc.pdf").hover();
  await panel.getByRole("button", { name: "Preview" }).first().click();

  const lightbox = page.getByRole("dialog").last();
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator("canvas").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(lightbox.getByText(/1 page/i)).toBeVisible();
});
```

- [ ] **Step 2: Run the e2e spec**

Run: `pnpm test:e2e -- item-pdf-preview` (use the repo's e2e command; confirm in `package.json` scripts — mirror however `item-attachments.spec.ts` is run).
Expected: PASS — canvas visible, "1 page" shown. (Skips automatically if Supabase secrets are absent, matching the existing spec.)

- [ ] **Step 3: Full gate suite**

Run each and confirm green:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: all pass. Pay attention to `pnpm build` — this is where a misconfigured PDF.js worker surfaces; apply the `public/` worker fallback from Task C Step 1 if the worker asset fails to resolve.

- [ ] **Step 4: Commit**

```bash
git add e2e/item-pdf-preview.spec.ts
git commit -m "test(attachments): e2e pdf upload → inline lightbox render"
```

---

## Self-Review

**Spec coverage:**

- §1 In scope — inline PDF render in lightbox (E), multi-page scroll + page count + zoom (C), PDF-only signed URL via fetch (B), lazy `pdfjs-dist` (E `next/dynamic` + C). ✓
- §1 Both surfaces — Files tab (E + D affordance) and board Files cell (E; `BoardTable` shares the lightbox, FilesCell already opens it). ✓
- §2.1 `PdfPreview` client-only + worker + `ssr:false` + loading/error states — C + E. ✓
- §2.2 Lightbox one new branch — E. ✓ (`fileKind` already returns `"pdf"`, no classification change.)
- §2.3 PDF-only signing action, rejects non-PDF, no download disposition, reuse `PREVIEW_TTL`, `isPreviewable` not widened — B + Global Constraints. ✓
- §3 Data flow / no RSC nav — E (pure client state). ✓
- §4 Security: no top-level nav, no embedded JS, RLS unchanged, MIME gate — B + C + Global Constraints. ✓
- §5 Testing: unit (A, B), component (C, E), e2e (F), gates (F). ✓
- §6 Forward-compat seam — `PdfPreview` keyed on `src` (a PDF URL), not on the original type; no rework needed for a future derived-PDF source. ✓ (No code in this plan blocks it.)
- §6 Perf budget — 0 round-trips first paint (cells/cards use metadata icons; D adds only an affordance), per-interaction one action + one fetch + lazy chunk (E). ✓

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The e2e flow references copying explicit steps from a named existing spec (`item-attachments.spec.ts`) rather than inventing the auth harness — the steps exist verbatim there. The one deliberate verify-at-build item (PDF.js worker bundling for Next 16) has a concrete primary approach **and** a concrete fallback.

**Type consistency:** `canPreviewInline(mime: string): boolean` (A) consumed identically in D and referenced in E's design. `getAttachmentPdfUrl({ attachmentId }): ActionResult<{ url }>` (B) consumed with that exact shape in E. `PdfPreview({ src, fileName })` (C) rendered with those props in E. `PREVIEW_TTL` = 300 matches the action test's `300` assertion. ✓
