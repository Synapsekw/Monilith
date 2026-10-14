# Mono on Vercel: preview and release

The approved Assembly landing and Mono run in the existing Monolith Next.js application. `/` is public for signed-out visitors; signed-in visitors continue to `/home`. `/landing` is available to everyone and shows the appropriate app-entry action.

## Verified preview — 2026-10-14

[Open the Vercel Preview](https://monilith-at296yn4g-synapse-solutionskw.vercel.app). Deployment `dpl_7V4owXPSiM3qWLPtCYk32J66zThG` is READY and retains Vercel authentication protection. Integrated into `develop` at `5241dd27`; production is unchanged.

The deployed landing, Mono animation and guide reply were verified in the browser with no console errors. `/api/mono?action=status` returned HTTP 200 with `cache-control: no-store`, `mode: preview`, and both bot switches disabled. Full gates passed: typecheck, lint (0 errors, 5 pre-existing warnings), 8,076 tests (1 skipped), production build, and DEV migration ledger 176/176.

**Still required:** enter the OpenAI and bot credentials directly into Vercel's Preview environment, enable `MONO_CALLBACKS_ENABLED=true`, redeploy, and run the real-reply/contact-delivery acceptance steps below. Real AI replies and Grok delivery have not been verified on Vercel. Keep reporting disabled unless conversation-summary delivery is explicitly wanted.

## Preview setup

Use the existing Vercel project `synapse-solutionskw/monilith`. Create a **Preview** deployment, never a production deployment for acceptance testing. The repository disables automatic deployments for non-main branches, so create the preview explicitly through the Vercel CLI or dashboard.

In the project's Environment Variables settings, select **Preview** for Mono settings. Never add `NEXT_PUBLIC_` to a secret's name. The local setup page and its in-memory credentials are not part of the app build and are not transferred to Vercel.

| Variable                 | Preview value/purpose                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONO_OPENAI_API_KEY`    | Enter the OpenAI key directly in Vercel. Required for real replies.                                                                                             |
| `MONO_SESSION_SECRET`    | Random 32+ character server secret for encrypted records and request hashing. A preview-only secret was created during integration without logging its value.   |
| `MONO_SITE_ORIGIN`       | Exact allowed origin if explicitly configured. Preview deployments can derive their own exact origin from Vercel's trusted `VERCEL_URL`; do not use a wildcard. |
| `MONO_BOT_WEBHOOK_URL`   | Optional HTTPS bot routine URL.                                                                                                                                 |
| `MONO_BOT_WEBHOOK_KEY`   | Optional raw bot key.                                                                                                                                           |
| `MONO_BOT_AUTHORIZATION` | Alternative to raw key: copied Bearer header. Use one form.                                                                                                     |
| `MONO_BOT_ALLOWED_HOST`  | Exact webhook hostname, default `api2.cursor.sh`.                                                                                                               |
| `MONO_REPORTING_ENABLED` | `false` initially. Explicit `true` sends conversation summaries/recent messages to the bot.                                                                     |
| `MONO_CALLBACKS_ENABLED` | `false` initially. Explicit `true` enables reviewed, consented contact submissions.                                                                             |

The existing server-only Supabase service-role setting is used for the dedicated encrypted Mono records. It never enters the browser. Browser database roles cannot read these records or execute the Mono storage RPCs. Preview and production records are separated by deployment origin.

Mono uses the requested `gpt-6-luna` model. Redeploy the preview after changing environment variables. Missing Mono credentials leave the landing usable with Mono's built-in guide; this is not a verified real-AI connection. Invalid configured settings fail closed.

## Acceptance walkthrough

1. Open the exact preview URL signed out. Confirm the Assembly hero, blue product screenshots, and Mono are present.
2. Use the product chapters, agent demo, billing toggle, navigation and screenshot viewer. Close the viewer; Mono should return. Pause motion and verify both the hero and Mono stop; check reduced-motion and mobile widths.
3. Open Mono without credentials. Confirm its guide is available and no real bot delivery is claimed.
4. After setting Preview credentials and redeploying, open Mono, ask what Monolith does, and confirm a real reply. Refresh and reopen to verify conversation recovery.
5. Keep bot switches off for reply-only testing. To test a bot explicitly, configure its credentials and enable the needed switches, then redeploy. A summary shares the recent conversation; a contact request shares only the reviewed fields.
6. Tell Mono you want a demo and provide clearly marked test contact details. Use **Review contact details** (or **Contact team**) and verify the chat details are prefilled and editable. Review the final values, give consent, then **Confirm & send**. Verify receipt and bot delivery. A receipt means accepted for processing, not a booked call. If delivery is unknown, use Check delivery; do not create another request.
7. Verify Log in, Sign up, and the signed-in `/landing` app-entry action. Use existing test access; do not change real workspace records during marketing-page acceptance.

## Production release

After preview acceptance, configure **Production** Mono variables separately, use a separate session secret and exact canonical `MONO_SITE_ORIGIN`, and decide which bot actions to enable. Production activation follows the repository's `develop → main` PR: the owner manually reviews and merges after CI passes. Agents must not merge main, enable auto-merge or invoke a direct production deploy.

The current live Vercel deployment uses the DEV Supabase project by deliberate repository policy. The Mono migration adds isolated storage only; this work does not change database routing or alter existing tenant records. The idle PROD database is not the preview target.
