import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RootError from "./error";
import AppError from "./(app)/error";
import BoardsError from "./(app)/boards/error";
import DashboardsError from "./(app)/dashboards/error";
import PortfoliosError from "./(app)/portfolios/error";
import GoalsError from "./(app)/goals/error";
import TimeError from "./(app)/time/error";
import RootNotFound from "./not-found";
import BoardNotFound from "./(app)/boards/[boardId]/not-found";
import DashboardNotFound from "./(app)/dashboards/[dashboardId]/not-found";
import PortfolioNotFound from "./(app)/portfolios/[portfolioId]/not-found";

const err = Object.assign(new Error("x"), { digest: "d1" });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("error boundaries", () => {
  const cases: [
    string,
    React.ComponentType<{
      error: Error & { digest?: string };
      unstable_retry: () => void;
    }>,
  ][] = [
    ["root", RootError],
    ["(app)", AppError],
    ["boards", BoardsError],
    ["dashboards", DashboardsError],
    ["portfolios", PortfoliosError],
    ["goals", GoalsError],
    ["time", TimeError],
  ];
  it.each(cases)("%s renders a retry affordance", (_name, Comp) => {
    render(<Comp error={err} unstable_retry={() => {}} />);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
    cleanup();
  });
});

describe("not-found pages", () => {
  const cases: [string, React.ComponentType, string][] = [
    ["root", RootNotFound, "/"],
    ["board", BoardNotFound, "/boards"],
    ["dashboard", DashboardNotFound, "/dashboards"],
    ["portfolio", PortfolioNotFound, "/portfolios"],
  ];
  it.each(cases)("%s renders a back link to %s", (_n, Comp, href) => {
    render(<Comp />);
    expect(screen.getByRole("link")).toHaveAttribute("href", href);
    cleanup();
  });
});
