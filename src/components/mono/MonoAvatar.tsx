"use client";

import { useEffect, useMemo, useRef } from "react";
import { subscribeMonoClock } from "./mono-clock";
import { monoPalette } from "./mono-palette";
import { drawMono, type MonoMood } from "./mono-renderer";

const SMALL = 40;
const ALWAYS_ANIMATE: MonoMood[] = ["thinking", "needsyou"];

export function MonoAvatar({
  color,
  mood = "idle",
  size,
  label,
  className,
}: {
  color: string;
  mood?: MonoMood;
  size: number;
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = useMemo(() => monoPalette(color), [color]);
  const height = Math.round(size * 1.06);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let t = 0;
    let blinkAge = 0;
    let nextBlink = 3 + Math.random() * 4;
    let visible = true;
    const render = () => {
      ctx.clearRect(0, 0, size, height);
      drawMono(ctx, size, height, mood, t, blinkAge, palette);
    };
    render();

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const animate =
      !reduced && (size >= SMALL || ALWAYS_ANIMATE.includes(mood));
    if (!animate) return;

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(canvas);
    const unsubscribe = subscribeMonoClock((dt) => {
      if (!visible) return;
      t += dt;
      if (blinkAge > 0) {
        blinkAge += dt;
        if (blinkAge > 0.16) blinkAge = 0;
      } else if ((nextBlink -= dt) <= 0) {
        blinkAge = 0.001;
        nextBlink = 4.5 + Math.random() * 4;
      }
      render();
    });
    return () => {
      unsubscribe();
      io.disconnect();
    };
  }, [mood, palette, size, height]);

  return (
    <span
      role="img"
      aria-label={label}
      data-mood={mood}
      className={className}
      style={{
        display: "inline-block",
        position: "relative",
        width: `${size}px`,
        height: `${height}px`,
        flex: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </span>
  );
}
