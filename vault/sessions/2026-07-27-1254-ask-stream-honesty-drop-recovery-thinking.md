---
type: session
date: 2026-07-27-1254
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-27-gotcha-62-client-disconnect-kills-the-turn-before-it-bills]]"
  - "[[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]]"
  - "[[2026-07-27-0659-batch-a-builds-conformance-probes]]"
---

# Ask Pulse tells the truth about what it is doing — and GitHub locked us out

## What changed

- **Drop recovery (`c6ec3da`).** A severed `/ask` stream no longer renders silence. A reader loop
  ending without the `done` terminator (or a truncated trailing JSON line — the real signature of a
  cut socket) marks the turn `dropped`, then **automatically re-reads the conversation** and renders
  the answer if it landed. `recoverConversation` reuses the same `toThreadMessages` mapping as first
  paint, so a recovered thread is byte-for-byte a hard reload — `tool_trace` included, so a dropped
  proposal returns with its confirm card still actionable. Only if nothing landed does a
  "Connection lost / Check again" card appear.
- **Honest work-in-progress (`78cb402` + `cb3362a`).** The static `"…"` is gone. `ThinkingIndicator`
  animates from the moment of submit — not first byte — and an `OPENING_STATUS` ("Reading your
  boards…") is emitted as the response's first byte, before the first model round. Measured silence
  before this: **25–42 seconds**.
- **The resend hole, root-caused.** `disabled={streaming}` derived from a flag `useAskStream` only
  raises _inside_ `send()`, but `onSubmit` first `await`s a Server Action — leaving the composer live
  for that whole round-trip. Guard moved into `AskChat` as a `useRef` checked before any `await`
  (two submits can land in one tick). Blocked rather than cancel-and-restart: an in-flight turn is a
  paid call that often still lands.
- **Promotion PR #74 opened, validated green, and blocked** — see below.
- **ADR:** [[2026-07-27-gotcha-62-client-disconnect-kills-the-turn-before-it-bills]].

## Why

The morning's "AI is not replying" was three distinct problems wearing one costume: a dev-server
rebuild severing the stream ([[2026-07-27-gotcha-61-repo-ops-kill-in-flight-dev-streams]]), a UI that
rendered a completed answer as nothing, and a 25–42s tool-round wait with no visible sign of life.
Only the first was self-inflicted. The other two would hit any real user on any slow or flaky
connection, so both were fixed rather than explained away.

## How to test

1. `pnpm dev`, `/ask`, ask "what's overdue across all my boards?" and press ⌘↵.
2. **Within a second:** rippling dots + "Thinking…" in the assistant gutter, before any network
   response. A moment later the label flips to "Reading your boards…", then "Consulting N boards…".
3. Composer greys out, hint reads WORKING — ONE QUESTION AT A TIME; ⌘↵ again does nothing.
4. First token → dots vanish, answer streams in place, no layout jump.
5. **Drop:** mid-turn, DevTools → Offline (or stop the dev server ~2s). Expect "Reconnecting —
   checking whether your answer arrived…", then the recovered answer, or the Connection lost card
   with Check again.
6. **Reduced motion:** dots hold still; labels still read and update.

## Resolved before the session closed — everything shipped to production

GitHub verification came back and the whole backlog cleared in one pass:

- `git push origin develop` succeeded (`cc36e81..22facb2`); both retained worktrees and `task/*`
  branches removed.
- **Promotion #74 merged** — `main` @ `105bb57`. It went through with a **plain `--squash`, no
  `--admin`**, which retroactively proves the account's unverified email was the _sole_ blocker; the
  earlier `BLOCKED` state and the `mergePullRequest` refusal were the same root cause wearing two
  faces, and nothing was wrong with branch protection.
- Squash divergence healed on `develop` @ `14f4d9e` (`-s ours`, tree byte-identical, `main` confirmed
  an ancestor) — gotcha-32 pre-empted for the next promotion.
- ✅ main CI green · ✅ **Vercel production deploy live**. No migration in the bundle, so prod schema
  and code stayed in step and `/sync-prod` was not required.

## Open threads

- **A disconnect still destroys the turn** — persistence lives inside the response body's lifetime.
  Decoupling it is the real fix (gotcha-62), unbuilt, and now live in production.
- **Ask Pulse writes are reachable by real users for the first time.** The confirm-card flow has been
  exercised on DEV only; a prod pass is worth doing deliberately rather than discovering.
- Worth a cheap confirmation: run the conformance probes against prod
  (`CONFORMANCE_TARGET_URL` + `CONFORMANCE_TARGET_ANON_KEY`).
- Unchanged: prod `digest_secret` (digest has never fired), E5 embeddings backfill + Vercel env var,
  MCP end-to-end test, Tier 2 fixtures / authenticated-half gate, the 69 skipping suites, E6 Stripe.

## Next session entry point

Board is clear — nothing is blocked and nothing is half-done. Pick from: **decoupling turn
persistence** from the response body (gotcha-62), **Tier 2 test fixtures** for the authenticated half
of the security boundary, or **Report Builder v2 roll-ups + org templates** (one shared migration,
both blocked by `reports.board_id NOT NULL`).
