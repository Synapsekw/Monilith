import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useEffect, useState, type ComponentType } from "react";
import { MonolithScene } from "./monolith-scene";

// The LightRays backdrop is a next/dynamic({ ssr: false }) import so the WebGL
// (`ogl`) chunk stays off the landing critical path. Mock next/dynamic to
// resolve the loader in an effect (mirrors BoardViews.test.tsx): here the
// loader maps to LightRays, but we let it stay unresolved (render null) to
// prove the hero paints before the WebGL chunk arrives.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    return function Lazy(props: Record<string, unknown>) {
      const [Comp, setComp] = useState<ComponentType<
        Record<string, unknown>
      > | null>(null);
      useEffect(() => {
        void loader().then((m) =>
          setComp(() => m as ComponentType<Record<string, unknown>>),
        );
      }, []);
      return Comp ? <Comp {...props} /> : null;
    };
  },
}));

// framer-motion needs jsdom shims; mock it to a passthrough motion proxy plus a
// reduced-motion hook so the scene renders deterministically in jsdom.
vi.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({
          children,
          variants: _variants,
          initial: _initial,
          animate: _animate,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => {
          const Tag = tag as keyof React.JSX.IntrinsicElements;
          return <Tag {...rest}>{children}</Tag>;
        },
    },
  );
  return { motion, useReducedMotion: () => false };
});

vi.mock("@/lib/fonts", () => ({ nunito: { className: "font-mock" } }));

describe("MonolithScene", () => {
  it("loads the LightRays backdrop via next/dynamic with ssr:false", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/landing/monolith-scene.tsx"),
      "utf8",
    );
    // The WebGL backdrop must NOT be a static import.
    expect(src).not.toMatch(/^import\s+\{\s*LightRays\s*\}\s+from/m);
    // It must be a next/dynamic loader with ssr disabled.
    expect(src).toContain("dynamic(");
    expect(src).toMatch(/ssr:\s*false/);
  });

  it("renders the hero wordmark and CTA even while the WebGL chunk is unresolved", () => {
    render(
      <MonolithScene>
        <a href="#">Get started</a>
      </MonolithScene>,
    );
    expect(screen.getByText("MONOLITH")).toBeInTheDocument();
    expect(screen.getByText("Get started")).toBeInTheDocument();
  });
});
