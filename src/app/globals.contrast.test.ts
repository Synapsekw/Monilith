import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * WCAG AA for the dominant muted text ON THE WASH.
 *
 * This is the machine-checkable half of follow-up #3. It reads the shipped
 * values out of globals.css — the wash stops, the bloom alpha and
 * --muted-foreground — and recomputes contrast, so the numbers can never drift
 * away from the stylesheet the way a comment would.
 *
 * WHAT IT DOES NOT PROVE: that the resulting grey still reads as "muted"
 * rather than as body text. That is an eye judgement and belongs to the
 * visual pass, not here.
 *
 * Direction of the bloom matters and is why the two themes have different
 * worst cases:
 *   - light bloom is WHITE, so it lightens the surface and RAISES contrast
 *     against dark text → worst case is the darkest stop, bloom ignored.
 *   - dark bloom is --brand, so it lightens the surface and LOWERS contrast
 *     against light text → worst case is the lightest stop at full bloom.
 */
const AA = 4.5;

function blockOf(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in globals.css`);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

function declaration(selector: string, token: string): string {
  const m = blockOf(selector).match(
    new RegExp(`^\\s{2}${token}:\\s*([^;]+);`, "m"),
  );
  if (!m) throw new Error(`${token} not declared in ${selector}`);
  return m[1].trim();
}

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over composite of `fg` at `alpha` onto opaque `bg`. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i])) as RGB;
}

/** Every colour stop of a `linear-gradient(...)` declaration. */
function washStops(selector: string): string[] {
  const stops = declaration(selector, "--app-wash").match(/#[0-9a-f]{6}/gi);
  if (!stops || stops.length < 2) {
    throw new Error(`--app-wash in ${selector} has no parseable stops`);
  }
  return stops;
}

describe("muted text clears WCAG AA on the wash — light", () => {
  const fg = hex(declaration(":root", "--muted-foreground"));

  it.each(washStops(":root"))("clears AA on the %s stop", (stop) => {
    expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
  });

  it("clears AA on the content card and on --surface-muted", () => {
    expect(
      contrast(fg, hex(declaration(":root", "--content-surface"))),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(fg, hex(declaration(":root", "--surface-muted"))),
    ).toBeGreaterThanOrEqual(AA);
  });
});

describe("muted text clears WCAG AA on the wash — dark", () => {
  const fg = hex(declaration(".dark", "--muted-foreground"));
  const brand = hex(declaration(".dark", "--brand"));

  // The declared peak of `color-mix(in oklab, var(--brand) N%, transparent)`.
  const bloomPeak = (() => {
    const m = declaration(".dark", "--app-bloom").match(
      /var\(--brand\)\s+(\d+)%/,
    );
    if (!m) throw new Error("could not read the dark bloom percentage");
    return Number(m[1]) / 100;
  })();

  it.each(washStops(".dark"))("clears AA on the %s stop, unbloomed", (stop) => {
    expect(contrast(fg, hex(stop))).toBeGreaterThanOrEqual(AA);
  });

  it.each(washStops(".dark"))(
    "clears AA on the %s stop under the bloom at its declared peak",
    (stop) => {
      expect(
        contrast(fg, over(brand, bloomPeak, hex(stop))),
      ).toBeGreaterThanOrEqual(AA);
    },
  );

  it("clears AA on the content card", () => {
    expect(
      contrast(fg, hex(declaration(".dark", "--content-surface"))),
    ).toBeGreaterThanOrEqual(AA);
  });
});
