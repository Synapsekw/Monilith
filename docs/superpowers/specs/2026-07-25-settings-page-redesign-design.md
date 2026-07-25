# Settings page redesign + MCP connection guide

**Date:** 2026-07-25
**Status:** Approved (design), pending implementation

## Problem

`/settings` is a single route that renders eight unequal cards into a 1→2→3→4 column
CSS masonry, with the Members console as a full-width slab underneath. Three concrete
failures:

1. **No alignment.** Multi-column masonry packs cards by height, so no two controls
   share a left or right edge and every column ends ragged. Nothing reads as a grid.
2. **Box-per-setting.** A one-field timezone form gets the same card chrome as the
   whole notification matrix. Two adjacent cards are both titled about AI
   ("AI — Organization" and "AI"), and when the org manages AI centrally the personal
   card degrades to a sentence in a box that looks broken.
3. **No MCP instructions.** Pulse ships a hosted MCP server and an OAuth 2.1
   authorization server, and the entire in-app surface for it is one card reading
   "No apps connected via MCP yet." with a bare Revoke link. A user cannot discover
   the server URL, cannot learn how to point a client at it, and cannot see what a
   connected client is allowed to do.

Secondary: the route fetches everything for every visit — profile, timezone, personal
AI credential, org AI settings, notification prefs, MCP connections, org, workspaces,
the `get_org_members` RPC, pending/declined invites, and a 50-row audit slice — even
though most visits touch one section.

## Solution

A left sub-nav with a single focused content column, backed by real nested routes.
Cards are replaced by aligned label/control rows. `Connect via MCP` becomes a full
setup guide with its own route.

### Information architecture

`src/app/(app)/settings/layout.tsx` renders the page header and the nav; `/settings`
redirects to `/settings/profile`. Each section is its own route segment.

| Group        | Route                     | Contents                                                 |
| ------------ | ------------------------- | -------------------------------------------------------- |
| Account      | `/settings/profile`       | Avatar, full name, email (read-only)                     |
| Account      | `/settings/preferences`   | Personal time zone, appearance (theme)                   |
| Account      | `/settings/notifications` | In-app notification kinds, email digest                  |
| Account      | `/settings/security`      | Email, change password, sign out everywhere, danger zone |
| Organization | `/settings/organization`  | Org name (rename), org time zone                         |
| Organization | `/settings/workspaces`    | Workspace list, create/rename/delete                     |
| Organization | `/settings/members`       | `OrgAdminConsole` (admin only)                           |
| Integrations | `/settings/ai`            | Org AI policy (admin) + personal provider key            |
| Integrations | `/settings/mcp`           | Connect via MCP guide + connected apps                   |

`Members` is hidden from the nav and returns `notFound()` for non-admins. The AI page
merges today's two AI cards: org policy first for admins, then the personal key,
which renders as a disabled explanatory row (not an empty card) when the org manages
AI centrally.

### Visual system

Inside a section there are no cards. The primitives:

- **`SettingsSection`** — `<h2>` + one-line description + a rule, wrapping rows.
- **`SettingRow`** — label + optional helper text on the left, control right-aligned
  in a fixed-width column (`280px` at `md+`, stacked below), hairline rule between
  rows, no rule after the last.
- Content column capped at `max-w-3xl` so form rows do not stretch across a wide
  monitor.
- Cards survive only for genuinely repeated objects: a connected app, a workspace.
- Tokens and idiom per the `pulse-ui` skill (Monolith Keystone: near-black surfaces,
  single periwinkle accent, mono kickers, radius 14).

### Connect via MCP page

1. **What this is** — one paragraph in plain language.
2. **Your server URL** — `https://<origin>/api/mcp` in a mono field with a copy
   button. Origin is derived server-side from request headers (`headers()` is async
   in Next 16) so dev and prod each render their own URL rather than a hardcoded one.
   This mirrors how `.well-known/oauth-protected-resource` derives its origin.
3. **Add it to your client** — client picker (Claude Desktop · claude.ai · Claude
   Code · Other) with numbered steps per client. Picker state is History-API only
   (`window.history.replaceState`), zero server round-trips.
4. **What Pulse exposes** — table of the six registered tools with read/write badges:
   `list_boards`, `get_board`, `search_items`, `get_item` (read); `create_item`,
   `update_item` (write).
5. **Access & safety** — the client connects as you; every read and write goes
   through RLS scoped to your account; no delete tools exist; sign-in happens on
   Pulse so the client never sees your password; revoke at any time.
6. **Connected apps** — client name, connected date, revoke behind a confirm dialog
   with the error surfaced.
7. **Troubleshooting** — client won't connect, connection dropped, no boards
   returned.

### Fixes and additions

- **Revoke error surfacing.** `revokeConnectionAction` already returns
  `ActionResult`; `ConnectedAppsSection` discards it inside an inline `form action`,
  so a failed revoke is silent. Replace with a client component that awaits the
  result, toasts `error` on failure, and confirms before revoking. (Closes the
  north-star owed item.)
- **Rename organization.** New `updateOrgName` action in `src/lib/org/actions.ts`
  with `updateOrgNameSchema` in `src/lib/validations/org.ts`. The existing
  `organizations: update if owner/admin` RLS policy gates it — **no migration**.
