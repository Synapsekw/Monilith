# MCP: column write-metadata on `get_board` + a supported file-attachment path

**Date:** 2026-08-06
**Status:** Approved (design)
**Surface:** `src/lib/mcp/tools/`, `src/lib/collaboration/`, `src/lib/ai/board-snapshot.ts`

## 1. Problem

An external MCP agent (today: Hermes on a VPS; the design must not assume it) cannot complete a
board workflow autonomously, for two independent reasons.

**Status writes are guess-and-check.** `get_board` selects `id, name, kind` from `columns`
(`src/lib/mcp/tools/get-board.ts:23-28`) and discards `settings`. A status cell value is
`{ optionId }`, where `optionId` is an opaque id defined per column in
`columns.settings.options`. The agent is never shown those ids, so it cannot construct a valid
value. Writes are validated strictly server-side — `cellValueSchema(kind)` runs on every MCP field
write (`src/lib/mcp/tools/cell-value-validation.test.ts`) — so the agent gets rejection after
rejection with no way to discover what would have passed.

The in-app `/ask` agent does not have this problem: `buildBoardSnapshot`
(`src/lib/ai/board-snapshot.ts:89-99`) parses `settings.options` and emits `options: [{id, label}]`
per status/dropdown column. The capability exists; the MCP surface never received it.

**File attachment is unreachable.** Attachments are written by a browser-only path: a client-direct
Supabase Storage upload followed by the `createAttachment` Server Action
(`src/lib/boards/mutations/files.ts:56-73`). MCP tool arguments are JSON and `createAttachment` is
`"use server"`, bound to `next/headers` cookies. There is no attachment tool registered at all
(`src/lib/mcp/tools/register.ts`).

## 2. Goals / non-goals

**Goals.** An agent holding only a `boardId` can (a) discover every column's writable value shape,
including status/dropdown option ids, and (b) attach a file it produced to an item or a Files-column
cell, without a human in the loop.

**Non-goals.** No attachment _deletion_ — `update_item` advertises "No delete/archive/move" and the
MCP write surface stays deliberately additive. No attachment _read/download_ tool; the chosen
direction is write-only (revisit separately if a workflow needs to read existing files). No change
to `/ask`'s snapshot contract beyond the shared-helper extraction in §3.1. No service-role access.

## 3. Design

### 3.1 `get_board` column metadata

`getBoardHandler` adds `settings` to the columns select and maps each row through a new pure
function, `describeColumn(kind, settings)`, in `src/lib/mcp/tools/column-meta.ts`.

Emitted per column:

| Field                | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `id`, `name`, `kind` | Unchanged.                                                                  |
| `options`            | `{ id, label, color }[]` — status/dropdown only. Omitted otherwise.         |
| `settings`           | Only keys that change how a value is written. Omitted when empty.           |
| `writable`           | `false` when the kind stores no `cell_values` row.                          |
| `valueShape`         | Human-readable shape string for `fields[].value`; `null` when not writable. |

`settings` is a deliberate allow-list, not the raw jsonb: `currency` (currency), `unit` and
`precision` (numbers), `target_board_id` and `allow_multiple` (relation). `summary_aggregation`,
`dirham_sign`, and the mirror wiring keys stay internal — they do not affect how a value is written,
and emitting them would pin this tool's public contract to the DB jsonb shape.

Full per-kind table, derived from the value schemas in `src/lib/validations/boards.ts`:

| Kind            | `writable` | `valueShape`                                                   |
| --------------- | ---------- | -------------------------------------------------------------- |
| `text`          | yes        | `{ text: string }` (max 20,000 chars)                          |
| `status`        | yes        | `{ optionId: string \| null }`                                 |
| `dropdown`      | yes        | `{ optionIds: string[] }`                                      |
| `people`        | yes        | `{ userIds: string[] }`                                        |
| `date`          | yes        | `{ date: "YYYY-MM-DD", end?: "YYYY-MM-DD" }`                   |
| `numbers`       | yes        | `{ n: number }`                                                |
| `checkbox`      | yes        | `{ checked: boolean }`                                         |
| `rating`        | yes        | `{ rating: 1..5 }` (integer)                                   |
| `percent`       | yes        | `{ percent: 0..100 }`                                          |
| `currency`      | yes        | `{ amount: number }`                                           |
| `priority`      | yes        | `{ level: "normal" \| "critical" }`                            |
| `link`          | yes        | `{ url: string (http/https only), text?: string }`             |
| `email`         | yes        | `{ email: string }`                                            |
| `phone`         | yes        | `{ phone: string }` (1–40 chars)                               |
| `time_tracking` | yes        | `{ estimateSeconds: number }` (positive integer)               |
| `files`         | **no**     | `null` — use `attach_file`; content derives from `attachments` |
| `relation`      | **no**     | `null` — content derives from `relation_links`                 |
| `mirror`        | **no**     | `null` — read-only rollup                                      |

