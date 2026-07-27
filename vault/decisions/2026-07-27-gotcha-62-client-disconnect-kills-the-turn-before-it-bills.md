---
type: adr
status: accepted
date: 2026-07-27
tags: [project/pulse, adr, gotcha, ai, streaming, ask]
related:
  - "[[2026-07-27-1254-ask-stream-honesty-drop-recovery-thinking]]"
  - "[[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]]"
---

# Gotcha 62 — A client disconnect cancels the response stream and kills the turn before it persists or bills

## Context

Chasing a "nothing is happening" report on `/ask`, two user messages were found persisted at
`08:30:17` and `08:31:39` with **no assistant reply and — decisively — no `ai_usage` row for
either**. The obvious story was "the user resent and the first request was abandoned."

That story does not survive the evidence. A second submit **races** the first fetch; it does not
abort it. Both would have reached Anthropic and both would have been metered. A turn that produces
**zero** usage was killed at the _transport_.

The actual mechanism: `/api/ask` does its work inside the `ReadableStream`'s `start()`. When the
browser disconnects — a reload, or an RSC navigation such as the rail's "New chat" or another thread
link, which unmounts `AskChat` — the stream is **cancelled**. The next `controller.enqueue` throws,
and the turn dies inside `runAi` before usage is recorded and before the assistant row is written.

This is the mirror image of [[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]]. There, the
connection broke _after_ the server finished, so the answer survived and only the render was lost.
Here the connection breaks _during_, so the whole turn evaporates — no answer, no bill, no trace
beyond the orphaned user message.

## Decision

Treat **response-body lifetime as an unreliable host for work that must complete.** Anything whose
completion matters — persistence, metering, side effects — must not live only inside the stream that
delivers it to one browser tab.

For now the exposure is _reduced_, not removed:

- The composer is blocked for the whole turn (guard moved into `AskChat` as a `useRef` checked before
  any `await`, since the pre-fetch Server Action window left `streaming === false` and the composer
  live). This removes the double-submit path.
- An animated indicator plus an immediate opening status remove the _motive_ to reload or click away,
  which is what actually triggers the cancellation.

Neither makes a turn survive a genuine disconnect. Doing that requires decoupling persistence from
the response — running the turn independently of the request and having the stream _observe_ it, so a
dropped client costs a render rather than the work.

## Consequences

- **An orphaned user message with no assistant reply and no `ai_usage` row is diagnostic**: it means
  transport cancellation, not a model or auth failure. `ai_usage` is the sharpest instrument here —
  it distinguishes "never called" from "called and lost" in one query.
- A user who reloads out of impatience **destroys** the very turn they are waiting for, and it cannot
  be recovered — unlike a gotcha-61 drop, where the persisted answer is still there to re-read. The
  fixes above are therefore load-bearing UX, not polish.
- The same shape applies to any future route that does real work inside a streamed body — Autopilot,
  agentic automations, long report generation. Work inside `start()` is only as durable as the
  client's attention span.
- Cancelling an in-flight turn was **rejected** as a resend strategy for this reason: the call is
  already paid for and frequently still lands, which is exactly what gotcha-61's recovery exploits.
  Blocking preserves bought work; cancelling discards it.
