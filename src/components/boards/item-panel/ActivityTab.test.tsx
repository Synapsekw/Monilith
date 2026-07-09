import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityTab } from "./ActivityTab";

describe("ActivityTab", () => {
  it("renders the empty state when there is no activity", () => {
    render(
      <ActivityTab cache={{ activities: [] }} columns={[]} members={[]} />,
    );
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("shows an error state instead of the empty state when the fetch failed", () => {
    render(<ActivityTab cache={undefined} isError columns={[]} members={[]} />);
    expect(screen.getByText(/couldn't load activity/i)).toBeInTheDocument();
    expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument();
  });
});
