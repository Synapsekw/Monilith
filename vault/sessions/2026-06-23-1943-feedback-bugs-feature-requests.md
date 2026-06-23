---
type: session
date: 2026-06-23-1943
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-23-gotcha-41-db-types-contamination-from-shared-remote]]"
---

# Feedback — in-app bug & feature-request reporting

## What changed

- New feature, specced → planned → built subagent-driven in worktree `task/feedback`, merged to `develop` (merge `eb99423`). Spec + plan: `docs/superpowers/{specs,plans}/2026-06-23-feedback-bugs-feature-requests*`.
- **Schema** (`20260623120000_feedback.sql`): `public.feedback` (org-scoped, RLS: submitter reads own / platform admin all/writes) + `notifications.feedback_id` + `notification_kind` value `feedback_response`. Migration applied to the linked DB.
- **Server** (`src/lib/feedback/`): `submitFeedback` / `listMyFeedback` / `adminUpdateFeedback`; the admin reply notifies the submitter via the **service client** (cross-tenant insert — admin isn't a member of the submitter's org).
- **UI**: header **Feedback** popover (New + My requests tabs); platform-admin triage at `/admin/feedback` (filterable list w/ `new` count badge → status + public response); bell renders `feedback_response`.
- Side fix: Stop hook path made absolute via `$CLAUDE_PROJECT_DIR` (`20bc461`) — killed the per-turn `MODULE_NOT_FOUND`.

## Why

There was no in-product channel for users to report bugs / request features; feedback travelled out-of-band with no triage surface and no loop back to the reporter. This gives a low-friction capture point plus a single platform-admin triage queue with a status/response loop.

## How to test (for the user)

Pull `develop` first. The migration is already applied to the shared dev DB.

1. As any user, click **Feedback** in the top bar → **New** → pick **Bug**, add a title + details → **Submit**. Expect a thanks state and the report under **My requests** as **New**.
2. As the platform admin, open **`/admin/feedback`** (sidebar shows a `new` count badge) → open the report → set status **In progress** + type a public response → **Save**.
3. Back as the user: the **bell** shows "updated your feedback request"; **My requests** shows **In progress** + the reply.
4. Confirm a non-admin can't reach `/admin/feedback` and sees only their own reports.

## Open threads

- **Hand-grafted types.** `src/types/database.types.ts` was hand-edited for feedback only — a full `db:types --linked` regen pulled another session's then-unmerged `percent` column-kind. Next clean regen on `develop` will routinely reconcile that file. See [[2026-06-23-gotcha-41-db-types-contamination-from-shared-remote]].
- **Merge gate.** Merged on typecheck/lint/1079 unit/build + feedback RLS integration (4/4). The repo-wide integration suite was NOT the gate — concurrent sessions trip the shared cloud GoTrue 429 limit, failing unrelated integration files (documented in `vitest.config.ts`). Re-run integration when sessions are quiet if a clean full-suite pass is wanted.
- **Deferred (v1 non-goals):** screenshot/attachment upload, auto page/browser context, per-org triage, voting/roadmap, submitter edit-after-submit, deep-link from bell into the popover.
- **Post-merge fix — RSC render-prop boundary** (`3bd9ac4`). `/admin/feedback` (Server Component) passed a **render-prop function** as `children` to the client `FeedbackFilters` → runtime _"Functions are not valid as a child of Client Components"_. Functions don't serialize across the RSC→Client boundary. Fix: move the list rendering **into** `FeedbackFilters` so only the serializable `rows` array crosses; page now does `<FeedbackFilters rows={rows} />`. Plan gap: the render-prop wrapper was specified without accounting for the boundary, and slipped through because no test exercised the server/client composition (unit tests only covered leaf components with mock props). Lesson: never pass a function child from an RSC to a client component; render the list inside the client component over plain data. See [[2026-06-23-gotcha-42-no-function-children-across-rsc-client-boundary]].

## Next session entry point

Feedback is shipped on `develop` (unpromoted). Resume the main line: run `/promote` to ship the `develop` bundle (now also carrying feedback), then Phase 9.3 cache + 9.4 skeletons.
