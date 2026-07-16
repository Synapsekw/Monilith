# Mutual Org Membership (cross-org board sharing) — Design Spec

**Date:** 2026-07-16
**Status:** Draft — awaiting owner review
**Author:** Brainstorming session (interactive Q&A with owner)

---

## 1. Problem

Board access in Pulse is per-board on the org spine: a user sees a board only if
they created it or someone ran `share_board` to add them to `board_members`
(`supabase/migrations/20260620100000_board_level_sharing.sql`). Crucially,
`share_board` **hard-gates the target to the board's own org**
(`is_org_member_of(v_org, p_user_id)`, lines 627-645), and the RLS helpers
`can_read_board` / `can_edit_board` require `is_org_member(b.org_id)`
(`20260621000000_board_access_require_membership_and_returning.sql:50-81`).

Consequence, in the owner's words: _"if I invite someone to my org I can only
share boards **with** them; if they want to share boards **with me** they have to
invite me to their own org, which is messy."_ Sharing is directional. Inviting
Bob into Alice's org lets Alice share Alice-org boards with Bob, but gives Bob no
way to share his own (Bob-org) boards back to Alice — Alice isn't a member of
Bob's org, so Bob's `share_board` call would reject her.

We want: **when you invite someone into your org, board-sharing works freely in
both directions** — without the invitee having to issue a second, reverse org
invite.

## 2. Chosen approach — reciprocal membership on invite-accept

Of the approaches considered (see §9), the owner chose **mutual membership**:
inviting someone establishes a two-way link so both can share either direction.

The insight that makes this cheap: **the security model already does everything
we need the moment both people are members of both orgs.** Once Alice is a member
of Bob's org, Bob's existing `ShareBoardDialog` already lists her, `share_board`
already accepts her (she passes `is_org_member_of`), and `can_read_board` already
lets her read a board Bob shares. Nothing in the RLS boundary has to change.

So the entire feature is: **make accepting an invite also add the inviter into
the invitee's org.** Concretely — when Bob accepts Alice's invite into Alice's
org (today's behavior: Bob → member of Alice's org), we **also** add Alice into
**Bob's owned org** as a `guest`. Now both are members of both orgs, and per-board
sharing flows both ways using the machinery that already exists.

### Direction, restated precisely

- `invited_by` on the invite = **Alice** (the inviter).
- The accepting user = **Bob** (the invitee).
- Reciprocal insert = **Alice → Bob's owned org**, role `guest`.

Rationale for "Bob's _owned_ org": Bob's boards live in the org Bob owns. For Bob
to share one of them with Alice, Alice must be a member of _that_ org. A user owns
**at most one** org (`create_organization` refuses a second —
`20260709124750_create_organization_atomic_guarded.sql:44-49`;
`provision_account` short-circuits on any existing membership —
`20260619184702_provision_account.sql:24-32`), so "Bob's owned org" is
unambiguous: exactly zero or one row where `org_members.user_id = Bob AND
role = 'owner'`.

## 3. Goals / Non-Goals

**Goals**

- Accepting an org invite makes the inviter a member (`guest`) of the invitee's
  owned org, so board-sharing works in **both** directions with no reverse invite.
- Cover **both** accept paths: in-app `accept_invitation` and the login-callback
  batch `redeem_invitations`.
- **Zero changes to the security boundary** — no edit to `share_board`,
  `can_read_board`, `can_edit_board`, `board_members`, or any board/satellite RLS
  policy. The reciprocal insert lives inside the existing SECURITY DEFINER accept
  RPCs.
- Behavior-preserving for everyone who never gets/accepts an invite.

**Non-Goals (v1 — explicitly deferred, see §7)**

- **Restricting the `guest` role.** `guest` is dormant today (see §4); a
  reciprocal guest has the same DB capabilities as a `member`. We accept that for
  v1. Making `guest` a truly restricted role is a separate, larger change that
  touches multiple RLS policies.
