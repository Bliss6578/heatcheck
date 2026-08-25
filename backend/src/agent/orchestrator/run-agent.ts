import { TRPCError } from "@trpc/server";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  autonomousAgentEvents,
  autonomousAgentRuns,
  autonomousAgentToolCalls,
  heatObservations,
  hotspots,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  requireLocationMember,
  requireOperatorRole,
  requireWorkspaceMember,
} from "../../heatcheck/tenant";
import { AGENT_CONFIG } from "../config";
import { GroqAgentLLM } from "../llm/groq-agent";
import { DeterministicPlanner, HybridPlanner } from "../planner";
import { createAgentToolRegistry } from "../tools";
import { executeRegisteredTool } from "../tool-registry";
import type { AgentGoal, HeatAgentState } from "../types";

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "HeatCheck memory is unavailable.",
    });
  return db;
}
function event(
  state: HeatAgentState,
  type: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  state.events.push({
    type,
    message,
    metadata,
    createdAt: new Date().toISOString(),
  });
}
function publicLevel(level?: string) {
  return level === "SEVERE"
    ? "VERY_HIGH"
    : level === "CRITICAL"
      ? "EXTREME"
      : level;
}

export async function runAutonomousAgent(input: {
  userId: number;
  organizationId: string;
  locationId: string;
  goal?: AgentGoal;
  radiusKm?: number;
}) {
  if (!AGENT_CONFIG.enabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The HeatCheck Agent is disabled.",
    });
  const workspace = await requireWorkspaceMember(
    input.userId,
    input.organizationId
  );
  requireOperatorRole(workspace.role);
  const location = await requireLocationMember(
    input.userId,
    input.organizationId,
    input.locationId
  );
  const db = await requireDb();
  const previous = (
    await db
      .select()
      .from(heatObservations)
      .where(eq(heatObservations.locationId, location.id))
      .orderBy(desc(heatObservations.observedAt))
      .limit(1)
  )[0];
  const previousHotspots = previous
    ? await db
        .select()
        .from(hotspots)
        .where(eq(hotspots.observationId, previous.id))
    : [];
  const llm = process.env.GROQ_API_KEY ? new GroqAgentLLM() : null;
  const state: HeatAgentState = {
    runId: nanoid(),
    userId: input.userId,
    organizationId: input.organizationId,
    locationId: location.id,
    goal: input.goal ?? "ANALYZE_LOCATION",
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
    },
    radiusKm: input.radiusKm ?? 1,
    status: "INITIALIZING",
    observations: {},
    hotspots: [],
    previousAnalysis: previous
      ? {
          riskScore: previous.riskScore,
          riskLevel: previous.riskLevel,
          temperature: previous.temperature,
          hotspotCount: previousHotspots.length,
        }
      : undefined,
    events: [],
    toolCalls: [],
    actions: [],
    stepNumber: 0,
    planner: {
      provider: "groq",
      model: AGENT_CONFIG.model,
      available: Boolean(llm),
      fallbackUsed: !llm,
    },
    createdAt: new Date().toISOString(),
  };
  await db.insert(autonomousAgentRuns).values({
    id: state.runId,
    organizationId: input.organizationId,
    userId: input.userId,
    locationId: location.id,
    goal: state.goal,
    status: state.status,
    plannerType: "HYBRID",
    llmProvider: "groq",
    llmModel: AGENT_CONFIG.model,
    fallbackUsed: state.planner.fallbackUsed,
  });
  event(state, "agent.started", "HeatCheck Agent started.");
  event(
    state,
    "memory.loaded",
    previous
      ? "Previous location analysis loaded."
      : "No previous analysis was available."
  );
  const registry = createAgentToolRegistry();
  const planner = new HybridPlanner(new DeterministicPlanner(), llm, registry);
  try {
    state.status = "OBSERVING";
    for (let step = 0; step < AGENT_CONFIG.maxSteps; step += 1) {
      state.stepNumber = step + 1;
      state.status = "PLANNING";
      event(state, "agent.planning", `Planning step ${step + 1}.`);
      const decision = await planner.next(state);
      if (decision.type === "COMPLETE") break;
      state.status = "EXECUTING";
      event(
        state,
        "tool.started",
        `${decision.tool.replaceAll("_", " ")} started.`,
        { tool: decision.tool }
      );
      await executeRegisteredTool(
        registry,
        state,
        decision.tool,
        decision.arguments
      );
    }
    if (!state.risk)
      throw new Error(
        "The agent reached its step limit before calculating risk."
      );
    state.status = "ACTING";
    if (state.risk.score >= 65)
      await executeRegisteredTool(registry, state, "create_heat_alert", {});
    await executeRegisteredTool(registry, state, "create_recommendation", {});
    await executeRegisteredTool(
      registry,
      state,
      "schedule_next_monitoring",
      {}
    );
    state.status = "SAVING";
    event(
      state,
      "memory.saved",
      "Agent run, tools, evidence, and actions saved to long-term memory."
    );
    state.status = "COMPLETED";
    event(
      state,
      "agent.completed",
      `Operational risk completed at ${state.risk.score}/100.`
    );
    const comparison = state.observations.compare_heat_conditions as
      | Record<string, unknown>
      | undefined;
    const response = {
      runId: state.runId,
      status: state.status,
      agent: {
        provider: "groq",
        model: AGENT_CONFIG.model,
        planner: "hybrid",
        available: state.planner.available,
        fallbackUsed: state.planner.fallbackUsed,
      },
      location: state.location,
      risk: {
        score: state.risk.score,
        level: publicLevel(state.risk.level),
        factors: state.risk.factors,
      },
      temperature: state.observations.get_environmental_conditions,
      hotspots: state.hotspots,
      trend: comparison,
      decision: {
        title: `${publicLevel(state.risk.level)} operational heat risk`,
        summary: state.risk.summary,
        actions: state.actions,
      },
      toolCalls: state.toolCalls.map(call => call.tool),
      stepsUsed: state.stepNumber,
      maxSteps: AGENT_CONFIG.maxSteps,
      maxToolCalls: AGENT_CONFIG.maxToolCalls,
      generatedAt: new Date().toISOString(),
    };
    await Promise.all([
      db
        .update(autonomousAgentRuns)
        .set({
          status: state.status,
          fallbackUsed: state.planner.fallbackUsed,
          stepsUsed: state.stepNumber,
          toolCallsUsed: state.toolCalls.length,
          riskScore: state.risk.score,
          riskLevel: state.risk.level,
          result: response,
          completedAt: new Date(),
        })
        .where(eq(autonomousAgentRuns.id, state.runId)),
      state.events.length
        ? db.insert(autonomousAgentEvents).values(
            state.events.map(item => ({
              id: nanoid(),
              runId: state.runId,
              organizationId: input.organizationId,
              type: item.type,
              message: item.message,
              metadata: item.metadata ?? null,
              createdAt: new Date(item.createdAt),
            }))
          )
        : Promise.resolve(),
      state.toolCalls.length
        ? db.insert(autonomousAgentToolCalls).values(
            state.toolCalls.map(call => ({
              id: nanoid(),
              runId: state.runId,
              organizationId: input.organizationId,
              toolName: call.tool,
              status: call.status,
              durationMs: call.durationMs,
              inputJson: call.input,
              outputSummary: call.outputSummary,
              createdAt: new Date(call.createdAt),
            }))
          )
        : Promise.resolve(),
    ]);
    return response;
  } catch (error) {
    state.status = "FAILED";
    event(state, "agent.failed", "HeatCheck Agent did not complete.");
    await db
      .update(autonomousAgentRuns)
      .set({
        status: "FAILED",
        stepsUsed: state.stepNumber,
        toolCallsUsed: state.toolCalls.length,
        fallbackUsed: state.planner.fallbackUsed,
        errorCode: error instanceof TRPCError ? error.code : "AGENT_FAILURE",
        completedAt: new Date(),
      })
      .where(eq(autonomousAgentRuns.id, state.runId));
    throw error instanceof TRPCError
      ? error
      : new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "HeatCheck Agent could not complete this run.",
        });
  }
}

export async function listAutonomousAgentRuns(
  userId: number,
  organizationId: string
) {
  await requireWorkspaceMember(userId, organizationId);
  const db = await requireDb();
  return db
    .select()
    .from(autonomousAgentRuns)
    .where(eq(autonomousAgentRuns.organizationId, organizationId))
    .orderBy(desc(autonomousAgentRuns.createdAt))
    .limit(20);
}
export async function getAutonomousAgentRun(
  userId: number,
  organizationId: string,
  runId: string
) {
  await requireWorkspaceMember(userId, organizationId);
  const db = await requireDb();
  const run = (
    await db
      .select()
      .from(autonomousAgentRuns)
      .where(eq(autonomousAgentRuns.id, runId))
      .limit(1)
  )[0];
  if (!run || run.organizationId !== organizationId)
    throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found." });
  const [events, toolCalls] = await Promise.all([
    db
      .select()
      .from(autonomousAgentEvents)
      .where(eq(autonomousAgentEvents.runId, runId)),
    db
      .select()
      .from(autonomousAgentToolCalls)
      .where(eq(autonomousAgentToolCalls.runId, runId)),
  ]);
  return { run, events, toolCalls };
}
