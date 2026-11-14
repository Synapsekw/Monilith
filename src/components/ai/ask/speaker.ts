import type { ReactNode } from "react";

/** Who answers in a chat. Absent = the org assistant (the default look). The
 *  My Mono tab passes its Mono so the owner can tell the two apart. */
export type ChatSpeaker = {
  name: string;
  /** Decorative: drawn in the turn tile / empty state in place of the Ask mark. */
  mark: ReactNode;
  /** Shown only by the thinking indicator (the live, animated mood). Falls
   *  back to `mark`. */
  thinkingMark?: ReactNode;
  /** The speaker's colour; tints the name. */
  tint?: string;
};
