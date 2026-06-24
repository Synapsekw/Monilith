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
