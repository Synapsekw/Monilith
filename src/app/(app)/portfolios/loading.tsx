import { PortfolioGridSkeleton } from "@/components/portfolios/PortfolioGridSkeleton";

/** Instant loading fallback for the portfolios index. Static Server Component. */
export default function PortfoliosLoading() {
  return <PortfolioGridSkeleton />;
}
