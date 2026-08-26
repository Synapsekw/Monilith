import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { useRestoreFocusAfterPending } from "./use-restore-focus-after-pending";

/**
 * Mirrors the real call sites (personal-timezone-form.tsx, timezone-form.tsx,
 * AgentEditor.tsx): a button disables itself the instant `pending` flips
 * true, synchronously in its own click handler — the sequence that drops
 * focus to `<body>` in a real browser (disabling the focused element removes
 * it from the tab order and there is nowhere else to send focus). jsdom does
 * NOT reproduce that auto-blur — `element.disabled = true` alone leaves
 * `document.activeElement` unchanged, a known jsdom gap versus real browser
 * behavior — so the click handler below calls `.blur()` explicitly to drive
 * the same end state a browser reaches on its own. That keeps this test
 * focused on the hook's own restore logic rather than also asserting jsdom
 * behavior it doesn't have; the drop itself is exercised for real in Chromium
 * via this repo's Playwright e2e harness for anything that needs the real
 * browser behavior.
 */
function SaveButton() {
  const [pending, setPending] = useState(false);
  const ref = useRestoreFocusAfterPending<HTMLButtonElement>(pending);
  return createElement(
    "button",
    {
      ref,
      disabled: pending,
      onClick: (e: { currentTarget: HTMLButtonElement }) => {
        setPending(true);
        e.currentTarget.blur();
        // Simulate the async work completing on the next tick.
        setTimeout(() => setPending(false), 0);
      },
    },
    pending ? "Saving…" : "Save",
  );
}

describe("useRestoreFocusAfterPending", () => {
  it("returns focus to the control once pending resolves after a body drop", async () => {
    render(createElement(SaveButton));
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    expect(button).toHaveFocus();

    button.click();
    // Disabling the focused button synchronously drops focus to <body>.
    expect(document.body).toHaveFocus();

    await waitFor(() => expect(button).toHaveFocus());
  });

  it("does not steal focus if the user moved away deliberately while pending", async () => {
    render(
      createElement(
        "div",
        null,
        createElement(SaveButton),
        createElement("input", { "aria-label": "Elsewhere" }),
      ),
    );
    const button = screen.getByRole("button", { name: "Save" });
    button.focus();
    button.click();
    expect(document.body).toHaveFocus();

    const elsewhere = screen.getByLabelText("Elsewhere");
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();

    await new Promise((r) => setTimeout(r, 10));
    expect(elsewhere).toHaveFocus();
  });
});
