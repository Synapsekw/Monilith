# Mono Vercel Integration Implementation Plan

> **For agentic workers:** Use Superpowers parallel agents, test-driven-development and verification-before-completion. User already approved this design and execution; proceed without repeated approval questions.

**Goal:** Integrate approved Assembly and Mono into the existing app and prepare a Vercel preview.
**Architecture:** Server-rendered shared landing with scoped client effects; existing Mono HTTP contract through a Node route with encrypted Supabase records.
**Tech Stack:** Next.js 16, React, TypeScript, Zod, Supabase/Postgres, Vercel.

## Global constraints

Preserve approved design and consent behavior. No production release. Isolated task worktrees and path-specific commits. No secrets in source, outputs, browser storage or client bundles. Main owner integrates into develop with repository gates; workers commit only their own changes for integration.

## Execution DAG

Parallel batch 1: A (landing), B (backend/storage). Each gets its own repository task worktree. Batch 2: C consumes both commits, checks integration, runs all gates and creates preview. Critical path max(A,B) -> C.

## A: Landing integration

Files: src/components/landing/assembly-_; public/landing/assembly/_; src/app/page.tsx; src/app/landing/page.tsx; corresponding tests.
Consumes: approved artifacts in Documents/Monolith/artifacts/{monolith-experiences,mono-widget,mono-concepts}. Produces: AssemblyLanding({signedIn?:boolean}) with Mono `/api/mono` transport and complete effect cleanup.

- [ ] Add/run failing tests for approved hero, local signup/login links, signed-in entry, public route rendering, and lifecycle cleanup.
- [ ] Implement server content and scoped CSS/assets; preserve approved animation code with initialization/disposal boundaries and client-only widget mount.
- [ ] Run focused tests, targeted lint/typecheck; commit explicit paths. Parent reviews visual/browser results before integration.

## B: Mono backend and storage

Files: src/lib/mono/_; src/app/api/mono/route.ts; src/proxy.ts + tests; a minted supabase/migrations/__mono_private_store.sql; generated database types.
Consumes: existing service.mjs/providers.mjs and widget HTTP contract. Produces: GET/POST `/api/mono`, encrypted indexed durable record store with atomic writes and expiry cleanup, server-only validated settings.

- [ ] Port behavioral tests first and run failure; retain request IDs, cookie/token behavior, bounded history, real contact consent and status-only unknown delivery recovery.
- [ ] Implement typed service/provider and route adapter with Zod, exact deployment origin and reliable client IP. Preserve guide fallback when unconfigured.
- [ ] Mint migration via helper: dedicated table, deny browser-role grants, service-only atomic access, bounded expiry sweep. Parent coordinates applying this additive migration and generated types.
- [ ] Test malformed inputs, cross-origin, CSRF, conflicts, concurrent replay, encryption, expiry, error redaction and proxy reachability. Commit paths and report exact migration contract.

## C: Integration and Vercel preview

Files: operational docs, session vault note, any integration fixes.
Consumes: A+B commits. Produces: integrated develop commit, passing gates, verified preview or precise external blocker.

- [ ] Review worker commits and integrate; perform browser desktop/mobile/motion/modal/chat checks.
- [ ] Apply only reviewed additive Mono migration using existing authorized database access, regenerate types, verify ledger/public denial. Never alter tenant records.
- [ ] Document preview-only environment names and exact origin configuration; leave live credentials with user.
- [ ] Run scripts/finish-task.sh for rebase, typecheck, lint, tests, build, develop integration and cleanup.
- [ ] Use existing Vercel project for a preview deployment only; verify landing and `/api/mono` through the deployed URL. Do not use `--prod` or merge main.
- [ ] Record wrapup and give concrete test steps plus preview/release links as applicable.
