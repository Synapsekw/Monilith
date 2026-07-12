"use client";

import { memo } from "react";
import { BoardTableInner } from "./table/BoardTableInner";

// Public component: a memo wrapper over the implementation, which now lives in
// ./table/ (split from this once-2,800-line file; this module stays the stable
// public entry point). The memo rationale is documented above BoardTableInner.
export const BoardTable = memo(BoardTableInner);