The three non-writable kinds matter as much as the options do. `filesValueSchema`,
`relationValueSchema`, and `mirrorValueSchema` are all `z.object({}).strict()` and, per their own
comments, exist "only to keep the switch exhaustive" — they are never used by `upsertCell`. An agent
that does not know this will retry a relation write until it gives up. `files` additionally
cross-references `attach_file`, connecting the two halves of this spec.

**Shared option parsing.** `board-snapshot.ts:89-99` already parses `settings.options` through
`optionSchema`. Extract that into a pure `parseColumnOptions(settings): ColumnOption[]` in
`src/lib/boards/column-options.ts` and call it from both sites, rather than writing a second parser.
`board-snapshot.ts` keeps projecting to `{id, label}` (it drops `color` on purpose, for token
economy in `/ask`); only the parsing is shared. This is a targeted improvement to code the change
touches — no other `board-snapshot` behaviour changes.

**Degradation.** A column whose `settings` fails `safeParse` (hand-edited jsonb, a kind whose
settings predate a schema change) omits `options`/`settings` and still returns `id`, `name`, `kind`,
`writable`, `valueShape`. One malformed column must never fail the whole `get_board` call.

### 3.2 Attachment tools

Two tools, registered in `register.ts`. Both need the actor id, so they take `actorId` alongside
`getClient` — the `registerCreateItemTool` signature.

**`create_attachment_upload({ itemId, columnId?, fileName })`**

Resolves the item's `org_id`/`board_id` under RLS, builds the object key with the existing
`buildStoragePath` (item-level) or `buildColumnFilePath` (Files-column) from
`src/lib/collaboration/attachments-path.ts`, and calls
`storage.from("attachments").createSignedUploadUrl(path)`, which returns
`{ signedUrl, token, path }`.

Returns `{ uploadUrl: signedUrl, token, storagePath, expiresInSeconds: 7200, maxBytes: 52428800 }`.
The agent uploads its bytes to `uploadUrl`, then calls `attach_file` with the returned
`storagePath`.

**The 2-hour TTL is fixed by the SDK**, not a parameter — `createSignedUploadUrl(path, options?)`
accepts only `{ upsert }` (verified against `@supabase/storage-js@2.108.1`). `expiresInSeconds` is
therefore a reported constant, not a knob; do not add a plan task to make it configurable. Minting
the URL requires `objects` insert permission, which the bridged client has via
`attachments_obj_insert` — so an agent that cannot write to the org cannot even obtain a ticket.

**`attach_file({ itemId, columnId?, fileName, mimeType?, storagePath? | contentBase64? })`**

Exactly one of `storagePath` / `contentBase64`, enforced by a zod `.refine` — supplying both or
neither is an input error, not a silent precedence rule.

- **`contentBase64` branch.** Decode; reject empty or >131,072 bytes (128 KB) decoded; build the
  path; upload through the bridged client; register. The cap exists because base64 costs ~1.37
  tokens per byte — 128 KB is ~44k tokens in a single tool call, which fits generated CSVs, JSON,
  markdown reports, and small SVGs without threatening a context window.
- **`storagePath` branch.** Assert the path sits under this item's
  `<org>/<board>/<item>[/<column>]/` prefix, then call `storage.from("attachments").info(path)` and
  take `size` and `contentType` **from Storage**. The caller's claimed values are never trusted for
  the row. Both fields are optional on `FileObjectV2`: a missing `size` is an error (the row's
  `size_bytes > 0` check constraint would reject it anyway), and a missing `contentType` falls back
  to `application/octet-stream`, matching `files.ts:53`. `info()` doubles as the existence check —
  an agent that never completed its PUT, or whose ticket expired, gets a clear "object not found"
  instead of a dangling metadata row.

Both branches then insert the `attachments` row and, if the insert fails, remove the orphaned
object — mirroring `files.ts:66-72`. Returns
`{ attachmentId, storagePath, fileName, sizeBytes, mimeType }`.

