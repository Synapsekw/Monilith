"use client";

import { useEffect, useRef } from "react";

/** This tiny boundary keeps the canvas and Mono out of the first-paint bundle. */
export function AssemblyEffects({ signedIn }: { signedIn: boolean }) {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = marker.current?.closest<HTMLElement>(".assembly-landing");
    if (!root) return;
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const pending = window.setTimeout(() => {
      void import("./assembly-runtime").then(({ mountAssembly }) => {
        if (!disposed) cleanups.push(mountAssembly(root));
      });
      void import("./assembly-mono").then(({ mountMono }) => {
        if (!disposed) cleanups.push(mountMono(root, signedIn));
      });
    }, 0);
    return () => {
      disposed = true;
      window.clearTimeout(pending);
      cleanups.reverse().forEach((dispose) => dispose());
    };
  }, [signedIn]);
  return <span ref={marker} hidden />;
}
