import { z } from "zod";
import type { Database } from "@/types/database.types";

export type NotificationKind = Database["public"]["Enums"]["notification_kind"];
export type NotificationChannel =
  Database["public"]["Enums"]["notification_channel"];

/**
 * Event-types a user may toggle for the in-app channel. `feedback_response`
 * is intentionally excluded (always-on: it is a direct reply to the user).
 * `update_on_item` / `automation` are reserved enum values not yet emitted.
 */
export const CONTROLLABLE_IN_APP_KINDS = [
  "mention",
  "assigned",
  "health_digest",
] as const;

export type AppNotificationPrefKind =
  (typeof CONTROLLABLE_IN_APP_KINDS)[number];

export const notificationPrefKindSchema = z.enum(CONTROLLABLE_IN_APP_KINDS);

/** UI copy for each controllable kind (in-app channel). */
export const IN_APP_KIND_LABELS: Record<
  AppNotificationPrefKind,
  { label: string; description: string }
> = {
  mention: {
    label: "Mentions",
    description: "When someone @-mentions you in an update",
  },
  assigned: {
    label: "Assignments",
    description: "When you're assigned to an item",
  },
  health_digest: {
    label: "Weekly digest",
    description: "The weekly plan-health digest, in-app",
  },
};
