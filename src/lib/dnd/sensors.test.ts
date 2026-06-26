import { renderHook } from "@testing-library/react";
import { PointerSensor, TouchSensor } from "@dnd-kit/core";
import { expect, test } from "vitest";
import { useTouchAwareSensors } from "./sensors";

test("exposes a mouse PointerSensor and a long-press TouchSensor", () => {
  const { result } = renderHook(() => useTouchAwareSensors());
  const sensors = result.current;

  const pointer = sensors.find((s) => s.sensor === PointerSensor);
  const touch = sensors.find((s) => s.sensor === TouchSensor);

  expect(pointer).toBeDefined();
  expect(pointer?.options.activationConstraint).toEqual({ distance: 6 });

  expect(touch).toBeDefined();
  // 200ms hold "lifts" the item; an 8px move within that window scrolls instead.
  expect(touch?.options.activationConstraint).toEqual({
    delay: 200,
    tolerance: 8,
  });
});
