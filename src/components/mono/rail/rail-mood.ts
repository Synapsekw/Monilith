import type { MonoBrain } from "@/lib/monos/types";
import type { MonoMood } from "../mono-renderer";

/** The rail's mood for the owner's Mono in 2A (spec §8 moods as states). */
export function railMood(s: {
  brain: MonoBrain;
  busy: boolean;
  justCreated: boolean;
}): MonoMood {
  if (s.brain === "none") return "dozing";
  if (s.busy) return "thinking";
  if (s.justCreated) return "hello";
  return "idle";
}
