import type { PortfolioPriority } from "@/lib/portfolios/types";
import { StatusPill, type StatusColor } from "@/components/ui/status-pill";

const LABEL: Record<PortfolioPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

const PRIORITY_COLOR: Record<PortfolioPriority, StatusColor> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "gray",
};

export function PriorityPill({
  priority,
}: {
  priority: PortfolioPriority | null;
}) {
  if (!priority)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <StatusPill variant="soft" color={PRIORITY_COLOR[priority]}>
      {LABEL[priority]}
    </StatusPill>
  );
}
