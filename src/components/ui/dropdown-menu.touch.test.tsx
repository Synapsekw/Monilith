import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
} from "./dropdown-menu";

// 44px == min-h-11. We assert the coarse-pointer variant token is present in
// the rendered row's class string (the media query itself only resolves in a
// real browser), mirroring button.touch.test.tsx. Each interactive row type
// is rendered inside the minimal Radix wrappers it requires, with the menu
// forced open so the portalled content mounts.

function renderItem(child: React.ReactNode) {
  const { baseElement } = render(
    <DropdownMenu open>
      <DropdownMenuContent>{child}</DropdownMenuContent>
    </DropdownMenu>,
  );
  return baseElement;
}

test("dropdown menu item gets a 44px floor + padding bump under a coarse pointer", () => {
  const el = renderItem(<DropdownMenuItem>Edit</DropdownMenuItem>);
  const row = el.querySelector('[data-slot="dropdown-menu-item"]')!;
  expect(row.className).toContain("pointer-coarse:min-h-11");
  expect(row.className).toContain("pointer-coarse:py-2.5");
  // desktop unchanged
  expect(row.className).toContain("py-1");
});

test("dropdown checkbox item gets coarse sizing and keeps its indicator", () => {
  const el = renderItem(
    <DropdownMenuCheckboxItem checked>Show done</DropdownMenuCheckboxItem>,
  );
  const row = el.querySelector('[data-slot="dropdown-menu-checkbox-item"]')!;
  expect(row.className).toContain("pointer-coarse:min-h-11");
  expect(row.className).toContain("pointer-coarse:py-2.5");
  expect(row.className).toContain("py-1");
  expect(
    el.querySelector('[data-slot="dropdown-menu-checkbox-item-indicator"]'),
  ).not.toBeNull();
});

test("dropdown radio item gets coarse sizing and keeps its indicator", () => {
  const el = renderItem(
    <DropdownMenuRadioGroup value="a">
      <DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>,
  );
  const row = el.querySelector('[data-slot="dropdown-menu-radio-item"]')!;
  expect(row.className).toContain("pointer-coarse:min-h-11");
  expect(row.className).toContain("pointer-coarse:py-2.5");
  expect(row.className).toContain("py-1");
  expect(
    el.querySelector('[data-slot="dropdown-menu-radio-item-indicator"]'),
  ).not.toBeNull();
});

test("dropdown sub-trigger gets coarse sizing under a coarse pointer", () => {
  const el = renderItem(
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
    </DropdownMenuSub>,
  );
  const row = el.querySelector('[data-slot="dropdown-menu-sub-trigger"]')!;
  expect(row.className).toContain("pointer-coarse:min-h-11");
  expect(row.className).toContain("pointer-coarse:py-2.5");
  expect(row.className).toContain("py-1");
});
