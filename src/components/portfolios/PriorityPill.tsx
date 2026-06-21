import type { PortfolioPriority } from "@/lib/portfolios/types";

const LABEL: Record<PortfolioPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export function PriorityPill({
  priority,
}: {
  priority: PortfolioPriority | null;
}) {
  if (!priority)
    return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-xs font-medium">{LABEL[priority]}</span>;
}
