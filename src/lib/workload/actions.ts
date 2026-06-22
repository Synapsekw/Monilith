"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getUserOrgs } from "@/lib/auth/session";
import {
  setWorkloadDefaultsSchema,
  upsertMemberCapacitySchema,
} from "@/lib/validations/workload";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

export async function upsertMemberCapacity(
  input: z.input<typeof upsertMemberCapacitySchema>,
): Promise<ActionResult<null>> {
  const parsed = upsertMemberCapacitySchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS (can_edit_member_capacity) gates this; the unique (org_id,user_id) drives the upsert.
  const { error } = await supabase.from("member_capacity").upsert(
    {
      org_id: orgId,
      user_id: d.userId,
      hours_per_day: d.hoursPerDay,
      working_days: d.workingDays,
      created_by: user.id,
    },
    { onConflict: "org_id,user_id" },
  );
  if (error) return fail(error.message);

  revalidatePath("/workload");
  return { ok: true, data: null };
}

export async function setWorkloadDefaults(
  input: z.input<typeof setWorkloadDefaultsSchema>,
): Promise<ActionResult<null>> {
  const parsed = setWorkloadDefaultsSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const d = parsed.data;

  const orgs = await getUserOrgs();
  const orgId = orgs[0]?.id;
  if (!orgId) return fail("No organization.");

  const supabase = await createClient();
  // RLS (has_org_role owner/admin) gates this write.
  const { error } = await supabase.from("org_workload_settings").upsert(
    {
      org_id: orgId,
      default_hours_per_day: d.defaultHoursPerDay,
      default_per_item_hours: d.defaultPerItemHours,
      default_working_days: d.defaultWorkingDays,
    },
    { onConflict: "org_id" },
  );
  if (error) return fail(error.message);

  revalidatePath("/workload");
  return { ok: true, data: null };
}
