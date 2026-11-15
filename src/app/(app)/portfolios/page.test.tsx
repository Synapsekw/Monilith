import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PortfoliosIndex from "./page";

const listPortfolios = vi.fn();
const isActiveOrgGuest = vi.fn();
vi.mock("@/lib/org/guest", () => ({
  isActiveOrgGuest: (userId: string) => isActiveOrgGuest(userId),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("@/lib/portfolios/queries", () => ({
  listPortfolios: () => listPortfolios(),
}));
vi.mock("@/lib/portfolios/actions", () => ({ createPortfolio: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PortfoliosIndex", () => {
  beforeEach(() => {
    listPortfolios.mockReset();
    isActiveOrgGuest.mockReset().mockResolvedValue(false);
  });

  it("tells a guest the page is not available, with no create control and no read", async () => {
    isActiveOrgGuest.mockResolvedValue(true);
    render(await PortfoliosIndex());

    expect(isActiveOrgGuest).toHaveBeenCalledWith("user-1");
    expect(
      screen.getByText("Portfolios is not available to guests"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New portfolio" })).toBeNull();
    expect(listPortfolios).not.toHaveBeenCalled();
  });

  it("with no portfolios, shows Mono, what will appear, and the existing New portfolio trigger", async () => {
    listPortfolios.mockResolvedValue([]);
    const { container } = render(await PortfoliosIndex());

    expect(container.querySelector("svg[data-mood]")).not.toBeNull();
    expect(
      screen.getByText("Your portfolios will appear here"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Create a portfolio to roll up boards across your org."),
    ).toBeInTheDocument();
    // The header's trigger plus the same dialog trigger in the empty state.
    expect(
      screen.getAllByRole("button", { name: "New portfolio" }),
    ).toHaveLength(2);
    expect(screen.queryByText(/No portfolios yet/)).toBeNull();
  });

  it("with portfolios, lists them and shows no mascot", async () => {
    listPortfolios.mockResolvedValue([{ id: "p1", name: "Q4 launches" }]);
    const { container } = render(await PortfoliosIndex());

    expect(screen.getByRole("link", { name: "Q4 launches" })).toHaveAttribute(
      "href",
      "/portfolios/p1",
    );
    expect(container.querySelector("svg[data-mood]")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "New portfolio" }),
    ).toHaveLength(1);
  });
});
