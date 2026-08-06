import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { OFFLINE_MESSAGE } from "./constants";
import { assertOnline, isOnline } from "./online-status";

describe("assertOnline", () => {
  afterEach(() => onlineManager.setOnline(true));

  it("throws the offline message when offline", () => {
    onlineManager.setOnline(false);
    expect(() => assertOnline()).toThrow(OFFLINE_MESSAGE);
  });

  it("does not throw when online", () => {
    onlineManager.setOnline(true);
    expect(() => assertOnline()).not.toThrow();
  });

  it("isOnline tracks the manager", () => {
    onlineManager.setOnline(false);
    expect(isOnline()).toBe(false);
    onlineManager.setOnline(true);
    expect(isOnline()).toBe(true);
  });
});
