import type { AgentLLM, HeatAgentState, PlannerDecision } from "./types";
import type { ToolRegistry } from "./tool-registry";

const required = [
  "get_previous_analysis",
  "get_heatmap",
  "get_environmental_conditions",
  "detect_heat_hotspots",
  "calculate_heat_risk",
  "compare_heat_conditions",
];
export class DeterministicPlanner {
  next(state: HeatAgentState): PlannerDecision {
    const completed = new Set(
      state.toolCalls
        .filter(call => call.status === "COMPLETED")
        .map(call => call.tool)
    );
    const tool = required.find(name => !completed.has(name));
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
      return await this.llm.plan({
        state,
        tools: this.registry.list().map(tool => ({
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
