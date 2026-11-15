# Folder invites: invite a person to a folder and they get every board in it

Date: 2026-11-14
Status: draft, awaiting owner review

## Problem

Access is granted one board at a time. A board is readable by its creator and by anyone with a
`board_members` row, and sharing only works for people who are already in the organization
(`share_board` raises "target is not a member of this org"). A folder such as DAAS holds 11 boards,
so bringing one person onto the project means 11 share dialogs, and again for every board added
later. There is no way to bring in someone from outside the organization at all, short of a full
org invite that shows them every folder name.

The folder page's "Share" button only copies the URL.

## Decisions taken with the owner

| Question                                  | Decision                                                          |
| ----------------------------------------- | ----------------------------------------------------------------- |
| Who can be invited                        | An existing org member, or anyone by email                        |
| What a folder invite grants               | Viewer or editor, chosen per person, on every board in the folder |
| What an outside invitee sees of the org   | Only the folders they were invited to                             |
| Who can invite, change a level, or remove | The folder's creator, and org owners and admins                   |

## Goals

1. One action gives a person access to every board in a folder, including boards added later.
2. A person outside the organization can be invited by email and sees only what they were given.
3. No existing user loses or gains access because of the migration itself.
4. Every surface agrees on who can read a board: RLS, database functions, the sidebar, the board
   page, reports, and MCP.

## Non-goals

- Private folders for regular members. Members keep seeing every folder name, as today.
- Per-board exceptions inside a folder (hiding one board from one folder member).
- Nested folders, groups or teams as invitees, link-based public sharing, expiry dates.
- Changing signup approval. A new account still waits for a platform admin.
- Dropping the legacy `board_folders` / `board_folder_boards` tables.

## Design

### 1. Data model

```sql
create table public.folder_members (
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  access_level public.board_access not null,          -- 'viewer' | 'editor'
  granted_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (folder_id, user_id),
  foreign key (folder_id, org_id) references public.folders(id, org_id) on delete cascade
);
create index folder_members_user_idx on public.folder_members (user_id, folder_id);

create table public.folder_invitations (
  id           uuid primary key default gen_random_uuid(),
  folder_id    uuid not null,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  email        text not null,
  access_level public.board_access not null,
  invited_by   uuid references auth.users(id) on delete set null,
  status       text not null default 'pending'
               check (status in ('pending','accepted','revoked')),
  created_at   timestamptz not null default now(),
  foreign key (folder_id, org_id) references public.folders(id, org_id) on delete cascade
);
create unique index folder_invitations_pending_idx
  on public.folder_invitations (folder_id, lower(email)) where status = 'pending';
```

A folder grant is one row. It is not copied into `board_members`. Access to a board through a
folder is resolved at read time from `folder_boards`, which already has `primary key (board_id)`,
so the lookup from a board to its folder is a primary-key read. Nothing has to be kept in sync when
a board enters or leaves a folder: the access follows the placement.

RLS, default deny:

- `folder_members` select: anyone who can see the folder (a non-guest org member, or a member of
  that folder), so the header's avatar stack and the read-only dialog work for everyone on the
  folder. The "is a member of this folder" test goes through a `security definer` helper so the
  policy does not query its own table.
- `folder_invitations` select: the folder's creator, and org owners and admins.
- No insert, update or delete policy on either table. All writes go through the RPCs in section 4.

### 2. One access rule

Today the rule "active org member, and creator or `board_members` row" is written out four times in
SQL: `can_read_board`, `can_edit_board`, `readable_board_ids`, and (through `is_board_member`) the
inline select policy on `boards`. 68 policies on 26 tables and 27 database functions call those
helpers.

The four keep their names and signatures, so none of the 68 policies or 27 functions is edited.
Their bodies change to add the folder path:

```sql
-- internal, security definer, stable, search_path = ''
create function public._folder_board_level(p_board_id uuid) returns public.board_access ...
  select fm.access_level
  from public.folder_boards fb
  join public.folder_members fm on fm.folder_id = fb.folder_id
  where fb.board_id = p_board_id and fm.user_id = (select auth.uid());
```

- `can_read_board`: existing rule, or `_folder_board_level(id) is not null`.
- `can_edit_board`: existing rule, or `_folder_board_level(id) = 'editor'`.
- `readable_board_ids`: existing set, union the boards in folders the caller is a member of. Written
  as a set (join from `folder_members` to `folder_boards`), not as a per-row function call, to keep
  the shape the 2026-07-02 set-based RLS work introduced.
- `is_board_member`: true for a direct row or a folder row, so the inline `boards` policy and
  `INSERT ... RETURNING` keep working.

The org-membership requirement stays in every path. A removed org member loses folder access even
if a `folder_members` row is left behind.

