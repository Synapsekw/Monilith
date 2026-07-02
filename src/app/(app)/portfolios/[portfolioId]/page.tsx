import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPortfolioRows } from "@/lib/portfolios/queries";
import { listReadableBoardsCached } from "@/lib/portfolios/queries-cached";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { PortfolioGrid } from "@/components/portfolios/PortfolioGrid";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  const user = await requireUser();

  // Stage 1: everything keyed on portfolioId / userId, concurrent.
  const [result, addableBoards] = await Promise.all([
    getPortfolioRows(portfolioId),
    listReadableBoardsCached(user.id),
  ]);
  if (!result) notFound();

  // Stage 2: same use-cache key getPortfolioRows just resolved → warm hit,
  // not a second Supabase round-trip (this used to be a duplicate fresh fetch).
  const members = await listOrgMembersCached(result.portfolio.org_id);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <h1 className="text-base font-semibold">{result.portfolio.name}</h1>
      </div>
      <div className="min-h-0 flex-1">
        <PortfolioGrid
          portfolioId={portfolioId}
          rows={result.rows}
          members={members.map((m) => ({
            userId: m.userId,
            fullName: m.fullName,
            avatarUrl: m.avatarUrl,
          }))}
          addableBoards={addableBoards.map((b) => ({ id: b.id, name: b.name }))}
        />
      </div>
    </div>
  );
}
