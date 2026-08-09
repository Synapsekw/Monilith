import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function ReportNotFound() {
  return (
    <NotFoundFallback
      title="Report not found"
      description="This report may have been deleted, or you may not have access to the boards it covers."
      backHref="/reports"
      backLabel="All reports"
    />
  );
}