The effective level on a board is the higher of the direct grant and the folder grant. Removing
someone from a folder does not remove a direct `board_members` row they also hold.

`EXECUTE` on every new function is revoked from `public` and `anon` and granted to `authenticated`
only where a policy needs it.

**Mono bots.** `_owner_board_level` reads `created_by` and `board_members` to copy an owner's level
onto their bot. It gains the folder path, so a bot follows its owner into folder boards. The
follow-owner trigger currently fires on `board_members`; the plan must confirm how a bot's grant is
materialised and add the matching trigger on `folder_members` and `folder_boards` if grants are
copied rather than resolved.

### 3. Guests see only their folders

An outside invitee joins the organization with the existing `guest` role.

`guest` already has one meaning: when a person redeems an invitation, the inviter is added to the
invitee's home org as a guest (`20260716100326_cross-org-reciprocal-membership.sql`). The rule
below applies to those guests too, which is the intended reading of "guest": they see what they
were given.

- `folders` select policy: an org member whose role is not `guest`, or a member of that folder.
- `folders` insert, update, delete, and `folder_layouts` writes: not for guests.
- `_assert_folder_member` (used by `folder_rollup`, `folder_burn`, `folder_attention`,
  `folder_workload`, `folder_timeline`): a guest must hold a `folder_members` row.
- `listFoldersCached` uses the service client and today returns placements for every board in the
  workspace, including boards the caller cannot read. It is changed to return only folders the
  caller may see and only placements of boards the caller can read. This closes an existing leak of
  board IDs into the page payload.

The plan must list every other surface a guest can reach (member directory, goals, portfolios,
dashboards, reports, workload, search, Ask) and state for each whether it is already gated by board
access or needs a guest check. Anything gated only by org membership is in scope for this work.

### 4. Server operations

RPCs, all `security definer`, all checking the caller is the folder's creator or an org owner or
admin:

- `share_folder(p_folder_id, p_user_id, p_level)`: target must be an active org member. Upserts the
  `folder_members` row.
- `unshare_folder(p_folder_id, p_user_id)`.
- `invite_to_folder(p_folder_id, p_email, p_level)`: inserts the pending `folder_invitations` row
  and, when there is no pending org invitation for that email, an `org_invitations` row with role
  `guest`.
- `revoke_folder_invitation(p_id)`.

A folder member can remove themself (same as the "member leaves" policy on `board_members`).

Server Actions in `src/lib/folders/sharing-actions.ts`, validated with Zod, returning
`ActionResult` from `src/lib/actions/result.ts`, calling the RPCs through
`src/lib/supabase/typed-rpc.ts`:

- `shareFolder`, `unshareFolder`, `revokeFolderInvitation`.
- `inviteToFolder(email, level)`: if the email belongs to an active org member it calls
  `share_folder`. Otherwise it calls `invite_to_folder` and then
  `auth.admin.inviteUserByEmail(email)` with the service client, the same call `inviteMember`
  makes, ignoring "already registered". It writes to `admin_audit_log`.

