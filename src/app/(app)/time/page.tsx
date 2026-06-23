import { requireUser } from "@/lib/auth/session";
import { getTimeCardData, listUserCategories } from "@/lib/time/queries";
import { mondayOf } from "@/lib/time/card";
import { TimeCard } from "@/components/time/TimeCard";

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  // The server owns the clock so SSR/CSR agree (mirrors workload's `today`).
  const todayIso = new Date().toISOString().slice(0, 10);
  const weekStart = sp.week ? mondayOf(sp.week) : mondayOf(todayIso);

  const [data, categories] = await Promise.all([
    getTimeCardData(weekStart),
    listUserCategories(),
  ]);

  return <TimeCard data={data} categories={categories} />;
}
