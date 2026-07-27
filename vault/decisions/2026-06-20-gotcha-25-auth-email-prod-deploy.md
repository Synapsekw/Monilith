---
type: adr
status: accepted
date: 2026-06-20
tags: [adr, gotcha, supabase, auth, email, deploy]
---

# Gotcha 25 — Branded auth emails reach prod only via the Management API push script

## Context

Monolith brands its Supabase auth emails (confirmation, recovery, invite) as HTML in
`supabase/templates/*.html`, wired in `supabase/config.toml` under `[auth.email.template.*]`.

## The trap

`config.toml`'s email-template settings **only drive the local stack**. Editing a template or
`config.toml` and restarting changes nothing in the **hosted** project — the live email keeps
arriving as GoTrue's plain default. Symptom: "the email is branded when I test locally but the one
that hit my inbox from prod has no logo/branding."

This bit us: recovery/invite were added to `config.toml` and looked done, but a real password-reset
email arrived unbranded because nothing had pushed them to the hosted project.

`supabase config push` is **not** the fix — it would upload the whole local auth block, overwriting
the prod **Site URL** with config.toml's `site_url = http://127.0.0.1:3000` and resetting
`enable_confirmations`. Both wrong for production.

## The fix / rule

- **`scripts/push-auth-emails.ts`** PATCHes the Management API
  (`/v1/projects/<ref>/config/auth`) with only the mailer fields —
  `mailer_subjects_<flow>` + `mailer_templates_<flow>_content` for confirmation/recovery/invite,
  plus `mailer_autoconfirm: false`. It reads the template files at run time (single source of
  truth) and never touches Site URL. Generalizes the old confirmation-only
  `push-confirmation-email.ts`.
- Run: `pnpm exec tsx --env-file=.env.local scripts/push-auth-emails.ts`
  (`SUPABASE_ACCESS_TOKEN=sbp_…` lives in gitignored `.env.local`; key documented in
  `.env.example`). Project ref `hjqcahbbbdaknbbnfnvl`.

**Rules going forward:**

1. After editing any auth email template, re-run the push script — local edits alone never reach prod.
2. To add a new branded flow, add its file + subject to the `TEMPLATES` array in the script (and
   the matching `[auth.email.template.*]` block for local). magic_link/email_change/reauthentication
   are still GoTrue defaults — no app flow triggers them yet.
3. Never `supabase config push` for email changes — it clobbers prod Site URL.

Related: Gotcha 24 (integration auth rate limit), the simplified-registration branded-email spec.
