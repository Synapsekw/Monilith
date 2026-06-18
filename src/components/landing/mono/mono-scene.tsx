// src/components/landing/mono/mono-scene.tsx
"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  useAnimate,
  useReducedMotion,
  type AnimationSequence,
} from "framer-motion";
import { nunito } from "@/lib/fonts";
import { LightRays } from "@/components/landing/light-rays";
import { MonoLayer } from "./mono-layer";
import { buildSequence } from "./sequence";
import { topCenter, center, ropePath } from "./measure";
import styles from "./mono-scene.module.css";

/**
 * Test-page centerpiece. Renders the hero clone in its FINAL state (so SSR and
 * the first client paint are correct and reduced-motion needs no JS), then —
 * only when motion is allowed — hides the animated bits before paint and plays
 * the mono reveal after the webfont has settled.
 */
export function MonoScene() {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const oRef = useRef<HTMLSpanElement>(null);
  const sourceRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const monoRef = useRef<HTMLDivElement>(null);

  // Hide the animated elements before first paint so we don't flash the final
  // state, then snap them back via the sequence's `[from, to]` keyframes.
  useLayoutEffect(() => {
    if (reduce) return;
    const sub = subtitleRef.current;
    const mono = monoRef.current;
    if (sub) sub.style.opacity = "0";
    if (mono) mono.style.opacity = "0";
  }, [reduce]);

  useEffect(() => {
    if (reduce) return;
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    (async () => {
      await document.fonts?.ready;
      if (cancelled) return;
      requestAnimationFrame(() => {
        if (cancelled || !scope.current) return;
        const stage = scope.current.getBoundingClientRect();
        const o = oRef.current?.getBoundingClientRect();
        const source = sourceRef.current?.getBoundingClientRect();
        const sub = subtitleRef.current?.getBoundingClientRect();
        if (!o || !source || !sub) return;

        const from = topCenter(source, stage);
        const to = topCenter(o, stage);
        const d = ropePath(from, to);
        const climb = center(sub, stage).y - center(o, stage).y;

        const rope = scope.current.querySelector(".rope");
        rope?.setAttribute("d", d);
        if (monoRef.current) monoRef.current.style.offsetPath = `path('${d}')`;

        // buildSequence returns our local MonoSequence shape; framer-motion's
        // AnimationSequence is structurally stricter (no clean overlap), so we
        // assert through `unknown`. Mirrors the repo's existing local-type
        // workaround for framer-motion in monolith-scene.tsx.
        controls = animate(
          buildSequence({
            climbDistance: climb,
          }) as unknown as AnimationSequence,
        );
      });
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [reduce, animate, scope]);

  return (
    <div className={styles.page}>
      <div ref={scope} className={styles.stage}>
        <LightRays className={styles.rays} />
        <span ref={sourceRef} className={styles.source} aria-hidden />
        <span className={styles.vignette} aria-hidden />
        <span className={`${styles.wordmark} ${nunito.className}`}>
          MON<span ref={oRef}>O</span>LITH
        </span>
        <p ref={subtitleRef} className={`subtitle ${styles.subtitle}`}>
          The only work surface you need.
        </p>
        <div className={styles.ctas}>
          <a href="/signup" className={`${styles.cta} ${styles.ctaPrimary}`}>
            Get started
          </a>
          <a href="/login" className={`${styles.cta} ${styles.ctaSecondary}`}>
            Sign in
          </a>
        </div>
        <MonoLayer ref={monoRef} />
      </div>
    </div>
  );
}
