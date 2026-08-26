---
type: session
date: 2026-08-25-1932
branch: develop
trigger: wrapup
status: complete
tags: [session, agents, ai, spec-2b]
related:
  [
    "[[2026-08-14-0808-agent-runtime-spec-2a]]",
    "[[2026-08-25-gotcha-93-a-preview-that-shares-a-function-but-not-its-inputs-still-lies]]",
    "[[2026-08-25-gotcha-94-a-plan-is-right-about-intent-and-wrong-about-signatures]]",
  ]
---

# Agent reference documents — Spec 2b

## What changed

- **Spec 2b brainstormed, planned, built and merged** (`fede1f69`, 8 tasks, 15 commits, 51 files,
  +5313/−77). An owner keeps a **personal library** of reference documents — pasted, or extracted
  from `.md`/`.txt`/`.pdf`/`.docx`/`.xlsx` — attaches them many-to-many to their scheduled agents,
  and they are injected **verbatim** into the system prompt under a hard context budget.
  Spec: `docs/superpowers/specs/2026-08-24-agent-reference-documents-design.md`.
- **Spec 2 was split.** 2b is reference documents only; the memory layer became **Spec 2c**. They
  share exactly one thing — `document-budget.ts`, which 2b builds and 2c must consume, not
  re-derive.
- **No retrieval, by decision.** A structural example must arrive whole, a policy list complete, and
  vocabulary is used every run — so the correct retrieval result is always "all of it". The cost is
  a hard ceiling, enforced at **attach time** with a live meter where the owner can still act.
  **Nothing truncates**: an over-budget set is dropped entirely and the run is flagged
  `documents_omitted`, following the `model_substituted` precedent (a run that worked without its
  documents *succeeded*).
- **Two migrations, ledger 143/143.** `agent_documents` + `user_agent_documents` (owner-scoped RLS,
  table-level grants, **no new column on `user_agents`** — a join table needs only its own grants,
  which sidesteps the column-grant trap), then a second adding `is_org_member(org_id)` to the write
  policies and a `SECURITY INVOKER` `replace_agent_documents` RPC.
- **Three parsers were already installed and already used** by the file-preview lightbox
  (`pdfjs-dist`, `docx-preview`, `exceljs`). No new dependency. `.xlsx` deliberately parses
  **server-side** — `parseWorkbookSheets` carries the zip-bomb guard, so browser-side extraction
  would have traded a security control for one round trip. This is the one documented deviation
  from the approved spec.
- **`contextLength` was threaded through two shared types** that both dropped it: `ResolvedModel`
  (via `resolvedFrom`) and `ModelOption` (via `buildModelOptions`).
- **Announced on `/updates`** — three entries dated 2026-08-25.

## Why

Spec 2a gave an agent hands; its entire durable knowledge was still one free-text `instructions`
field. That is the right shape for *what to do* and the wrong shape for *what to know* — a standup
format to imitate, a vendor exception list, internal vocabulary. All three are stable across runs
and shared across agents, so a per-agent text field means they are re-typed, drift independently,
and are invisible to the context budget.

## How to test (for the user)

Tested and confirmed by the owner on 2026-08-25. Steps, for the record:

1. Pull `develop`, `pnpm dev`, sign in, go to **Settings → Agents → Reference documents**.
2. **Add document** → paste text, add a title. The token count updates as you type with no network
   activity. Save.
3. Upload a `.docx`; the extracted text lands in a textarea for review and nothing saves until you
   click Save. Repeat with a `.pdf` and note the "extraction is lossy" warning.
4. Upload an `.xlsx` — same review step, but this one round-trips to the server.
5. Upload a scanned/image-only PDF: refused at upload, not stored empty.
6. Open an existing document. The body loads on demand; edit one line and save.
7. In an agent's editor, attach documents. Watch the meter; attach past the budget and the remaining
   checkboxes disable while anything already selected stays deselectable.
8. Pin the agent to a small-context model — the meter recomputes and may report the context too
   small.
9. Delete an attached document: the confirmation names the affected agents.
10. Run an agent. History shows a normal run, or "Ran — reference documents omitted".

## Open threads

- **NOT IN PRODUCTION.** `develop` never deploys; this needs a `develop → main` promotion.
  [[2026-08-17-gotcha-92-a-fix-merged-to-develop-is-not-a-fix-in-production]] cost three days of
  outage this month for exactly this confusion. `origin/main..origin/develop` is **2649** — squash
  accumulation, not work.
- **The sentinel check has a plausible false positive.** Bodies containing `REFERENCE DOCUMENTS` are
  refused at save, and that is a standard all-caps heading in SOP/ISO/RFP documents — precisely the
  corpus this feature attracts. By our own analysis that sentinel cannot escape the block anyway, so
  it buys no security. Narrow it to `INSTRUCTIONS_SENTINEL` only.
- **A better prompt-injection defence surfaced too late to use:** a **per-agent stable nonce**
  defeats delimiter forgery *and* keeps the prompt prefix byte-stable, dominating both options we
  weighed (per-run nonce = a permanent cache-write bill; save-time rejection = the false positive
  above).
- **`DocumentPicker` still caps silently.** The library list says "Showing 100 of N"; the picker gets
  the same 100 rows with no total, so documents 101+ are unattachable with no hint.
- **Ledger `name` cosmetic drift** on `20260825113635` — unprefixed where every prior row is
  version-prefixed. `check-migration-ledger.mjs` compares 14-digit versions only, so it is genuinely
  in sync; matters only if future tooling reconstructs filenames from `name`.
- **Spec 2c (agent memory) is next**, then Spec 3 (orchestration, `@handle` addressing).
- Unrelated and still open: the `number`/`battery`/`completion`/`health` dashboard widgets calling
  `SECURITY DEFINER` RPCs through the service client where `auth.uid()` is null.

## Next session entry point

**Promote `develop → main`** — this feature is merged and unshipped. Then brainstorm **Spec 2c
(agent memory)**, which consumes `document-budget.ts` and must not re-derive its arithmetic.
