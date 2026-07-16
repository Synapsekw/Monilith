import { beforeAll, describe, expect, it } from "vitest";
import {
  integrationTargetReady,
  loadIntegrationEnv,
} from "@/test/integration-env";

describe.skipIf(!integrationTargetReady())("reports actions", () => {
  beforeAll(() => loadIntegrationEnv());

  it("createReport rejects a caller without board edit access", async () => {
    const { createReport } = await import("@/lib/reports/actions");
    const res = await createReport({
      boardId: "00000000-0000-0000-0000-000000000000",
      name: "Nope",
    });
    expect(res.ok).toBe(false);
  });
});
