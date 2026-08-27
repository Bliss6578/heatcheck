import type { RiskAssessment, RiskLevel } from "../heatcheck/types.js";
import type { z } from "zod";

export type AgentGoal =
  | "ANALYZE_LOCATION"
  | "MONITOR_LOCATION"
  | "DETECT_HOTSPOTS"
  | "TRACK_HEAT_CHANGE"
  | "ASSESS_EVENT_HEAT_RISK";
export type AgentStatus =
  | "INITIALIZING"
  | "OBSERVING"
  | "ANALYZING"
  | "PLANNING"
  | "EXECUTING"
  | "ACTING"
  | "SAVING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";
export type ToolRisk = "SAFE" | "CONTROLLED" | "REQUIRES_APPROVAL";
export type PlannerDecision =
  | { type: "TOOL_CALL"; tool: string; arguments: unknown }
  | { type: "COMPLETE"; summary?: string };
export type AgentAction = {
  type:
    | "STORE_ANALYSIS"
    | "CREATE_ALERT"
    | "UPDATE_ALERT"
    | "CREATE_RECOMMENDATION"
    | "MARK_HOTSPOT"
    | "GENERATE_REPORT"
    | "CHANGE_MONITORING_FREQUENCY"
    | "REQUEST_HUMAN_APPROVAL";
  permission: ToolRisk;
  status: "EXECUTED" | "PROPOSED";
  title: string;
  reason: string;
};
export type AgentEvent = {
  type: string;
  message: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};
export type ToolCallRecord = {
  tool: string;
  status: "COMPLETED" | "FAILED";
  durationMs: number;
  input: unknown;
  outputSummary: Record<string, unknown>;
  createdAt: string;
};

export type HeatAgentState = {
  runId: string;
  userId: number;
  organizationId: string;
  locationId: string;
  goal: AgentGoal;
  location: { latitude: number; longitude: number; name?: string };
  radiusKm: number;
  status: AgentStatus;
  observations: Record<string, unknown>;
  risk?: RiskAssessment;
  hotspots: Array<Record<string, unknown>>;
  previousAnalysis?: {
    riskScore: number;
    riskLevel: RiskLevel;
    temperature: number | null;
    hotspotCount: number;
  };
  events: AgentEvent[];
  toolCalls: ToolCallRecord[];
  actions: AgentAction[];
  stepNumber: number;
  planner: {
    provider: "groq";
    model: string;
    available: boolean;
    fallbackUsed: boolean;
  };
  createdAt: string;
  durable: {
    monitoringRunId?: string;
    observationId?: string;
    operationalAgentRunId?: string;
    decisionId?: string;
    incidentId?: string;
    report?: Record<string, unknown>;
  };
};

export type ToolExecutionContext = {
  state: HeatAgentState;
  signal: AbortSignal;
};
export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRisk;
  schema: z.ZodType<I>;
  jsonSchema: Record<string, unknown>;
  maxCalls: number;
  execute(input: I, context: ToolExecutionContext): Promise<O>;
}
export interface AgentLLM {
  plan(input: {
    state: HeatAgentState;
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }): Promise<PlannerDecision>;
  evaluate(input: { state: HeatAgentState }): Promise<{ summary: string }>;
  summarize(input: { state: HeatAgentState }): Promise<string>;
}
