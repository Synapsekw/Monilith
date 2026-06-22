import { z } from "zod";

/**
 * Guards the `itemId` that becomes a panel presence focus-target before it is
 * broadcast over the Realtime channel. Item ids are opaque non-empty strings
 * (uuids in practice); we only assert non-empty here to avoid coupling to id
 * format.
 */
export const itemPresenceTargetSchema = z.string().min(1);
