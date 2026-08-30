import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentActions, agentDecisions, agentRuns, autonomousAgentToolCalls, heatObservations, hotspots as hotspotRows, incidents, locations, monitoringRuns, organizations } from "../../../drizzle/schema.js";
import { getDb } from "../../db.js";
import { nextAdaptiveAnalysisAt } from "../../heatcheck/adaptiveMonitoring.js";
import { deliverManagedHeatAlert } from "../../heatcheck/notifications.js";
import { analysisCacheKey, getCached, setCached } from "../../heatcheck/cache.js";
import {
  extractHeatmapGeojson,
  FortyGuardClient,
  FortyGuardError,
} from "../../heatcheck/fortyguard.js";
import {
  createBoundingPolygon,
  detectHotspots,
  detectRiskChange,
} from "../../heatcheck/geo.js";
import { calculateHeatRisk } from "../../heatcheck/riskEngine.js";
import { phoenixSimulation } from "../../heatcheck/simulation.js";
import type { NormalizedObservation } from "../../heatcheck/types.js";
import {
  permissionForAgentAction,
  canExecuteAction,
} from "../actions/permissions.js";
import { ToolRegistry } from "../tool-registry.js";
import type { AgentAction, AgentTool } from "../types.js";
import { callWeatherMcp } from "../mcp/weather-mcp.js";

const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(10).default(1),
});
const emptySchema = z.object({}).passthrough();
const locationJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    latitude: { type: "number", minimum: -90, maximum: 90 },
    longitude: { type: "number", minimum: -180, maximum: 180 },
    radiusKm: { type: "number", minimum: 0.1, maximum: 10 },
  },
  required: ["latitude", "longitude", "radiusKm"],
};
const emptyJson = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

function tool<I, O>(value: AgentTool<I, O>) {
  return value as AgentTool;
}
function optionalUnavailable(error: unknown) {
  if (error instanceof FortyGuardError && error.code === "FORBIDDEN")
    return {
      available: false as const,
      reason: "FEATURE_NOT_AVAILABLE" as const,
    };
  throw error;
}
function addAction(
  state: Parameters<AgentTool["execute"]>[1]["state"],
  type: AgentAction["type"],
  title: string,
  reason: string
) {
  const permission = permissionForAgentAction(type);
  const action: AgentAction = {
    type,
    permission,
    status: canExecuteAction(type) ? "EXECUTED" : "PROPOSED",
    title,
    reason,
  };
  state.actions.push(action);
  return action;
}

