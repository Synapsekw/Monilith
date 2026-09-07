import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConversationRail } from "./ConversationRail";
import type { ConversationRow } from "@/lib/ai/ask/conversations";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ask",
}));
// The rename/delete Server Actions are `"use server"` modules that pull in
// `server-only` transitively. This test is about the rail's surface model, so
// stub them rather than drag the server graph into jsdom.
vi.mock("@/lib/ai/ask/conversation-actions", () => ({
  deleteConversation: vi.fn(),
  renameConversation: vi.fn(),
}));

const chats: ConversationRow[] = [
  { id: "c1", title: "Q3 slippage", updated_at: new Date().toISOString() },
  { id: "c2", title: "Hiring plan", updated_at: "2026-08-01T10:00:00Z" },
];
const briefings: ConversationRow[] = [
  { id: "b1", title: "Ops — 2026-09-07", updated_at: "2026-09-07T06:00:00Z" },
];

describe("ConversationRail surface model", () => {
  /**
   * The rail is transparent atmosphere sitting directly on `.app-wash` (see
   * `src/app/ask/layout.test.tsx`), so its chrome must not paint an opaque
   * resting fill. The `outline` button variant ships `bg-background` for light
   * mode (ui/button.tsx:14) — full-width here, so it would punch a flat
   * rectangle out of the gradient. Scoping the override to this call site
   * rather than the variant is the same deliberate choice made in
   * `src/components/command-trigger.test.tsx`: `outline` is correct as-is
   * everywhere it sits on the opaque content card. tailwind-merge drops the
   * losing `bg-background` from the emitted string and leaves the variant's
   * `dark:bg-input/30` alone — a different modifier group, and already
   * translucent.
   */
  it("does not paint an opaque New chat fill on the wash", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    const button = screen.getByRole("button", { name: /new chat/i });
    expect(button.className).toContain("bg-transparent");
    expect(button.className).not.toMatch(/\bbg-background\b/);
    expect(button.className).toContain("dark:bg-input/30");
  });

  it("keeps briefings out of the chat list, in their own section", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    const chatNav = screen.getByRole("navigation", { name: /chats/i });
    expect(within(chatNav).queryByText(/Ops — 2026-09-07/)).toBeNull();
    expect(
      screen.getByRole("group", { name: /briefings/i }),
    ).toBeInTheDocument();
  });

  it("counts the briefings on the collapsed section", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    expect(screen.getByText(/briefings/i).textContent).toMatch(/1/);
  });

  // The count and the list under it are one statement: a search that matches
  // only a chat left the collapsed summary still claiming "Briefings (1)"
  // while the section it summarised had been filtered to nothing.
  it("counts what the briefings section will actually show", async () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    await userEvent.type(
      screen.getByLabelText(/search conversations/i),
      "hiring",
    );
    expect(screen.getByText(/briefings/i).textContent).toMatch(/\(0\)/);
  });

  it("keeps counting a briefing that the search does match", async () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    await userEvent.type(screen.getByLabelText(/search conversations/i), "ops");
    expect(screen.getByText(/briefings/i).textContent).toMatch(/\(1\)/);
  });

  it("filters the loaded rows as you type, with no server call", async () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    await userEvent.type(
      screen.getByLabelText(/search conversations/i),
      "hiring",
    );
    expect(screen.queryByText("Q3 slippage")).toBeNull();
    expect(screen.getByText("Hiring plan")).toBeInTheDocument();
  });

  it("groups chats into age buckets", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    expect(screen.getByText(/^today$/i)).toBeInTheDocument();
    // `c2` is dated 2026-08-01, well past a fortnight before any run of this
    // suite, so it lands in the tail bucket.
    expect(screen.getByText(/^older$/i)).toBeInTheDocument();
  });

  /** `<details open>` is the real state — jsdom does not hide a closed
   *  section's children, so asserting on the attribute is what actually pins
   *  the fold. */
  function sectionFor(label: RegExp): HTMLDetailsElement {
    return screen.getByText(label).closest("details")!;
  }

  it("opens Today and folds the older buckets on first paint", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    expect(sectionFor(/^today$/i).open).toBe(true);
    expect(sectionFor(/^older$/i).open).toBe(false);
    expect(
      screen.getByRole("group", { name: /briefings/i }),
    ).not.toHaveAttribute("open");
  });

  it("shows how many chats a folded bucket is hiding", () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    expect(sectionFor(/^older$/i).textContent).toMatch(/1/);
  });

  it("opens a folded bucket when its heading is clicked", async () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    await userEvent.click(screen.getByText(/^older$/i));
    expect(sectionFor(/^older$/i).open).toBe(true);
  });

  it("unfolds every section while searching, so a match cannot hide", async () => {
    render(<ConversationRail chats={chats} briefings={briefings} />);
    expect(sectionFor(/^older$/i).open).toBe(false);
    await userEvent.type(
      screen.getByLabelText(/search conversations/i),
      "hiring",
    );
    expect(sectionFor(/^older$/i).open).toBe(true);
  });
});
