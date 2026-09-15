"use server";

// Task 5 (not yet landed on this branch) owns the full folder Server Action
// surface (createFolder, renameFolder, deleteFolder, moveBoardToFolder,
// attachDashboardToFolder, getFolderWorkload — see the plan's Task 5 section).
// Task 8's CommandCenter shell only needs `getFolderWorkload` to exist as an
// importable/mockable specifier (the People tab that will call it is Task 9's
// scope); this is a placeholder Task 5's implementer should replace with the
// real RLS-backed query, not a second definition.
import { fail, type ActionResult } from "@/lib/actions/result";
import type { WorkloadRow } from "@/lib/folders/types";

export async function getFolderWorkload(_input: {
  folderId: string;
}): Promise<ActionResult<WorkloadRow[]>> {
  return fail("Not implemented yet — Task 5 wires the folder workload query.");
}
