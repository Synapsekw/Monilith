import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the Pulse brand and its children", () => {
    render(
      <AppShell>
        <div>Board content</div>
      </AppShell>,
    );

    expect(screen.getAllByText("Pulse").length).toBeGreaterThan(0);
    expect(screen.getByText("Board content")).toBeInTheDocument();
  });

  it("exposes the command palette trigger", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByText("Search…")).toBeInTheDocument();
  });
});
