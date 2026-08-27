import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  autonomousAgentEvents,
  autonomousAgentRuns,
  autonomousAgentToolCalls,
  heatObservations,
  hotspots,
} from "../../../drizzle/schema.js";
import { getDb } from "../../db.js";
import {
  requireLocationMember,
  requireOperatorRole,
  requireWorkspaceMember,
} from "../../heatcheck/tenant.js";
import { AGENT_CONFIG } from "../config.js";
import { GroqAgentLLM } from "../llm/groq-agent.js";
import { DeterministicPlanner, HybridPlanner } from "../planner.js";
import { createAgentToolRegistry } from "../tools/index.js";
import { executeRegisteredTool } from "../tool-registry.js";
import type { AgentGoal, HeatAgentState } from "../types.js";

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "HeatCheck memory is unavailable.",
    });
  return db;
}
async function event(
  state: HeatAgentState,
  type: string,
  message: string,
  metadata?: Record<string, unknown>,
  onEvent?: (event: HeatAgentState["events"][number]) => void
) {
  const item = {
    type,
    message,
    metadata,
    createdAt: new Date().toISOString(),
  };
  state.events.push(item);
  onEvent?.(item);
  const sequence = state.events.length;
  const db = await getDb();
  if (db) await db.insert(autonomousAgentEvents).values({ id: nanoid(), runId: state.runId, organizationId: state.organizationId, type: item.type, message: item.message, metadata: item.metadata ?? null, createdAt: new Date(item.createdAt), sequence });
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
  onEvent?: (event: HeatAgentState["events"][number]) => void;
  runId?: string;
  idempotencyKey?: string;
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
  if (input.idempotencyKey) {
    const prior = (await db.select().from(autonomousAgentRuns).where(and(eq(autonomousAgentRuns.organizationId, input.organizationId), eq(autonomousAgentRuns.idempotencyKey, input.idempotencyKey))).limit(1))[0];
    if (prior?.result) return prior.result;
    if (prior && prior.status !== "FAILED" && prior.status !== "CANCELLED") throw new TRPCError({ code: "CONFLICT", message: "An equivalent agent run is already active." });
  }
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
    runId: input.runId ?? nanoid(),
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
    durable: {},
  };
  if (!input.runId) await db.insert(autonomousAgentRuns).values({
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
    idempotencyKey: input.idempotencyKey ?? null,
    lastHeartbeatAt: new Date(),
  });
  else await db.update(autonomousAgentRuns).set({ status: "INITIALIZING", cancelRequested: false, lastHeartbeatAt: new Date() }).where(eq(autonomousAgentRuns.id, state.runId));
  await event(state, "agent.started", "HeatCheck Agent started.", { runId: state.runId, goal: state.goal }, input.onEvent);
  await event(
    state,
    "memory.loaded",
    previous
      ? "Previous location analysis loaded."
      : "No previous analysis was available.",
    undefined,
    input.onEvent
  );
  const registry = createAgentToolRegistry();
  const planner = new HybridPlanner(new DeterministicPlanner(), llm, registry);
  let persistedToolCalls = 0;
  const persistToolCalls = async () => {
    const pending = state.toolCalls.slice(persistedToolCalls);
    if (pending.length) await db.insert(autonomousAgentToolCalls).values(pending.map(call => ({ id: nanoid(), runId: state.runId, organizationId: input.organizationId, toolName: call.tool, status: call.status, durationMs: call.durationMs, inputJson: call.input, outputSummary: call.outputSummary, createdAt: new Date(call.createdAt) })));
    persistedToolCalls = state.toolCalls.length;
  };
  const execute = async (name: string, args: unknown) => {
    const current = (await db.select({ cancelRequested: autonomousAgentRuns.cancelRequested }).from(autonomousAgentRuns).where(eq(autonomousAgentRuns.id, state.runId)).limit(1))[0];
    if (current?.cancelRequested) { state.status = "CANCELLED"; throw new TRPCError({ code: "CLIENT_CLOSED_REQUEST", message: "Agent run cancelled." }); }
    const beforeEvents = state.events.length;
    try { return await executeRegisteredTool(registry, state, name, args); }
    finally {
      const directEvents = state.events.slice(beforeEvents);
      if (directEvents.length) await db.insert(autonomousAgentEvents).values(directEvents.map((item, index) => ({ id: nanoid(), runId: state.runId, organizationId: state.organizationId, type: item.type, message: item.message, metadata: item.metadata ?? null, createdAt: new Date(item.createdAt), sequence: beforeEvents + index + 1 })));
      directEvents.forEach(item => input.onEvent?.(item));
      await persistToolCalls(); await db.update(autonomousAgentRuns).set({ lastHeartbeatAt: new Date(), stepsUsed: state.stepNumber, toolCallsUsed: state.toolCalls.length }).where(eq(autonomousAgentRuns.id, state.runId));
    }
  };
  try {
    state.status = "OBSERVING";
    for (let step = 0; step < AGENT_CONFIG.maxSteps; step += 1) {
      state.stepNumber = step + 1;
      state.status = "PLANNING";
      await db.update(autonomousAgentRuns).set({ status: state.status, lastHeartbeatAt: new Date() }).where(eq(autonomousAgentRuns.id, state.runId));
      await event(state, "agent.planning", `Planning step ${step + 1}.`, undefined, input.onEvent);
      const decision = await planner.next(state);
      if (decision.type === "COMPLETE") break;
      state.status = "EXECUTING";
      await db.update(autonomousAgentRuns).set({ status: state.status, lastHeartbeatAt: new Date() }).where(eq(autonomousAgentRuns.id, state.runId));
      await event(
        state,
        "tool.started",
        `${decision.tool.replaceAll("_", " ")} started.`,
        { tool: decision.tool },
        input.onEvent
      );
      await execute(decision.tool, decision.arguments);
    }
    if (!state.risk)
      throw new Error(
        "The agent reached its step limit before calculating risk."
      );
    // Recalculate once after Qwen's optional context calls so satellite land-cover
    // evidence can influence the same deterministic formula without giving the LLM
    // authority over the score.
    if (state.toolCalls.some(call => call.tool === "get_satellite_environment" && call.status === "COMPLETED"))
      await execute("calculate_heat_risk", { latitude: state.location.latitude, longitude: state.location.longitude, radiusKm: state.radiusKm });
    state.status = "ACTING";
    await db.update(autonomousAgentRuns).set({ status: state.status, lastHeartbeatAt: new Date() }).where(eq(autonomousAgentRuns.id, state.runId));
    await execute("save_heat_analysis", {});
    if (state.risk.score >= 65)
      await execute("create_heat_alert", {});
    await execute("create_recommendation", {});
    await execute("schedule_next_monitoring", {});
    await execute("generate_heat_report", {});
    state.status = "SAVING";
    await db.update(autonomousAgentRuns).set({ status: state.status, lastHeartbeatAt: new Date() }).where(eq(autonomousAgentRuns.id, state.runId));
    await event(
      state,
      "memory.saved",
      "Agent run, tools, evidence, and actions saved to long-term memory.",
      undefined,
      input.onEvent
    );
    state.status = "COMPLETED";
    await event(
      state,
      "agent.completed",
      `Operational risk completed at ${state.risk.score}/100.`,
      undefined,
      input.onEvent
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
      weather: state.observations.get_weather_context,
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
      report: state.durable.report,
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
          monitoringRunId: state.durable.monitoringRunId,
          operationalAgentRunId: state.durable.operationalAgentRunId,
          completedAt: new Date(),
        })
        .where(eq(autonomousAgentRuns.id, state.runId)),
      Promise.resolve(),
    ]);
    return response;
  } catch (error) {
    const cancelled = state.status === "CANCELLED";
    state.status = cancelled ? "CANCELLED" : "FAILED";
    await event(state, cancelled ? "agent.cancelled" : "agent.failed", cancelled ? "HeatCheck Agent run was cancelled." : "HeatCheck Agent did not complete.", undefined, input.onEvent);
    await db
      .update(autonomousAgentRuns)
      .set({
        status: state.status,
        stepsUsed: state.stepNumber,
        toolCallsUsed: state.toolCalls.length,
        fallbackUsed: state.planner.fallbackUsed,
        errorCode: cancelled ? "CANCELLED" : error instanceof TRPCError ? error.code : "AGENT_FAILURE",
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

export async function cancelAutonomousAgentRun(userId: number, organizationId: string, runId: string) {
  await requireWorkspaceMember(userId, organizationId); const db = await requireDb();
  const run = (await db.select().from(autonomousAgentRuns).where(and(eq(autonomousAgentRuns.id, runId), eq(autonomousAgentRuns.organizationId, organizationId))).limit(1))[0];
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found." });
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) return { cancelled: false, status: run.status };
  await db.update(autonomousAgentRuns).set({ cancelRequested: true }).where(eq(autonomousAgentRuns.id, runId));
  return { cancelled: true, status: "CANCELLATION_REQUESTED" };
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
      .where(eq(autonomousAgentEvents.runId, runId))
      .orderBy(asc(autonomousAgentEvents.sequence)),
    db
      .select()
      .from(autonomousAgentToolCalls)
      .where(eq(autonomousAgentToolCalls.runId, runId)),
  ]);
  return { run, events, toolCalls };
}
