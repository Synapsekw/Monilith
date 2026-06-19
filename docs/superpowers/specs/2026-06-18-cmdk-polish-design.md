# ⌘K command-palette polish — design spec

**Date:** 2026-06-18
**Phase:** 8 (Dashboards + templates + ⌘K polish) — ⌘K slice (final Phase-8 piece)
**Status:** approved, ready for plan
**Related:** board-templates spec `2026-06-18-board-templates-design.md` (the picker this reuses);
master spec `2026-06-14-pulse-design.md` §7 (phase 8)

## 1. Goal & scope

Turn the existing ⌘K stub (`src/components/command-palette.tsx`) — where Navigation and Create are
disabled `soon` placeholders and only Theme works — into a working command palette for **fast
navigation and creation**.

**In scope:**

- **Navigate** to any board or dashboard (and the Dashboards home), keyboard-driven, fuzzy-filtered.
- **Create**: New board (reusing the template picker) and New dashboard (reusing the existing name
  dialog), triggered from the palette.
- Theme switching stays as-is.

**Explicitly out of scope (deferred):**

- **Global content search** across item names / cell values (would need a bounded, indexed,
  org-scoped search RPC + ranking). Not now — navigation is filtering over already-loaded lists only.
- AI assist / command history / recents.

## 2. Current state & the core problem

`<CommandPalette>` is mounted in the **root `Providers`** (`src/components/providers.tsx`), which
wraps the entire app including `(auth)`/login/landing. It therefore (a) has **no access** to the
`boards`/`dashboards`/`workspaces` lists that `AppShell` loads server-side, and (b) mounts even where
⌘K is meaningless. The fix is to move it into `AppShell`, which already has that data.

## 3. Architecture & data flow

```
AppShell (server component, authed layouts only)
  loads boards / dashboards / workspaces  ──props──▶  <CommandPalette boards dashboards workspaces />
                                                          │  (client; ⌘K key handler lives here)
                                                          ├─ Navigate group: item per board/dashboard
                                                          │     select → router.push('/boards/:id' | '/dashboards/:id')
                                                          ├─ Create group:
                                                          │     "New board"     → setNewBoardOpen(true)
                                                          │     "New dashboard" → setNewDashboardOpen(true)
                                                          └─ Theme group (unchanged)

useUIStore  (ephemeral flags)  newBoardOpen / newDashboardOpen
   ▲ set by palette                       │ read by the controlled dialogs
   └───────────────────────────────────────┘
NewBoardDialog (sidebar + store-controlled)   DashboardsNav create-dialog (sidebar + store-controlled)
```

- **Filtering** is cmdk's built-in fuzzy match over the rendered `CommandItem`s — pure client, **0
  server round-trips**.
- **Mount move:** remove `<CommandPalette>` from `Providers`; render it in `AppShell` with props. The
  ⌘K `keydown` listener moves into the palette as mounted there, so the shortcut binds only in the
  authed app.

## 4. Components & changes

### 4.1 `CommandPalette` (`src/components/command-palette.tsx`)

- New props: `boards: BoardListEntry[]`, `dashboards: AppShellDashboard[]`, `workspaces:
AppShellWorkspace[]` (types already exported by `queries.ts` / `app-shell.tsx`).
- Keep `open`/`toggle` from `useUIStore` + the ⌘K key handler.
- **Navigation group:** a top-level "Dashboards" item (→ `/dashboards`), then one item per board
  (icon + name → `/boards/:id`) and one per dashboard (→ `/dashboards/:id`). Use `useRouter().push`.
  Each item's `onSelect` closes the palette then navigates.
- **Create group:** "New board" → `setNewBoardOpen(true)` + close; "New dashboard" →
  `setNewDashboardOpen(true)` + close. Disabled (or hidden) when there is no workspace to create in.
- **Theme group:** unchanged.
- Remove the `disabled … soon` placeholders.

### 4.2 `useUIStore` (`src/stores/ui.ts`)

Add ephemeral (not persisted) flags + setters:

```ts
newBoardOpen: boolean;     setNewBoardOpen: (open: boolean) => void;
newDashboardOpen: boolean; setNewDashboardOpen: (open: boolean) => void;
```

(Mirror the `commandOpen` pattern; leave `partialize` unchanged so they don't persist.)

### 4.3 `NewBoardDialog` (`src/components/boards/NewBoardDialog.tsx`)

Make it **controllable**: the dialog's open state becomes `storeOpen || localOpen`, and `onOpenChange`
clears both (`setNewBoardOpen(false)` + local). Keep the `+` `DialogTrigger` for the sidebar. This way
the sidebar `+` and the palette both drive one dialog. No change to the picker/create logic.

### 4.4 DashboardsNav create-dialog (`src/components/dashboards/DashboardsNav.tsx`)

Same controllable treatment for its existing "New dashboard" name dialog (open = `storeOpen ||
localOpen`). Keep the `+` trigger.

### 4.5 `AppShell` (`src/components/app-shell.tsx`) + `Providers` (`src/components/providers.tsx`)

- `Providers`: remove `<CommandPalette/>`.
- `AppShell`: render `<CommandPalette boards={boards ?? []} dashboards={dashboards ?? []}
workspaces={workspaces ?? []} />` (alongside the existing `<CommandTrigger/>` in the header). The
  trigger button stays where it is.

## 5. Error handling & edge cases

- **No workspace** (shouldn't happen in authed app, but guard): Create items disabled.
- **Empty boards/dashboards:** Navigation group still renders the "Dashboards" home + Create items;
  no per-item rows. cmdk shows `CommandEmpty` only when a query matches nothing.
- **Navigation is RSC nav** (board/dashboard pages are server routes) — `router.push` is correct here
  (not an in-page toggle), so a refetch of the destination route is expected and desired.

## 6. Testing

- **Component (`command-palette.test.tsx`, extend existing):**
  - renders a Navigation item per board + per dashboard from props;
  - selecting a board item calls `router.push('/boards/<id>')` and closes;
  - "New board" calls `setNewBoardOpen(true)`; "New dashboard" calls `setNewDashboardOpen(true)`;
  - theme items still work.
- **Component (`NewBoardDialog.test.tsx`, extend):** dialog opens when `newBoardOpen` store flag is
  true (controlled path), independent of the `+` trigger.
- **e2e (`e2e/command-palette.spec.ts`, new):** open ⌘K (or click the trigger), type a known board
  name, press Enter, assert URL becomes `/boards/<id>` and the board renders.
- Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Data-fetching budget:** the navigation list and its filtering are entirely client-side over
already-loaded server data — **0 new round-trips** on open/type. Create reuses existing dialogs +
Server Actions. Only the final navigate (RSC nav to a board/dashboard) or create (mutation) touches
the server, which is the intended behavior.

## 7. Risks & notes

- **Controlled-dialog refactor** touches two sidebar components (`NewBoardDialog`,
  `DashboardsNav`). Keep changes minimal — add controlled open state, don't rework the dialogs.
- **Mount move** changes where the ⌘K listener lives; confirm the shortcut still fires app-wide
  within the authed shell and no longer on login/landing. Update `app-shell.test.tsx` /
  `command-palette.test.tsx` as needed (the palette test currently renders the component directly,
  so it keeps working; it just gains props).
- Boards list type is `BoardListEntry` (from `queries.ts`); dashboards is `AppShellDashboard` (from
  `app-shell.tsx`). Reuse these — do not invent new shapes.
