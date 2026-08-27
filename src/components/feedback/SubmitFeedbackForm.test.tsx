import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SubmitFeedbackForm } from "./SubmitFeedbackForm";

describe("SubmitFeedbackForm", () => {
  it("calls submit with the chosen kind and trimmed text, then fires onDone", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true, data: { id: "f1" } });
    const onDone = vi.fn();
    render(<SubmitFeedbackForm submit={submit} onDone={onDone} />);

    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "Export crashes" },
    });
    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: "Boom" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        kind: "bug",
        title: "Export crashes",
        body: "Boom",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  /**
   * The defect this guards: both fields were placeholder-only — no `<label>`,
   * no `aria-label` — so neither had an accessible NAME at all. A placeholder
   * is not a name (it is not exposed as one, and it vanishes the moment the
   * user types), so a screen reader announced two anonymous "edit text" fields
   * inside the feedback popover with nothing to tell them apart.
   */
  it("gives both fields a real accessible name", () => {
    render(<SubmitFeedbackForm submit={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByLabelText("Title")).toBe(
      screen.getByRole("textbox", { name: "Title" }),
    );
    expect(screen.getByLabelText("Details")).toBe(
      screen.getByRole("textbox", { name: "Details" }),
    );
  });

  it("keeps the placeholder as the visible hint, not the name", () => {
    render(<SubmitFeedbackForm submit={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Title" })).toHaveAttribute(
      "placeholder",
      "Title — briefly describe the issue",
    );
    expect(screen.getByRole("textbox", { name: "Details" })).toHaveAttribute(
      "placeholder",
      "What happened, or what you'd like to see…",
    );
  });

  it("shows the error and does not call onDone when submit fails", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: false, error: "Nope" });
    const onDone = vi.fn();
    render(<SubmitFeedbackForm submit={submit} onDone={onDone} />);
    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByPlaceholderText(/what happened/i), {
      target: { value: "y" },
    });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(screen.getByText("Nope")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
