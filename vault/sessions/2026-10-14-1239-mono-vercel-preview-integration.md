---
type: session
date: 2026-10-14-1239
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-14-mono-vercel-design]]", "[[2026-10-14-mono-vercel-integration]]"]
---

# Mono and Assembly on Vercel Preview

## What changed
- Integrated the approved Assembly landing and expressive Mono into Next.js; shared public landing, local app links, scoped assets, motion controls and lifecycle cleanup.
- Added conversational contact drafts, editable review, explicit consent/send to the private bot webhook, durable replay/recovery and encrypted service-only storage. Applied additive Mono migration on live DEV; no tenant data or database-routing changes.
- Reviewed the full branch and fixed stale draft, durable-history, retry and deployment-exclusion defects. Full gates passed: typecheck, lint (0 errors, 5 existing warnings), 8,076 tests / 1 skipped, build, ledger 176/176.
- Merged and pushed integration `5241dd27` to develop; all three task worktrees/branches removed. Vercel Preview READY; deployed guide response and HTTP 200/no-store status verified, no browser errors.
- Updated preview runbook, north-star and board JSON only. No public changelog entry: this is preview-only and real AI/bot credentials are still absent.

## Why
The user approved the landing and Mono locally, requested Vercel integration before release, and identified the missing Aria/Orbit contact-to-bot flow. Production and main remain untouched.

## How to test (for the user)
1. Open https://monilith-at296yn4g-synapse-solutionskw.vercel.app using Vercel access. Explore the landing and click Mono; the current deployment provides prepared guide answers.
2. Enter Preview credentials using `docs/operations/mono-vercel-preview.md`, enable callbacks and redeploy. Ask for a demo with marked test contact details; expect a real reply and a prefilled editable review form.
3. Correct a field, check consent, then Confirm & send. Verify one receipt and one Grok bot delivery; ambiguous delivery uses Check delivery rather than a fresh request. Complete desktop/mobile, motion, sign-in and signup checks before release.

## Open threads
- Real Vercel AI replies and Grok bot delivery await owner-entered Preview credentials and acceptance. Keep summaries off unless explicitly enabled. Production release remains an owner-reviewed, manually merged develop-to-main PR.
- Board JSON refreshed locally; cloud Artifact redeploy and optional Obsidian link checks unavailable. Unrelated earlier draft notes and backlog remain untouched.

## Next session entry point
Start with `docs/operations/mono-vercel-preview.md` and the exact preview URL above. Coordinate with Monolith Redesign; never copy in-memory local credentials into source or change production during acceptance.
