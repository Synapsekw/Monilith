import type { ChangelogEntry } from "./types";

/**
 * Frozen, hand-curated history that predates the `Changelog:` trailer
 * convention. New entries come from commit trailers (see `generated.ts`); add
 * here only to backfill something shipped before the convention existed.
 */
export const SEED: ChangelogEntry[] = [
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
