"use server";

import * as z from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { fail, type ActionResult } from "@/lib/actions/result";
import { markItemDoneCore, setItemDueDateCore } from "./row-actions-core";

const doneSchema = z.object({ itemId: z.uuid() });
const dueSchema = z.object({
  itemId: z.uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date."),
});

// Revalidation rule for the Today row actions: My Work is the page the member
// is looking at and the only server-rendered reader of what just changed, so
// it alone is revalidated. Next.js returns its fresh render in the SAME
// response as the action (one round trip, no navigation, no router.refresh),
// which replaces the optimistic row with the database's answer and updates the
// grouped list below. The board route is deliberately not revalidated: a
// mounted board reads from its client cache and Realtime, and a fresh visit is
// dynamic anyway (see the rule in @/lib/boards/actions/group).

/** Mark a Today row done (Server Action). */
export async function markFocusItemDone(input: {
  itemId: string;
}): Promise<ActionResult<{ optionLabel: string }>> {
  const parsed = doneSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return fail("Sign in to continue.");
  const res = await markItemDoneCore(supabase, parsed.data, user.id);
  if (res.ok) revalidatePath("/my-work");
  return res;
}

/** Change a Today row's due date (Server Action). */
export async function setFocusItemDueDate(input: {
  itemId: string;
  dueDate: string;
}): Promise<ActionResult<{ dueDate: string }>> {
  const parsed = dueSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return fail("Sign in to continue.");
  const res = await setItemDueDateCore(supabase, parsed.data, user.id);
  if (res.ok) revalidatePath("/my-work");
  return res;
}