**Redemption.** `redeem_invitations()` already runs at login, on `/pending-approval` and on
`/onboarding`, after approval. It is extended: for each pending `folder_invitations` row matching
the caller's email, ensure the `org_members` row (role `guest` unless a higher role already
exists), insert `folder_members`, mark the invitation accepted. The `account_not_approved` trigger
on `org_members` keeps an unapproved account out, so a folder invite can never bypass signup
approval. The existing reciprocal step (inviter added to the invitee's home org as guest) runs
unchanged.

**Moving a board into a folder exposes it** to the folder's members. `folder_accepts_board` is
tightened: when the target folder has at least one member, the caller must be the board's creator
or an org owner or admin. A folder with no members keeps today's rule.

### 5. TypeScript copies of the rule

Each of these rebuilds board access by hand and must change in the same PR:

- `src/lib/boards/queries.ts` `getBoardAccessCore` / `deriveBoardAccess`: add the folder level;
  result stays `owner | editor | viewer`.
- `src/lib/boards/queries-cached.ts`: "Shared with me" includes boards reached through a folder.
- `src/lib/portfolios/queries-cached.ts` `listReadableBoardsCached`: its comment already says it
  must mirror the policy.

Cache invalidation: a change to a folder's members, and a board entering or leaving a folder that
has members, invalidates `sharedBoardsTag(userId)` for each affected member and the folders tag.

### 6. UI

Built with the `pulse-ui` and `frontend-design` skills.

- **Folder header** (`HeaderActions.tsx`): the "Share" button becomes "Invite", next to a stack of
  member avatars. Shown to everyone; the dialog is read-only for people who cannot manage.
- **`ShareFolderDialog`**: one input that searches org members and accepts an email address, a
  Viewer / Editor select, and an Invite button. Below it, the list of people with access: name,
  level select, Remove. Pending email invites show "Invited" and, once the account exists but is
  unapproved, "Waiting for approval". "Copy link" moves into the dialog footer.
- **Sidebar folder menu** (`BoardFolderMenu.tsx`): "Share folder…" opens the same dialog.
- **`ShareBoardDialog`**: people who reach the board through its folder are listed read-only as
  "Through folder DAAS · Editor".
- **Move to folder**: when the target folder has members, a confirm states how many people will get
  access to the board.
- A guest's sidebar shows only their folders and the boards shared with them.

Errors are specific: "Only the folder's creator or an admin can invite people",
"That person already has access", "Enter a valid email address".

## Performance and data-fetching budget

- **First paint:** the folder page adds one read of `folder_members` for the avatar stack (indexed
  on `folder_id`, capped at 50 rows, with a count). The dialog's full list and pending invitations
  load when the dialog opens.
- **Interactions:** opening the dialog and searching members make no navigation. Invite, level
  change and remove are Server Actions with targeted tag invalidation; no `router.push`.
- **Hot path:** `can_read_board` gains one primary-key read on `folder_boards` and one on
  `folder_members (folder_id, user_id)`. `readable_board_ids` gains one index scan on
  `folder_members (user_id, folder_id)` joined to `folder_boards`. The plan must capture
  `explain analyze` for the board page's item read and for `folder_rollup` on DAAS before and
  after, on DEV, and stop if either regresses by more than 10%.

## Rollout and safety

The deployment at `www.monolith.works` runs on the DEV database, so this migration reaches live
users when `main` is promoted.

- The migration is additive. With `folder_members` empty, every helper returns what it returns
  today. The guest restriction on `folders` is the only change that can remove something a current
  user sees; the plan must count current `guest` rows and list what each would lose before the
  migration is applied.
- Minted with `scripts/new-migration.sh`, applied through the `supabase-dev` MCP with the same
  version and name, checked with `pnpm db:ledger-check`, types regenerated in the same PR.
- Before applying: run the migration and a scripted access matrix inside a transaction on DEV and
  roll back.

## Independent units

- **U1 schema and access rule:** tables, RLS, `_folder_board_level`, the four helper bodies,
  `_owner_board_level`, guest rule on `folders` and `_assert_folder_member`, types.
- **U2 RPCs and redemption:** `share_folder`, `unshare_folder`, `invite_to_folder`,
  `revoke_folder_invitation`, `redeem_invitations`, `folder_accepts_board`. Depends on U1.
- **U3 TypeScript access copies and caches:** section 5 and `listFoldersCached`. Depends on U1.
- **U4 Server Actions:** depends on U2.
- **U5 dialog and entry points:** `ShareFolderDialog`, header, sidebar menu, move confirm. Depends
  on U4 for wiring; can be built against the action signatures in parallel with U2 and U3.
- **U6 `ShareBoardDialog` folder rows:** depends on U3.

U2 and U3 run together after U1. U5 can start with U2. U4 then U6 close it out.

## Testing

- **RLS integration** (`*.rls.integration.test.ts`, run with `PULSE_TEST_DB`): a folder viewer
  reads items, cells, updates, attachments and activities on every board in the folder and cannot
  write; a folder editor can write; a board added to the folder becomes readable with no further
  grant; a board moved out stops being readable; a removed folder member loses access; a removed
  org member loses access with the row still present; a user in another org gets nothing; a guest
  sees only their folders and cannot call a folder RPC on another folder; non-managers cannot call
  the share RPCs; a pending folder invitation grants nothing; an unapproved account cannot redeem.
- **Unit:** `deriveBoardAccess` with direct, folder and both grants; Zod schemas; the member and
  invitation list mapping.
- **Component:** dialog invite of a member and of an email, level change, remove, read-only mode,
  pending states, the move-to-folder confirm.
- **Conformance:** the existing suite that checks `EXECUTE` grants must pass for the new functions.
- **Live run before merge:** on the DEV-backed preview, invite a second existing account to a
  folder as viewer, confirm every board appears and is read-only, add a board to the folder and
  confirm it appears, switch to editor, remove, and invite a fresh email through to approval.

All four gates pass: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Open points for the plan to verify against code

1. How a Mono bot's board grant is stored (copied rows or resolved), which decides the bot trigger
   work in section 2.
2. The full list of guest-reachable surfaces in section 3.
3. Whether `auth.admin.inviteUserByEmail` sends a second email to an address with a pending org
   invitation, so the dialog can say whether an email went out.
