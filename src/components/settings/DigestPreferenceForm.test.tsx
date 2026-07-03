import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setEmailDigestOptOut = vi.fn(async (_input: unknown) => ({
  ok: true,
  data: null,
}));
vi.mock("@/lib/settings/digest-actions", () => ({
  setEmailDigestOptOut: (input: unknown) => setEmailDigestOptOut(input),
}));

import { DigestPreferenceForm } from "@/components/settings/DigestPreferenceForm";

describe("DigestPreferenceForm", () => {
  it("renders checked when subscribed and calls the action on toggle", async () => {
    render(<DigestPreferenceForm initialOptOut={false} />);
    const box = screen.getByRole("checkbox", {
      name: /email me the weekly plan health digest/i,
    }) as HTMLInputElement;
    expect(box.checked).toBe(true);

    fireEvent.click(box);
    await waitFor(() =>
      expect(setEmailDigestOptOut).toHaveBeenCalledWith({ optOut: true }),
    );
    expect(box.checked).toBe(false);
  });

  it("renders unchecked when opted out", () => {
    render(<DigestPreferenceForm initialOptOut={true} />);
    const box = screen.getByRole("checkbox", {
      name: /email me the weekly plan health digest/i,
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
  });
});
