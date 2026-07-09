import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser,
  updateUser,
  updateUserById,
  signUp,
  resetPasswordForEmail,
  redirect,
  serverEnv,
  headerMap,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  updateUserById: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  // Real next/navigation redirect() throws to halt execution — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  serverEnv: { value: {} as Record<string, unknown> },
  headerMap: new Map<string, string>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser, updateUser, signUp, resetPasswordForEmail },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { updateUserById } } }),
}));
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => serverEnv.value,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({ headers: async () => headerMap }));

import {
  changeOwnPassword,
  requestPasswordReset,
  signUp as signUpAction,
} from "./actions";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({
    data: { user: { id: "u1", app_metadata: { y: 2 } } },
  });
  updateUser.mockReset().mockResolvedValue({ error: null });
  updateUserById.mockReset().mockResolvedValue({ error: null });
  signUp
    .mockReset()
    .mockResolvedValue({ data: { session: null }, error: null });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  redirect.mockClear();
  serverEnv.value = {};
  headerMap.clear();
});

const fd = (password: string) => {
  const f = new FormData();
  f.set("password", password);
  return f;
};

const signupFd = () => {
  const f = new FormData();
  f.set("email", "new@example.com");
  f.set("password", "longenough1");
  f.set("orgName", "Acme");
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

describe("signUp — email enumeration hardening", () => {
  it("does NOT confirm existence on 'User already registered'", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: {
        code: "user_already_exists",
        message: "User already registered",
      },
    });
    const res = await signUpAction({}, signupFd());
    // Indistinguishable from a fresh signup — no error revealing the account.
    expect(res).toEqual({ success: "check-email" });
    expect(res.error).toBeUndefined();
  });

  it("still surfaces an actionable weak-password error", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: { code: "weak_password", message: "Password is too weak" },
    });
    const res = await signUpAction({}, signupFd());
    expect(res).toEqual({ error: "Password is too weak" });
  });

  it("returns check-email on a clean signup awaiting confirmation", async () => {
    const res = await signUpAction({}, signupFd());
    expect(res).toEqual({ success: "check-email" });
  });
});

const resetFd = (email: string) => {
  const f = new FormData();
  f.set("email", email);
  return f;
};

describe("requestPasswordReset", () => {
  it("rejects an invalid email without calling Supabase", async () => {
    const res = await requestPasswordReset({}, resetFd("not-an-email"));
    expect(res.error).toBeTruthy();
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends the reset email with a redirectTo landing on change-password", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };
    const res = await requestPasswordReset({}, resetFd("user@example.com"));
    expect(res).toEqual({ success: "reset-email-sent" });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo:
        "https://app.example.com/auth/callback?next=%2Fchange-password%3Frecovery%3D1",
    });
  });

  it("prefers APP_BASE_URL over poisoned request headers", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };
    headerMap.set("origin", "https://evil.example");
    headerMap.set("host", "evil.example");
    await requestPasswordReset({}, resetFd("user@example.com"));
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({
        redirectTo:
          "https://app.example.com/auth/callback?next=%2Fchange-password%3Frecovery%3D1",
      }),
    );
  });

  it("falls back to request headers when APP_BASE_URL is unset", async () => {
    serverEnv.value = {};
    headerMap.set("origin", "http://localhost:3000");
    await requestPasswordReset({}, resetFd("user@example.com"));
    expect(resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({
        redirectTo:
          "http://localhost:3000/auth/callback?next=%2Fchange-password%3Frecovery%3D1",
      }),
    );
  });

  it("does NOT reveal whether the account exists on a Supabase error (anti-enumeration)", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: { code: "user_not_found", message: "User not found" },
    });
    const res = await requestPasswordReset({}, resetFd("nobody@example.com"));
    // Indistinguishable from the account-exists outcome.
    expect(res).toEqual({ success: "reset-email-sent" });
    expect(res.error).toBeUndefined();
  });

  it("does NOT reveal rate-limit errors either", async () => {
    resetPasswordForEmail.mockResolvedValue({
      error: {
        code: "over_email_send_rate_limit",
        message: "Email rate limit exceeded",
      },
    });
    const res = await requestPasswordReset({}, resetFd("user@example.com"));
    expect(res).toEqual({ success: "reset-email-sent" });
  });
});

describe("signUp — emailRedirectTo host trust", () => {
  it("prefers APP_BASE_URL over request headers (ignores a poisoned Origin)", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };
    headerMap.set("origin", "https://evil.example");
    headerMap.set("host", "evil.example");
    await signUpAction({}, signupFd());
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example.com/auth/callback",
        }),
      }),
    );
  });

  it("falls back to request headers when APP_BASE_URL is unset", async () => {
    serverEnv.value = {};
    headerMap.set("origin", "http://localhost:3000");
    await signUpAction({}, signupFd());
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "http://localhost:3000/auth/callback",
        }),
      }),
    );
  });
});
