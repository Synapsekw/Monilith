import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DayActualsPopover } from "./DayActualsPopover";

const H = 3600;

describe("DayActualsPopover", () => {
  it("renders one row per in-week day with its hours when opened", async () => {
    const user = userEvent.setup();
    render(
      <DayActualsPopover
        weekLabel="Jun 1"
        memberName="Ada"
        days={[
          { day: "2026-06-01", secs: 3 * H },
          { day: "2026-06-05", secs: 2 * H },
        ]}
      >
        <button>open</button>
      </DayActualsPopover>,
    );
    await user.click(screen.getByText("open"));
    expect(screen.getByText(/Mon/)).toBeInTheDocument();
    expect(screen.getByText("3h")).toBeInTheDocument();
    expect(screen.getByText("2h")).toBeInTheDocument();
  });

  it("shows an empty message when there are no day actuals", async () => {
    const user = userEvent.setup();
    render(
      <DayActualsPopover weekLabel="Jun 1" memberName="Ada" days={[]}>
        <button>open</button>
      </DayActualsPopover>,
    );
    await user.click(screen.getByText("open"));
    expect(screen.getByText(/No logged time/i)).toBeInTheDocument();
  });
});
