import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeaderUserSkeleton } from "./header-user-skeleton";

describe("HeaderUserSkeleton", () => {
  it("reserves a circular avatar-sized placeholder", () => {
    render(<HeaderUserSkeleton />);
    const region = screen.getByRole("status", { name: /loading account/i });
    expect(region).toHaveAttribute("aria-busy", "true");
    const avatar = region.querySelector(".rounded-full");
    expect(avatar).not.toBeNull();
  });
});
