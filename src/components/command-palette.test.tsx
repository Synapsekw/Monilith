import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import { useUIStore } from "@/stores/ui";

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

beforeEach(() => {
  useUIStore.setState({ commandOpen: false });
});

describe("CommandPalette", () => {
  it("renders the search input when open without crashing", () => {
    useUIStore.setState({ commandOpen: true });

    render(<CommandPalette />);

    expect(
      screen.getByPlaceholderText("Type a command or search…"),
    ).toBeInTheDocument();
  });
});
