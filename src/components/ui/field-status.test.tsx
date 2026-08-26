import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FieldStatus,
  useFieldStatus,
  type FieldTone,
} from "./field-status";

/**
 * The contract every swept call site relies on. Only this suite tests the id
 * wiring exhaustively: the ~40 forms that consume the hook assert their own
 * behavior (that the message appears at all), not that `aria-describedby`
 * resolves — that guarantee lives here, once.
 */
function Field({
  message,
  tone = "error",
  extraDescribedBy,
  className,
  name = "field",
}: {
  message: string | null;
  tone?: FieldTone;
  extraDescribedBy?: string;
  className?: string;
  /** Distinct DOM ids when a test renders more than one field. */
  name?: string;
}) {
  const status = useFieldStatus(message, tone, extraDescribedBy);
  return (
    <div>
      <p id={`${name}-hint`}>Use your work address.</p>
      <label htmlFor={name}>Email</label>
      <input id={name} {...status.controlProps} />
      <FieldStatus field={status} className={className} />
    </div>
  );
}

describe("useFieldStatus / <FieldStatus>", () => {
  it("leaves the control undescribed and valid when there is no message", () => {
    render(<Field message={null} />);
    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("treats an empty string as no message", () => {
    render(<Field message="" />);
    expect(screen.getByLabelText("Email")).not.toHaveAttribute(
      "aria-describedby",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes an error message the control's accessible description", () => {
    render(<Field message="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription("Enter a valid email.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("announces an error message as an alert", () => {
    render(<Field message="Enter a valid email." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email.");
  });

  it("announces a non-error message politely and does not mark the control invalid", () => {
    render(<Field message="Saved." tone="success" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription("Saved.");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives every field on the page its own message id", () => {
    render(
      <div>
        <Field name="one" message="First problem." />
        <Field name="two" message="Second problem." />
      </div>,
    );
    const [first, second] = screen.getAllByLabelText("Email");
    expect(first).toHaveAccessibleDescription("First problem.");
    expect(second).toHaveAccessibleDescription("Second problem.");
    expect(first.getAttribute("aria-describedby")).not.toBe(
      second.getAttribute("aria-describedby"),
    );
  });

  it("keeps a caller-supplied description id alongside the message", () => {
    render(
      <Field message="Enter a valid email." extraDescribedBy="field-hint" />,
    );
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Use your work address. Enter a valid email.",
    );
  });

  it("keeps a caller-supplied description id when there is no message", () => {
    render(<Field message={null} extraDescribedBy="field-hint" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-describedby", "field-hint");
    expect(input).toHaveAccessibleDescription("Use your work address.");
  });

  it("styles an error with the destructive token and a non-error muted", () => {
    const { rerender } = render(<Field message="Nope." />);
    expect(screen.getByRole("alert")).toHaveClass("text-destructive");
    rerender(<Field message="Saved." tone="success" />);
    expect(screen.getByRole("status")).toHaveClass("text-muted-foreground");
  });

  it("lets a caller override the default type scale", () => {
    render(<Field message="Nope." className="text-sm" />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("text-sm");
    expect(alert).not.toHaveClass("text-xs");
  });

  it("exposes messageProps so a bespoke message element can be wired by hand", () => {
    function Bespoke() {
      const status = useFieldStatus("Boom.");
      return (
        <div>
          <label htmlFor="b">Name</label>
          <input id="b" {...status.controlProps} />
          <p {...status.messageProps}>
            <span aria-hidden="true">!</span> {status.message}
          </p>
        </div>
      );
    }
    render(<Bespoke />);
    // The `aria-hidden` decoration is correctly excluded from the description.
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Boom.");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
