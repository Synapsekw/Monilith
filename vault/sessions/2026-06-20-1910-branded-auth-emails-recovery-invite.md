---
type: session
date: 2026-06-20-1910
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-06-20-gotcha-25-auth-email-prod-deploy]]"]
---

# Branded auth emails — recovery + invite (and prod deploy fix)

## What changed

- Added `supabase/templates/recovery.html` + `invite.html`, matching the existing branded
  `confirmation.html` (logo, monochrome card, dark CTA, link fallback, footer). Wired both into
  `supabase/config.toml` under `[auth.email.template.*]`.
- Generalized the prod-deploy mechanism: new `scripts/push-auth-emails.ts` PATCHes the Management
  API for confirmation + recovery + invite (supersedes the confirmation-only
  `push-confirmation-email.ts`, left in place). Documented `SUPABASE_ACCESS_TOKEN` in `.env.example`;
  stored the token in gitignored `.env.local`.
- Pushed to the hosted project and **verified via Management API read-back** (recovery/invite
  subjects + branded HTML present, `mailer_autoconfirm` still false, Site URL untouched).
- Committed `5d46cfa` (5 files). Captured the deploy trap as [[2026-06-20-gotcha-25-auth-email-prod-deploy]].

## Why

A real password-reset email arrived unbranded: `config.toml` templates only drive the local stack,
so recovery/invite were never pushed to the hosted project. Brand consistency across all
user-facing auth emails, with a repeatable, Site-URL-safe deploy path.

## Open threads

- magic_link / email_change / reauthentication still on GoTrue defaults — no app flow triggers them yet.
- `scripts/push-confirmation-email.ts` is now a strict subset of the new script; delete on request.
- Token is in this session's chat history — rotate when convenient.
- An unrelated `_draft-…1542.md` (6c time-tracking) remains in `vault/sessions/` — belongs to that session, left untouched.

## Next session entry point

Auth-email work is done and live. Resume the main track: build Phase 6c (time tracking) per
[[2026-06-20-1619-phase6c-time-tracking-plan]].
