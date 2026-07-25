import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUser,
  updateUser,
  updateUserById,
  signUp,
  signInWithPassword,
  resetPasswordForEmail,
  checkRateLimit,
  redirect,
  serverEnv,
  headerMap,
} = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  updateUserById: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  checkRateLimit: vi.fn(),
  // Real next/navigation redirect() throws to halt execution — mirror that.
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  serverEnv: { value: {} as Record<string, unknown> },
  headerMap: new Map<string, string>(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser,
      updateUser,
      signUp,
      signInWithPassword,
      resetPasswordForEmail,
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ auth: { admin: { updateUserById } } }),
}));
vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => serverEnv.value,
}));
vi.mock("@/lib/rate-limit/auth-rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  throttleResult: () => ({
    error: "Too many attempts. Please try again in about 1 minute.",
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));
vi.mock("next/headers", () => ({ headers: async () => headerMap }));

import {
  changeOwnPassword,
  requestPasswordReset,
  signIn as signInAction,
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
  signInWithPassword
    .mockReset()
    .mockResolvedValue({ data: { session: null }, error: null });
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true });
  redirect.mockClear();
  serverEnv.value = {};
  headerMap.clear();
});

const fd = (password: string, confirmPassword: string = password) => {
  const f = new FormData();
  f.set("password", password);
  f.set("confirmPassword", confirmPassword);
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
  it("rejects when the confirmation does not match", async () => {
    const r = await changeOwnPassword({}, fd("longenough1", "different123"));
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

const loginFd = (email = "u@example.com", password = "pw") => {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
};

describe("rate limiting — throttle short-circuits before Supabase", () => {
  it("signIn returns the throttle error and never calls Supabase", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await signInAction({}, loginFd());
    expect(res.error).toMatch(/too many attempts/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("signUp returns the throttle error and never calls Supabase", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await signUpAction({}, signupFd());
    expect(res.error).toMatch(/too many attempts/i);
    expect(signUp).not.toHaveBeenCalled();
  });

  it("requestPasswordReset throttle error is identical for existent & nonexistent emails (anti-enumeration)", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const a = await requestPasswordReset({}, resetFd("real@example.com"));
    const b = await requestPasswordReset({}, resetFd("nobody@example.com"));
    expect(a).toEqual(b);
    expect(a.error).toMatch(/too many attempts/i);
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("changeOwnPassword returns the throttle error and never updates", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 90 });
    const res = await changeOwnPassword({}, fd("longenough1"));
    expect(res.error).toMatch(/too many attempts/i);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("rate limiting — allowed path preserves existing contracts", () => {
  it("signUp still returns check-email when allowed (duplicate == fresh)", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: {
        code: "user_already_exists",
        message: "User already registered",
      },
    });
    const res = await signUpAction({}, signupFd());
    expect(res).toEqual({ success: "check-email" });
  });

  it("requestPasswordReset still returns reset-email-sent when allowed", async () => {
    const res = await requestPasswordReset({}, resetFd("user@example.com"));
    expect(res).toEqual({ success: "reset-email-sent" });
  });
});

const LF = "\n";

const loginFdWithNext = (next: string) => {
  const f = loginFd();
  f.set("next", next);
  return f;
};

describe("signIn — next handling", () => {
  it("redirects to a safe next", async () => {
    await expect(
      signInAction({}, loginFdWithNext("/boards/b1")),
    ).rejects.toThrow("REDIRECT:/boards/b1");
  });

  it("resumes an OAuth authorize request with its query string", async () => {
    const target = "/api/oauth/authorize?client_id=a&state=b";
    await expect(signInAction({}, loginFdWithNext(target))).rejects.toThrow(
      `REDIRECT:${target}`,
    );
  });

  it("redirects to / when there is no next (unchanged contract)", async () => {
    await expect(signInAction({}, loginFd())).rejects.toThrow("REDIRECT:/");
  });

  it.each([
    ["absolute URL", "https://evil.com"],
    ["protocol-relative", "//evil.com"],
    ["backslash trick", "/\\evil.com"],
    ["control character", "/" + LF + "/evil.com"],
    ["login loop", "/login"],
  ])("refuses a forged next (%s) and falls back to /", async (_label, next) => {
    // The field is client-controlled — the page-level sanitize cannot protect
    // this call path.
    await expect(signInAction({}, loginFdWithNext(next))).rejects.toThrow(
      "REDIRECT:/",
    );
  });

  it("does not redirect at all when the credentials are wrong", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await signInAction({}, loginFdWithNext("/boards/b1"));

    expect(res.error).toBe("Invalid login credentials");
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("signUp — next handling", () => {
  const signupFdWithNext = (next: string) => {
    const f = signupFd();
    f.set("next", next);
    return f;
  };

  it("threads a safe next into emailRedirectTo", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };

    await signUpAction({}, signupFdWithNext("/boards/b1"));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo:
            "https://app.example.com/auth/callback?next=%2Fboards%2Fb1",
        }),
      }),
    );
  });

  it("omits next from emailRedirectTo when it is unsafe", async () => {
    serverEnv.value = { APP_BASE_URL: "https://app.example.com" };

    await signUpAction({}, signupFdWithNext("https://evil.com"));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.example.com/auth/callback",
        }),
      }),
    );
  });

  it("honours next when Supabase returns an immediate session", async () => {
    signUp.mockResolvedValue({
      data: { session: { access_token: "t" } },
      error: null,
    });

    await expect(
      signUpAction({}, signupFdWithNext("/boards/b1")),
    ).rejects.toThrow("REDIRECT:/boards/b1");
  });
});
