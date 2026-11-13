import type { ReactNode } from "react";

/** Who answers in a chat. Absent = the org assistant (the default look). The
 *  My Mono tab passes its Mono so the owner can tell the two apart. */
export type ChatSpeaker = {
  name: string;
  /** Decorative: drawn in the turn tile / empty state in place of the Ask mark. */
  mark: ReactNode;
  /** The speaker's colour; tints the name. */
  tint?: string;
};
