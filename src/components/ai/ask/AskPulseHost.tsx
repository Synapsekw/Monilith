"use client";

import dynamic from "next/dynamic";
import { useUIStore } from "@/stores/ui";

// Lazy-load the panel (and its action/SDK imports) only when first opened.
const AskPulse = dynamic(() => import("./AskPulse").then((m) => m.AskPulse), {
  ssr: false,
});

export function AskPulseHost() {
  const askPulseOpen = useUIStore((s) => s.askPulseOpen);
  const setAskPulseOpen = useUIStore((s) => s.setAskPulseOpen);

  return askPulseOpen ? <AskPulse open onOpenChange={setAskPulseOpen} /> : null;
}
