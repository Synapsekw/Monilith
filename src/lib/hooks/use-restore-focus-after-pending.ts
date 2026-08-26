"use client";

import { useEffect, useRef } from "react";

/**
 * Restores focus after a `disabled={pending}` transition drops it to
 * `<body>`. Disabling the element that currently has focus — typically a
 * Save button, disabled synchronously inside its own click handler the
 * instant a transition starts — removes it from the tab order before React
 * (or anything else) can react: the browser has nowhere else to send focus,
 * so it lands on `<body>`, and a keyboard or screen-reader user loses their
 * place on the page. Repo pattern: gotcha matching `ui/timezone-picker.tsx`'s
 * inherited a11y defects (focus dropped to `<body>` after save/clear).
 *
 * This only reclaims focus when it actually landed on `<body>` — if the user
 * tabbed away deliberately while the request was in flight, this must not
 * steal focus back from wherever they went. Attach the returned ref to the
 * element that should reclaim focus once `pending` resolves (usually the
 * same control that disabled itself).
 */
export function useRestoreFocusAfterPending<
  T extends HTMLElement = HTMLButtonElement,
>(pending: boolean) {
  const ref = useRef<T>(null);
  const wasPending = useRef(pending);

  useEffect(() => {
    if (
      wasPending.current &&
      !pending &&
      document.activeElement === document.body
    ) {
      ref.current?.focus();
    }
    wasPending.current = pending;
  }, [pending]);

  return ref;
}
