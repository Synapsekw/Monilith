"use client";

import {
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";

/**
 * Shared dnd-kit sensors for every Pulse drag surface (Kanban, Table rows,
 * Gantt bars, dashboard widgets). Replaces the per-component
 * `useSensors(useSensor(PointerSensor, { distance: 6 }))` calls so the
 * activation constraints and sensor construction live in exactly one place.
 *
 * - PointerSensor (mouse/trackpad): 6px move before a drag starts (unchanged).
 * - TouchSensor (finger): 200ms long-press "lift" + 8px tolerance, so a quick
 *   swipe scrolls and a deliberate hold drags. See the iPad touch spec.
 * - KeyboardSensor: **opt-in, per surface** — see below.
 *
 * ## Why the keyboard sensor is opt-in
 *
 * dnd-kit spreads `attributes` onto every handle, and those attributes announce
 * a space-bar lift to screen readers. Without a `KeyboardSensor` that promise is
 * a lie: Space does nothing. But the COORDINATE STRATEGY that makes the lift
 * real is geometry-specific — a vertical sortable list, a horizontally-dragged
 * Gantt bar, a calendar date cell and a two-axis board table do not move the
 * same way, and `sortableKeyboardCoordinates` is right for some and wrong for
 * others. Enabling it everywhere would trade one accessibility lie ("Space
 * picks it up" → nothing) for a subtler one ("Space picks it up" → arrows move
 * it somewhere wrong).
 *
 * So: this module still owns HOW sensors are built; the caller declares WHICH
 * geometry it has. Today `BoardsNavSortable` is the only caller that opts in.
 * The remaining surfaces are tracked in
 * `vault/decisions/2026-08-27-decision-41-seven-drag-surfaces-announce-a-keyboard-lift-they-do-not-have.md`.
 *
 * `sortableKeyboardCoordinates` is deliberately NOT imported here — it lives in
 * `@dnd-kit/sortable`, and importing it would drag that package into the module
 * graph of all eight eager call sites.
 */
export function useTouchAwareSensors(options?: {
  keyboardCoordinateGetter?: KeyboardCoordinateGetter;
}) {
  const keyboard = options?.keyboardCoordinateGetter;

  const pointer = useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  });
  const touch = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  // Constructed unconditionally: `useSensor` is a hook, so a conditional call
  // would change the hook order between renders. `useSensors` filters nullish
  // entries (verified in @dnd-kit/core@6.3.1, core.cjs.development.js:205-212),
  // so passing `null` is the sanctioned way to leave a sensor out. The
  // conditionality belongs in the argument list, never at the call site.
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: keyboard,
  });

  return useSensors(pointer, touch, keyboard ? keyboardSensor : null);
}
