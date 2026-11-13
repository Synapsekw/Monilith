import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isOrgAdminCached,
  getOrgAiSettings,
  buildModelOptions,
  getUsageSummary,
} = vi.hoisted(() => ({
  isOrgAdminCached: vi.fn(),
  getOrgAiSettings: vi.fn(),
  buildModelOptions: vi.fn(),
  getUsageSummary: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "o1", name: "Acme" }),
}));
vi.mock("@/lib/org/guard", () => ({
  isOrgAdminCached: (u: string, o: string) => isOrgAdminCached(u, o),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/ai/credentials", () => ({
  listMyAiCredentials: async () => [],
}));
vi.mock("@/lib/ai/providers/provider-rows", () => ({
  listEnabledProviders: async () => [],
  listProviderVerification: async () => [],
}));
vi.mock("@/lib/ai/models/model-options", () => ({
  buildModelOptions: (...a: unknown[]) => buildModelOptions(...a),
}));
vi.mock("@/lib/ai/settings-actions", () => ({
  getOrgAiSettings: () => getOrgAiSettings(),
}));
vi.mock("@/lib/ai/usage-summary", () => ({
  getUsageSummary: (orgId: string) => getUsageSummary(orgId),
}));
vi.mock("@/components/settings/settings-section", () => ({
  SettingsSection: () => null,
}));
vi.mock("@/components/settings/AiKeyList", () => ({ AiKeyList: () => null }));
vi.mock("@/components/settings/ProviderVerificationBadge", () => ({
  ProviderVerificationList: () => null,
}));
vi.mock("@/components/settings/OrgAiSettingsForm", () => ({
  OrgAiSettingsForm: () => null,
}));
vi.mock("@/components/settings/OrgAgentCeiling", () => ({
  OrgAgentCeiling: () => null,
}));
vi.mock("@/components/settings/UsageBreakdown", () => ({
  UsageBreakdown: () => null,
}));

import AiSettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  isOrgAdminCached.mockResolvedValue(true);
  getOrgAiSettings.mockResolvedValue({
    ok: true,
    data: { mode: "per_user", agentCapabilityCeiling: [] },
  });
  buildModelOptions.mockResolvedValue([]);
  getUsageSummary.mockResolvedValue(null);
});

describe("AiSettingsPage — admin-only reads", () => {
  it("issues the usage read while the model catalog is still pending", async () => {
    let releaseCatalog: (v: unknown[]) => void = () => {};
    buildModelOptions.mockReturnValue(
      new Promise((resolve) => {
        releaseCatalog = resolve;
      }),
    );

    const pending = AiSettingsPage();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A serial page never asks for usage until the catalog has answered.
    expect(buildModelOptions).toHaveBeenCalledTimes(1);
    expect(getUsageSummary).toHaveBeenCalledWith("o1");

    releaseCatalog([]);
    await pending;
  });

  it("issues neither read for a non-admin", async () => {
    isOrgAdminCached.mockResolvedValue(false);

    await AiSettingsPage();

    expect(buildModelOptions).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
  });

  it("issues neither read when the org AI settings failed to load", async () => {
    getOrgAiSettings.mockResolvedValue({ ok: false, error: "nope" });

    await AiSettingsPage();

    expect(buildModelOptions).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
  });
});
