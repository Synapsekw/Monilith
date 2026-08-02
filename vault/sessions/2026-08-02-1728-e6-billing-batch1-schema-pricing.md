---
type: session
date: 2026-08-02-1728
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-02-gotcha-71-omitting-thinking-is-not-no-thinking]]"
---

# E6 billing batch 1 — schema, entitlement mapping, public pricing

## What changed

- **Closed out `task/ai-cogs`** (merged `fdce8df2`): wrote [[2026-08-02-gotcha-71-omitting-thinking-is-not-no-thinking]], resolved a real rebase integration (types, a deleted `MODEL` export, a renamed test binding), and found the branch's own bug class recurring in freshly-merged code — `summarise.ts` issued a 512-token call with no `thinking`, masked by `fallbackSummary()`.
- **Discovered a duplicate plan before writing code.** A 1000-line E6 plan from 2026-07-12 already existed and was missed. Nothing from it was ever built (verified against repo + live DEV). Both July artifacts now carry supersession banners rather than deletion — their Stripe mechanics are worth harvesting, and their **F17 track (usage dashboard + AI digest narrative) has no successor spec and is tracked nowhere else**.
- **Planned and built E6 batch 1** — `docs/superpowers/plans/2026-08-02-billing-batch1-schema-and-pricing.md`, 9 tasks, merged as `34839115` (36 files, +1744).
- **Unit A:** `org_billing` + `billing_discount_codes` (RLS on, **zero policies** — the deny *is* the absence of policy), `get_org_billing_status()` definer that never returns a Stripe id, tier vocabulary `none|core|pulse|trial|enterprise`, `tiers.ts → entitling.ts → status.ts`, and the **`setAiMode` self-grant hole closed**.
- **Unit D:** static `/pricing` (cards, cadence toggle, comparison table, FAQ), landing teaser in its own file, nav + footer links.
- **The `DEFAULT_ORG_AI_SETTINGS` flip, done safely.** DEV had 22 orgs and **zero** `org_ai_settings` rows, so all 22 ran on the constant — flipping it alone would have killed AI for every one of them in one deploy. The migration wrote 22 explicit `per_user` rows first; verified `uncovered = 0` before the constant moved.

## Why

The billing spec was approved with "plan pending" and E6 was the last open AI epic. Batch 1 is the credential-free half — it gives the Stripe track a schema root and puts a real price list in front of visitors while Stripe access is still outstanding.

The reason to stop at batch 1 is **risk isolation, not blockage**: the July plan proves the Stripe path builds and unit-tests with no credentials (optional env, injected client, `generateTestHeaderString`). Only end-to-end verification waits on the account. The AI-mode default flip touches a deployment serving real users and deserved to land alone.

## How to test (for the user)

Pull `develop`. Production still runs `main`, so this is not live until promoted.

1. **Pricing page.** Logged out, open `/pricing`. Expect **$10 / $24 / Custom**, Pulse marked "Most popular", annual preselected. Click **Monthly** → **$12 / $29**, no reload.
2. **Public access.** Hard-refresh `/pricing` while logged out — expect the page, not a `/login` redirect.
3. **Landing.** `/landing` → click **Pricing** in the nav (smooth scroll, not a navigation) → **Compare plans →** goes to `/pricing`.
4. **Existing orgs keep AI.** Sign in, Settings → AI. Expect **per-user keys**, unchanged. Reading "off" means the backfill missed that org — that is a regression, report it.
5. **Self-grant closed.** In an org with no subscription, Settings → AI → select **Managed**. Expect *"Managed AI needs an active Pulse subscription."* This previously succeeded.
6. **New orgs default off.** Create a fresh org → Settings → AI reads **off**, Ask reports AI is not on the plan. Grant tier `pulse` / ceiling 500 at `/admin/organizations/<id>` and confirm AI comes alive.

## Open threads

- **Signup is open and new orgs now get no AI.** Live from the next promotion. Until checkout ships, `setOrgAiPlan` in the platform console is the only grant path.
- **F17 (usage dashboard + AI weekly-digest narrative) is homeless** — unbuilt, no successor spec, flagged only in the superseded July plan and the batch-1 plan.
- **Ask WRITE path still unverified live** ("create a task called Billing spike in Phase 1 MVP Launch on QCC") — no authenticated browser session was reachable without entering credentials.
- Three stale `_draft-*.md` (1707, 0337, 0554) belong to already-written-up sessions; left in place rather than deleted from another session's work.
- Board refresh skipped — a concurrent session is actively editing `vault/board.html`.

## Next session entry point

Plan the Stripe track (units B, C, E–H) against `2026-08-01-billing-and-monetization-design.md`, harvesting Tasks 1/4/6 of the superseded July plan rather than re-deriving them. It needs no credentials to build — only to verify end to end.
