import { z } from "zod";
import { FortyGuardClient, FortyGuardError } from "../../heatcheck/fortyguard.js";
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

export function createAgentToolRegistry() {
  const registry = new ToolRegistry();
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
      async execute(input) {
        if (
          process.env.HEATCHECK_MOCK_MODE === "true" ||
          !process.env.FORTYGUARD_API_KEY
        ) {
          const mock = phoenixSimulation(input.latitude, input.longitude);
          return {
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
        }
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
        return {
          source: "fortyguard",
          activityId: activity.activityId,
          result: result.result ?? {},
          geojson:
            result.result?.geojson ??
            result.result?.data ??
            createBoundingPolygon(
              input.latitude,
              input.longitude,
              input.radiusKm
            ),
        };
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
        const stats = (heatmap?.result?.stats_data ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const temperature = Number(stats.Temperature_stats?.Mean ?? 35);
        const provider = new FortyGuardClient();
        const submitted = await provider.submitEnvironmentalParameters({
          latitude: input.latitude,
          longitude: input.longitude,
          temperature,
          occurredAt: new Date(),
        });
        const environment = await provider.awaitActivity(submitted.activityId);
        return provider.normalize({
          heatmap: { status: "Completed", result: heatmap?.result, raw: {} },
          environment,
          latitude: input.latitude,
          longitude: input.longitude,
        });
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
        const risk = calculateHeatRisk(
          environment,
          environment.hotspots.reduce(
            (sum, hotspot) => sum + hotspot.workersExposed,
            0
          )
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
      async execute(input) {
        try {
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
      async execute(input) {
        try {
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
        return addAction(
          state,
          "CREATE_ALERT",
          `${state.risk?.level} internal heat alert`,
          `Operational risk reached ${state.risk?.score}/100.`
        );
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
        return addAction(
          state,
          "CREATE_RECOMMENDATION",
          "Operational heat response",
          (state.risk?.score ?? 0) >= 65
            ? "Prioritize shade, cooling, exposure reduction, and hottest zones."
            : "Continue monitoring with an operational heat advisory."
        );
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
        addAction(
          state,
          "CHANGE_MONITORING_FREQUENCY",
          `Check again in ${minutes} minutes`,
          "Adaptive interval based on deterministic risk."
        );
        return {
          minutes,
          recommendedNextCheckAt: new Date(
            Date.now() + minutes * 60_000
          ).toISOString(),
        };
      },
    })
  );
  for (const name of [
    "get_location_history",
    "save_heat_analysis",
    "generate_heat_report",
  ] as const)
    registry.register(
      tool({
        name,
        description: `${name.replaceAll("_", " ")} through the bounded HeatCheck runtime.`,
        riskLevel: name === "generate_heat_report" ? "CONTROLLED" : "SAFE",
        schema: emptySchema,
        jsonSchema: emptyJson,
        maxCalls: 1,
        async execute(_input, { state }) {
          return { available: true, runId: state.runId };
        },
      })
    );
  return registry;
}
