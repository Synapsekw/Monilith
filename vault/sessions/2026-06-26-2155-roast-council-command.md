---
type: session
date: 2026-06-26-2155
branch: develop
trigger: wrapup
status: complete
tags: [session, tooling, decision-making]
related:
  - "[[2026-06-21-whats-next-skill-design]]"
---

# /roast adversarial decision council command

## What changed

- Added `.claude/commands/roast.md` — a `/roast` slash command (registers; appears in skills list).
- Wrote spec + plan: `docs/superpowers/specs/2026-06-26-roast-council-design.md`,
  `docs/superpowers/plans/2026-06-26-roast-council.md`.
- 3 commits on develop (tooling lane, no worktree): `f17d70f` spec, `fe95164` command, `b011b61` plan.
- Verified live: ran both dry-runs end-to-end — idea mode (5 personas + Buyer → KILL) and technical
  mode (Buyer → Maintainer swap → KILL); Deep Researcher made real web calls, agents read the repo.
- Healed pre-existing drift: `exceljs` was in package.json but missing from the main-checkout
  `node_modules` (failed typecheck) — `pnpm install` fixed it; typecheck/lint/build then green.

## Why

User wanted Nate Herk's "roast" LLM-council (anti-sycophancy decision stress-test) rebuilt for this
repo. Generalized it to be mode-aware (business ideas + technical decisions) so it doubles as an
architecture-decision check, reusing the repo's parallel-agent-dispatch + separate-judge patterns.

## How to test (for the user)

1. In a Claude Code session here, run `/roast a $9/mo tool that turns a YouTube transcript into a
week of LinkedIn posts`.
2. Answer the ≤3 intake questions (buyer / edge / constraints).
3. Confirm 5 persona agents fan out in parallel, then one separate Judge runs.
4. Expect a RESHAPE/KILL verdict with a per-persona score table and a "cheapest 48h test".
5. Run `/roast should we replace our Zustand store with React Context for the board view` — confirm
   mode flips to technical, roster swaps Buyer → Maintainer, cheapest test becomes a validation spike.

## Open threads

- `pnpm test` deliberately skipped (writes fixtures to live remote Supabase; markdown-only change
  can't affect test outcomes) — flagged, not silently dropped.
- Optional follow-ups offered, not built: `--research` off-switch, persist verdicts to disk/vault.

## Next session entry point

`/roast` is done and on develop. If iterating, tune the persona rosters/prompts in
`.claude/commands/roast.md`; otherwise pick up unrelated roadmap work.
