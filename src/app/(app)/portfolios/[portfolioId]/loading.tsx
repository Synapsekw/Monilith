import { PortfolioGridSkeleton } from "@/components/portfolios/PortfolioGridSkeleton";

/** Instant loading fallback for a portfolio. Static Server Component. */
export default function PortfolioLoading() {
  return <PortfolioGridSkeleton />;
}
