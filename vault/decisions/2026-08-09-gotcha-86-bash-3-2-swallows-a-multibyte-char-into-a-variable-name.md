---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, tooling, scripts, bash, macos, worktrees]
related:
  [
    "[[2026-08-09-gotcha-85-a-cache-first-service-worker-poisons-turbopack-dev]]",
  ]
---

# Gotcha 86 — bash 3.2 swallows a following multibyte char into a variable name

## Context

`scripts/finish-task.sh` merges a task branch, pushes, then installs into the main checkout when
the merge changed dependencies, and finally removes the worktree and deletes the branch. It aborted
mid-run with:

```
scripts/finish-task.sh: line 243: MAIN?: unbound variable
```

Line 243 was:

```bash
echo "→ this merge changed dependencies — installing in $MAIN…"
```

`MAIN` is set at line 36 and used correctly at lines 105–241. macOS ships **bash 3.2** (2007, for
GPLv2 licensing reasons), which absorbs the bytes of the following `…` (U+2026) into the variable
name, yielding an identifier that was never set. Under `set -u` that is fatal. Reproduced in
isolation:

```bash
$ bash -c 'set -u; M=/x; echo "in $M…"'
bash: M?: unbound variable
$ bash -c 'set -u; M=/x; echo "in ${M}…"'   # braces terminate the name
in /x…
```

Not a Monolith bug so much as a portability one — the same script is fine under bash 5.

## The reason this is expensive

The blast radius is disproportionate to the typo, because of **where** it fires:

- It is **latent**. The line sits inside `if [ -n "$DEP_CHANGES" ]`, so it only ever runs on a merge
  that changed `package.json`/`pnpm-lock.yaml`. Every dependency-free task passes cleanly. It had
  been in the script long enough to feel proven.
- It fires **after the irreversible half**. The merge and push already landed. So the branch is
  merged but the worktree still exists, the branch still exists, and — worst — `pnpm install` in the
  main checkout is skipped.
- It **suppresses its own warning**. The very next lines print "DEPENDENCIES CHANGED … restart your
  dev server or it will keep failing." The crash is on the `echo` that precedes the install, so the
  operator gets neither the install nor the notice designed for exactly this situation.
- The error names a variable that is **demonstrably set**, on a line that only *prints*. Nothing
  about "unbound variable" suggests "your comment character is being parsed as an identifier".

It also manufactured a compelling false lead: a dependency-changing merge that half-completed is a
perfect explanation for [[2026-08-09-gotcha-85-a-cache-first-service-worker-poisons-turbopack-dev]],
which was happening at the same moment and had nothing to do with it.

## Decision

Brace every variable expansion **adjacent to a non-ASCII character** — `${MAIN}…`, not `$MAIN…`.
Fixed at the site, with the reason inline so nobody "tidies" the braces away.

Repo-wide check, clean apart from the comment describing the rule:

```bash
grep -rnP '\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]' scripts/*.sh
```

Our scripts lean on typographic characters (`→`, `…`, `—`) in operator-facing output, so this is a
standing hazard rather than a one-off, and the grep is the cheap way to keep it closed.

## Consequences

- `bash -n` does **not** catch it — the script is syntactically valid; the failure is at expansion
  time. Only executing the dependency-changing path reveals it, which is why the gates never did.
- Worth remembering that the four gates ran green in the worktree and the script still failed
  afterwards: **`finish-task.sh` itself is unguarded infrastructure**. Nothing tests it.

## The generalisable rule

**Put irreversible operations last, and never place a cosmetic statement between a decision and the
action it authorises.** The script decided to install, announced it, then installed. Ordering the
announcement first meant a printing bug could suppress a state-changing step — and take its own
error message down with it. If the install had come first, or the message had been part of the same
command, a broken `echo` would have cost a line of output and nothing else.
