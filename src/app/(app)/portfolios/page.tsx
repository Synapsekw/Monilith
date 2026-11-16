import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { isActiveOrgGuest } from "@/lib/org/guest";
import { GuestUnavailable } from "@/components/shell/guest-unavailable";
import { listPortfolios } from "@/lib/portfolios/queries";
import { NewPortfolioDialog } from "@/components/portfolios/NewPortfolioDialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export default async function PortfoliosIndex() {
  const user = await requireUser();
  // Org-wide planning is not offered to guests (the sidebar hides the link);
  // reached by URL, say so instead of rendering an empty page whose create
  // buttons the database refuses. Same cached role read as the shell.
  if (await isActiveOrgGuest(user.id))
    return <GuestUnavailable title="Portfolios" />;
  const portfolios = await listPortfolios();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <PageHeader
        className="mb-6"
        kicker="Planning"
        title="Portfolios"
        actions={<NewPortfolioDialog />}
      />
      {portfolios.length === 0 ? (
        <EmptyState
          mascot
          title="Your portfolios will appear here"
          actions={<NewPortfolioDialog />}
        >
          Create a portfolio to roll up boards across your org.
        </EmptyState>
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
