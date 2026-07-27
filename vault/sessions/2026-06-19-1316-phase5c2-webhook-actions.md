---
type: session
date: 2026-06-19-1316
branch: develop
trigger: wrapup
status: complete
tags: [session, project/pulse, phase-5, automations, webhooks, pg_net]
related:
  - "[[2026-06-19-phase-5c2-automations-design]]"
  - "[[2026-06-19-0957-phase5c1-run-history]]"
---

# Phase 5c-2 — Automations: external/webhook actions (closes Phase 5)

## What changed

- **Built Phase 5c-2 end-to-end, subagent-driven** (9 plan tasks, fresh implementer + spec/quality
  review each; final whole-branch review = **Ship**). Commits `5d57232`→`8b7d091` (~20, interleaved
  with a parallel session on develop). A `call_webhook` automation action: the in-DB engine
  (`_automation_run`) enqueues an HTTPS POST via **`pg_net`** (outcome `queued`) + records a
  `automation_webhook_deliveries` ledger row; a 1-min `pg_cron` **`_automation_webhook_reconcile`**
  reads `net._http_response` and patches the 5c-1 run-history outcome to `delivered_<code>` /
  `failed_<code>` / `failed_network`.
- **Security:** baseline SSRF guard `_webhook_url_safe` (https-only, blocks private/loopback/metadata
  hosts + IP literals; userinfo/port stripped; inet-cast exception-guarded) + an **admin-gate DB
  trigger** (`tg_automations_guard_webhook`, raises 42501, guarded on `auth.uid() is not null` so
  trusted service-role/cron contexts pass) — the real boundary; server-action + builder gating are UX.
- **Two migrations** applied to cloud (`20260619130000` schema/engine/guard, `20260619130001`
  reconcile/cron/prune). Zod `call_webhook` variant, run-formatter strings, `getBoardAdminStatus` +
  the `actionsContainWebhook` helper (in a **non-`"use server"`** module per gotcha-16), builder
  `WebhookRow` + admin-gated button, one recipe + dialog wiring (incl. a `summarize()` exhaustiveness
  fix).
- **Gate green:** typecheck / lint / **642 tests** (7-case cloud integration) / build; **e2e** passes
  against live cloud; advisor-parity clean (6 fns search_path-pinned, table RLS + 1 SELECT policy).
  **Real-network proof** (autonomous via cloud SQL): pg_net delivered 405/503/200 round-trips →
  `_webhook_outcome` mapped failed_405/failed_503/delivered_200; `jsonb_set` patch verified
  (webhook action patched, sibling notify untouched).

## Why

5c-1 built run-history specifically so webhook delivery outcomes could land in it. 5c-2 adds the
first **outbound HTTP** from Monolith (Slack/Zapier/Make/custom), staying 100% in-DB via pg_net +
pg_cron, and **closes Phase 5 (Automations)**.

## Open threads

- **Not user-verified in the app beyond the e2e.** Optional: build a rule pointing at a `webhook.site`
  URL and watch the outcome flip queued→delivered in "Recent runs" (≤1 min).
- **39 commits unpushed on develop** (5c-2 + interleaved parallel-session work). Push decision pending.
- **Do not promote develop→main** (WebGL landing cross-browser check still outstanding).
- v2 hardening (deferred, bounded by admin gate): in-DB re-validate auth-header name charset / forbid
  Content-Type override; HMAC signing; per-org domain allowlist; retries; body templating.
- Gotchas hit: `get diagnostics … = row_count` into a `boolean` raises at runtime → use `FOUND`;
  `pnpm db:types` PostHog `"_tag"` line clobbered `database.types.ts` → regen with `grep -v '"_tag"'`;
  lint-staged stash/restore swept 3 untracked parallel-session files into a commit (shared checkout).

## Next session entry point

Phase 5 is done. Either push develop (39 ahead) and/or pivot to **Phase 6 (ClickUp depth:
subitems/nesting, time tracking, Docs, custom fields, relations+mirror)**. Spec
[[2026-06-19-phase-5c2-automations-design]].
