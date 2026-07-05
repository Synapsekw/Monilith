import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// ChartContainer wraps children in a real ResponsiveContainer, which does not
// mount its children in jsdom (no layout). Stub it so ChartTooltipContent still
// receives ChartContainer's context but renders directly.
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 300 }}>{children}</div>
    ),
  };
});

const config: ChartConfig = {
  Ada: { label: "Ada", color: "#34d399" },
};

// The shape Recharts 3 passes to a Tooltip `content` component: active + payload[].
const payload = [
  {
    dataKey: "Ada",
    name: "Ada",
    value: 3,
    color: "#34d399",
    payload: { __label: "Done", Ada: 3 },
  },
];

describe("ChartTooltipContent (recharts 3 compat)", () => {
  it("renders label + value from a v3-shaped tooltip payload", () => {
    render(
      <ChartContainer config={config}>
        <ChartTooltipContent active payload={payload as never} label="Done" />
      </ChartContainer>,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
