// src/components/landing/mono/mono-wisp.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MonoWisp } from "./mono-wisp";

describe("MonoWisp", () => {
  it("renders the named animatable parts", () => {
    const { container } = render(
      <svg>
        <MonoWisp />
      </svg>,
    );
    expect(container.querySelector('[data-part="body"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-part="eye"]')).toHaveLength(2);
    expect(container.querySelector('[data-part="tail"]')).not.toBeNull();
    expect(container.querySelector('[data-part="glow"]')).not.toBeNull();
  });
});
