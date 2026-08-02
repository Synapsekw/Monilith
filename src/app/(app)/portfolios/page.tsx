import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listPortfolios } from "@/lib/portfolios/queries";
import { NewPortfolioDialog } from "@/components/portfolios/NewPortfolioDialog";
import { Kicker } from "@/components/ui/kicker";

export default async function PortfoliosIndex() {
  await requireUser();
  const portfolios = await listPortfolios();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Kicker>PLANNING</Kicker>
          <h1 className="text-lg font-semibold">Portfolios</h1>
        </div>
        <NewPortfolioDialog />
      </div>
      {portfolios.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No portfolios yet. Create one to roll up boards across your org.
        </p>
      ) : (
        <ul className="shadow-card divide-y overflow-hidden rounded-[14px] border">
          {portfolios.map((p) => (
            <li key={p.id}>
              <Link
                href={`/portfolios/${p.id}`}
                className="hover:bg-state-hover/40 block px-4 py-3 text-sm font-medium"
              >
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