- **Auto-teardown.** Removing someone from your org will **not** auto-remove the
  reciprocal membership in v1. Documented limitation (§7).
- **Reciprocating when the invitee owns no org.** Skipped silently (§7) — such a
  user has no boards to share anyway.
- Any org-to-org "connection" abstraction (Approach 3, §9). Not built.

## 4. Grounding: why `guest` is the right role and what it does (and doesn't) limit

Confirmed by reading every role check in the schema:

- The only role helper, `has_org_role` (`20260619200000_org_admin_platform_console.sql:66-73`),
  is only ever called with `{owner,admin}` (or `{owner}`). **No policy anywhere
  distinguishes `member` from `guest`.** All non-admin write paths gate on
  `is_org_member(org_id)` — membership _existence_, role-blind
  (`20260619200000...:57-64`).
- Therefore a `guest` can today do everything a `member` can in that org: create
  boards (`boards: insert if member` — `20260615061747_boards_core.sql:251-253`,
  gated on `is_org_member`, not role), create workspaces
  (`20260614174043_init_auth_tenancy.sql:250-252`), and read the full
  `org_members` roster (`org_members: read if member` — `...:225-227`).
- `guest` is a **dormant enum value**: declared at
  `20260614174043_init_auth_tenancy.sql:9`, referenced nowhere in SQL logic.
- App-layer, `guest` _is_ already treated as lesser in two harmless spots we
  benefit from: digest recipients exclude guests
  (`src/lib/digest/run.ts:184,192` — `.in("role", ["owner","admin","member"])`),
  and it's an offered invite role (`src/components/settings/invite-panel.tsx:17`).

**Why `guest` anyway (not `member`):** it's the correct _semantic_ marker — "this
person is here via a reciprocal cross-org link, not a first-class hire" — it
already self-excludes from digests, and it's the natural hook if/when the owner
later decides to make guests genuinely restricted (that future work would gate on
`role`, and these rows would already be tagged). For v1 the choice is capability-
neutral but future-proofing.

**Owner-accepted tradeoff:** a reciprocal `guest` can create boards in the other
person's org and appears in that org's roster. This is _symmetric with how a
normal invite already behaves today_ (an invited `member` can already do both in
the org they were invited to) — reciprocation simply makes the relationship
two-way. The owner reviewed and accepted this for v1.

## 5. The change (grounded in code)

### 5a. `accept_invitation` — in-app accept

Current (`supabase/migrations/20260620110000_invite_acceptance.sql:32-62`) reads
`org_id, role` from the invite and inserts the invitee. We extend it to also read
`invited_by`, look up the invitee's owned org, and insert the inviter as `guest`.

Shape of the new definer logic (final SQL written during implementation):

```sql
-- after the existing invitee insert (…:56-58):
-- v_invited_by comes from `returning org_id, role, invited_by into …`
declare
  v_home_org uuid;
begin
  select org_id into v_home_org
  from public.org_members
  where user_id = v_uid and role = 'owner'   -- invitee's owned org (0 or 1)
  limit 1;

  if v_home_org is not null and v_invited_by is not null
     and v_invited_by <> v_uid then
    insert into public.org_members (org_id, user_id, role)
    values (v_home_org, v_invited_by, 'guest')
    on conflict (org_id, user_id) do nothing;   -- idempotent; never downgrades
  end if;
end;
```

Notes:

- `on conflict (org_id, user_id) do nothing` — if the inviter is already a member
  of the invitee's org (any role), leave their existing row untouched (never
  demote an owner/admin/member to guest).
- `v_home_org is null` → invitee owns no org → skip (Non-Goal, §3).
- Same-org self-invite guard (`v_invited_by <> v_uid`) is defensive.

### 5b. `redeem_invitations` — login-callback batch

