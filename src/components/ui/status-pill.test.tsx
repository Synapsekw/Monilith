import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DARK_FG } from "@/lib/boards/contrast";
import {
  STATUS_BG,
  STATUS_COLORS,
  StatusPill,
  statusToneClasses,
} from "@/components/ui/status-pill";

/** Raw Tailwind palette classes (emerald-500, amber-400, …) are forbidden. */
const RAW_PALETTE =
  /\b(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

describe("statusToneClasses", () => {
  it("solid pills never use plain white text on pale token fills", () => {
    // Per pillTextColor()'s WCAG routing applied to the --status-* token
    // values, near-black (DARK_FG) wins on every fill in both themes except
    // light-mode purple. `text-white` alone (the old hardcode) is never valid.
    for (const color of STATUS_COLORS) {
      const cls = statusToneClasses(color, "solid");
      expect(cls).toContain(STATUS_BG[color]);
      if (color === "purple") {
        expect(cls).toContain("text-white");
        expect(cls).toContain(`dark:text-[${DARK_FG}]`);
      } else {
        expect(cls).toContain(`text-[${DARK_FG}]`);
        expect(cls).not.toContain("text-white");
      }
    }
  });

  it("soft pills pair a 15% token tint with token-derived text", () => {
    for (const color of STATUS_COLORS) {
      const cls = statusToneClasses(color, "soft");
      expect(cls).toContain(`${STATUS_BG[color]}/15`);
      // Light mode: token darkened toward black (AA on light surfaces).
      expect(cls).toContain(`color-mix(in_oklab,var(--status-${color})_65%,black)`);
      // Dark mode: the token itself (AA on the near-black background).
      expect(cls).toContain(`dark:text-status-${color}`);
    }
  });

  it("supports the brand accent for 'done' semantics", () => {
    expect(statusToneClasses("primary", "solid")).toBe(
      "bg-primary text-primary-foreground",
    );
    expect(statusToneClasses("primary", "soft")).toBe(
      "bg-primary/15 text-primary",
    );
  });

  it("emits no raw Tailwind palette classes", () => {
    for (const color of [...STATUS_COLORS, "primary"] as const) {
      expect(statusToneClasses(color, "solid")).not.toMatch(RAW_PALETTE);
      expect(statusToneClasses(color, "soft")).not.toMatch(RAW_PALETTE);
    }
  });
});

describe("StatusPill", () => {
  it("renders its label with the boards' canonical pill geometry", () => {
    render(<StatusPill color="green">Active</StatusPill>);
    const pill = screen.getByText("Active");
    expect(pill.className).toContain("rounded-md");
    expect(pill.className).toContain("px-2.5");
    expect(pill.className).toContain("py-0.5");
    expect(pill.className).toContain("text-xs");
    expect(pill.className).toContain("bg-status-green");
  });

  it("keeps the text-size utility when the soft text color is applied", () => {
    // Guards against tailwind-merge misclassifying the arbitrary color-mix
    // text color as a font-size and dropping `text-xs`.
    render(
      <StatusPill color="yellow" variant="soft">
        At risk
      </StatusPill>,
    );
    const pill = screen.getByText("At risk");
    expect(pill.className).toContain("text-xs");
    expect(pill.className).toContain("color-mix");
  });

  it("lets dense call sites override geometry via className", () => {
    render(
      <StatusPill color="blue" className="px-1.5 text-[10px]">
        Triaged
      </StatusPill>,
    );
    const pill = screen.getByText("Triaged");
    expect(pill.className).toContain("px-1.5");
    expect(pill.className).not.toContain("px-2.5");
    expect(pill.className).toContain("text-[10px]");
    expect(pill.className).not.toContain("text-xs");
  });
});
