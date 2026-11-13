import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChip, MonoIdentity } from "./MonoChip";

describe("MonoIdentity", () => {
  it("shows the avatar, name, Agent chip and owner", () => {
    render(<MonoIdentity name="Nova" color="#7395ff" ownerName="Danijel J" />);
    expect(
      screen.getByRole("img", { name: "Nova, Danijel's Mono" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Danijel's Mono")).toBeInTheDocument();
  });

  it("can hide the owner line", () => {
    render(
      <MonoIdentity
        name="Nova"
        color="#7395ff"
        ownerName="Danijel"
        showOwner={false}
      />,
    );
    expect(screen.queryByText("Danijel's Mono")).toBeNull();
  });

  it("renders the bare chip", () => {
    render(<AgentChip />);
    expect(screen.getByText("Agent")).toBeInTheDocument();
  });
});
