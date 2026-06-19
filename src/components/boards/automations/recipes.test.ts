import { it, expect } from "vitest";
import { recipeStatusChangedWebhook } from "@/components/boards/automations/recipes";

it("builds a status-changed -> webhook draft", () => {
  const d = recipeStatusChangedWebhook(
    "col-1",
    null,
    "https://hooks.example.com/x",
  );
  expect(d).toEqual({
    trigger: { type: "status_changed", columnId: "col-1", toOptionId: null },
    actions: [{ type: "call_webhook", url: "https://hooks.example.com/x" }],
  });
});