function numericFraction(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

function landCoverContext(value: unknown) {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = root.result && typeof root.result === "object" ? root.result as Record<string, unknown> : root;
  const vegetation = result.vegetationFraction ?? result.vegetation_fraction ?? result.vegetationPercentage ?? result.vegetation_percentage ?? result.ndvi;
  const builtUp = result.builtUpFraction ?? result.built_up_fraction ?? result.builtUpPercentage ?? result.built_up_percentage ?? result.impervious_fraction;
  return { vegetationFraction: numericFraction(vegetation), builtUpFraction: numericFraction(builtUp) };
}

async function requireAgentDb() {
  const db = await getDb();
  if (!db) throw new Error("HeatCheck memory is unavailable.");
  return db;
}

async function durableAction(state: Parameters<AgentTool["execute"]>[1]["state"], type: string, title: string, reason: string, safe = false) {
  if (!state.durable.operationalAgentRunId) throw new Error("Analysis must be saved before actions are created.");
  const db = await requireAgentDb();
  const organization = (await db.select().from(organizations).where(eq(organizations.id, state.organizationId)).limit(1))[0];
  const autonomous = organization?.agentMode === "AUTONOMOUS";
  const canExecute = safe || autonomous;
  const id = nanoid();
  await db.insert(agentActions).values({
    id, organizationId: state.organizationId, agentRunId: state.durable.operationalAgentRunId,
    decisionId: state.durable.decisionId ?? null, actionType: type, target: state.location.name ?? state.locationId,
    status: canExecute ? "COMPLETED" : "AWAITING_APPROVAL",
    permission: canExecute ? "SAFE_AUTO" : "APPROVAL_REQUIRED",
    executionResult: { source: "AUTONOMOUS_ORCHESTRATOR", reason, title },
    executedAt: canExecute ? new Date() : null,
  });
  return { id, status: canExecute ? "COMPLETED" : "AWAITING_APPROVAL", durable: true };
}

async function enforceProviderBudget(state: Parameters<AgentTool["execute"]>[1]["state"]) {
  const db = await requireAgentDb();
  const organization = (await db.select().from(organizations).where(eq(organizations.id, state.organizationId)).limit(1))[0];
  const policy = (organization?.providerPolicy ?? {}) as { dailyCallLimit?: number };
  const limit = Math.max(1, Math.min(10_000, Number(policy.dailyCallLimit ?? process.env.FORTYGUARD_DAILY_CALL_LIMIT ?? 500)));
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const calls = await db.select().from(autonomousAgentToolCalls).where(and(eq(autonomousAgentToolCalls.organizationId, state.organizationId), gte(autonomousAgentToolCalls.createdAt, start)));
  const used = calls.filter(call => ["get_heatmap", "get_environmental_conditions", "get_satellite_environment", "get_street_environment"].includes(call.toolName) && call.status === "COMPLETED").length;
  if (used >= limit) throw new Error("The organization FortyGuard daily call budget has been reached.");
  return { used, limit };
}

export function createAgentToolRegistry() {
  const registry = new ToolRegistry();
  registry.register(
    tool({
      name: "get_weather_context",
      description: "Use the Weather MCP server for current conditions, forecast, and official alerts when extra meteorological context is useful.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 1,
      async execute(input) {
        try {
          return await callWeatherMcp("get_weather_summary", {
            latitude: input.latitude,
            longitude: input.longitude,
            include: ["current", "forecast", "alerts"],
            days: 2,
            detail: "summary",
            units: "metric",
          });
        } catch {
          return { available: false, reason: "WEATHER_MCP_UNAVAILABLE" };
        }
      },
    })
  );
  registry.register(
    tool({
      name: "get_previous_analysis",
      description: "Load tenant-scoped prior analysis memory.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 1,
      async execute(_input, { state }) {
        return state.previousAnalysis ?? { available: false };
      },
    })
  );
  registry.register(
    tool({
      name: "get_heatmap",
      description: "Fetch and normalize the thermal map for the area.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 2,
      async execute(input, { state }) {
        const cacheKey = analysisCacheKey({ ...input, analysisType: "agent-heatmap" });
        const cached = getCached<Record<string, unknown>>(cacheKey);
        if (cached) return { ...cached, cacheHit: true };
        if (
          process.env.HEATCHECK_MOCK_MODE === "true" ||
          !process.env.FORTYGUARD_API_KEY
        ) {
          const mock = phoenixSimulation(input.latitude, input.longitude);
          const simulated = {
            source: "mock",
            statistics: {
              minimum: mock.minimumTemperature,
              maximum: mock.maximumTemperature,
              mean: mock.meanTemperature,
              standardDeviation: 2.1,
            },
            geojson: createBoundingPolygon(
              input.latitude,
              input.longitude,
              input.radiusKm
            ),
            mockObservation: mock,
          };
          setCached(cacheKey, simulated); return simulated;
        }
        await enforceProviderBudget(state);
        const provider = new FortyGuardClient();
        const activity = await provider.submitHeatmap({
          latitude: input.latitude,
          longitude: input.longitude,
          polygonGeojson: createBoundingPolygon(
            input.latitude,
            input.longitude,
            input.radiusKm
          ),
          occurredAt: new Date(),
        });
        const result = await provider.awaitActivity(activity.activityId);
        const normalized = {
          source: "fortyguard",
          activityId: activity.activityId,
          result: result.result ?? {},
          geojson: extractHeatmapGeojson(result.result),
        };
        setCached(cacheKey, normalized); return normalized;
      },
    })
  );
  registry.register(
    tool({
      name: "get_environmental_conditions",
      description:
        "Fetch normalized environmental conditions after the heatmap.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 2,
      async execute(input, { state }) {
        const heatmap = state.observations.get_heatmap as
          | {
              source?: string;
              mockObservation?: NormalizedObservation;
              result?: Record<string, unknown>;
            }
          | undefined;
        if (heatmap?.source === "mock" && heatmap.mockObservation)
          return heatmap.mockObservation;
        const cacheKey = analysisCacheKey({ ...input, analysisType: "agent-environment" });
        const cached = getCached<NormalizedObservation>(cacheKey);
        if (cached) return { ...cached, cacheHit: true };
        await enforceProviderBudget(state);
        const stats = (heatmap?.result?.stats_data ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const temperatureStats = stats.Temperature_stats ?? stats.temperature_stats ?? {};
        const heatmapTemperature = Number(
          temperatureStats.Mean ??
          temperatureStats.mean ??
          temperatureStats.Maximum ??
          temperatureStats.maximum
        );
        const previousTemperature = typeof state.previousAnalysis?.temperature === "number"
          ? state.previousAnalysis.temperature
          : Number.NaN;
        const temperature = Number.isFinite(heatmapTemperature)
          ? heatmapTemperature
          : Number.isFinite(previousTemperature)
            ? previousTemperature
            : 35;
        const provider = new FortyGuardClient();
        try {
          const submitted = await provider.submitEnvironmentalParameters({
            latitude: input.latitude,
            longitude: input.longitude,
            temperature,
            occurredAt: new Date(),
          });
          const environment = await provider.awaitActivity(submitted.activityId);
          const normalized = provider.normalize({
            heatmap: { status: "Completed", result: heatmap?.result, raw: {} },
            environment,
            latitude: input.latitude,
            longitude: input.longitude,
          });
          setCached(cacheKey, normalized);
          return normalized;
        } catch (error) {
          state.events.push({
            type: "tool.degraded",
            message: "Environmental conditions were unavailable; HeatCheck continued with thermal-map evidence.",
            metadata: {
              tool: "get_environmental_conditions",
              reason: error instanceof FortyGuardError ? error.code : "UPSTREAM_UNAVAILABLE",
            },
            createdAt: new Date().toISOString(),
          });
          const normalized = provider.normalize({
            heatmap: { status: "Completed", result: heatmap?.result, raw: {} },
            environment: { status: "Unavailable", result: {}, raw: {} },
            latitude: input.latitude,
            longitude: input.longitude,
          });
          setCached(cacheKey, normalized);
          return normalized;
        }
      },
    })
  );
  registry.register(
    tool({
      name: "detect_heat_hotspots",
      description:
        "Detect anomalously hot cells locally without sending GeoJSON to the model.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 2,
      async execute(_input, { state }) {
        const heatmap = state.observations.get_heatmap as
          | { geojson?: unknown; mockObservation?: NormalizedObservation }
          | undefined;
        const detected = detectHotspots(heatmap?.geojson);
        const hotspots = detected.length
          ? detected
          : (heatmap?.mockObservation?.hotspots ?? []);
        state.hotspots = hotspots as Array<Record<string, unknown>>;
        return { count: hotspots.length, hotspots };
      },
    })
  );
  registry.register(
    tool({
      name: "calculate_heat_risk",
      description:
        "Calculate the official deterministic HeatCheck operational risk score.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 3,
      async execute(_input, { state }) {
        const environment = state.observations.get_environmental_conditions as
          | NormalizedObservation
          | undefined;
        if (!environment)
          throw new Error(
            "Environmental observations are required before risk calculation."
          );
        const anomalies = state.hotspots.map(hotspot => Number(hotspot.anomaly ?? 0)).filter(Number.isFinite);
        const landCover = landCoverContext(state.observations.get_satellite_environment);
        const risk = calculateHeatRisk(
          environment,
          environment.hotspots.reduce(
            (sum, hotspot) => sum + hotspot.workersExposed,
            0
          ),
          { heatAnomaly: anomalies.length ? Math.max(...anomalies) : 0, ...landCover }
        );
        state.risk = risk;
        return risk;
      },
    })
  );
  registry.register(
    tool({
      name: "compare_heat_conditions",
      description: "Compare measurable current conditions with prior memory.",
      riskLevel: "SAFE",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 1,
      async execute(_input, { state }) {
        if (!state.risk) throw new Error("Risk is required before comparison.");
        const environment = state.observations
          .get_environmental_conditions as NormalizedObservation;
        const change = detectRiskChange(
          state.previousAnalysis
            ? {
                score: state.previousAnalysis.riskScore,
                level: state.previousAnalysis.riskLevel,
                temperature: state.previousAnalysis.temperature,
              }
            : null,
          {
            score: state.risk.score,
            level: state.risk.level,
            temperature: environment.temperature,
          }
        );
        return {
          ...change,
          trend:
            change.scoreDelta >= 5
              ? "WORSENING"
              : change.scoreDelta <= -5
                ? "IMPROVING"
                : "STABLE",
          newHotspots: Math.max(
            0,
            state.hotspots.length - (state.previousAnalysis?.hotspotCount ?? 0)
          ),
          resolvedHotspots: Math.max(
            0,
            (state.previousAnalysis?.hotspotCount ?? 0) - state.hotspots.length
          ),
        };
      },
    })
  );
  registry.register(
    tool({
      name: "get_satellite_environment",
      description: "Optionally obtain land-cover context for elevated risk.",
      riskLevel: "CONTROLLED",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 1,
      async execute(input, { state }) {
        try {
          await enforceProviderBudget(state);
          const provider = new FortyGuardClient();
          const task = await provider.submitSatellite(
            input.latitude,
            input.longitude,
            createBoundingPolygon(
              input.latitude,
              input.longitude,
              input.radiusKm
            )
          );
          return {
            available: true,
            result:
              (await provider.awaitActivity(task.activityId)).result ?? {},
          };
        } catch (error) {
          return optionalUnavailable(error);
        }
      },
    })
  );
  registry.register(
    tool({
      name: "get_street_environment",
      description: "Optionally obtain street-level urban context.",
      riskLevel: "CONTROLLED",
      schema: locationSchema,
      jsonSchema: locationJson,
      maxCalls: 1,
      async execute(input, { state }) {
        try {
          await enforceProviderBudget(state);
          const provider = new FortyGuardClient();
          const task = await provider.submitStreetView(
            input.latitude,
            input.longitude
          );
          return {
            available: true,
            result:
              (await provider.awaitActivity(task.activityId)).result ?? {},
          };
        } catch (error) {
          return optionalUnavailable(error);
        }
      },
    })
  );
  registry.register(
    tool({
      name: "create_heat_alert",
      description:
        "Create a controlled internal heat alert when deterministic risk justifies it.",
      riskLevel: "CONTROLLED",
      schema: emptySchema,
      jsonSchema: emptyJson,
      maxCalls: 1,
      async execute(_input, { state }) {
        if ((state.risk?.score ?? 0) < 65)
          return { created: false, reason: "RISK_BELOW_THRESHOLD" };
        const action = addAction(
          state,
          "CREATE_ALERT",
          `${state.risk?.level} internal heat alert`,
          `Operational risk reached ${state.risk?.score}/100.`
        );
        const db = await requireAgentDb();
        const observationId = state.durable.observationId;
        if (!observationId) throw new Error("A durable observation is required before opening an alert.");
        const incidentId = nanoid();
        await db.insert(incidents).values({ id: incidentId, organizationId: state.organizationId, locationId: state.locationId, observationId, severity: state.risk!.level, riskScore: state.risk!.score, title: `${state.risk!.level} heat exposure at ${state.location.name}`, summary: state.risk!.summary });
        state.durable.incidentId = incidentId;
        const durable = await durableAction(state, "CREATE_HEAT_ALERT", action.title, action.reason);
        if (durable.status === "COMPLETED") await deliverManagedHeatAlert({ organizationId: state.organizationId, locationId: state.locationId, locationName: state.location.name ?? "Monitored location", incidentId, riskScore: state.risk!.score, riskLevel: state.risk!.level, summary: state.risk!.summary });
        return { created: true, incidentId, actionId: durable.id, status: durable.status };
      },
    })
  );
  registry.register(
    tool({
      name: "create_recommendation",
      description: "Create an evidence-based operational recommendation.",
      riskLevel: "SAFE",
      schema: emptySchema,
      jsonSchema: emptyJson,
      maxCalls: 1,
      async execute(_input, { state }) {
        const action = addAction(
          state,
          "CREATE_RECOMMENDATION",
          "Operational heat response",
          (state.risk?.score ?? 0) >= 65
            ? "Prioritize shade, cooling, exposure reduction, and hottest zones."
            : "Continue monitoring with an operational heat advisory."
        );
        const durable = await durableAction(state, "CREATE_RECOMMENDATION", action.title, action.reason, true);
        return { ...action, actionId: durable.id, durableStatus: durable.status };
      },
    })
  );
  registry.register(
    tool({
      name: "schedule_next_monitoring",
      description: "Recommend the next bounded monitoring interval.",
      riskLevel: "CONTROLLED",
      schema: emptySchema,
      jsonSchema: emptyJson,
      maxCalls: 1,
      async execute(_input, { state }) {
        const score = state.risk?.score ?? 0;
        const minutes =
          score >= 85
            ? 10
            : score >= 65
              ? 15
              : score >= 45
                ? 30
                : score >= 25
                  ? 45
                  : 60;
        const action = addAction(
          state,
          "CHANGE_MONITORING_FREQUENCY",
          `Check again in ${minutes} minutes`,
          "Adaptive interval based on deterministic risk."
        );
        const durable = await durableAction(state, "CHANGE_MONITORING_FREQUENCY", action.title, action.reason);
        const db = await requireAgentDb();
        const organization = (await db.select().from(organizations).where(eq(organizations.id, state.organizationId)).limit(1))[0];
        const nextAnalysisAt = nextAdaptiveAnalysisAt(score, organization?.monitoringIntervalMinutes ?? minutes);
        if (durable.status === "COMPLETED") await db.update(locations).set({ lastAnalysisAt: new Date(), nextAnalysisAt }).where(eq(locations.id, state.locationId));
        return {
          minutes,
          recommendedNextCheckAt: nextAnalysisAt.toISOString(),
          actionId: durable.id,
        };
      },
    })
  );
  registry.register(tool({ name: "get_location_history", description: "Return the tenant-scoped prior analysis already loaded into agent memory.", riskLevel: "SAFE", schema: emptySchema, jsonSchema: emptyJson, maxCalls: 1, async execute(_input, { state }) { return state.previousAnalysis ?? { available: false }; } }));
  registry.register(tool({ name: "save_heat_analysis", description: "Persist the normalized evidence and connect this autonomous run to the canonical operational records.", riskLevel: "SAFE", schema: emptySchema, jsonSchema: emptyJson, maxCalls: 1, async execute(_input, { state }) {
    if (!state.risk) throw new Error("Risk must be calculated before saving analysis.");
    const environment = state.observations.get_environmental_conditions as NormalizedObservation | undefined;
    if (!environment) throw new Error("Environmental evidence is missing.");
    const db = await requireAgentDb(); const monitoringRunId = nanoid(); const observationId = nanoid(); const operationalAgentRunId = nanoid(); const decisionId = nanoid();
    await db.insert(monitoringRuns).values({ id: monitoringRunId, organizationId: state.organizationId, locationId: state.locationId, status: "COMPLETED", mode: environment.source === "FORTYGUARD" ? "LIVE" : "SIMULATION", requestedByUserId: state.userId, startedAt: new Date(), completedAt: new Date() });
    await db.insert(heatObservations).values({ id: observationId, organizationId: state.organizationId, locationId: state.locationId, monitoringRunId, observedAt: environment.observedAt, temperature: environment.temperature, minimumTemperature: environment.minimumTemperature, maximumTemperature: environment.maximumTemperature, meanTemperature: environment.meanTemperature, apparentTemperature: environment.apparentTemperature, heatIndex: environment.heatIndex, wetBulbTemperature: environment.wetBulbTemperature, relativeHumidity: environment.relativeHumidity, aqi: environment.aqi, pm25: environment.pm25, pm10: environment.pm10, solarIrradiance: environment.solarIrradiance, riskScore: state.risk.score, riskLevel: state.risk.level, operationalExposureScore: environment.hotspots.reduce((sum, item) => sum + item.workersExposed, 0), source: environment.source, summary: { ...environment.summary, autonomousRunId: state.runId, geojson: (state.observations.get_heatmap as Record<string, unknown> | undefined)?.geojson } });
    if (environment.hotspots.length) await db.insert(hotspotRows).values(environment.hotspots.map(item => ({ id: nanoid(), organizationId: state.organizationId, observationId, locationId: state.locationId, label: item.label, latitude: item.latitude, longitude: item.longitude, temperature: item.temperature, riskLevel: state.risk!.level, workersExposed: item.workersExposed, metadata: item.metadata ?? null })));
    await db.insert(agentRuns).values({ id: operationalAgentRunId, organizationId: state.organizationId, locationId: state.locationId, observationId, monitoringRunId, status: "COMPLETED", startedAt: new Date(), completedAt: new Date() });
    await db.insert(agentDecisions).values({ id: decisionId, agentRunId: operationalAgentRunId, riskLevel: state.risk.level, summary: state.risk.summary, reasoningSummary: state.risk.factors.map(item => `${item.factor}: ${item.contribution.toFixed(1)}`).join("; "), decision: state.risk.score >= 65 ? "ACTIVATE_RESPONSE" : "CONTINUE_MONITORING", structuredOutput: { goal: state.goal, factors: state.risk.factors, autonomousRunId: state.runId } });
    state.durable = { ...state.durable, monitoringRunId, observationId, operationalAgentRunId, decisionId };
    return state.durable;
  } }));
  registry.register(tool({ name: "generate_heat_report", description: "Create a durable report snapshot from the completed run evidence.", riskLevel: "CONTROLLED", schema: emptySchema, jsonSchema: emptyJson, maxCalls: 1, async execute(_input, { state }) { if (!state.risk) throw new Error("Risk is required before report generation."); const report = { reportId: nanoid(), runId: state.runId, generatedAt: new Date().toISOString(), location: state.location, risk: state.risk, hotspots: state.hotspots, evidenceSummary: { completedTools: state.toolCalls.filter(call => call.status === "COMPLETED").map(call => call.tool), observationRecordId: state.durable.observationId, monitoringRunId: state.durable.monitoringRunId } }; state.durable.report = report; const action = await durableAction(state, "GENERATE_REPORT", "Generate Heat Intelligence report", "Durable report snapshot created from verified run evidence.", true); return { reportId: report.reportId, actionId: action.id }; } }));
  return registry;
}
