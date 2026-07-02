import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getPortfolioRows, listReadableBoards } from "@/lib/portfolios/queries";
import { listOrgMembersCached } from "@/lib/org/queries-cached";
import { PortfolioGrid } from "@/components/portfolios/PortfolioGrid";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ portfolioId: string }>;
}) {
  const { portfolioId } = await params;
  await requireUser();

  const result = await getPortfolioRows(portfolioId);
  if (!result) notFound();

  const [members, addableBoards] = await Promise.all([
    listOrgMembersCached(result.portfolio.org_id),
    listReadableBoards(),
  ]);

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