`redeem_invitations` (`20260619200000_org_admin_platform_console.sql:260-282`,
wrapped by `src/lib/auth/redeem.ts:6-12`) batch-accepts **all** pending invites
for the user's email and inserts memberships (lines 274-278). It must apply the
**same** reciprocal insert for **each** redeemed invite's `invited_by` into the
redeemer's owned org.

Subtlety: `redeem_invitations` runs in the auth callback _before_
`provision_account`, and `provision_account` short-circuits if the user already
has any membership (`20260619184702...:24-32`). So a brand-new invite-only user,
at redeem time, **owns no org yet** → their `role='owner'` lookup returns null →
reciprocal insert is correctly skipped for that user. (They have no boards to
share regardless.) The reciprocal insert only fires for redeemers who already own
an org. This is consistent with §3's zero-owned-org Non-Goal and needs no special
casing beyond the `v_home_org is null` skip.

### 5c. New migration

One migration minted **only** via `scripts/new-migration.sh cross-org-reciprocal-membership`
(never hand-stamped — per AGENTS.md). It `create or replace`s both RPCs with the
reciprocal logic. Applied to DEV via the `supabase-dev` MCP with the **same
version + name**; ledger verified with `list_migrations`. No schema/table/column
change, no type regeneration needed (no new tables/columns) — but run
`pnpm db:types` and confirm a no-op diff to be safe.

### 5d. UI copy (consent / non-surprise)

Accepting an invite now grants the inviter into your org, so it must not be
silent. Add one line to the invite-accept surface
(`src/components/notifications/InvitationsSection.tsx` and/or the accept confirm)
— e.g. _"Accepting also lets **{inviter}** collaborate on boards you share from
your own workspace."_ Exact wording finalized with `pulse-ui` at build time. No
other UI change — the existing `ShareBoardDialog` and member roster already handle
the new member row correctly.

## 6. Security analysis (this touches multi-tenancy — must be explicit)

- **The RLS boundary is unchanged.** No board/satellite policy, and neither RLS
  helper, is edited. Cross-org _read_ access still requires a real `board_members`
  grant **and** membership in the board's org — both of which now legitimately
  exist because the person is a genuine member.
- **The reciprocal insert is a real, auditable membership**, not a special-case
  bypass. It's created only inside SECURITY DEFINER RPCs (client code can't insert
  `org_members` directly — that policy was dropped in
  `20260704110500_drop_org_members_direct_insert_policy.sql`), triggered only by a
  consensual accept of an invite the inviter themselves issued.
- **No privilege escalation vs. status quo:** the reciprocal member is a `guest`,
  which is ≤ `member`, and the invite the inviter sent already proves intent to
  collaborate. The inviter gains exactly what any invited member already gets in
  the org they join — nothing more.
- **Blast radius of a bug** is contained to "an unintended `guest` row in an org,"
  which still only exposes boards that are _explicitly_ shared (per-board model
  holds). It cannot expose an org's boards wholesale.
- **Residual risk (accepted, v1):** no auto-teardown means an ex-collaborator can
  linger as a `guest` after being removed from the reciprocal direction. Because
  `guest` is unrestricted today, that lingering guest retains member-level
  capability in the org until manually removed. Documented in §7; the owner
  accepted this for v1.

## 7. Edge cases & documented v1 limitations

| Case                                              | v1 behavior                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitee owns **no** org (invite-only user)        | Reciprocal insert skipped (`v_home_org is null`). No error. They have no boards to share anyway.                                                         |
| Inviter already a member of invitee's org         | `on conflict do nothing` — existing (possibly higher) role preserved; never demoted to guest.                                                            |
| Invitee later founds an org (after being invited) | Not retroactively reciprocated. They'd re-invite the collaborator, or a future enhancement backfills on org creation. **Documented limitation.**         |
| Teardown — inviter removes invitee from the org   | Reciprocal membership **not** auto-removed in v1. **Documented limitation** (mild security smell, §6). Follow-up: symmetric teardown in `remove_member`. |
| Self-invite / inviter == invitee                  | Guarded (`v_invited_by <> v_uid`).                                                                                                                       |
| Reciprocal member deactivated                     | Existing deactivation semantics apply unchanged (the `is_org_member` gate already respects `deactivated_at`).                                            |

