---
type: decision
date: 2026-08-03
tags: [decision, gotcha, tooling, testing]
related:
  - "[[2026-08-03-1049-keystone-wash-followups-closed]]"
  - "[[2026-08-02-2012-keystone-wash-and-polish]]"
---

# Gotcha 72 — a `/g` regex reused with `.test()` makes a guard silently blind

## What happened

The plan for the scroll-container guard specified the obvious shape:

```js
const SCROLLER = /overflow-(y-)?auto/g;
const hits = files.filter((f) => SCROLLER.test(f.source));
```

`RegExp.prototype.test()` on a `/g` regex **advances `lastIndex`** on every match and only resets
it on a failed match. So file 2 is scanned starting from wherever file 1's match ended, file 3 from
wherever file 2's ended, and so on. Matches are dropped in an order-dependent, essentially arbitrary
pattern. The guard still passes, still prints nothing, and still exits 0 — it just stops seeing
things.

Caught during implementation, before the guard shipped. Routed every read through `matchAll()`,
which iterates a clone and leaves the original's `lastIndex` at 0.

## Why it matters here

This is the **third** decorative-guard failure on this branch's lineage. The two guards shipped by
the Keystone wash were dead on Windows because `import.meta.url === \`file://${process.argv[1]}\``
is always false for a backslash path ([[2026-08-02-2012-keystone-wash-and-polish]]). A guard that
cannot fail is worse than no guard: it converts "nobody checked" into "the check passed."

The failure mode is specific and worth naming — a guard does not announce that it went blind. Its
green is indistinguishable from a real green. Only an adversarial test tells them apart.

## The rule

1. **Never reuse a `/g` regex across inputs with `.test()` or `.exec()`.** Use `matchAll()`, or
   construct the regex inside the loop, or drop the `g` flag if you only need a boolean.
2. **Every guard must be proven to FAIL before it is accepted.** Inject a real violation, confirm
   it prints and exits non-zero, revert. Paste that output into the task report — a claim that the
   drill was run is not evidence that it was.
3. **Assert the matcher is not vacuous.** A guard suite should carry a case that reads the
   *unfiltered* input and asserts the matcher finds the known population. That case is what
   distinguishes "no violations" from "the matcher stopped matching" — and it is what proved, when
   a real scroller was temporarily exempted, that the exemption had silenced something real rather
   than the regex having gone blind.

Point 3 is the durable half. Points 1 and 2 catch known traps; point 3 catches the trap nobody has
thought of yet.
