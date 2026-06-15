# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead, report privately via
GitHub Security Advisories ("Report a vulnerability" on the repo's Security tab) or email the
maintainer. We aim to acknowledge within a few business days.

## Handling secrets

- `.env.local` is gitignored and must never be committed. Only `.env.example` (placeholders) is tracked.
- `SUPABASE_SERVICE_ROLE_KEY` is **server-only** — never expose it to the browser or any client bundle.
- Row Level Security (RLS) is the real authorization boundary: every table is default-deny and
  org-scoped. Never rely on client-side checks for access control.
- If a secret is ever committed, rotate it immediately (Supabase dashboard → API keys) and purge it
  from history.
