import { describe, expect, it } from "vitest";
import { DeterministicPlanner } from "./planner";
import { evaluateAgentReplay } from "./evaluation";
import type { AgentGoal, HeatAgentState } from "./types";

function state(goal: AgentGoal): HeatAgentState { return { runId: "run", userId: 1, organizationId: "organization", locationId: "location", goal, location: { latitude: 1, longitude: 1 }, radiusKm: 1, status: "PLANNING", observations: {}, hotspots: [], events: [], toolCalls: [], actions: [], stepNumber: 0, planner: { provider: "groq", model: "test", available: false, fallbackUsed: true }, createdAt: new Date().toISOString(), durable: {} }; }
function sequence(goal: AgentGoal) { const planner = new DeterministicPlanner(); const current = state(goal); const tools: string[] = []; for (let index = 0; index < 12; index += 1) { const decision = planner.next(current); if (decision.type === "COMPLETE") break; tools.push(decision.tool); current.toolCalls.push({ tool: decision.tool, status: "COMPLETED", durationMs: 1, input: {}, outputSummary: {}, createdAt: new Date().toISOString() }); } return tools; }

describe("goal-specific agent workflows", () => {
  it("keeps expensive urban context optional for Qwen selection", () => { expect(sequence("ANALYZE_LOCATION")).not.toContain("get_street_environment"); expect(sequence("ANALYZE_LOCATION")).not.toContain("get_satellite_environment"); expect(sequence("MONITOR_LOCATION")).not.toContain("get_street_environment"); });
  it("keeps hotspot detection focused", () => { expect(sequence("DETECT_HOTSPOTS")).toEqual(["get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk"]); });
  it("requires previous memory when tracking change", () => { expect(sequence("TRACK_HEAT_CHANGE")[0]).toBe("get_previous_analysis"); });
});

describe("replay evaluation", () => {
  it("accepts a complete, auditable evidence chain", () => { const tools = sequence("DETECT_HOTSPOTS").map(toolName => ({ toolName, status: "COMPLETED" })); expect(evaluateAgentReplay({ status: "COMPLETED", riskScore: 78, events: [{ type: "agent.completed" }], toolCalls: tools }).passed).toBe(true); });
  it("identifies missing deterministic evidence", () => { const result = evaluateAgentReplay({ status: "COMPLETED", riskScore: 78, events: [{ type: "agent.completed" }], toolCalls: [] }); expect(result.passed).toBe(false); expect(result.missingEvidence).toContain("calculate_heat_risk"); });
});
