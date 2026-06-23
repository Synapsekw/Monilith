import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database.types";

const PAGE_SIZE = 50;

export async function listFeedbackPage(opts?: {
  page?: number;
}): Promise<{ rows: Tables<"feedback">[]; hasMore: boolean }> {
  const page = Math.max(0, opts?.page ?? 0);
  const supabase = await createClient();
  const from = page * PAGE_SIZE;
  const { data } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE); // one extra row signals "more"
  const rows = data ?? [];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function countNewFeedback(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  return count ?? 0;
}

export async function getFeedback(
  id: string,
): Promise<Tables<"feedback"> | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("feedback")
    .select("*")
    .eq("id", id)
    .single();
  return data ?? null;
}
