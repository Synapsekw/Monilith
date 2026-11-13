import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MonoNameColorForm } from "./MonoNameColorForm";

describe("MonoNameColorForm", () => {
  it("offers seven presets and submits the trimmed name and chosen colour", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => null);
    render(
      <MonoNameColorForm submitLabel="Create my Mono" onSubmit={onSubmit} />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    await user.type(screen.getByLabelText("Name"), "  Nova ");
    await user.click(screen.getByRole("radio", { name: "Mint" }));
    await user.click(screen.getByRole("button", { name: "Create my Mono" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Nova", color: "#3fe0a5" });
  });

  it("keeps submit disabled without a name", () => {
    render(
      <MonoNameColorForm submitLabel="Create my Mono" onSubmit={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Create my Mono" }),
    ).toBeDisabled();
  });

  it("shows the error the submit returns", async () => {
    const user = userEvent.setup();
    render(
      <MonoNameColorForm
        initialName="Nova"
        submitLabel="Save"
        onSubmit={async () => "That did not work."}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That did not work.",
    );
  });
});
