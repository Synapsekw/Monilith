---
type: adr
status: accepted
date: 2026-08-01
tags: [project/monolith, adr, gotcha, tooling, windows, migrations, ci]
related:
  - "[[2026-08-01-1146-debt-audit-and-paydown]]"
  - "[[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]"
---

# Gotcha 68 — A POSIX path join silently disabled the ledger gate on Windows for two sessions

## Context

`pnpm db:ledger-check` (gotcha-57's guard against a ledger row with no committed file) had not
actually run for two sessions. The reported cause was "psql isn't on PATH on this machine" and the
recorded fix was "set `PG_BIN` in `.env.prod.local`".

Both were wrong. `PG_BIN` **was already set**, and PostgreSQL 17 **was installed**. The real cause
was four lines in `scripts/check-migration-ledger.mjs`:

```js
if (pgBin) env.PATH = `${pgBin}:${env.PATH ?? ""}`;
```

Two independent bugs in one statement:

1. **A hardcoded POSIX `:` delimiter.** Windows splits `PATH` on `;`, so any plain directory value
   fused with the next entry into one invalid path. `psql` was never findable regardless of what
   `PG_BIN` contained — the documented escape hatch was inoperable on the platform that needed it.
2. **A case-mismatched key.** Windows env vars are case-insensitive, but Node preserves the OS
   casing when spreading `process.env` (`Path`). Assigning a fresh `PATH` key handed the child
   process **two** path variables rather than prepending to the existing one. Fixing only the
   delimiter would not have been enough.

## Decision

Join `PATH` with `path.delimiter`, update whichever `PATH`-like key already exists, and normalize an
MSYS-form value (`/c/Program Files/…`) to Windows form on `win32` — so **one plain documented value
serves both consumers**. `normalizePgBin` is exported and unit tested across platforms.

## Rationale

`PG_BIN` has two consumers whose native path forms are incompatible: this Node script (Windows form,
`;`) and `scripts/sync-prod/*.sh` under Git Bash (`PATH="$PG_BIN:$PATH"`, MSYS form, `:`). The
session before this one resolved that by writing a **dual-form value** into `.env.prod.local` that
both delimiters happen to parse. It worked, but it encoded a workaround for a code bug into
machine-local config — the next person to hit it would have had to rediscover the whole chain.
Normalizing inside the script puts the compensation where the incompatibility is.

The deeper lesson is about the gate, not the path. `scripts/finish-task.sh` treats exit 3
("could not check") as a **loud but non-blocking warning**, deliberately — gating a merge on a
network call is how a gate wedges every future task. That is the right call. But it means a
**permanently broken** gate and a **transient network blip** look identical, and the warning scrolls
past in a wall of build output. The gate was not silently green; it was honestly amber, and amber was
enough to ignore twice.

Note the shape this shares with [[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]:
that ADR's follow-up was "worth a periodic sweep", and a sweep one session later found **two more**
orphaned endpoints. An advisory follow-up is a follow-up that does not happen.

## Consequences

- Positive: the ledger gate genuinely runs again — 118 files = 118 DEV rows, no drift. The
  `.env.prod.local` hack reverts to a plain path a human would write.
- Positive: `normalizePgBin` is pure and unit tested, so the Windows path is covered on CI regardless
  of the runner's OS.
- Negative: a third `PG_BIN` consumer would need the same normalization, which is now a convention
  rather than something enforced.
- Follow-up: **when a check can report "could not verify", something must track how long it has been
  saying so.** A warning nobody diffs against last run is not a signal. The same applies to the
  orphaned-`"use server"`-export sweep — both should become gates rather than advice.

## Related

- `[[2026-08-01-1146-debt-audit-and-paydown]]`
- `[[2026-07-31-gotcha-66-an-uncalled-use-server-export-is-still-a-live-endpoint]]` — same failure
  mode one layer up: an advisory follow-up recurred within one session.
- `.env.prod.local` must stay **BOM-free and LF** — a BOM on line 1 silently breaks
  `. .env.prod.local` sourcing in the sync-prod bash scripts, leaving `PROD_SUPABASE_URL` unset.
