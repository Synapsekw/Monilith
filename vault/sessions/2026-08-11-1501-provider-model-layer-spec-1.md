---
type: session
date: 2026-08-11-1501
branch: develop
trigger: wrapup
status: complete
tags: [session, ai, providers, subagent-driven]
related:
  - "[[2026-08-11-decision-35-the-gateway-id-namespace-is-not-the-providers]]"
  - "[[2026-08-11-gotcha-89-five-tests-that-could-not-fail-in-one-plan]]"
  - "[[2026-08-11-gotcha-90-vitest-spy-tracking-reports-a-handled-rejection]]"
---

# Provider & model layer — Spec 1 of 3, merged

## What changed

- **13-task subagent-driven build merged to `develop`** (`4b6a718e`, branch `fbe157bd..3afbda5a`
  = 37 commits, 140 files, +11483/−1542). Two new tables — `ai_providers` (registry) and
  `ai_models` (catalog, refreshed daily from the public Vercel AI Gateway feed). One API key
  **per provider** across five providers, any agent pinnable to any model those keys reach, and
  new models appearing **without a deploy**.
- **Resumed mid-plan** (7 of 13 done) from a handover. Every remaining task ran
  implementer → task review → fix round → scoped re-review; then a whole-branch review, one
  14-item fix wave, and a scoped re-review of that. Final verdict: no Critical, merge-ready.
- **Two migrations only** (`20260810173752`, `20260811024717`), both already applied; ledger
  138/138 in sync. No third was minted despite four tasks having a reason to want one.
- **Anthropic id verification closed with the owner's authorisation** — one read-only
  `GET /v1/models` with the single stored credential, run through the *shipped* code path.
  Anthropic went 1 verified / 14 unverified → **10 / 5**; `claude-haiku-4.5` →
  `claude-haiku-4-5-20251001` confirmed live.
- **Two pricing decisions taken by the owner mid-flight** (see ADR 35's sibling notes below):
  a null catalog price chains to `FALLBACK_RATES` instead of billing $0, and `FALLBACK_RATES`
  became a per-component **minimum** so Sonnet 5's introductory $2/$10 (expiring **2026-08-31**)
  cannot silently replace the standard $3/$15 it is deliberately billed at.
- **`/updates`:** announced three entries dated 2026-08-11 (per-provider keys, org default-model
  picker, agent model pin). They publish at the next promotion, which is also when the feature
  becomes reachable — the two land together.
- **PROMOTED THE SAME SESSION — PR #95, `main` @ `1ebc8a44`, 47 commits.** Verified live rather than
  assumed: Vercel `state=success`, `www.monolith.works` 200, `/settings/ai` 307, `/updates` serving
  all three new entries, and **`/api/ai/models/refresh` returning 401 rather than 404** — the daily
  catalog cron finally has a live, HMAC-gated target instead of a missing route.
  `AI_PGNET_HMAC_SECRET` was confirmed present in Vercel production *before* the merge, and
  `ANTHROPIC_API_KEY` is there too, so the refresh pass will actually re-verify Anthropic ids in
  production. Squash divergence healed (`a0a692df`, ancestry and byte-identical tree both checked).

## Why

Spec 1 of 3 unblocks the rest of the AI track: Spec 2 (agent capability & knowledge) and Spec 3
(orchestration & `@handles`) both assume a model can be chosen rather than compiled in. It also
retires the last hardcoded provider constants, which is what made Mistral and Kimi unreachable
regardless of whether a key existed.

## How to test (for the user)

Setup: `git checkout develop && git pull && pnpm install && pnpm dev`. This runs against **DEV**,
which is the live database — the steps below write only your own settings and one agent.

1. Go to **`/settings/ai`**. Under **"Your AI providers"** you should see **five rows**, sorted by
   label: *Anthropic (Claude)*, *Google Gemini*, *Kimi (Moonshot AI)*, *Mistral*, *OpenAI*.
   (Kimi before Mistral is correct — it sorts on the label, not the id.)
2. Your existing **Anthropic** key shows as a masked hint (`sk-ant-…pQAA`) with **Replace** /
   **Remove**. The other four say **"Not connected"** with **Add key**.
3. Click **Add key** on **Mistral**. The field opens *in that row only*. **This is the case that
   used to 500 the whole page** — a non-native credential hit a three-entry lookup.
4. Paste a deliberately **wrong** Mistral key and Save. Expect "Verifying…", then a red message
   **on the Mistral row** only; your Anthropic key untouched.
5. Now save a **valid** key for Mistral or Kimi. Expect that row to show its own masked hint
   **while Anthropic still shows its own**. Two keys side by side is what the old UI could not do.
6. Click **Remove** on the second row. Only that row reverts. (Remove used to always target the
   first key regardless of which button you clicked.) **Reload** — state comes back from the DB.
7. As an org admin, scroll to **Organization AI → Default model** and open the picker. Expect a
   searchable list grouped by provider, cheapest first, with a mono tier chip. **Anthropic** and
   **OpenAI** populated; **Google**, **Mistral**, **Kimi** each showing a single greyed
   *"Add an API key to see models"* row — that is configuration state, not breakage.
8. Type in the search box and switch provider groups with **DevTools → Network open**: expect
   **zero requests**. That is the working-agreement-#5 assertion.
9. Pick a model, reload — it persists. Then open the picker and choose **"No default — each
   feature picks its own tier"** to clear it; reload again.
10. Go to **`/settings/agents`** → **New agent** → **Morning Brief**. Find the **Model** field
    (below the schedule row). It reads *"Use the organization's default"*. Pick a Claude model →
    the line changes to *"This agent always runs on this model…"*. Create, re-open, reload — the
    pin persists. Clear it back to the org default and confirm that persists too.
11. If you pin a **non-Anthropic** model, expect a warning line: tool loops are Anthropic-only, so
    that agent's runs would be recorded **skipped**.

## Open threads

- **CLOSED by the promotion:** the 1-arg `ai_credential_get` exposure (production now runs the
  per-provider reader, so a second key is safe to add) and the missing catalog-cron route.
- **Two post-promotion migrations are now unblocked** and can be batched: drop the unused 1-arg
  `ai_credential_get` / `org_ai_secret_get` overloads — deployed production no longer calls them —
  and add `CHECK (>= 0)` on the four `ai_models` price columns.
- **Only Anthropic re-verifies after a refresh.** For the other four providers, "new models without
  a deploy" is false until a user re-saves their key. Largest functional gap; belongs in Spec 2.
- **Six legacy arg-blind test fakes remain** outside this branch's files (see gotcha 89).
- **`pickModel`'s ladder** tries the org default before the per-feature tier; the real answer is
  probably a capability constraint rather than a tier. Deliberately not redesigned in a fix wave.
- **A repo-wide a11y ticket** is owed: focus dropped to `<body>` after save/clear, error text not
  tied to its control, comboboxes named from their value — all inherited, matching
  `ui/timezone-picker.tsx`. One `ModelPicker` edit was **denied by the permission system** and not
  retried; raise it there as one decision.
- Post-promotion migration candidates: drop the two 1-arg overloads; add `CHECK (>= 0)` on the four
  `ai_models` price columns.

## Next session entry point

Already promoted (PR #95). Walk the "How to test" guide above against production — step 5 (a
*second* provider key) is the one path no automated test could prove. Then Spec 2 (agent capability
& knowledge), which should absorb per-provider re-verification and the `pickModel`
capability-constraint question; the dashboard-widget service-client issue is still the open item
that may be affecting users today.
