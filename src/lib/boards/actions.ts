// Board server-actions barrel. The actual `"use server"` action bodies live in
// the domain-clustered modules under ./actions/*. This barrel re-exports them so
// every caller keeps importing from `@/lib/boards/actions` unchanged. Split out
// of a single ~1200-line file to stay under the ESLint max-lines budget.
//
// Internal helpers (`invalidateMyBoards`, `columnBoardId`) stay private to their
// modules and are intentionally NOT re-exported — the public surface here is the
// exact set of actions the original file exported.

export * from "./actions/board";
export * from "./actions/group";
export * from "./actions/item";
export * from "./actions/cell";
export * from "./actions/column";
export { loadBoardTrash } from "./actions/internal";
