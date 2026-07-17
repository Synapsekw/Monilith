"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { getActiveOrgId } from "@/lib/org/active";
import { type ActionResult, fail } from "@/lib/actions/result";
import { reportConfigSchema, defaultReportConfig } from "@/lib/reports/config";
import { reportBoardAccess, canEditReports } from "@/lib/reports/access";
import { getReport } from "@/lib/reports/queries";

const createSchema = z.object({
  boardId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export async function createReport(input: {
  boardId: string;
  name: string;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  const access = await reportBoardAccess(parsed.data.boardId);
  if (!canEditReports(access))
    return fail("You can't create reports on this board.");

  const user = await requireUser();
  const orgId = await getActiveOrgId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({
      org_id: orgId,
      board_id: parsed.data.boardId,
      name: parsed.data.name,
      config: defaultReportConfig(),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return fail("Could not create the report.");
  return { ok: true, data: { id: data.id } };
}

const saveSchema = z.object({
  reportId: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string().min(1).max(200),
  config: reportConfigSchema,
});

export async function saveReport(input: unknown): Promise<ActionResult<void>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");

  // Bind the mutation to the report's REAL board — never trust the client's
  // boardId. Prevents editing a report on another board within the same org.
  const report = await getReport(parsed.data.reportId);
  if (!report || report.boardId !== parsed.data.boardId)
    return fail("Report not found.");

  const access = await reportBoardAccess(report.boardId);
  if (!canEditReports(access)) return fail("You can't edit this report.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .update({
      name: parsed.data.name,
      config: parsed.data.config,
      updated_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.reportId);
  if (error) return fail("Could not save the report.");
  return { ok: true, data: undefined };
}

export async function deleteReport(input: {
  reportId: string;
  boardId: string;
}): Promise<ActionResult<void>> {
  const parsed = z
    .object({ reportId: z.string().uuid(), boardId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid");

  // Bind the mutation to the report's REAL board — never trust the client's
  // boardId. Prevents deleting a report on another board within the same org.
  const report = await getReport(parsed.data.reportId);
  if (!report || report.boardId !== parsed.data.boardId)
    return fail("Report not found.");

  const access = await reportBoardAccess(report.boardId);
  if (!canEditReports(access)) return fail("You can't delete this report.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("reports")
    .delete()
    .eq("id", parsed.data.reportId);
  if (error) return fail("Could not delete the report.");
  return { ok: true, data: undefined };
}
