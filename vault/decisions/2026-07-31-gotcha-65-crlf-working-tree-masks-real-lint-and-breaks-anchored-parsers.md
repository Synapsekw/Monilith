---
type: adr
status: accepted
date: 2026-07-31
tags: [project/monolith, adr, gotcha, tooling, windows, git, ci]
related:
  - "[[2026-07-31-1708-quality-sweep-crlf-dead-code]]"
  - "[[windows-crlf-breaks-conformance-test]]"
---

# Gotcha 65 — A CRLF working tree hides real formatting problems and silently degrades anchored parsers

## Context

The Windows checkout had `core.autocrlf=true` and the repo had **no `.gitattributes`**. Two gates
were red locally while CI (Linux/LF) stayed green, and both were written off as "just Windows":

- `pnpm format:check` reported **1775 files**.
- `pnpm test:unit` failed in `anon-conformance`, whose `parsePublicTableNames` splits on `"\n"` and
  then tests `/^ {4}Tables: \{$/` — a trailing `\r` defeats the anchored `$`.

The load-bearing fact nobody had checked: **git already stored LF in every blob.** `autocrlf` converts
on checkout, not on commit. So the repo content was already correct; only the on-disk representation
was wrong.

## Decision

Add a `.gitattributes` with `* text=auto eol=lf` and refresh the working tree
(`git rm --cached -r . && git reset --hard`). Independently, make the parsers split on `/\r?\n/`
rather than depending on how the repo happens to be checked out.

## Rationale

Because the blobs were already LF, pinning `eol=lf` is a **zero-content diff** — it changes checkout
behaviour, not history. The feared "1775-file rewrite commit" never had to happen; `git status` was
clean immediately after the renormalize.

The alternative — tolerating the noise as a known Windows quirk — is what caused the actual damage:

- Of the 1775 files, **42 were genuinely unformatted** and had been for weeks. The line-ending noise
  buried them, so nobody could act on the list. Once the tree was LF, `format:check` dropped to those
  42 and they were fixed in one pass.
- `parsePublicTableNames` **threw**, which is the lucky case. The sibling parsers
  (`parsePublicFunctionSignatures`, tenant-fixtures' `codeOnly`) are also `$`-anchored but would have
  **degraded silently** — a security conformance probe that matches nothing still reports green.

## Consequences

- Positive: Windows checkouts are now byte-identical to CI. `format:check` is actionable again.
- Positive: the parsers are correct on any checkout, so the guard does not depend on repo config.
- Negative: one-time renormalize needed in each existing checkout (`git rm --cached -r . && git reset
  --hard`) — a fresh clone needs nothing.
- Follow-up: a regression test now asserts a CRLF source parses identically to LF.

## Related

- Supersedes the "not a real break, CI passes" framing in `[[windows-crlf-breaks-conformance-test]]`
  (auto-memory) — it *was* a real break, in the sense that it masked 42 real ones.
- `[[2026-07-31-1708-quality-sweep-crlf-dead-code]]`
