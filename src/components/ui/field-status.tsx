"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * How a field's message should be treated by assistive tech — NOT how it looks.
 * `error` marks the control invalid and interrupts (`role="alert"`); everything
 * else is a polite `role="status"` that leaves validity alone.
 */
export type FieldTone = "error" | "success" | "info";

export type FieldStatusState = {
  /** The message, normalized: `null` whenever there is nothing to announce. */
  message: string | null;
  tone: FieldTone;
  /**
   * Spread onto the `<Input>` / `<Textarea>` / combobox trigger the message
   * belongs to. This is the whole point of the hook: the message becomes the
   * control's accessible DESCRIPTION, so a screen reader reads it as part of
   * the field instead of leaving it as orphaned text somewhere on the page.
   */
  controlProps: {
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  };
  /**
   * Spread onto a bespoke message element when `<FieldStatus>`'s single `<p>`
   * doesn't fit (an icon + text row, a tinted banner, extra trailing copy).
   * Carries the id `controlProps` points at plus the right live-region role.
   */
  messageProps: {
    id: string;
    role: "alert" | "status";
  };
};

/**
 * Ties a field's error/status text to the control it belongs to.
 *
 * The defect this exists to stop: a form renders `{error && <p
 * className="text-destructive">{error}</p>}` next to an `<Input>` and nothing
 * connects the two. Sighted users see the pairing from proximity; a screen
 * reader user tabbing to the field hears "Email, edit text" and no reason the
 * submit failed. Wiring it by hand needs a `useId`, a conditional
 * `aria-describedby`, an `aria-invalid` and a live-region role at EVERY call
 * site — four chances to get it wrong, ~40 times over. So it is one hook.
 *
 * Mirrors the naming/description split that `ui/timezone-picker.tsx` and
 * `settings/ModelPicker.tsx` established: the field's static label stays the
 * accessible NAME, and everything situational (current value there, current
 * error here) is exposed as the DESCRIPTION.
 *
 * @param message  The text to announce, or null/"" for none.
 * @param tone     `error` (default) marks the control invalid and announces
 *                 assertively; `success`/`info` announce politely.
 * @param extraDescribedBy  Id of existing description text (a hint line) that
 *                 must stay in the accessible description alongside the
 *                 message — pass it here rather than re-wiring by hand.
 */
export function useFieldStatus(
  message: string | null | undefined,
  tone: FieldTone = "error",
  extraDescribedBy?: string,
): FieldStatusState {
  const id = useId();
  const text = message ? message : null;
  const describedBy =
    [extraDescribedBy, text ? id : null].filter(Boolean).join(" ") || undefined;

  return {
    message: text,
    tone,
    controlProps: {
      "aria-describedby": describedBy,
      "aria-invalid": text && tone === "error" ? true : undefined,
    },
    messageProps: { id, role: tone === "error" ? "alert" : "status" },
  };
}

/**
 * The message element for a `useFieldStatus` field. Renders nothing when there
 * is no message, so it can sit unconditionally in the JSX.
 *
 * Styling is the repo's existing inline-message recipe (`text-xs`, destructive
 * for errors, muted otherwise); `className` overrides through `twMerge` for the
 * call sites that use `text-sm`.
 */
export function FieldStatus({
  field,
  className,
}: {
  field: FieldStatusState;
  className?: string;
}) {
  if (!field.message) return null;
  return (
    <p
      {...field.messageProps}
      className={cn(
        "text-xs",
        field.tone === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {field.message}
    </p>
  );
}
