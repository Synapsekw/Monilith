"use server";

import { createClient } from "@/lib/supabase/server";
import {
  createDependencySchema,
  deleteDependencySchema,
} from "@/lib/validations/dependency-actions";
import type { ActionResult } from "@/lib/boards/actions";

function fail(message: string): { ok: false; error: string } {
  return { ok: false, error: message };
}

export async function createDependency(input: {
  predecessorId: string;
  successorId: string;
}): Promise<ActionResult<{ dependencyId: string }>> {
  const parsed = createDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_item_dependency", {
    p_predecessor: parsed.data.predecessorId,
    p_successor: parsed.data.successorId,
  });
  if (error || !data)
    return fail(error?.message ?? "Could not create dependency.");
  return { ok: true, data: { dependencyId: data.id } };
}

export async function deleteDependency(input: {
  dependencyId: string;
}): Promise<ActionResult> {
  const parsed = deleteDependencySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { data: dep, error: readErr } = await supabase
    .from("item_dependencies")
    .select("board_id")
    .eq("id", parsed.data.dependencyId)
    .maybeSingle();
  if (readErr || !dep) return fail("Dependency not found.");
  const { error } = await supabase
    .from("item_dependencies")
    .delete()
    .eq("id", parsed.data.dependencyId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
