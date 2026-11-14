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

  it("labels a Mono actor as a Mono", () => {
    render(
      <ActivityTab
        cache={{
          activities: [
            {
              id: "a1",
              org_id: "o",
              board_id: "b",
              item_id: "i1",
              actor_id: "m1",
              action: "item_created",
              column_id: null,
              old_value: null,
              new_value: null,
              created_at: "2026-11-13T10:00:00Z",
            } as never,
          ],
        }}
        columns={[]}
        members={[
          {
            userId: "m1",
            fullName: "Nova",
            mono: {
              color: "#7395ff",
              ownerId: "u1",
              ownerName: "Ada Owner",
              directable: false,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Ada's Mono")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Nova, Ada's Mono" }),
    ).toBeInTheDocument();
  });
});
