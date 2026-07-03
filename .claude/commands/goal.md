# /goal — The current product goal

The current product goal is **MVP Final Features**:
`docs/superpowers/plans/2026-07-03-mvp-final-features.md` — every open user-submitted feature
request from the in-app feedback table, deduplicated into 9 features with an execution DAG.

When invoked:

1. Read `docs/superpowers/plans/2026-07-03-mvp-final-features.md`.
2. Check progress against reality — for each feature, look for a merged `task/*` branch, a session
   note in `vault/sessions/`, or shipped code; also check `git branch --list 'task/*'` and
   `git worktree list` for in-flight work. Optionally cross-check live status in the
   `public.feedback` table (dev Supabase).
3. Report a compact status board: per feature — done / in-flight / not started, plus what the DAG
   says is launchable **now** (unblocked items in the current batch).
4. End with a one-line recommendation of the next parallel batch to dispatch (hand off to
   `/whats-next` or `/develop` for actual dispatch — `/goal` itself is read-only and never builds).

When the goal changes, repoint this file at the new plan document.
