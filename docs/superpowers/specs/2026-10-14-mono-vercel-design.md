# Assembly landing and Mono in the existing Vercel app

The user approved the Assembly landing, animated Pocket Block Mono, and local real-chat testing. On 2026-10-14 they approved replacing the existing landing inside the app, retaining Vercel, and preparing a preview before production. This records that approved design; no new visual exploration is needed.

## Architecture and scope

- Replace the shared public landing presentation at `/` and `/landing` with the approved Assembly design. Preserve the authenticated `/` to `/home` redirect and the signed-in CTA on `/landing`.
- Preserve the approved canvas, blue product screenshots, motion pause/reduced-motion behavior, screenshot modal, and Mono animation/chat/contact review.
- Render substantive marketing content on the server. Scope CSS and imperative effects to the landing. Clean up listeners, observers and animation loops when navigating away. Keep ordinary app pages unaffected.
- Serve Mono through a Node Next.js route at `/api/mono` using the existing widget's Request/Response contract. This explicitly approved protocol endpoint handles chat/callback/reset POSTs; it is not a general workspace mutation API. Validate external input with Zod. Keep every existing consent, origin, CSRF, deduplication and error-redaction guarantee.
- Store encrypted, expiring opaque Mono records in a dedicated Supabase table, separate from tenant/workspace data. Use atomic compare-and-swap writes, indexes for key/expiry, service-role-only access and bounded expiry cleanup. Never expose table rows or functions to anon/authenticated roles.
- Use server-only Mono environment variables. An unconfigured preview remains guide-only. Preview bot reports/contact delivery default off. Exact request origin must match the deployment's configured origin; no arbitrary trusted hosts.
- Do not read/copy local in-memory credentials. User adds preview credentials through Vercel.
- No production deployment, main merge, domain/DNS changes or database cutover. The existing DEV database serves live users: additive narrowly scoped schema only.

## Performance and data fetching budget

First paint contains server-rendered marketing copy and optimized local assets; animation/widget code loads only on landing pages. Billing toggles, chapters, navigation, agent demo and motion controls perform zero server round-trips. Mono status is fetched once when its controller connects; each chat/contact action is bounded by existing payload/history/rate limits. Storage reads use exact indexed keys; cleanup uses an expiry index and a fixed batch limit. No workspace data is fetched by Mono.

## Independent units and execution DAG

A: Landing + lifecycle-safe widget integration consumes approved artifacts and produces the shared landing component and `/api/mono` client.
B: Backend + private durable storage consumes the existing Mono protocol and produces `/api/mono`, migration and tests.
A and B are independent; execute concurrently in separate task worktrees. C depends on A+B: integration, full checks, browser QA, database verification, Vercel preview and release documentation. Critical path: max(A,B) -> C.

## Acceptance

Anonymous landing, signed-in landing CTA, navigation, mobile, reduced motion, screenshot modal and Mono all work in-app. Direct public API returns JSON without a login redirect. Unconfigured guide is useful; configured API passes real testing after user supplies credentials. Tests cover origin/CSRF, malformed payloads, concurrent duplicate callbacks, ambiguous-delivery recovery, storage conflicts/encryption/expiry and denied public data access. Typecheck, lint, full tests and build pass before integration into develop. A Vercel preview URL is verified before handoff; credentials/access blockers are reported precisely if present. Production release remains the owner's manual decision.
