# Simplified Registration + Branded Confirmation Email — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) → ready for implementation plan
**Author:** pairing session (danijel@synapse-solutions.ai)

## Goal

Make user registration as simple as possible and replace Supabase's stock,
unstyled confirmation email with a branded MONOLITH email. The current flow
works; this is a simplification + polish pass, not a bug fix.

## Current flow (baseline)

`/signup` collects **full name (optional) + email + password** →
`supabase.auth.signUp()` with `emailRedirectTo: ${origin}/auth/callback` →
Supabase sends its **default** confirmation email → user clicks link →
`/auth/callback` exchanges the code for a session → home redirects to
`/onboarding` (org name + workspace name) → `create_organization` RPC + workspace
insert → app.

Key files:

| Concern                           | Path                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Signup page                       | `src/app/(auth)/signup/page.tsx`                                                                         |
| Auth form (signup/login)          | `src/components/auth/auth-form.tsx`                                                                      |
| Auth Zod schemas                  | `src/lib/validations/auth.ts`                                                                            |
| Auth actions (`signUp`, `signIn`) | `src/app/auth/actions.ts`                                                                                |
| Email callback handler            | `src/app/auth/callback/route.ts`                                                                         |
| Onboarding page/form/action       | `src/app/onboarding/*`, `src/components/onboarding/onboarding-form.tsx`, `src/app/onboarding/actions.ts` |
| DB schema + triggers              | `supabase/migrations/20260614174043_init_auth_tenancy.sql`                                               |
| Sidebar logo (source of truth)    | `src/components/brand/monolith-mark.tsx`, `src/components/brand/brand.tsx`                               |

## Decisions (from brainstorm)

1. **Merged signup, minimal fields:** email + password + **org name**. Drop the
   optional full-name field. No separate required onboarding step.
2. **Workspace:** auto-create a single default workspace named **"Main"** (not
   collected on the form).
3. **Branded confirmation email** is in scope regardless.
4. **Email logo:** a single hosted **PNG lockup** (icon + MONOLITH wordmark),
   referenced by absolute URL — reliable across Gmail/Outlook/Apple Mail (inline
   SVG is stripped by Gmail, so the live sidebar SVG can't be used as-is).

## Architecture

### A. Signup form (client + validation)

- `signUpSchema` in `src/lib/validations/auth.ts`:
  - **add** `orgName: z.string().trim().min(1, …).max(100, …)` (required).
  - **remove** `fullName`.
- `auth-form.tsx`: in `signup` mode render an **Org name** input alongside the
  email and password inputs; remove the full-name input. Login mode is unchanged.

### B. Account provisioning (the session wrinkle)

With email confirmation enabled, `signUp()` returns **no session**, so the org
cannot be created from the form synchronously.

- `signUp()` (in `src/app/auth/actions.ts`) passes the org name into Supabase
  user metadata: `options: { emailRedirectTo, data: { org_name } }`.
- New atomic RPC **`provision_account(p_org_name text)`** (SECURITY DEFINER,
  `set search_path = ''`), modeled on the existing `create_organization`:
  - requires `auth.uid()` (raise `42501` if null),
  - **idempotent**: if the user already owns/belongs to an org, return early (no
    duplicate),
  - inserts `organizations` (name = `p_org_name`, slug = slugified name + short
    uuid suffix, `created_by = auth.uid()`),
  - inserts `org_members` (role `owner`),
  - inserts a `workspaces` row named **"Main"** for that org,
  - returns the organization row.
- **`/auth/callback`** (`src/app/auth/callback/route.ts`): after
  `exchangeCodeForSession(code)`, fetch the user; if they have **no org** and
  `user.user_metadata.org_name` is present, call `provision_account`. Then
  redirect to `next` (default `/`).

**Why callback-RPC over a DB trigger:** doing it in `handle_new_user` (fires at
`signUp`, before confirmation) would create orgs for people who never confirm —
orphan rows. Provisioning at the callback runs only for **confirmed,
authenticated** users and preserves `auth.uid()` semantics. `handle_new_user`
stays as-is (profile creation only).

- **`/onboarding`** remains as a graceful fallback only (e.g. metadata missing /
  legacy users with 0 orgs). The normal path never requires it.

Migration: new SQL file in `supabase/migrations/`; then `pnpm db:types` and
commit the regenerated `src/types/database.types.ts` in the same change.

### C. Branded confirmation email

- **Template (source of truth, tracked):** `supabase/templates/confirmation.html`
  — a Go-template HTML email using `{{ .ConfirmationURL }}` for the confirm
  button + a plaintext fallback link.
- **Wiring:** `supabase/config.toml` →
  `[auth.email.template.confirmation]` with `subject` and
  `content_path = "./supabase/templates/confirmation.html"`. Applies
  automatically to the local Supabase stack.
- **Logo asset:** render the exact lockup — `MonolithMark` slab path +
  "MONOLITH" in Nunito 800 — to a PNG via a headless-browser screenshot at 2x,
  saved to `public/email/monolith-logo@2x.png` (displayed at ~half size for
  retina crispness). Referenced in the email by an **absolute** URL built from a
  new env var **`NEXT_PUBLIC_SITE_URL`** (the deployed domain) so external mail
  clients can load it.
- **Layout** (Monolith monochromatic + single accent, table-based for email
  compatibility, light background): centered card → logo → "Confirm your email"
  heading → one-line lead → prominent accent **Confirm email** button →
  muted plaintext fallback URL → muted footer (org/product line + "ignore if you
  didn't sign up"). Inline styles only; no external CSS; system-font stack with
  a bold weight for the wordmark area (the wordmark itself is the PNG).

### D. Configuration / env

- Add `NEXT_PUBLIC_SITE_URL` to `.env.example` and the `src/lib/env.ts` schema
  (public, URL). Used to build the email logo's absolute URL.

## The one manual step (cannot be scripted here)

The in-repo template is the source of truth and applies to **local** Supabase
automatically. The **hosted** project's "Confirm signup" template must be applied
once via `supabase config push` (or the dashboard Auth → Email Templates). The
Supabase MCP exposes no auth-template tool, so this is a documented manual step,
not an automated migration. `NEXT_PUBLIC_SITE_URL` must also be set in the
deployment environment so the logo PNG resolves.

## Testing (mandatory — written and executed)

- **Schema:** `signUpSchema` requires a non-empty trimmed `orgName` (≤100),
  rejects empty; `fullName` is gone.
- **Action:** `signUp()` threads `org_name` into `options.data` and still sets
  `emailRedirectTo`.
- **Callback provisioning** (mocked Supabase client): calls `provision_account`
  when the user has no org and `org_name` metadata is present; **skips** when an
  org already exists; redirects to `next`.
- **Template sanity:** `confirmation.html` contains `{{ .ConfirmationURL }}` and
  the logo URL token, and is non-empty valid HTML.
- **Gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

## Out of scope / non-goals

- Passwordless / magic-link auth (explicitly not chosen).
- Branding the other auth emails (recovery, magic link, email-change) — only the
  **signup confirmation** email is in scope.
- Collecting workspace name at signup (auto-"Main" instead).
- Removing the `/onboarding` route entirely (kept as fallback).

## Performance & data-fetching budget

Per AGENTS.md working agreement #5: this feature has no multi-view/tab/filter
surface over shared data. The signup form is a single static form; submission is
a **Server Action** (correct — it mutates server data: creates the auth user).
Provisioning is a one-time RPC at the confirmation callback (a route handler), not
a hot-path list read. No client-side refetch concerns, no unbounded reads. N/A
in the multi-view sense; budget satisfied.
