---
type: adr
status: accepted
date: 2026-07-27
tags: [project/pulse, adr, gotcha, worktrees, streaming, ai]
related:
  - "[[2026-07-27-0659-batch-a-builds-conformance-probes]]"
  - "[[2026-07-25-gotcha-58-playwright-reuses-port-3000-server]]"
---

# Gotcha 61 — `git pull` in the main checkout kills the user's in-flight streams, and a dropped stream renders as total silence

## Context

Mid-session the user reported "nothing happening, AI is not replying" on `/ask`. The obvious suspect
was the Ask Pulse Phase 2 merge, which had landed hours earlier and changed the streaming loop.

It was not the merge. The evidence, gathered read-only:

- `ai_usage` showed the call reaching Anthropic and being metered.
- `ai_messages` held a **2,594-character assistant reply, fully persisted with its tool trace**,
  written at the exact moment the user saw nothing.
- `use-ask-stream.ts` — the client parser — was **not touched** by the merge; only the route and the
  event union were.
- Token emission (`stream.on("text") → emit`) was likewise unchanged.

A hard refresh showed the answer immediately. The backend had always worked.

The cause was the orchestrating session itself. The user's `pnpm dev` runs out of the **main
checkout**. Verifying merges there — `git pull --ff-only`, and `finish-task.sh`'s own
`git pull --rebase` — rewrites files under a running Next dev server, which rebuilds and drops
in-flight responses. Server-side work continues to completion (hence the persisted row); the HTTP
response to the browser is severed. Both failed attempts fall inside windows of heavy repo activity;
the timeline is unambiguous once lined up.

## Decision

**Do not mutate the main checkout's working tree while a dev server is running on it.** Verify merges
from a worktree, from a bare `git log`/`git show` against `origin/*` refs (which touch no files), or
ask first. `git fetch` is safe; `pull`, `rebase`, and `checkout` are not.

This generalizes working agreement #1's "one folder per session" rule to a case it did not
anticipate: the conflict is not two _agents_ sharing a folder, it is an _agent and a long-running
process_ sharing one. `git show origin/develop:<path>` reads any committed file without touching
disk and should be the default for verification.

## Consequences

- Time lost to debugging a non-bug, with a merge wrongly under suspicion. The disproof was cheap only
  because the work is metered and persisted — `ai_usage` and `ai_messages` made it a five-minute
  question instead of a bisect.
- **The real product bug this exposed is still open:** a dropped stream renders as _nothing_. No
  error, no spinner, no "connection lost — reload to see the reply." The turn succeeded and the user
  has no way to learn that. This will hit real users on flaky mobile connections, where it is far
  more common than a developer rebuilding under them. Worth its own task.
- Same family as [[2026-07-25-gotcha-58-playwright-reuses-port-3000-server]]: the worktree model
  isolates _files_, not _ports_ or _processes_. Anything long-running and directory-bound crosses the
  boundary silently.
