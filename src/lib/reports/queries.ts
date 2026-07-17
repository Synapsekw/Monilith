import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { reportConfigSchema, type ReportConfig } from "@/lib/reports/config";

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
    config: reportConfigSchema.parse(row.config ?? {}),
    updatedAt: row.updated_at,
  };
}

export const getReport = cache(
  async (reportId: string): Promise<ReportRow | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("reports")
      .select("id, org_id, board_id, name, config, updated_at")
      .eq("id", reportId)
      .maybeSingle();
    return data ? rowToReport(data) : null;
  },
);

export async function listReports(boardId: string): Promise<ReportRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, org_id, board_id, name, config, updated_at")
    .eq("board_id", boardId)
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data ?? []).map(rowToReport);
}
