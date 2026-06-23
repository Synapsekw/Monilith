import type { ChangelogEntry } from "./types";

/**
 * Frozen, hand-curated history that predates the `Changelog:` trailer
 * convention. New entries come from commit trailers (see `generated.ts`); add
 * here only to backfill something shipped before the convention existed.
 */
export const SEED: ChangelogEntry[] = [
  {
    date: "2026-06-23",
    kind: "new",
    title: "Dashboards",
    description:
      "Turn board data into dashboards — number widgets with gauge displays and charts in every shape (line, area, stacked, grouped, combo, donut, and radial), all built in a single drawer with a live preview.",
  },
  {
    date: "2026-06-23",
    kind: "new",
    title: "My Time",
    description:
      "Log how your time is spent across categories with a quick decimal-hours grid, right from the sidebar.",
  },
  {
    date: "2026-06-23",
    kind: "improved",
    title: "Workload insights",
    description:
      "The workload view now fills the canvas with utilization percentages, capacity bars, and per-day drill-downs into planned-vs-actual variance.",
  },
  {
    date: "2026-06-23",
    kind: "new",
    title: "Progress columns",
    description:
      "Track completion with a new percent column that automatically averages the progress of its subitems.",
  },
  {
    date: "2026-06-23",
    kind: "new",
    title: "Send feedback in-app",
    description:
      "Report a bug or request a feature from the new Feedback button in the header — and get a notification in the bell when we respond.",
  },
  {
    date: "2026-06-23",
    kind: "improved",
    title: "Reorder boards in the sidebar",
    description:
      "Drag your boards into whatever order suits you; the arrangement sticks.",
  },
  {
    date: "2026-06-23",
    kind: "improved",
    title: "Names on kanban cards",
    description:
      "Kanban cards now show assignee names in the people summary, not just avatars.",
  },
  {
    date: "2026-06-23",
    kind: "fixed",
    title: "Clearer column errors",
    description:
      "Adding a column now surfaces a clear message when something goes wrong instead of failing silently.",
  },
  {
    date: "2026-06-23",
    kind: "fixed",
    title: "Steadier dashboard widgets",
    description:
      "Sum and Average widgets can no longer get stuck in a state you can't save.",
  },
  {
    date: "2026-06-22",
    kind: "new",
    title: "Real-time collaboration",
    description:
      "See who else is on a board with live presence avatars, watch teammates' edits as they happen across table, kanban, calendar, and gantt, and get a quick highlight when someone's change lands.",
  },
  {
    date: "2026-06-22",
    kind: "new",
    title: "Move items between groups automatically",
    description:
      "Add a “move to group” step to any automation so items land in the right group the moment your rule fires.",
  },
  {
    date: "2026-06-22",
    kind: "improved",
    title: "Column headers in every group",
    description:
      "Each group now shows its own interactive column header, so you can sort and resize without scrolling back to the top.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    title: "Portfolios",
    description:
      "Roll up boards into an org-wide portfolio grid — track progress, timelines, health, and owners across every board in one place, with manual overrides where you need them.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    title: "Manage workspaces",
    description:
      "Create, rename, and delete workspaces right from the sidebar to organize your boards however you work.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    title: "Connect boards",
    description:
      "Link items across boards with a new relation column — pick related rows from another board and jump straight to them.",
  },
  {
    date: "2026-06-21",
    kind: "new",
    title: "Personal time zone",
    description:
      "Set your own time zone in Settings and see every date and time across Monolith in it.",
  },
  {
    date: "2026-06-21",
    kind: "improved",
    title: "Item update details",
    description:
      "Each item update now shows who made the change and exactly when.",
  },
  {
    date: "2026-06-20",
    kind: "new",
    title: "Time tracking",
    description:
      "Track time on any item with a built-in timer or manual entries, set estimates, and watch totals roll up to the parent.",
  },
  {
    date: "2026-06-20",
    kind: "new",
    title: "Board sharing",
    description:
      "Share individual boards with specific teammates and control who can view or edit — find them under “Shared with me”.",
  },
  {
    date: "2026-06-20",
    kind: "new",
    title: "Accept invites in the app",
    description:
      "Pending organization invites now show up in your notifications, ready to accept or decline without leaving Monolith.",
  },
  {
    date: "2026-06-20",
    kind: "new",
    title: "Inline PDF previews",
    description:
      "Open PDF attachments right in the preview lightbox — no download required.",
  },
  {
    date: "2026-06-20",
    kind: "improved",
    title: "Branded emails",
    description:
      "Invitation and password-reset emails now match Monolith's look.",
  },
  {
    date: "2026-06-19",
    kind: "new",
    title: "Subitems",
    description:
      "Break work down into nested subitems under any row, with rolled-up totals on the parent.",
  },
  {
    date: "2026-06-19",
    kind: "new",
    title: "Board groups",
    description:
      "Organize rows into colored groups — add, rename, recolor, and reorder them however you like.",
  },
  {
    date: "2026-06-19",
    kind: "improved",
    title: "Drag and drop to reorder",
    description:
      "Reorder items, subitems, and groups by dragging — changes save and sync instantly.",
  },
  {
    date: "2026-06-19",
    kind: "new",
    title: "Team management",
    description:
      "Invite teammates and manage members, invitations, and activity from a new admin console in Settings.",
  },
  {
    date: "2026-06-19",
    kind: "new",
    title: "Webhook automations",
    description:
      "Automations can now call external webhooks, so your boards can talk to the tools you already use.",
  },
  {
    date: "2026-06-19",
    kind: "improved",
    title: "Automation run history",
    description:
      "See when each automation ran and what happened, right in the builder.",
  },
  {
    date: "2026-06-19",
    kind: "improved",
    title: "Quicker sign-up",
    description:
      "Name your organization at sign-up and we'll set up your workspace automatically.",
  },
  {
    date: "2026-06-18",
    kind: "new",
    title: "Board automations",
    description:
      "Set up rules that react to changes on your board — a guided builder with ready-made recipes.",
  },
  {
    date: "2026-06-18",
    kind: "improved",
    title: "More automation triggers",
    description:
      "Trigger automations when an item is created, someone is assigned, or a date arrives — with optional conditions.",
  },
  {
    date: "2026-06-18",
    kind: "new",
    title: "New landing page",
    description: "A refreshed home page with an animated hero.",
  },
  {
    date: "2026-06-15",
    kind: "new",
    title: "Interactive boards",
    description:
      "Edit cells inline on the table view — changes save and sync live.",
  },
  {
    date: "2026-06-10",
    kind: "improved",
    title: "Faster board loads",
    description: "Large boards open noticeably quicker.",
  },
  {
    date: "2026-06-02",
    kind: "new",
    title: "Command palette",
    description: "Press ⌘K to jump anywhere and run actions without the mouse.",
  },
];