- **Appearance.** Theme (light/dark/system) moves into Preferences via `next-themes`,
  alongside the existing header `ThemeToggle`.
- **Security.** Show email, link to the existing `/change-password` page, and add
  sign-out-everywhere (`supabase.auth.signOut({ scope: "global" })`).
- **Danger zone.** Leave organization, blocked when you are the sole owner with a
  message naming the fix (promote another owner first). Uses the existing
  `org_members: delete self only` policy — **no migration**. Redirects to `/home`.

### Explicitly out of scope

**Delete account.** Investigated and deferred to its own task. 28 columns reference
`auth.users` without `on delete cascade` (~15 of them `not null`) — `boards.created_by`,
`item_updates.author_id`, `goals.owner_id`, `attachments.uploaded_by`,
`organizations.created_by`, and more. Deleting the auth user raises a foreign-key
violation even after a sole-owner check passes. Doing it properly means a migration
converting those FKs to `on delete set null`, dropping `not null` on the authorship
columns, and updating every consumer that assumes non-null authorship. That is a
schema change reaching every tenant table and belongs in its own spec.

## Performance & data-fetching budget

Required by AGENTS.md working agreement #5.

**First paint.** The shared layout resolves `requireUser()`, `resolveActiveOrg()` and
`isOrgAdmin()` (all `cache()`-wrapped). Each section route then fetches only its own
data:

| Route           | Reads                                                     |
| --------------- | --------------------------------------------------------- |
| `profile`       | `profiles` row (name, avatar)                             |
| `preferences`   | `getUserTimeZoneCached`                                   |
| `notifications` | `getDisabledInAppKinds` + `profiles.email_digest_opt_out` |
| `security`      | none beyond the layout                                    |
| `organization`  | none beyond the layout (org carries name + timezone)      |
| `workspaces`    | `listWorkspacesCached`                                    |
| `members`       | `get_org_members` RPC + invites + bounded 50-row audit    |
| `ai`            | `getMyAiCredential` + `getOrgAiSettings`                  |
| `mcp`           | `listMyConnections` + origin from headers                 |

Visiting `/settings/profile` drops from roughly ten queries to one plus the shared
layout reads. The members RPC, invites and audit slice only run when Members is
opened.

**Interactions.** Section switching is a `<Link>` navigation between _different_
data, not an in-page toggle over the same data, so it correctly re-runs one segment
(the shared layout is not re-rendered) and is prefetched on hover. The in-page
toggles that do exist stay History-API only, with zero round-trips: the MCP client
picker and the existing `OrgAdminConsole` tabs.

**Boundedness.** No new unbounded reads. `listMyConnections` is per-user and
naturally small; the audit slice keeps its existing `limit(50)`; the members RPC
stays bounded as today.

## Execution DAG

Required by AGENTS.md working agreement #6.

**Interfaces.** T1 produces `SettingsSection` / `SettingRow` / `SettingsNav` and the
layout; T2 produces `updateOrgName` + `leaveOrg` + schemas; T3 produces `CopyField`.
Everything downstream consumes those.

- **Batch 1** (no unmet dependencies, fully parallel)
  - **T1** — settings layout, nav, `SettingsSection` / `SettingRow` primitives, index redirect.
  - **T2** — `updateOrgName` + `leaveOrg` server actions, Zod schemas, action tests.
  - **T3** — `CopyField` primitive (mono field + copy button; no clipboard helper exists in the repo today).
- **Batch 2** (depends on batch 1)
  - **T4** — Account routes: profile, preferences (incl. appearance), notifications, security (needs T1).
  - **T5** — Organization routes: general (needs T1+T2), workspaces, members.
  - **T6** — AI route, merging the two existing AI cards (needs T1).
  - **T7** — MCP route: guide, client picker, tools table, connected-apps list with revoke fix (needs T1+T3).
- **Batch 3** (depends on batch 2)
  - **T8** — delete the old `page.tsx`, rework `loading.tsx` for the new shell, run all four gates, write the manual-test walkthrough.

**Critical path:** T1 → T7 → T8 (the MCP page is the largest single unit).

## Testing

Every unit ships with written and executed tests (working agreement #4).

- **Component tests (Vitest + RTL):** `SettingRow` / `SettingsSection` rendering and
  layout contract; `SettingsNav` active state per pathname and admin-only Members
  item; `CopyField` writes to the clipboard and shows confirmation; MCP client picker
  switches without navigation; tools table renders all six tools with correct
  read/write badges; connected-apps list revokes, confirms, and **surfaces an error
  toast when the action fails** (the regression this fixes).
- **Action tests:** `updateOrgName` rejects invalid input via Zod, returns `fail` on
  RLS denial, revalidates on success; `leaveOrg` refuses when the caller is the sole
  owner and succeeds otherwise.
- **Route tests:** each section route renders its own section; `/settings` redirects
  to `/settings/profile`; `/settings/members` returns `notFound()` for a non-admin.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Migrations

None. Org rename and leave-org both ride existing RLS policies
(`organizations: update if owner/admin`, `org_members: delete self only`).
