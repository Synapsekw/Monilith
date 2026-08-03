import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AskLayout from "./layout";

// The rail is an async RSC behind `requireUser()`. Stub it — this test is about
// the frame's surface model, not the rail's data. `railState.suspend` lets one
// test hold the stub in flight so the Suspense fallback actually renders.
const railState = vi.hoisted(() => ({ suspend: false }));
vi.mock("@/components/ai/ask/AskRailData", () => ({
  AskRailData: () => {
    if (railState.suspend) throw new Promise<void>(() => {});
    return <div>RAIL_DATA</div>;
  },
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

  /**
   * The wash reads across the top of every other page because `AppShell` puts a
   * transparent `h-14` header above `<main>` — `<main>` carries no top margin,
   * so that band IS the gradient's top edge. Without it `/ask` starts the opaque
   * card at y=0 and the wash never appears above the fold.
   */
  it("reserves a transparent header band above main so the wash reads across the top", () => {
    render(<AskLayout>chat</AskLayout>);
    const header = screen.getByRole("banner");
    expect(header).toHaveClass("h-14");
    expect(header).toHaveClass("shrink-0");
    expect(header.className).not.toMatch(/\bbg-/);
    expect(header.className).not.toMatch(/\bborder-b\b/);

    // The band sits above the card, in the same right-hand column.
    const main = screen.getByRole("main");
    expect(header.parentElement).toBe(main.parentElement);
    expect(
      header.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(main.className).not.toMatch(/\bmt-/);
  });

  it("puts the theme control in that band — /ask's only way to switch themes", () => {
    render(<AskLayout>chat</AskLayout>);
    const header = screen.getByRole("banner");
    expect(
      within(header).getByRole("button", { name: /toggle theme/i }),
    ).toBeInTheDocument();
  });

  it("renders main as the one inset opaque card", () => {
    render(<AskLayout>chat</AskLayout>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("bg-content-surface");
    expect(main).toHaveClass("rounded-xl");
    expect(main).toHaveClass("border-content-edge");
    expect(main).toHaveClass("shadow-content-lift");
  });

  /**
   * `globals.css` reserves a stable scrollbar gutter for `main,
   * [data-scroll-container]`, and `::-webkit-scrollbar { width: 10px }` forces
   * classic, space-taking scrollbars. `scrollbar-gutter: stable` applies to any
   * scroll container — `overflow: hidden` included — so the moment this `<main>`
   * became `overflow-hidden` it started reserving 10px that can never hold a
   * scrollbar, stacked on top of the 10px `MessageList` correctly reserves as
   * the real scroller. Opting out here (not dropping `overflow-hidden`, which
   * is what stops a second scrollbar stacking on the same axis) is the fix.
   * Don't "clean up" this utility.
   */
  it("opts main out of the stable gutter it can never use", () => {
    render(<AskLayout>chat</AskLayout>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("overflow-hidden");
    expect(main).toHaveClass("[scrollbar-gutter:auto]");
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

/**
 * The owner navigates between `/ask` and the rest of the app, so the two rails
 * are read as one rail that changed contents — not two rails. Any difference in
 * width or gutter shows up as the wordmark jumping sideways on navigation. The
 * reference is `src/components/sidebar.tsx`: `w-60` expanded, brand row
 * `flex min-h-14 gap-1 px-3 py-2`, nav column `px-2` + `px-3` rows.
 *
 * `/ask` deliberately has no collapse affordance, so it copies the geometry of
 * the shell's *expanded* state only — never the `w-14` collapsed one.
 */
describe("AskLayout rail geometry matches the app shell", () => {
  function railOf(container: HTMLElement) {
    return container.querySelector("aside") as HTMLElement;
  }

  it("gives the rail the shell sidebar's expanded width", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const classes = railOf(container).className.split(/\s+/);
    expect(classes).toContain("w-60");
    expect(classes).not.toContain("w-64");
  });

  /**
   * The shell sizes its brand row with `min-h-14 py-2`, not a hard `h-14`: the
   * tallest thing in it is a `size-8` collapse button (32px + 16px padding =
   * 48px), so the floor is what actually produces the 56px band. `/ask` has no
   * button — just the ~24px wordmark — so the floor is doing all the work here
   * and the row still resolves to exactly the 56px of the `h-14` header beside
   * it. Copy the floor, not the fixed height, so the two rails stay one box.
   */
  it("puts the brand row on the shell's brand-row box", () => {
    const { container } = render(<AskLayout>chat</AskLayout>);
    const brandRow = railOf(container).firstElementChild as HTMLElement;
    const classes = brandRow.className.split(/\s+/);
    expect(classes).toContain("min-h-14");
    expect(classes).toContain("px-3");
    expect(classes).toContain("py-2");
    expect(classes).toContain("gap-1");
    expect(classes).toContain("items-center");
    expect(classes).toContain("shrink-0");
    expect(classes).not.toContain("h-14");
    expect(classes).not.toContain("px-4");
    expect(classes).not.toContain("gap-2");
  });

  it("aligns the back link with the rail's content column", () => {
    render(<AskLayout>chat</AskLayout>);
    const back = screen.getByRole("link", { name: /back to monolith/i });
    const classes = back.className.split(/\s+/);
    expect(classes).toContain("px-3");
    expect(classes).not.toContain("px-4");
  });

  it("keeps the rail's loading fallback on that same column", () => {
    railState.suspend = true;
    try {
      render(<AskLayout>chat</AskLayout>);
      const fallback = screen.getByText(/loading conversations/i);
      const classes = fallback.className.split(/\s+/);
      expect(classes).toContain("px-3");
      expect(classes).not.toContain("px-4");
    } finally {
      railState.suspend = false;
    }
  });
});
