import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function unauthenticatedContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("Heatcheck API access boundaries", () => {
  it("exposes only a non-sensitive health status publicly", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());
    const health = await caller.heatcheck.health();

    expect(health.status).toBe("healthy");
    expect(["SIMULATION", "LIVE_READY"]).toContain(health.mode);
  });

  it("requires authentication before resolving a workspace", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());

    await expect(caller.heatcheck.workspace.current()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("requires authentication before an agent-mode setting can be changed", async () => {
    const caller = appRouter.createCaller(unauthenticatedContext());

    await expect(caller.heatcheck.workspace.updateSettings({
      organizationId: "organization-001",
      agentMode: "AUTONOMOUS",
    })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
