---
type: adr
date: 2026-06-22
status: accepted
tags: [decision, gotcha, realtime, supabase, security]
related:
  - "[[2026-06-22-1208-phase-6h-realtime-collaboration]]"
  - "[[2026-06-22-phase-6h-realtime-collaboration-design]]"
---

# Gotcha 35: a private Realtime channel is enforced without the project-wide "Allow public access" toggle — and flipping it breaks existing public channels

## Context

Phase 6h adds one **private** Supabase Realtime channel (`presence:board:<id>`,
`config: { private: true }`) authorized by RLS policies on `realtime.messages`
(reusing `can_read_board`). Both the Supabase docs' framing and our own first
draft of the spec/plan asserted a prerequisite: _"disable the Realtime 'Allow
public access' setting or private channels aren't enforced."_

That assertion is wrong for a mixed codebase, and acting on it would have caused
a regression. Pulse already runs several **public** channels (`board:<id>`,
`notifications:<id>`, `item:<id>`) carrying `postgres_changes` (and presence).
Doc research established:

- **Per-channel:** a `private: true` channel is **always** authorized against the
  `realtime.messages` RLS policies, regardless of the project toggle. The new
  presence channel is enforced on its own merits.
- **The toggle is a global mode switch**, not an additive hardening. "Channel
  Restrictions = only private channels" makes the server **reject all public
  channels project-wide**. Our existing public channels have no `realtime.messages`
  policies, so their _joins_ would be refused (default-deny) — and `postgres_changes`
  riding on those channels would stop being delivered, because the channel join is
  what's gated (postgres_changes' own table-RLS authorization is separate but only
  applies _after_ a successful join).
- The only thing the global toggle buys is closing a bypass where a client opens a
  same-named **public** channel to dodge the private channel's RLS. That doesn't
  leak here: a public `presence:board:<id>` is a **separate channel** from the
  private one and never receives its traffic.

## Decision

For adding authenticated/private Realtime channels to a project that also has
public channels: **add the `realtime.messages` RLS policies and create the channel
with `private: true` — do NOT flip the project-wide "Allow public access" / "Channel
Restrictions" setting.** The private channel is enforced by its policies alone;
leaving public access on keeps existing public channels working.

Only switch the project to "private only" if you have **first** migrated every
public channel to `private: true` and written covering `realtime.messages` policies
for their topics. Until then, that switch is a regression, not a hardening.

Also: client must `await supabase.realtime.setAuth()` before subscribing a private
channel (pushes the session JWT into the socket); gate policies on
`extension in ('broadcast','presence')` (presence rides the broadcast transport),
and wrap `realtime.topic()` / the `can_read_board` call in `(select …)` for RLS
initplan caching.

## Consequences

- Zero regression to existing realtime; the presence channel is still provably
  enforced (live test: non-member join → real `CHANNEL_ERROR`).
- Removes a scary manual production dashboard step from the feature's rollout.
- If we ever want the global bypass-closing guarantee, it becomes a separate,
  deliberate migration of all channels to private — tracked, not incidental.
