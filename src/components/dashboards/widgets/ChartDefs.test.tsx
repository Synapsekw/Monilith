import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartDefs, glowId } from "@/components/dashboards/widgets/ChartDefs";

describe("ChartDefs", () => {
  it("renders a gradient per spec and a glow filter", () => {
    const { container } = render(
      <svg>
        <ChartDefs
          widgetId="w1"
          specs={[
            { id: "g-w1-bar-hero", kind: "hero-bar" },
            { id: "g-w1-bar-x", kind: "bar", color: "#34d399" },
          ]}
        />
      </svg>,
    );
    expect(container.querySelector("#g-w1-bar-hero")).not.toBeNull();
    expect(container.querySelector("#g-w1-bar-x")).not.toBeNull();
    expect(container.querySelector(`#${glowId("w1")}`)).not.toBeNull();
  });
});
