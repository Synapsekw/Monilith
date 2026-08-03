import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const conversations: ConversationRow[] = [
  { id: "c1", title: "Sprint planning", updated_at: "2026-08-01T10:00:00Z" },
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
    render(<ConversationRail conversations={conversations} />);
    const button = screen.getByRole("button", { name: /new chat/i });
    expect(button.className).toContain("bg-transparent");
    expect(button.className).not.toMatch(/\bbg-background\b/);
    expect(button.className).toContain("dark:bg-input/30");
  });
});
