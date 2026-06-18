"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Full-bleed topographic backdrop: dimmed contour lines over a slowly drifting
 * height field, with a hill that rises toward the cursor. Marching-squares over
 * a coarse grid, drawn to a canvas. Self-contained client component — owns its
 * pointer tracking, animation frame and resize handling, all torn down on
 * unmount. Under prefers-reduced-motion it paints one static frame (no loop, no
 * pointer listener). In SSR / jsdom (no 2D context) it no-ops safely.
 */
export function TopographyCanvas() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / unsupported

    const COLS = 92;
    const ROWS = 58;
    const LEVELS = 16;
    // Cursor hill starts off-centre so the effect reads before the first move.
    const mouse = { x: window.innerWidth * 0.66, y: window.innerHeight * 0.4 };
    let dpr = 1;
    let raf = 0;
    let start = 0;

    function resize() {
      if (!canvas || !ctx) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function field(i: number, j: number, t: number, mx: number, my: number) {
      const x = i / COLS;
      const y = j / ROWS;
      let h =
        Math.sin(x * 6.0 + t * 0.00018) * 0.6 +
        Math.cos(y * 5.0 - t * 0.00013) * 0.6 +
        Math.sin((x + y) * 4.2 + t * 0.0001) * 0.35;
      const dx = i - mx;
      const dy = j - my;
      const sigma = 10.5;
      h += 3.0 * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      return h;
    }

    function paint(t: number) {
      if (!ctx) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const cw = w / COLS;
      const ch = h / ROWS;
      const mx = (mouse.x / w) * COLS;
      const my = (mouse.y / h) * ROWS;

      const f: number[][] = [];
      for (let j = 0; j <= ROWS; j++) {
        f[j] = [];
        for (let i = 0; i <= COLS; i++) f[j][i] = field(i, j, t, mx, my);
      }

      for (let l = 0; l < LEVELS; l++) {
        const iso = -1.7 + l * (4.6 / LEVELS);
        ctx.beginPath();
        for (let j = 0; j < ROWS; j++) {
          for (let i = 0; i < COLS; i++) {
            const a = f[j][i];
            const b = f[j][i + 1];
            const c = f[j + 1][i + 1];
            const d = f[j + 1][i];
            let idx = 0;
            if (a > iso) idx |= 8;
            if (b > iso) idx |= 4;
            if (c > iso) idx |= 2;
            if (d > iso) idx |= 1;
            if (idx === 0 || idx === 15) continue;
            const x0 = i * cw;
            const y0 = j * ch;
            const ip = (va: number, vb: number) => (iso - va) / (vb - va);
            const top: [number, number] = [x0 + ip(a, b) * cw, y0];
            const right: [number, number] = [x0 + cw, y0 + ip(b, c) * ch];
            const bot: [number, number] = [x0 + ip(d, c) * cw, y0 + ch];
            const left: [number, number] = [x0, y0 + ip(a, d) * ch];
            const seg = (p: [number, number], q: [number, number]) => {
              ctx.moveTo(p[0], p[1]);
              ctx.lineTo(q[0], q[1]);
            };
            switch (idx) {
              case 1:
              case 14:
                seg(left, bot);
                break;
              case 2:
              case 13:
                seg(bot, right);
                break;
              case 3:
              case 12:
                seg(left, right);
                break;
              case 4:
              case 11:
                seg(top, right);
                break;
              case 5:
                seg(left, top);
                seg(bot, right);
                break;
              case 6:
              case 9:
                seg(top, bot);
                break;
              case 7:
              case 8:
                seg(left, top);
                break;
              case 10:
                seg(left, bot);
                seg(top, right);
                break;
            }
          }
        }
        ctx.strokeStyle = `rgba(150,165,228,${0.05 + 0.13 * (l / LEVELS)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function frame(ts: number) {
      if (!start) start = ts;
      paint(ts - start);
      raf = window.requestAnimationFrame(frame);
    }

    function onMove(e: PointerEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }

    resize();
    window.addEventListener("resize", resize);

    if (reduce) {
      // Static field, no cursor hill, no loop.
      mouse.x = -9999;
      mouse.y = -9999;
      paint(0);
      return () => window.removeEventListener("resize", resize);
    }

    window.addEventListener("pointermove", onMove);
    raf = window.requestAnimationFrame(frame);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [reduce]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 z-0" />;
}
