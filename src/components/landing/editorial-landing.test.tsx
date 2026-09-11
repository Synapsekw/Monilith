import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorialLanding, LANDING_FAQS } from "./editorial-landing";
import { PRICING_TIERS, priceFor } from "@/lib/billing/tiers";

// next/link needs the app-router context in Next 16; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// next/image needs the image-loader config; a plain <img> keeps the alt/src.
vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    priority: _priority,
    quality: _quality,
    ...rest
  }: {
    src: string | { src: string };
    alt: string;
    priority?: boolean;
    quality?: number;
  } & Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : src.src} alt={alt} {...rest} />
  ),
}));

vi.mock("@/lib/fonts", () => ({ nunito: { className: "font-mock" } }));

describe("EditorialLanding", () => {
  it("renders the editorial hero and the approved section order", () => {
    render(<EditorialLanding />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /work, with\s*everyone in it/i,
      }),
    ).toBeInTheDocument();

    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(h2s).toEqual([
      "The big picture.And every little detail.",
      "Built aroundthe way you work.",
      "You can run the workspace.So can your agents.",
      "Intelligence,close to the work.",
      "Start with the work.Add the intelligence.",
      "Good questions.Straight answers.",
      "Bring your team.Bring your AI.",
    ]);
  });

  it("uses the official wordmark: MONOL + slab mark + TH, never a separate rectangle", () => {
    const { container } = render(<EditorialLanding />);
    const marks = container.querySelectorAll(
      'svg path[d="M8.6 5 15.4 3.2V20.8H8.6Z"]',
    );
    // Nav, agent-access destination, footer.
    expect(marks).toHaveLength(3);
    expect(marks[0].parentElement).toHaveAttribute(
      "viewBox",
      "8.6 3.2 6.8 17.6",
    );
    expect(screen.getAllByText("MONOLITH").length).toBe(3);
  });

  it("logged out: trial CTAs go to /signup, sign in to /login", () => {
    render(<EditorialLanding />);
    const trials = screen.getAllByRole("link", { name: /start your trial/i });
    expect(trials.length).toBeGreaterThan(0);
    for (const link of trials) expect(link).toHaveAttribute("href", "/signup");
    for (const link of screen.getAllByRole("link", { name: /sign in/i })) {
      expect(link).toHaveAttribute("href", "/login");
    }
    expect(
      screen.getByRole("link", { name: /create your workspace/i }),
    ).toHaveAttribute("href", "/signup");
    expect(
      screen.queryByRole("link", { name: /enter app/i }),
    ).not.toBeInTheDocument();
  });

  it("signed in: every entry point leads back into the app, none to /signup", () => {
    render(<EditorialLanding signedIn />);
    expect(
      screen.queryByRole("link", { name: /sign in/i }),
    ).not.toBeInTheDocument();
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("href", "/signup");
    }
    expect(
      screen.getAllByRole("link", { name: /enter app/i })[0],
    ).toHaveAttribute("href", "/");
    expect(
      screen.getAllByRole("link", { name: /open your workspace/i })[0],
    ).toHaveAttribute("href", "/");
  });

  it("main navigation uses in-page anchors, never router navigations", () => {
    render(<EditorialLanding />);
    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    const anchors = {
      Product: "#product",
      "For agents": "#agents",
      "Why Monolith": "#why",
      Pricing: "#pricing",
    };
    for (const [label, href] of Object.entries(anchors)) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute(
        "href",
        href,
      );
    }
    // …and every anchor target exists on the page.
    for (const id of ["product", "agents", "why", "pricing", "demo", "top"]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it("the mobile menu toggles and closes on a link click", async () => {
    const user = userEvent.setup();
    render(<EditorialLanding />);
    const toggle = screen.getByRole("button", { name: /open navigation/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: /close navigation/i }),
    ).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: /main navigation/i });
    await user.click(within(nav).getByRole("link", { name: "Pricing" }));
    expect(
      screen.getByRole("button", { name: /open navigation/i }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("the product tour switches captures without leaving the page", async () => {
    const user = userEvent.setup();
    render(<EditorialLanding />);
    const tabs = screen.getByRole("tablist", { name: /product screens/i });
    const boardTab = within(tabs).getByRole("tab", { name: /boards/i });
    expect(boardTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("img", { name: /interface: organize the work/i }),
    ).toBeVisible();

    await user.click(within(tabs).getByRole("tab", { name: /agent dock/i }));
    expect(boardTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Bring AI alongside")).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: /interface: organize the work/i,
        hidden: true,
      }),
    ).not.toBeVisible();
  });

  it("pricing reads prices and credits from the published tier list", () => {
    render(<EditorialLanding />);
    const pricing = document.getElementById("pricing")!;
    for (const tier of PRICING_TIERS) {
      const price = priceFor(tier, "annual");
      if (price !== null) {
        expect(within(pricing).getByText(`$${price}`)).toBeInTheDocument();
      }
    }
    expect(
      within(pricing).getByText(/500 AI credits per seat/),
    ).toBeInTheDocument();
    expect(
      within(pricing).getByRole("link", { name: /compare all plan details/i }),
    ).toHaveAttribute("href", "/pricing");
    expect(
      within(pricing).getByRole("link", { name: /explore enterprise/i }),
    ).toHaveAttribute("href", "/pricing");
  });

  it("keeps the MCP messaging: agents OPERATE the platform, distinct from board agents", () => {
    render(<EditorialLanding />);
    expect(
      screen.getByText(/designed for agents from the start/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Full agent access through MCP/i),
    ).toBeInTheDocument();
    const faq = LANDING_FAQS.find((f) =>
      /built-in agents different/i.test(f.q),
    );
    expect(faq?.a).toMatch(/propose changes for your review/);
    expect(faq?.a).toMatch(/operate the platform/);
    for (const f of LANDING_FAQS) {
      expect(screen.getByText(f.q)).toBeInTheDocument();
    }
  });

  it("carries no prototype-only annotations into production", () => {
    render(<EditorialLanding />);
    expect(
      screen.queryByText(/standalone design concept/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/captured in monolith/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^actual /i)).not.toBeInTheDocument();
    // Legacy beta signal from the previous landing — must not return either.
    expect(screen.queryByText("In active development")).not.toBeInTheDocument();
  });

  it("links the public /updates page from the footer", () => {
    render(<EditorialLanding />);
    expect(
      screen.getByRole("link", { name: /product updates/i }),
    ).toHaveAttribute("href", "/updates");
  });
});
