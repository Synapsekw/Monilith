// src/components/landing/mono/mono-layer.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// motion.path -> plain <path>; keep the className so queries work.
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (props: any) => {
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...props} />;
        },
    },
  ),
}));

import { MonoLayer } from "./mono-layer";

describe("MonoLayer", () => {
  it("renders the rope path and the mono character", () => {
    const { container } = render(<MonoLayer />);
    expect(container.querySelector(".rope")).not.toBeNull();
    expect(container.querySelector(".mono")).not.toBeNull();
    expect(container.querySelector('[data-part="body"]')).not.toBeNull();
  });
});
