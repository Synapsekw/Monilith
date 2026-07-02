import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function DashboardNotFound() {
  return (
    <NotFoundFallback
      title="Dashboard not found"
      description="This dashboard may have been deleted, or you may not have access to it."
      backHref="/dashboards"
      backLabel="All dashboards"
    />
  );
}
