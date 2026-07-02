import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function PortfolioNotFound() {
  return (
    <NotFoundFallback
      title="Portfolio not found"
      description="This portfolio may have been deleted, or you may not have access to it."
      backHref="/portfolios"
      backLabel="All portfolios"
    />
  );
}
