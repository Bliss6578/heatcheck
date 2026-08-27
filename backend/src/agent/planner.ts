import type { AgentLLM, HeatAgentState, PlannerDecision } from "./types.js";
import type { ToolRegistry } from "./tool-registry.js";

const workflows: Record<HeatAgentState["goal"], string[]> = {
  ANALYZE_LOCATION: ["get_previous_analysis", "get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk", "compare_heat_conditions", "get_satellite_environment", "get_street_environment"],
  MONITOR_LOCATION: ["get_previous_analysis", "get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk", "compare_heat_conditions"],
  DETECT_HOTSPOTS: ["get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk"],
  TRACK_HEAT_CHANGE: ["get_previous_analysis", "get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk", "compare_heat_conditions"],
  ASSESS_EVENT_HEAT_RISK: ["get_heatmap", "get_environmental_conditions", "get_satellite_environment", "get_street_environment", "detect_heat_hotspots", "calculate_heat_risk"],
};
export class DeterministicPlanner {
  next(state: HeatAgentState): PlannerDecision {
    const completed = new Set(
      state.toolCalls
        .filter(call => call.status === "COMPLETED")
        .map(call => call.tool)
    );
    const tool = workflows[state.goal].find(name => !completed.has(name));
    if (tool)
      return {
        type: "TOOL_CALL",
        tool,
        arguments: {
          latitude: state.location.latitude,
          longitude: state.location.longitude,
          radiusKm: state.radiusKm,
        },
      };
    return { type: "COMPLETE" };
  }
}

export class HybridPlanner {
  constructor(
    private readonly deterministic: DeterministicPlanner,
    private readonly llm: AgentLLM | null,
    private readonly registry: ToolRegistry
  ) {}
  async next(state: HeatAgentState): Promise<PlannerDecision> {
    const baseline = this.deterministic.next(state);
    if (baseline.type === "TOOL_CALL") return baseline;
    if (!this.llm || state.planner.fallbackUsed) return baseline;
    try {
      const plannerVisible = new Set(["get_location_history", "get_satellite_environment", "get_street_environment"]);
      return await this.llm.plan({
        state,
        tools: this.registry.list().filter(tool => plannerVisible.has(tool.name)).map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.jsonSchema,
        })),
      });
    } catch {
      state.planner.available = false;
      state.planner.fallbackUsed = true;
      state.events.push({
        type: "agent.planner_fallback",
        message: "Groq planner unavailable; deterministic planning continued.",
        createdAt: new Date().toISOString(),
      });
      return baseline;
    }
  }
}
