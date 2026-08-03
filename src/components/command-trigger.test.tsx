import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandTrigger } from "./command-trigger";
import { useUIStore } from "@/stores/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useParams: () => ({}),
}));

describe("CommandTrigger", () => {
  it("opens the command palette", async () => {
    useUIStore.setState({ commandOpen: false });
    render(<CommandTrigger />);
    await userEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(useUIStore.getState().commandOpen).toBe(true);
  });

  /**
   * The trigger sits in the header, i.e. directly on the wash. The `outline`
   * button variant ships an opaque `bg-background` for light mode
   * (ui/button.tsx:14). Scoping the override HERE rather than editing the
   * variant is deliberate: `outline` is used across the whole product on the
   * opaque content card, where an opaque fill is correct. tailwind-merge drops
   * the losing `bg-background` from the emitted class string, and leaves the
   * variant's `dark:bg-input/30` alone because that is a different modifier
   * group — dark was already translucent and already fine.
   */
  it("does not paint an opaque button fill on the wash", () => {
    render(<CommandTrigger />);
    const button = screen.getByRole("button", { name: /search/i });
    expect(button.className).toContain("bg-transparent");
    expect(button.className).not.toMatch(/\bbg-background\b/);
    expect(button.className).toContain("dark:bg-input/30");
  });

  it("gives the kbd chip an alpha-on-parent fill", () => {
    const { container } = render(<CommandTrigger />);
    const kbd = container.querySelector("kbd") as HTMLElement;
    expect(kbd.className).toContain("bg-chrome-fill");
    expect(kbd.className).not.toMatch(/\bbg-muted\b/);
  });
});
