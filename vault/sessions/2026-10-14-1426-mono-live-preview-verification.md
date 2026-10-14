---
type: session
date: 2026-10-14-1426
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-14-1239-mono-vercel-preview-integration]]"]
---

# Mono live Preview verification

## What changed
- Owner entered the OpenAI and bot settings into Vercel. Checked names/scopes without revealing their values; session secret already existed.
- Owner-started redeploy used older main code. Redeployed the approved Mono Preview explicitly to Preview; deployment `dpl_8AQLgA9Y14uSuHy46VCaCn7MDhvi` is READY. Production deployment unchanged.
- Verified HTTP 200/no-store, live mode, callbacks enabled and reporting disabled. Real OpenAI reply and conversational details → editable form → consent review passed in browser with no console errors.
- Left the marked test enquiry unsent and consent unchecked. Updated runbook, north-star and board JSON; no app-source change or public changelog announcement.

## Why
The user completed credential setup and started redeploying. Testing needed the approved Mono build and clear separation between live AI verification and still-unverified bot delivery.

## How to test (for the user)
1. Open https://monilith-geg46e06h-synapse-solutionskw.vercel.app; Mono should show AI assistant and answer a question.
2. Use the prepared Mono Preview Test review, or enter your own marked test enquiry. Review/edit the details, check consent and press Confirm & send.
3. Verify the acceptance receipt and actual arrival in the Grok bot. If status is unknown, use Check delivery rather than submitting another request.

## Open threads
- Bot authentication and actual delivery await the confirmed submission; prepared review used mono-preview@example.com and requested no follow-up.
- Production activation remains a later owner-controlled release. Cloud board refresh unavailable; updated JSON remains local. No app tests rerun for documentation-only changes.

## Next session entry point
Use the current Preview URL in `docs/operations/mono-vercel-preview.md`. Check the reviewed request's receipt after the user confirms sending.