These limitations are listed so review is informed; each is a deliberate scope
cut, not an oversight.

## 8. Performance & data-fetching budget (working agreement #5)

Negligible. The change adds, inside two already-invoked SECURITY DEFINER RPCs, one
indexed lookup (`org_members` by `user_id`, PK/`user_id` index exists —
`20260614174043...`) and one guarded `insert … on conflict`, only on the
**invite-accept** path (a rare, non-hot-path event). **Zero** new work on any
first-paint or in-page interaction; no board-list/read query shape changes. No new
`select *`; the reciprocal lookup is a single-row `where user_id = … and role =
'owner'`.

## 9. Approaches considered

- **Approach 1 — Reciprocal membership on accept (CHOSEN).** Smallest; leaves the
  RLS boundary untouched; reuses the entire existing sharing surface. Cost: the
  reciprocal member is a full-capability `guest` (accepted), and teardown/zero-org
  are deferred.
- **Approach 2 — Relax the gate to "co-members anywhere."** Change `share_board`
  and the RLS helpers so any two people who share _some_ org can share boards.
  More flexible but edits the security boundary at 3-4 layers and weakens the
  `is_org_member(board.org_id)` invariant that deactivation-driven access
  revocation relies on. Higher risk; rejected for a "quick fix."
- **Approach 3 — Org-to-org "connection" link.** A first-class relationship
  between orgs. Most future-proof, most infrastructure; overkill here. Rejected.

## 10. Testing strategy (full detail in the plan)

- **DB / RPC (integration, on DEV in a rolled-back txn — pattern per
  `tests-write-to-remote-db` memory; suites skip unless `PULSE_TEST_DB` set):**
  - `accept_invitation`: after Bob accepts Alice's invite, Alice is a `guest` in
    Bob's owned org; Bob is a `member` of Alice's org (unchanged).
  - Reverse-share works end-to-end: Bob `share_board`s a Bob-org board to Alice;
    Alice's `can_read_board` returns true; a non-member third party's does not.
  - `on conflict do nothing`: pre-existing higher role for the inviter is
    preserved (owner/admin not demoted to guest).
  - Zero-owned-org invitee: no reciprocal row, no error.
  - `redeem_invitations`: batch path applies the same reciprocity for a redeemer
    who already owns an org; skips for a brand-new invite-only redeemer.
  - Self-invite guard.
- **Isolation invariant (regression):** a `board_members` grant to someone NOT a
  member of the board's org is still inert (proves we didn't weaken RLS).
- **Copy/UI:** invite-accept surface shows the reciprocity notice.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.
- **Manual E2E (walkthrough in the plan):** two real users on DEV, each owning an
  org; A invites B; B accepts; B shares a B-org board with A; A sees it; A shares
  an A-org board with B; B sees it — both directions, no second invite.

## 11. Execution / parallelization (working agreement #6)

Small and mostly sequential — the two RPCs live in one migration and are the
critical path. Rough DAG:

- **T1 (critical):** write the migration (`accept_invitation` + `redeem_invitations`
  reciprocal logic), apply to DEV, verify ledger, `pnpm db:types` no-op check.
- **T2 (depends on T1):** DB/RPC integration tests on DEV.
- **T3 (parallel with T1/T2):** invite-accept UI copy line (`pulse-ui`) — no code
  dependency on the migration; can be built and tested concurrently.
- **T4 (depends on T1-T3):** full-gate run + manual E2E + wrapup.

Critical path: T1 → T2 → T4. T3 runs alongside. Given the size, a single worktree
(`scripts/start-task.sh cross-org-reciprocal-membership`) executed largely
sequentially is appropriate; T3 can be a parallel subagent if desired.
