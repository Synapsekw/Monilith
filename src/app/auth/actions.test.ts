import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, updateUser, updateUserById, redirect } = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  updateUserById: vi.fn(),
  // Real next/navigation redirect() throws to halt execution — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, updateUser } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { updateUserById } } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));

import { changeOwnPassword } from "./actions";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: "u1", app_metadata: { y: 2 } } },
  });
  updateUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ error: null });
  redirect.mockClear();
});

const fd = (password: string) => {
  const f = new FormData();
  f.set("password", password);
  return f;
};

describe("changeOwnPassword", () => {
  it("rejects a too-short password", async () => {
    const r = await changeOwnPassword({}, fd("short"));
    expect(r.error).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("updates the password, clears the flag, and redirects home", async () => {
    await expect(changeOwnPassword({}, fd("longenough1"))).rejects.toThrow(
      "REDIRECT:/",
    );
    expect(updateUser).toHaveBeenCalledWith({ password: "longenough1" });
    expect(updateUserById).toHaveBeenCalledWith("u1", {
      app_metadata: { y: 2, must_change_password: false },
    });
  });
});
