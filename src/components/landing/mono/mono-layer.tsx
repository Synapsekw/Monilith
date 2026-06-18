// src/components/landing/mono/mono-layer.tsx
"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { MonoWisp } from "./mono-wisp";
import styles from "./mono-scene.module.css";

/**
 * The animation overlay: a full-bleed SVG carrying the rope path (user units =
 * px, so the scene can feed it a pixel-space `d`) plus a positioned `.mono` div
 * that rides a CSS offsetPath. The `.mono` div is exposed via ref so the scene
 * can set `style.offsetPath` from measured coordinates.
 */
export const MonoLayer = forwardRef<HTMLDivElement>(function MonoLayer(_, ref) {
  return (
    <div className={styles.overlay} aria-hidden>
      <svg className={styles.ropeSvg} preserveAspectRatio="none">
        <motion.path
          className="rope"
          d=""
          fill="none"
          stroke="#bcc4ff"
          strokeWidth={1.5}
          strokeLinecap="round"
          pathLength={1}
        />
      </svg>
      <div ref={ref} className={`mono ${styles.mono}`}>
        <svg width="60" height="74" viewBox="0 0 60 74">
          <MonoWisp />
        </svg>
      </div>
    </div>
  );
});
