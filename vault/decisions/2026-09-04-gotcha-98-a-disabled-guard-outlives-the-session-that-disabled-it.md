---
type: adr
date: 2026-09-04
status: accepted
tags: [decision, gotcha, security, worktrees, process]
related:
  - "[[2026-09-04-1253-close-three-stalled-worktrees]]"
  - "[[2026-08-14-gotcha-91-a-guard-written-for-a-human-actor-does-not-survive-an-ai-actor]]"
---

# Gotcha 98 — a disabled guard outlives the session that disabled it

## What happened

`task/agent-pdf-output` was found eight days after its session died. Among its uncommitted changes:

```ts
function escapeHtml(s: string): string {
  return s; // TEMPORARILY DISABLED FOR CSP HARNESS — RESTORED IMMEDIATELY AFTER
  return s
    .replaceAll("&", "&amp;")
    ...
}
```

The session had switched escaping off to prove that the new `default-src 'none'` CSP really did
block fetches on its own, intending to restore it in the next edit. The session ended first. The
comment's promise is the only thing that was ever going to restore it, and a comment cannot run.

`src/lib/boards/markdown-html.ts` is not private to the PDF shell — board markdown rendering shares
it. So the file sitting on disk was a live XSS hole in a shared renderer, one `git add -A` from a
commit and one `finish-task.sh` from `develop`.

## The trap

**The test suite already covered this.** `markdown-html.test.ts` asserts
`&lt;script&gt;alert(1)&lt;/script&gt;` on the escaper's own output. Running any gate would have
turned red immediately.

That is the whole shape of it: the defence was fully built and the hole still survived eight days,
because **a gate only fires when someone runs it**, and the session that disabled the guard is
precisely the session that never got to the gate. Uncommitted work is invisible to CI, to
`finish-task.sh`, to code review, and to every ledger and drift check this repo owns. The
disabled-guard window is bounded by the author's own next command — and if that command never
comes, it is unbounded.

Worth naming alongside [[2026-08-14-gotcha-91-a-guard-written-for-a-human-actor-does-not-survive-an-ai-actor]]:
that one is a guard that was never mounted on a second path. This one is a guard deliberately
dismounted, with the remounting left to human memory in a process that assumes sessions finish.

## What to do instead

- **Never disable a security guard in the source to observe a backstop.** Assert the backstop
  directly — the replacement test asserts the CSP `<meta>` is present and sits in the head ahead of
  any model-authored markup. That test proves the same property and cannot be left switched on.
- If a guard genuinely must come off to reproduce something, do it in a scratch copy or a throwaway
  test, never in the module every other caller imports.
- **When adopting an abandoned worktree, read the full uncommitted diff before running anything.**
  Do not `git add -A`, and do not run `finish-task.sh` first and read after: the gates would have
  caught this one, but a hole whose test does not exist yet would ride straight through.
- A stalled worktree is not neutral storage. Treat every one as carrying unreviewed intent until
  its diff has been read line by line.
