import type { ChangelogEntry } from "./types";

/**
 * Frozen, hand-curated history that predates the `Changelog:` trailer
 * convention. New entries come from commit trailers (see `generated.ts`); add
 * here only to backfill something shipped before the convention existed.
 */
export const SEED: ChangelogEntry[] = [
  {
    date: "2026-06-18",
    kind: "new",
    title: "Board automations",
    description:
      "Set up rules that react to changes on your board — a guided builder with ready-made recipes.",
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
