import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AskLayout from "./layout";

// The rail is an async RSC behind `requireUser()`. Stub it — this test is about
// the frame's surface model, not the rail's data.
vi.mock("@/components/ai/ask/AskRailData", () => ({
  AskRailData: () => <div>RAIL_DATA</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ask",
  useParams: () => ({}),
}));

/**
 * `/ask` lives OUTSIDE the `(app)` group and owns its own frame, so it does not
 * inherit AppShell's wash. These assertions are the same three that
 * `src/components/sidebar.test.tsx` and `src/components/app-shell.test.tsx`
 * make about the shell — one surface model, asserted per frame.
 */
describe("AskLayout surface model", () => {
  it("paints the wash on its own root", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass("app-wash");
    expect(root).toHaveClass("h-svh");
  });

  it("leaves the conversation rail transparent — no fill, no dividing line", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const aside = container.querySelector("aside") as HTMLElement;
    expect(aside.className).not.toMatch(/\bbg-sidebar\b/);
    expect(aside.className).not.toMatch(/\bbg-surface\b/);
    expect(aside.className).not.toMatch(/\bborder-r\b/);
  });

  it("renders main as the one inset opaque card", () => {
    render(<AskLayout>chat</AskLayout>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-content-surface");
    expect(main).toHaveClass("rounded-xl");
    expect(main).toHaveClass("border-content-edge");
    expect(main).toHaveClass("shadow-content-lift");
  });

  it("still renders the brand, the back link and the rail slot", () => {
    render(<AskLayout>CHAT_CHILDREN</AskLayout>);
    expect(screen.getByText("RAIL_DATA")).toBeInTheDocument();
    expect(screen.getByText("CHAT_CHILDREN")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /back to monolith/i }),
    ).toHaveAttribute("href", "/my-work");
  });
});
