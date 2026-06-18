// src/app/landing-test/page.tsx
import { MonoScene } from "@/components/landing/mono/mono-scene";

/**
 * Throwaway experiment route for the "mono" on-load reveal animation. Always
 * dark, no auth derivation — CTAs are static placeholders. See
 * docs/superpowers/specs/2026-06-18-mono-landing-animation-design.md.
 */
export default function LandingTestPage() {
  return <MonoScene />;
}
