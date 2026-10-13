---
type: session
date: 2026-10-13-2304
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Owner-controlled production releases

## What changed

- Confirmed Vercel project `monilith` uses `main` as its production branch and GitHub's `main`
  already contains `deploymentEnabled: { "**": false, "main": true }` in `vercel.json`.
- Disabled repository auto-merge and enabled administrator enforcement on `main` protection
  through the GitHub API; read back the settings to verify.
- Preserved required `verify` CI with strict/up-to-date checking, required PRs, conversation
  resolution, linear history, and disabled force pushes/deletions. Verified `verify` exists.
- Owner explicitly chose to review and manually click Merge, rather than require a formal
  Approve review. Recent promotion PRs are authored as `Synapsekw`, which cannot approve itself.
- Updated AGENTS.md, CONTRIBUTING.md and /promote to require an owner-performed GitHub merge;
  agents prepare PRs, hand over the link, and do not merge, auto-merge, bypass, or deploy directly.

## Why

The owner decided to keep Monolith on Vercel and require personal inspection before production
releases. The deployment branch restriction already existed, but auto-merge was enabled and
administrators could bypass main's protections. This task changes release controls, not app code.

## How to test (for the user)

1. Open GitHub repository Settings → General → Pull Requests: Allow auto-merge is disabled.
2. Open Settings → Branches → main: protections apply to administrators, `verify` must pass,
   and the branch must be up to date. A separate approving review is intentionally not required.
3. On the next /promote, expect a PR link and a stop. Review the changes, then manually choose
   Squash and merge in GitHub to release. Do not merge merely to test this configuration.

No app behavior changed. Validation is live API readback and documentation diff/format checks;
the application test suite is not needed for these settings and prose edits.

## Open threads

- No production PR was merged or deployment triggered. GitHub Actions CI builds on develop
  and PRs remain enabled; the main-only restriction concerns Vercel deployments.
- Manual Vercel CLI/dashboard deployment privileges are not revoked by Git branch protection.
  GitHub also cannot distinguish a person from an agent using the same account credentials;
  the owner-only action is additionally recorded as a repository instruction.
- Unrelated untracked specs and session drafts were preserved.

## Next session entry point

Follow AGENTS.md and the updated /promote flow: prepare the production PR and hand over its link.
Only after the owner manually merges, verify the merge, heal squash divergence and watch deployment.
