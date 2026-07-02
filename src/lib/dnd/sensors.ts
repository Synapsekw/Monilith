"use client";

import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/**
 * Shared dnd-kit sensors for every Pulse drag surface (Kanban, Table rows,
 * Gantt bars, dashboard widgets). Replaces the per-component
 * `useSensors(useSensor(PointerSensor, { distance: 6 }))` calls so touch
 * behaviour is configured in exactly one place.
 *
 * - PointerSensor (mouse/trackpad): 6px move before a drag starts (unchanged).
 * - TouchSensor (finger): 200ms long-press "lift" + 8px tolerance, so a quick
 *   swipe scrolls and a deliberate hold drags. See the iPad touch spec.
 */
export function useTouchAwareSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );
}
