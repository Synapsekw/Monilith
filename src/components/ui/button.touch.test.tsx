import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./button";

// 44px == size-11 / h-11. We assert the coarse-pointer variant is present in
// the class string (the media query itself only resolves in a real browser).
test("icon button gets a 44px target under a coarse pointer", () => {
  render(
    <Button size="icon" aria-label="More">
      <span />
    </Button>,
  );
  expect(screen.getByRole("button", { name: "More" }).className).toContain(
    "pointer-coarse:size-11",
  );
});

test("default button gets a 44px height under a coarse pointer", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" }).className).toContain(
    "pointer-coarse:h-11",
  );
});

test("desktop sizing is unchanged (still h-8 by default)", () => {
  render(<Button>Save</Button>);
  expect(screen.getByRole("button", { name: "Save" }).className).toContain(
    "h-8",
  );
});
