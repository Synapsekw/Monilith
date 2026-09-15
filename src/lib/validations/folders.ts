import { z } from "zod";

// Task 5 (not yet landed on this branch) owns the full folder-actions Zod
// surface (folderIdSchema, createFolderSchema, renameFolderSchema, …) in this
// file. Task 8 only needs the command-tab enum for its client URL state, so
// this file starts with just that export — Task 5's implementer adds the
// rest here rather than creating a second file.
export const commandTabSchema = z.enum([
  "overview",
  "stages",
  "boards",
  "people",
]);
