import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { parseReportConfig, type ReportConfig } from "@/lib/reports/config";

export type ReportRow = {
  id: string;
  orgId: string;
  boardId: string;
  name: string;
  config: ReportConfig;
  updatedAt: string;
};

function rowToReport(row: {
  id: string;
  org_id: string;
  board_id: string;
  name: string;
  config: unknown;
  updated_at: string;
}): ReportRow {
  return {
    id: row.id,
    orgId: row.org_id,
    boardId: row.board_id,
    name: row.name,
    config: parseReportConfig(row.config),
    updatedAt: row.updated_at,
  };
}

/** Hot-path cap (AGENTS.md: bounded reads). Was an inline 100 in listReports. */
export const REPORTS_LIMIT = 100;

const REPORT_COLUMNS = "id, org_id, board_id, name, config, updated_at";

/** Client-injected core. */
export async function getReportCore(
  supabase: SupabaseClient<Database>,
  reportId: string,
): Promise<ReportRow | null> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("id", reportId)
    .maybeSingle();
  return data ? rowToReport(data) : null;
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export const getReport = cache(
  async (reportId: string): Promise<ReportRow | null> => {
    const supabase = await createClient();
    return getReportCore(supabase, reportId);
  },
);

/** Client-injected core. */
export async function listReportsCore(
  supabase: SupabaseClient<Database>,
  boardId: string,
  limit: number = REPORTS_LIMIT,
): Promise<ReportRow[]> {
  const { data } = await supabase
    .from("reports")
    .select(REPORT_COLUMNS)
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToReport);
}

/** Cookie-bound wrapper — the RSC entry point. Signature unchanged. */
export async function listReports(boardId: string): Promise<ReportRow[]> {
  const supabase = await createClient();
  return listReportsCore(supabase, boardId);
}
