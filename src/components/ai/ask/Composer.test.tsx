import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Composer } from "./Composer";
import type { MentionTarget } from "@/lib/collaboration/mentions";

const AGENTS: readonly MentionTarget[] = [
  { kind: "agent", agentId: "a1", handle: "ops", name: "Ops Chaser" },
  { kind: "agent", agentId: "a2", handle: "scout", name: "Deal Scout" },
];

describe("Composer — addressing an agent by @handle", () => {
  it("completes an agent handle in the composer", async () => {
    const onSubmit = vi.fn();
    render(<Composer disabled={false} agents={AGENTS} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole("textbox"), "@op");
    await userEvent.click(await screen.findByRole("button", { name: /ops/i }));
    await userEvent.type(
      screen.getByRole("textbox"),
      "what is late?{Meta>}{Enter}{/Meta}",
    );

    expect(onSubmit).toHaveBeenCalledWith("@ops what is late?", "a1");
  });

  it("only suggests the agents whose handle matches the query", async () => {
    render(<Composer disabled={false} agents={AGENTS} onSubmit={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox"), "@sc");

    expect(
      await screen.findByRole("button", { name: /scout/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ops chaser/i })).toBeNull();
  });

  it("passes a null agent id when no handle leads the message", async () => {
    const onSubmit = vi.fn();
    render(<Composer disabled={false} agents={AGENTS} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole("textbox"),
      "what is late?{Meta>}{Enter}{/Meta}",
    );

    expect(onSubmit).toHaveBeenCalledWith("what is late?", null);
  });

  it("passes a null agent id when the leading handle matches no agent", async () => {
    const onSubmit = vi.fn();
    render(<Composer disabled={false} agents={AGENTS} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole("textbox"),
      "@nobody what is late?{Meta>}{Enter}{/Meta}",
    );

    expect(onSubmit).toHaveBeenCalledWith("@nobody what is late?", null);
  });

  it("ignores a handle that is not leading the message", async () => {
    const onSubmit = vi.fn();
    render(<Composer disabled={false} agents={AGENTS} onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByRole("textbox"),
      "ask @ops later{Meta>}{Enter}{/Meta}",
    );

    expect(onSubmit).toHaveBeenCalledWith("ask @ops later", null);
  });

  it("names the agent it will ask once a leading handle resolves", async () => {
    render(<Composer disabled={false} agents={AGENTS} onSubmit={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox"), "@ops what is late?");

    expect(screen.getByText(/asking ops chaser/i)).toBeInTheDocument();
  });

  it("says who answers when the persona is sticky and nothing was typed", () => {
    render(
      <Composer
        disabled={false}
        agents={AGENTS}
        agentId="a1"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/asking ops chaser/i)).toBeInTheDocument();
  });

  it("a typed handle overrides the sticky persona in the helper line", async () => {
    render(
      <Composer
        disabled={false}
        agents={AGENTS}
        agentId="a1"
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(/your question/i), "@scout hi");
    expect(screen.getByText(/asking deal scout/i)).toBeInTheDocument();
  });

  it("inserts a handle when its chip is clicked", async () => {
    render(
      <Composer
        disabled={false}
        agents={AGENTS}
        agentId={null}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "@scout" }));
    expect(screen.getByLabelText(/your question/i)).toHaveValue("@scout ");
  });
});

describe("Composer — send failure and retry", () => {
  it("shows the last failure as an alert and calls onRetry from its button", async () => {
    const onRetry = vi.fn();
    render(
      <Composer
        disabled={false}
        agents={AGENTS}
        onSubmit={vi.fn()}
        error="Couldn't reach the server."
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't reach the server.");

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no alert and no retry button when there is no error", () => {
    render(<Composer disabled={false} agents={AGENTS} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("shows the error with no retry button when the parent gives no onRetry", () => {
    render(
      <Composer
        disabled={false}
        agents={AGENTS}
        onSubmit={vi.fn()}
        error="Couldn't reach the server."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't reach the server.",
    );
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });
});

// Spec §3: in the dock the composer is the ONE raised surface on the wash;
// its /ask strip (bg + top hairline + centred column) is gone. /ask itself
// keeps every class byte-for-byte.
describe("Composer — surface", () => {
  it("keeps the /ask card wrapper byte-for-byte by default", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toBe("bg-background border-t px-4 py-3");
    expect(outer.firstElementChild!.className).toBe(
      "relative mx-auto max-w-3xl",
    );
    expect(screen.getByRole("textbox").closest("form")!.className).toBe(
      "bg-surface focus-within:border-border-bright flex items-end gap-2 rounded-lg border p-2 transition-colors",
    );
    // Contiguous `.toContain`, not `.toBe`: the rendered className is
    // `Kicker`'s own base classes (uppercase + tracking — the mono eyebrow
    // recipe) plus this component's `className` prop. Pinning the full
    // composed string would hand-roll that recipe here, which
    // `kicker-usage.test.ts` forbids outside the primitive. This still fails
    // on any edit, removal, or reorder of the card-branch prop string itself.
    expect(screen.getByText("⌘↵ to send").className).toContain(
      "mx-auto mt-1.5 block max-w-3xl px-1",
    );
  });

  it("is the one raised surface on the wash: no strip, lifted form, hairline that brightens", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} surface="atmosphere" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).not.toMatch(
      /\bborder-t\b|\bbg-background\b|max-w-3xl/,
    );
    expect(outer.className).toContain("px-2.5");
    expect(outer.className).toContain("pb-2.5");
    expect(outer.firstElementChild!.className).toBe("relative");
    const form = screen.getByRole("textbox").closest("form")!;
    for (const cls of [
      "bg-surface",
      "border-border",
      "shadow-content-lift",
      "hover:border-border-hover",
      "focus-within:border-border-bright",
      "rounded-lg",
    ]) {
      expect(form.className).toContain(cls);
    }
    // The helper line is the same Kicker, aligned to the dock's px-3.5 (10 + 4).
    const helper = screen.getByText("⌘↵ to send");
    expect(helper.className).not.toContain("max-w-3xl");
    expect(helper.className).toContain("px-1");
  });

  it("rises into place on the wash (translate-y-2.5 → 0 at 200ms), on the wrapper not the form", () => {
    const { container } = render(
      <Composer disabled={false} onSubmit={vi.fn()} surface="atmosphere" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("starting:translate-y-2.5");
    expect(outer.className).toContain("transition-[opacity,translate]");
    expect(outer.className).toContain("delay-[200ms]");
    // The hover/focus hairline must not inherit the entrance delay.
    expect(
      screen.getByRole("textbox").closest("form")!.className,
    ).not.toContain("delay-");
  });
});