**`createAttachmentCore` extraction.** `createAttachment` (`src/lib/collaboration/actions.ts:159`)
holds four guards worth exactly one implementation: item-scoped org/board derivation, the
path-prefix spoof guard, the "column must be a `files` column on this item's board" check, and the
insert. Only `createClient()` and `auth.getUser()` are cookie-bound. Extract the rest into
`createAttachmentCore(supabase, input, actorId)` in `src/lib/collaboration/attachment-core.ts`,
called by both `createAttachment` and `attach_file`.

This mirrors `upsertCellCore` (`src/lib/boards/actions/cell-core.ts:31-34`), whose header documents
why: "Both the Supabase client AND the actor are injected, which is the entire point: a cookie-bound
Server Action and a bearer-token MCP request produce different clients and resolve their user
differently, but must produce identical side effects." Skipping that extraction and re-implementing
the guards is precisely what caused
[[2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp]] — a silently dropped
notification fan-out. `createAttachmentCore` never calls `supabase.auth.*`.

### 3.3 Security

The MCP connection is a **bridged Supabase session for the real user**
(`src/lib/mcp/context.ts:68`), not a service-role client, so Storage RLS applies to an MCP upload
exactly as to a browser one. `attachments_obj_insert` authorizes on
`is_org_member((storage.foldername(name))[1])` — the org id in the path's leading segment — so a
spoofed path fails closed at the database even if the application-level prefix guard were bypassed.
Defence in depth, both layers kept.

Server-derived `size_bytes` keeps the table's `size_bytes > 0 and size_bytes <= 52428800` check
constraint honest. Signed upload URLs are single-path and short-lived. `getClient()` is called
**exactly once per handler** — each call charges the MCP rate limit and rotates the OAuth bridge
secret (`shared.ts`), so a two-call upload flow charges two units, which is correct.

### 3.4 Error handling

Uniform `ToolResult` with `isError: true` and a message the agent can act on. Distinct cases:
item not found; invalid file column; storage path does not match this item; object not found at the
given path (PUT never happened, or the signed URL expired); decoded content exceeds 128 KB; empty
content; both or neither byte source supplied; upload failed; register failed (object cleaned up).

## 4. Testing

- `describeColumn` per kind: options emitted for status/dropdown only, allow-listed settings only,
  correct `writable`/`valueShape`, and malformed-settings degradation.
- **Anti-drift test:** for all 18 `ColumnKind`s, assert each documented `valueShape` parses under
  the real `cellValueSchema(kind)` and that a counter-example fails. Without it the hints rot into
  lies the first time a value schema changes — and a confidently wrong hint is worse for an
  autonomous agent than no hint. Follows the no-mock discipline of
  `cell-value-validation.test.ts`, which deliberately does not stub the real schema.
- `attach_file`: both branches, path-spoof rejection, non-`files` column rejection, oversize
  rejection, missing-object rejection, orphan cleanup on failed insert.
- `createAttachmentCore`: shared-guard tests, plus proof `createAttachment` still behaves
  identically after the extraction.
- Cross-org RLS integration test following `cross-org-access.rls.integration.test.ts`, gated on
  `PULSE_TEST_DB`.
- `src/test/mcp-fake-client.ts` gains a Storage fake. Its header comment currently asserts handlers
  touch "only four call shapes" — this change makes that untrue, so the comment is updated in the
  same edit.

## 5. Performance & data-fetching budget

No UI surface, so working agreement #5 applies only to the read path. `get_board` stays at **3
queries** (board, columns, groups): `settings` adds bytes to an existing select, never a round-trip.
Both are naturally bounded per board (columns and non-archived groups), over `board_id` with an
existing `position` order. `create_attachment_upload` is 1 client + 1 item read + 1 URL mint.
`attach_file` is 1 client + at most 3 storage/db calls. No new unbounded reads.

## 6. Execution DAG

**Batch 1 (parallel, no unmet dependencies)**

- **T1** — extract `parseColumnOptions`; add `column-meta.ts`; wire into `get_board`.
  _Produces:_ the `get_board` contract. _Consumes:_ nothing.
- **T2** — extract `createAttachmentCore`; repoint `createAttachment` at it.
  _Produces:_ `createAttachmentCore`. _Consumes:_ nothing.
- **T3** — add Storage support to `mcp-fake-client.ts`.
  _Produces:_ the test fake. _Consumes:_ nothing.

**Batch 2**

- **T4** — `create_attachment_upload` + `attach_file`, registered in `register.ts`.
  _Consumes:_ T2, T3.

**Critical path:** T2 → T4. T1 is fully independent and can merge on its own.

## 7. Out of scope

Attachment delete and download tools; any change to the 50 MB bucket ceiling; per-org storage
quotas (none exist today); `/ask` snapshot contract changes; a read direction for attachments.
