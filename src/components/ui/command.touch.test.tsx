import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Command, CommandList, CommandItem } from "./command";

// 44px == min-h-11. We assert the coarse-pointer variant is present in the
// class string (the media query itself only resolves in a real browser),
// mirroring button.touch.test.tsx.

function renderItem() {
  const { container } = render(
    <Command>
      <CommandList>
        <CommandItem>Dashboards</CommandItem>
      </CommandList>
    </Command>,
  );
  const item = container.querySelector('[data-slot="command-item"]');
  expect(item).not.toBeNull();
  return item as HTMLElement;
}

test("command item gets a 44px floor under a coarse pointer", () => {
  expect(renderItem().className).toContain("pointer-coarse:min-h-11");
});

test("command item gets a coarse-pointer padding bump", () => {
  expect(renderItem().className).toContain("pointer-coarse:py-2.5");
});

test("desktop sizing is unchanged (still py-1.5 by default)", () => {
  expect(renderItem().className).toContain("py-1.5");
});
