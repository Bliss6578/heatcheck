import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canExecuteAction,
  permissionForAgentAction,
} from "./actions/permissions";
import { DeterministicPlanner } from "./planner";
import { executeRegisteredTool, ToolRegistry } from "./tool-registry";
import type { HeatAgentState } from "./types";

function state(): HeatAgentState {
  return {
    runId: "run-1",
    userId: 1,
    organizationId: "org-0001",
    locationId: "loc-0001",
    goal: "ANALYZE_LOCATION",
    location: { latitude: 40.7128, longitude: -74.006 },
    radiusKm: 1,
    status: "INITIALIZING",
    observations: {},
    hotspots: [],
    events: [],
    toolCalls: [],
    actions: [],
    stepNumber: 0,
    planner: {
      provider: "groq",
      model: "qwen/qwen3.6-27b",
      available: false,
      fallbackUsed: true,
    },
    createdAt: new Date().toISOString(),
  };
}

describe("HeatCheck agent core", () => {
  it("allowlists registered tools and rejects arbitrary names", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "safe_tool",
      description: "Safe test",
      riskLevel: "SAFE",
      schema: z.object({ value: z.number() }),
      jsonSchema: {},
      maxCalls: 1,
      execute: async input => input,
    });
    await expect(
      executeRegisteredTool(registry, state(), "unknown_tool", {})
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("validates model-provided tool arguments", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "safe_tool",
      description: "Safe test",
      riskLevel: "SAFE",
      schema: z.object({ value: z.number() }),
      jsonSchema: {},
      maxCalls: 1,
      execute: async input => input,
    });
    await expect(
      executeRegisteredTool(registry, state(), "safe_tool", {
        value: "not-a-number",
      })
    ).rejects.toBeInstanceOf(z.ZodError);
  });
  it("enforces per-tool budgets", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "safe_tool",
      description: "Safe test",
      riskLevel: "SAFE",
      schema: z.object({}),
      jsonSchema: {},
      maxCalls: 1,
      execute: async () => ({ ok: true }),
    });
    const current = state();
    await executeRegisteredTool(registry, current, "safe_tool", {});
    await expect(
      executeRegisteredTool(registry, current, "safe_tool", {})
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("keeps human-approval actions proposed", () => {
    expect(permissionForAgentAction("REQUEST_HUMAN_APPROVAL")).toBe(
      "REQUIRES_APPROVAL"
    );
    expect(canExecuteAction("REQUEST_HUMAN_APPROVAL")).toBe(false);
    expect(canExecuteAction("CREATE_ALERT")).toBe(true);
  });
  it("starts deterministic fallback with memory and required sensor tools", () => {
    const planner = new DeterministicPlanner();
    expect(planner.next(state())).toMatchObject({
      type: "TOOL_CALL",
      tool: "get_previous_analysis",
    });
  });
});
