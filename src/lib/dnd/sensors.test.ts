import { renderHook } from "@testing-library/react";
import { KeyboardSensor, PointerSensor, TouchSensor } from "@dnd-kit/core";
import type { KeyboardCoordinateGetter } from "@dnd-kit/core";
import { expect, test } from "vitest";
import { useTouchAwareSensors } from "./sensors";

test("exposes a mouse PointerSensor and a long-press TouchSensor", () => {
  const { result } = renderHook(() => useTouchAwareSensors());
  const sensors = result.current;

  // dnd-kit's generic `SensorOptions` doesn't surface `activationConstraint`
  // (it lives on the per-sensor options type), so read it through a structural
  // view rather than the erased generic.
  type WithConstraint = {
    activationConstraint?: Record<string, number>;
  };
  const pointer = sensors.find((s) => s.sensor === PointerSensor);
  const touch = sensors.find((s) => s.sensor === TouchSensor);

  expect(pointer).toBeDefined();
  expect((pointer?.options as WithConstraint).activationConstraint).toEqual({
    distance: 6,
  });

  expect(touch).toBeDefined();
  // 200ms hold "lifts" the item; an 8px move within that window scrolls instead.
  expect((touch?.options as WithConstraint).activationConstraint).toEqual({
    delay: 200,
    tolerance: 8,
  });
});

test("stays pointer+touch only when no keyboard strategy is supplied", () => {
  const { result } = renderHook(() => useTouchAwareSensors());

  // THIS is the guard that the other eight drag surfaces are unchanged. They
  // all call the hook with no argument, so if this ever returns three sensors
  // the keyboard lift silently went live on Kanban, Gantt, Calendar, BoardTable
  // and ColumnOptionsDialog — geometries `sortableKeyboardCoordinates` does not
  // describe. It passes today and must keep passing; that is the point.
  expect(result.current).toHaveLength(2);
  expect(result.current.some((s) => s.sensor === KeyboardSensor)).toBe(false);
});

test("adds a KeyboardSensor carrying the supplied coordinate getter", () => {
  // A sentinel, not the real getter: the assertion is that the caller's
  // function reaches the sensor untouched, not what that function computes.
  const coordinateGetter = (() => ({
    x: 0,
    y: 0,
  })) as unknown as KeyboardCoordinateGetter;

  const { result } = renderHook(() =>
    useTouchAwareSensors({ keyboardCoordinateGetter: coordinateGetter }),
  );

  expect(result.current).toHaveLength(3);
  const keyboard = result.current.find((s) => s.sensor === KeyboardSensor);
  expect(keyboard).toBeDefined();
  expect(
    (keyboard?.options as { coordinateGetter?: KeyboardCoordinateGetter })
      .coordinateGetter,
  ).toBe(coordinateGetter);
});
