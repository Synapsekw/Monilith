# Keystone secondary-surface polish

**Date:** 2026-07-10
**Status:** Approved (design) — pending spec review
**Related:** `docs/superpowers/specs/2026-07-09-keystone-reskin-design.md` (core reskin — the design language this pass applies); memory `dark-first-monday-reskin`; `vault/sessions/2026-07-10-0907-keystone-reskin-build-and-polish.md`, `vault/sessions/2026-07-10-1011-keystone-promote-changelog.md`

## 1. Goal

The core Keystone reskin (sidebar, board table, item panel, board header) shipped to prod (PR#55).
Every **other** app surface already consumes the Keystone tokens — so the palette shifted
automatically — but none of them received the **bespoke Keystone layer** (`<Kicker>` eyebrows,
translucent `soft` pills, elevation-step surfaces with brightening hairlines, `card-lift` motion,
periwinkle-on-states). This pass gives that bespoke treatment to the full remaining app surface set,
at the **same depth** the core surfaces got.

This is **not** a cleanup pass: recon confirmed there are essentially **no hardcoded grays or
off-token hex** in the source (the only hex hits are `.test.tsx` fixtures and legitimate chart
color-data). It is purely **adding the missing bespoke layer**.

### Scope (in)

Fourteen surfaces + core touch-ups:

- **Board views:** Calendar, Gantt/Timeline, Kanban
- **Dashboards:** canvas, widgets, dashboards-nav
- **Admin & entry:** Settings, Auth, Onboarding
- **Planning:** Goals, Portfolios, Workload
- **Personal & chrome:** My Work, Time, Notifications inbox, Command palette
- **Core touch-ups** (on already-shipped surfaces): sidebar keystone wordmark mark, item-panel
  meta-chips + tab counts, `@mention` accent-highlighting, sidebar easing-utility consistency

### Scope (out — explicit non-goals)

- **Landing / `/landing`** — its own separate track (public marketing UI, larger redesign; north-star
  "Landing redesign", retire `brand-lab`). Not touched here.
- **No behavior changes.** Pure presentation: no data flow, Server Actions, queries, a11y roles,
  keyboard nav, DnD, or realtime wiring altered. Existing test intent preserved.
- **No palette/token changes.** The Keystone tokens (both themes) are fixed by the core reskin spec;
  this pass consumes them.

## 2. Design language (inherited, not redefined)

The full design language is defined in `2026-07-09-keystone-reskin-design.md` §2–§5 and is **fixed**.
This pass applies it. Canonical primitives (verified present by recon):

- **`<Kicker>`** — `src/components/ui/kicker.tsx`. Mono, `text-[11px]`, `tracking-[0.12em]`,
  `text-kicker` color, optional accent index prefix.
- **`<StatusPill>` / `statusToneClasses`** — `src/components/ui/status-pill.tsx`. Sanctioned geometry
  `rounded-sm px-2.5 py-0.5 text-xs font-medium`; `solid` and `soft` (15% tint + AA-derived text)
  variants; Keystone-eased transition.
- **`soft-pill-color.ts`** — AA-safe soft (translucent) fill+text for **arbitrary hex** option colors.
- **Tokens & utilities** in `src/app/globals.css`: `--kicker`, translucent `--border` /
  `--border-hover` / `--border-bright`, `--surface` / `--surface-muted` / `--surface-sunken`,
  `--shadow-card` / `--shadow-panel` / `--glow-primary`, `--ease-keystone`, and the `.card-lift`
  hover-lift utility.

## 3. Shared foundation (Wave 0 — lands first, own worktree → `develop`)

Because clusters ship in separate worktrees, shared primitives land first so they are not duplicated
or block each other. This wave is **thin and touches no surface files** (keeps it cleanly rebasable
under every cluster branch).

### 3.1 `<MetaChip>` — `src/components/ui/meta-chip.tsx` (new)

The mono `LABEL value` meta chip (`DUE Jul 14`, `STATUS Working`, `OWNER Synapse`). Label in
`--kicker` mono uppercase, value in `--foreground`. Needed for the item-panel touch-up and reusable
in My Work cards, calendar agenda, kanban cards (≥3 consumers → earns a primitive).

- Props: `label: string`, `children` (value), `tone?` (optional accent for the value), `className`.
- Renders an inline `<span>`; no interaction.
- Unit-tested: renders label uppercased + mono class, renders value, applies tone.

### 3.2 `<ColorChip>` — `src/components/ui/color-chip.tsx` (new)

Thin wrapper routing an **arbitrary hex** through `soft-pill-color.ts` to the AA-safe soft
(translucent) fill+text treatment, at the sanctioned `rounded-sm` chip geometry. Replaces the inline
solid `style={{ backgroundColor }}` chips in calendar `EventBar`, kanban labels, and gantt bars.

- Props: `color: string` (hex), `children`, `size?` (`sm` default), `className`.
- Delegates color math to the existing `soft-pill-color.ts` (no new contrast logic).
- Unit-tested: computes soft fill/text from a sample hex, applies `rounded-sm`.

### 3.3 Token audit (no new tokens)

Confirm `--radius-sm` (~8px chip radius), `--shadow-card` / `--shadow-panel`, and
`--border-hover` / `--border-bright` are all exported via `@theme inline` and usable as utilities
(`rounded-sm`, `shadow-card`, `border-border-hover`). Add any **missing export only** — no new
palette or values. Grep the target surfaces for `rounded-[`, `rounded-full` on chips, and
`shadow-sm`/`shadow-md` to build each cluster's fix-list.

## 4. Per-surface treatment

### 4.1 The four cross-cutting moves (every surface)

1. **Labels → `<Kicker>`.** Replace hand-rolled `uppercase tracking-wide font-semibold text-[10/11px]`
   (sans) section/eyebrow labels with `<Kicker>` (mono, `text-kicker`).
2. **Chips → primitives.** Route every status/label/event chip through `<StatusPill>` /
   `<ColorChip>` / `statusToneClasses`. Kills inline solid `backgroundColor` and `rounded-full`;
   introduces the `soft` translucent variant.
3. **Interactive cards → `card-lift` + brightening hairlines.** Apply `.card-lift` (or the
   `--ease-keystone` transform pattern) + `border-hover` / `border-bright` on hover/focus to draggable
   / clickable cards.
4. **Radius & shadow consistency.** Chips → `rounded-sm`; cards/panels → 14px; swap generic
   `shadow-sm`/`shadow-md` for `shadow-card` / `shadow-panel`.

### 4.2 Per-surface specifics (from recon)

- **Calendar** (`CalendarBoard.tsx` + `calendar/`): Kickers at `CalendarMonth.tsx:59`,
  `CalendarWeek.tsx:57`, `CalendarAgenda.tsx:78`; `EventBar.tsx` (event chips ~`:112`,`:131–145`) →
  `<ColorChip>` soft treatment (currently inline solid fills); day-cell / event hover states.
- **Gantt** (`GanttBoard.tsx`): Kickers at `:611`,`:967`; task bars `:1050` → soft status treatment +
  `shadow-card` (currently generic `rounded-md shadow-sm`); `border-hover` on sticky header hairlines.
- **Kanban** (`KanbanBoard.tsx`): label pill `:427` → `<ColorChip>`; count chip `:443`
  `rounded-full` → `rounded-sm` chip; column headers → `<Kicker>`; `card-lift` on cards
  (replace ad-hoc `transition`).
- **Dashboards** (`DashboardCanvas.tsx`, `DashboardWidget.tsx`, `WidgetConfigSheet.tsx`,
  `DashboardsNav.tsx`, `widgets/*`): already has a brand-wash on `DashboardWidget.tsx:55`. Needs:
  widget header `border-hover` (`:56`), `rounded-xl` → align to 14px card radius, widget titles
  (`NumberWidget.tsx:74`, `WidgetConfigSheet.tsx:143`) → `<Kicker>`, `card-lift` on draggable widgets,
  `DashboardsNav.tsx:139` avatar tiles. **Preserve** all chart color-data (`chart-*`) — that is data,
  not chrome.
- **Settings** (`members-table.tsx`, `invite-panel.tsx`, `profile-form.tsx`, `activity-feed.tsx`,
  `org-admin-console.tsx`, `AiProviderForm.tsx`, `DigestPreferenceForm.tsx`, timezone forms): pill
  geometry at `members-table.tsx:125` → `<StatusPill>`; section labels → `<Kicker>`; inputs/buttons
  `border-hover`/focus treatment; table `divide-border` rows get the reskin surface treatment.
- **Auth** (`auth/auth-form.tsx`, `change-password-form.tsx`, `forgot-password-form.tsx`; routes
  `src/app/auth/*` — note: NOT `(auth)`): **roughest** — stock shadcn `<Card>` defaults. Bespoke pass:
  brand-washed card (like `DashboardWidget`) + `<Kicker>` eyebrow + `shadow-panel` elevation +
  inverted primary CTA with `--glow-primary`.
- **Onboarding** (`src/components/onboarding/`): Kickers on step labels, panel elevation, primary CTA
  glow, `card-lift` on selectable cards.
- **Planning — Goals / Portfolios / Workload** (`src/components/goals/`, `portfolios/`, `workload/`):
  Kickers on section heads; status/progress chips → primitives; cards → `card-lift`; workload
  capacity bars adopt the accent progress treatment.
- **Personal & chrome — My Work / Time / Notifications / Command palette**
  (`src/components/my-work/`, `time/`, `notifications/`, `command-palette.tsx`): My Work cards →
  `<MetaChip>` + `card-lift`; Time card mono numerics + Kickers; Notifications inbox rows →
  translucent hover + accent unread marker; Command palette groups → `<Kicker>` section labels,
  accent active-row wash.

### 4.3 Core touch-ups (Wave 6 — on already-shipped surfaces)

- **Sidebar keystone wordmark mark** — the angled-slab clip-path ink-on-paper mark (reskin spec §6.1,
  deferred).
- **Item-panel meta-chips + tab counts** — mono meta chips via `<MetaChip>` (`STATUS Working`,
  `DUE Jul 14`), accent count on tabs (`Updates 02`).
- **`@mention` accent-highlighting** — mentions/tags render in the periwinkle accent in updates/comments.
- **Sidebar easing-utility consistency** — sidebar transitions use `--ease-keystone` like the rest.

## 5. Execution — clusters, DAG, shipping (working agreement #6)

**Approach B — cluster worktrees, ship incrementally.** Each cluster is its own worktree
(`scripts/start-task.sh`) → gates → `finish-task.sh` → `develop`, visually verified (and optionally
promoted) before the next. Within a cluster, surfaces build as **parallel subagents** (disjoint files,
one nested worktree) per `superpowers:dispatching-parallel-agents`.

### 5.1 Waves

| Wave | Cluster               | Surfaces / work                                                                     | Depends on |
| ---- | --------------------- | ----------------------------------------------------------------------------------- | ---------- |
| 0    | **Foundation**        | `<MetaChip>`, `<ColorChip>`, token audit                                            | —          |
| 1    | **Board views**       | Calendar · Gantt · Kanban                                                           | 0          |
| 2    | **Dashboards**        | canvas · widgets · dashboards-nav                                                   | 0          |
| 3    | **Admin & entry**     | Settings · Auth · Onboarding                                                        | 0          |
| 4    | **Planning**          | Goals · Portfolios · Workload                                                       | 0          |
| 5    | **Personal & chrome** | My Work · Time · Notifications · Command palette                                    | 0          |
| 6    | **Core touch-ups**    | sidebar wordmark · item-panel meta-chips + tab counts · `@mention` · sidebar easing | 0          |

### 5.2 DAG

- **Graph:** `0 → {1, 2, 3, 4, 5, 6}`. Waves 1–6 have **no interdependencies** (disjoint file sets,
  no shared state) — they consume only Wave 0's primitives.
- **Order:** shipped as a verified sequence (roughness × traffic): 1 → 2 → 3 → 4 → 5 → 6. Because
  1–6 are mutually independent, up to **2 worktrees may be in flight** to compress wall-clock without
  breaking the verify-before-ship discipline (each still merges + smoke-checks independently).
- **Critical path:** `Wave 0 + one cluster` is the theoretical floor; the practical floor is the
  chosen shipping sequence.

## 6. Testing strategy (from reskin spec §9)

- **Unit/RTL:** new `meta-chip.test.tsx`, `color-chip.test.tsx`; update any surface test whose
  asserted class contract changes. Assert **semantic token classes / behavior / roles**
  (`bg-surface`, `text-kicker`, `rounded-sm`), never raw hex — avoids brittle snapshots.
- **Per-cluster visual smoke-check:** drive the running app (browser) across that cluster's surfaces
  in **both** dark and light, confirming the Keystone look and no layout breakage before `finish-task`.
- **Gates:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green before every
  `finish-task.sh`.

## 7. Performance & data budget (working agreement #5)

Identical to reskin spec §8 — pure presentation:

- **First paint vs interaction:** unchanged. **0 new server round-trips** on any interaction; no
  view/tab/filter/sort behavior added or changed; in-page toggles stay client-state + History API.
- **Server data:** no interaction here changes server data — no Server Actions, queries,
  revalidation, or RSC navigation added or altered.
- **Hot-path reads:** unchanged — no new/removed queries; bounded/indexed reads stay as-is.
- **Asset cost:** no new fonts/tokens; two tiny shared components. Negligible bundle delta.

## 8. Risks & mitigations

- **Blast radius across many surfaces** → mitigated by B (one cluster per PR, verified before next);
  primitives land isolated in Wave 0.
- **Chart color-data mistaken for chrome** (Dashboards) → explicitly preserve `chart-*` color data;
  only chrome (headers, radius, chips, card-lift) is touched.
- **Core touch-ups edit already-promoted surfaces** → Wave 6 last, isolated, extra smoke-check; assert
  behavior not hex so existing tests stay green.
- **`<ColorChip>` AA regressions on arbitrary hues** → delegate entirely to the existing
  `soft-pill-color.ts` (already AA-derived in Batch A); add a unit test on a sample hue.
- **Radius/shadow inconsistency creep** → Wave 0 token audit produces the per-surface grep fix-list so
  clusters converge on one radius/shadow vocabulary.
