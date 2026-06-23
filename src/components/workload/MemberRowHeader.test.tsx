import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemberRowHeader } from "./MemberRowHeader";

const member = {
  userId: "u1",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  avatarUrl: null,
};

describe("MemberRowHeader utilization", () => {
  it("shows utilization percent over the window when capacity > 0", () => {
    render(
      <MemberRowHeader
        member={member}
        totalEffortSecs={20 * 3600}
        totalCapacitySecs={40 * 3600}
        totalActualSecs={0}
        metric="planned"
      />,
    );
    // 20h / 40h = 50%
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("omits utilization for the Unassigned row", () => {
    render(
      <MemberRowHeader
        member={null}
        totalEffortSecs={10 * 3600}
        totalCapacitySecs={0}
        totalActualSecs={0}
        metric="planned"
      />,
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
