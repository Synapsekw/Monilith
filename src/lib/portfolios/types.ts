export type PortfolioHealth = "on_track" | "at_risk" | "off_track";
export type PortfolioPriority = "low" | "medium" | "high" | "critical";

/** Raw per-board aggregates returned by the portfolio_rollup RPC. */
export type RollupRow = {
  boardId: string;
  name: string;
  totalItems: number;
  doneItems: number;
  timelineStart: string | null; // ISO date
  timelineEnd: string | null; // ISO date
  overdueItems: number;
};

/** A board's placement in a portfolio (manual fields + completion mapping). */
export type Placement = {
  id: string;
  boardId: string;
  position: number;
  ownerUserId: string | null;
  priority: PortfolioPriority | null;
  budget: number | null;
  healthOverride: PortfolioHealth | null;
  statusNote: string | null;
  doneColumnId: string | null;
  doneOptionIds: string[];
};

export type RowOwner = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/** A fully-merged grid row: placement + derived metrics + resolved owner. */
export type PortfolioRow = Placement & {
  name: string;
  totalItems: number;
  doneItems: number;
  progressPct: number | null; // null = no mapping or no items
  timelineStart: string | null;
  timelineEnd: string | null;
  overdueItems: number;
  autoHealth: PortfolioHealth | null;
  health: PortfolioHealth | null; // healthOverride ?? autoHealth
  owner: RowOwner | null;
};
