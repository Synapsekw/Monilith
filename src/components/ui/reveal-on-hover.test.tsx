import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RevealOnHover } from "./reveal-on-hover";
import { useCoarsePointer } from "@/lib/hooks/use-coarse-pointer";

vi.mock("@/lib/hooks/use-coarse-pointer", () => ({
  useCoarsePointer: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useCoarsePointer).mockReset();
});

test("is always visible on a coarse pointer (no hover gating)", () => {
  vi.mocked(useCoarsePointer).mockReturnValue(true);
  render(
    <RevealOnHover>
      <button>Edit</button>
    </RevealOnHover>,
  );
  const wrap = screen.getByText("Edit").parentElement as HTMLElement;
  expect(wrap.className).toContain("opacity-100");
  expect(wrap.className).not.toContain("group-hover");
});

test("is hover-gated on a fine pointer", () => {
  vi.mocked(useCoarsePointer).mockReturnValue(false);
  render(
    <RevealOnHover>
      <button>Edit</button>
    </RevealOnHover>,
  );
  const wrap = screen.getByText("Edit").parentElement as HTMLElement;
  expect(wrap.className).toContain("opacity-0");
  expect(wrap.className).toContain("group-hover:opacity-100");
  // keyboard users still get it
  expect(wrap.className).toContain("focus-within:opacity-100");
});
