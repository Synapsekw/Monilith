/**
 * Focus handoff across the Boards-nav subtree swap.
 *
 * `BoardsNav` renders a plain tree until the first pointer/focus interaction,
 * then swaps in the lazy drag layer. That swap REMOUNTS the subtree, destroying
 * whatever the user had just tabbed to — so the shell records an anchor before
 * arming and the drag layer restores it on mount.
 *
 * Capture and restore live in the same module deliberately: the two halves run
 * in different bundles (shell vs. lazy chunk) and must agree on the same data
 * attributes. Splitting them is what let folder rows join the swapped region
 * with no anchor of their own, dropping focus to <body>.
 *
 * This module imports nothing from @dnd-kit, so the shell can use it freely.
 */

/** Which row held focus when the drag layer was armed, and where in that row. */
export type BoardsNavFocusAnchor =
  | { kind: "board"; id: string; edge: "link" | "menu" }
  | { kind: "folder"; id: string; edge: "toggle" | "link" | "menu" };

const ROW_ATTR = {
  board: "data-board-row",
  folder: "data-folder-row",
} as const;

/**
 * Read an anchor off the element that just took focus. Board rows and folder
 * headers are disjoint (a folder's boards live in a sibling element, not inside
 * the header), so at most one of the two lookups can match.
 */
export function focusAnchorFrom(target: Element): BoardsNavFocusAnchor | null {
  // Shift+Tab enters the section from below and lands on a row's `⋯` button
  // rather than its link — the case the anchor-only-if-<a> version dropped.
  const onMenuTrigger = target.getAttribute("aria-haspopup") === "menu";

  const boardId = target.closest<HTMLElement>(`[${ROW_ATTR.board}]`)?.dataset
    .boardRow;
  if (boardId) {
    return {
      kind: "board",
      id: boardId,
      edge: onMenuTrigger ? "menu" : "link",
    };
  }

  const folderId = target.closest<HTMLElement>(`[${ROW_ATTR.folder}]`)?.dataset
    .folderRow;
  if (folderId) {
    // A folder header has THREE focusables since the name became a link to the
    // command center: chevron, name, ⋯. Tell the name apart from the chevron,
    // or tabbing to the name would hand focus back to the chevron.
    return {
      kind: "folder",
      id: folderId,
      edge: onMenuTrigger
        ? "menu"
        : target.closest("a[href]")
          ? "link"
          : "toggle",
    };
  }

  return null;
}

/**
 * Find the element in the freshly mounted tree that should take focus back.
 * Each selector resolves to exactly one node per row: a folder header has one
 * `button[aria-expanded]` (the chevron), one `a[href]` (the name, linking to
 * the command center) and one menu trigger, so focus returns precisely where
 * it was rather than to whichever control happens to come first.
 */
export function focusAnchorTarget(
  container: HTMLElement | null,
  anchor: BoardsNavFocusAnchor,
): HTMLElement | null {
  // CSS.escape: ids are interpolated straight into a selector.
  const row = container?.querySelector<HTMLElement>(
    `[${ROW_ATTR[anchor.kind]}="${CSS.escape(anchor.id)}"]`,
  );
  if (!row) return null;

  if (anchor.edge === "menu") {
    return row.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
  }
  if (anchor.kind === "folder" && anchor.edge === "toggle") {
    return row.querySelector<HTMLElement>("button[aria-expanded]");
  }
  return row.querySelector<HTMLElement>("a[href]");
}
