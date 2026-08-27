import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  heatAnalysisProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../_core/trpc.js";
import {
  createLocation,
  createWorkspace,
  getWorkspaceForUser,
  listLocationsForWorkspace,
  requireLocationMember,
  requireWorkspaceMember,
  updateWorkspaceSettings,
  updateWorkspacePolicies,
  updateLocationMonitoring,
  writeAuditLog,
} from "../heatcheck/tenant.js";
import {
  approveAction,
  getDashboardData,
  runMonitoring,
} from "../heatcheck/monitoring.js";
import { AGENT_CONFIG } from "../agent/config.js";
import { enqueueAutonomousAgentRun } from "../agent/queue.js";
import { chatWithHeatCheck } from "../agent/chat.js";
import {
  cancelAutonomousAgentRun,
  getAutonomousAgentRun,
  listAutonomousAgentRuns,
  runAutonomousAgent,
} from "../agent/orchestrator/run-agent.js";

const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

function isBoundedGeojson(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const serialized = JSON.stringify(value);
  if (serialized.length > 50_000) return false;
  const candidate = value as {
    type?: string;
    geometry?: { type?: string; coordinates?: unknown[] };
    features?: unknown[];
  };
  if (candidate.type === "Polygon")
    return Array.isArray(
      candidate.geometry?.coordinates ??
        (candidate as { coordinates?: unknown[] }).coordinates
    );
  if (candidate.type === "Feature" && candidate.geometry?.type === "Polygon")
    return Array.isArray(candidate.geometry.coordinates);
  if (
    candidate.type === "FeatureCollection" &&
    Array.isArray(candidate.features) &&
    candidate.features.length <= 20
  )
    return true;
  return false;
}

const locationInput = z.object({
  organizationId: z.string().min(8).max(36),
  name: z.string().trim().min(2).max(160),
  latitude,
  longitude,
  polygonGeojson: z
    .unknown()
    .optional()
    .refine(
      isBoundedGeojson,
      "Provide a bounded GeoJSON Polygon or FeatureCollection."
    ),
  timezone: z.string().trim().min(3).max(80).default("America/Phoenix"),
  monitoringEnabled: z.boolean().default(true),
  riskThreshold: z.number().int().min(0).max(100).default(76),
});

export const heatcheckRouter = router({
  health: publicProcedure.query(() => ({
    status: "healthy" as const,
    mode:
      process.env.FORTYGUARD_ENABLED !== "false" &&
      process.env.HEATCHECK_MOCK_MODE !== "true" &&
      process.env.FORTYGUARD_API_KEY
        ? ("LIVE_READY" as const)
        : ("SIMULATION" as const),
  })),
  agent: router({
    health: protectedProcedure.query(() => ({
      agent: AGENT_CONFIG.enabled,
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
      fortyGuardConfigured: Boolean(process.env.FORTYGUARD_API_KEY),
      database: Boolean(process.env.DATABASE_URL),
      mockMode: process.env.HEATCHECK_MOCK_MODE === "true",
      model: AGENT_CONFIG.model,
      parameters: { temperature: AGENT_CONFIG.temperature, topP: AGENT_CONFIG.topP, maxCompletionTokens: AGENT_CONFIG.maxCompletionTokens, maxSteps: AGENT_CONFIG.maxSteps, maxToolCalls: AGENT_CONFIG.maxToolCalls },
      mcpServer: null,
    })),
    chat: heatAnalysisProcedure
      .input(z.object({
        organizationId: z.string().min(8).max(36),
        locationId: z.string().min(8).max(36),
        message: z.string().trim().min(2).max(500),
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) })).max(8).default([]),
      }))
      .mutation(({ ctx, input }) => chatWithHeatCheck({ userId: ctx.user.id, ...input })),
    run: heatAnalysisProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          locationId: z.string().min(8).max(36),
          goal: z
            .enum([
              "ANALYZE_LOCATION",
              "MONITOR_LOCATION",
              "DETECT_HOTSPOTS",
              "TRACK_HEAT_CHANGE",
              "ASSESS_EVENT_HEAT_RISK",
            ])
            .default("ANALYZE_LOCATION"),
          radiusKm: z.number().min(0.1).max(10).default(1),
          idempotencyKey: z.string().trim().min(8).max(100).optional(),
        })
      )
      .mutation(({ ctx, input }) =>
        runAutonomousAgent({ userId: ctx.user.id, ...input })
      ),
    enqueue: heatAnalysisProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36), locationId: z.string().min(8).max(36), goal: z.enum(["ANALYZE_LOCATION", "MONITOR_LOCATION", "DETECT_HOTSPOTS", "TRACK_HEAT_CHANGE", "ASSESS_EVENT_HEAT_RISK"]).default("ANALYZE_LOCATION"), idempotencyKey: z.string().trim().min(8).max(100).optional() }))
      .mutation(({ ctx, input }) => enqueueAutonomousAgentRun({ userId: ctx.user.id, ...input })),
    command: heatAnalysisProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          locationId: z.string().min(8).max(36),
          command: z.string().trim().min(3).max(240),
        })
      )
      .mutation(({ ctx, input }) => {
        const text = input.command.toLowerCase();
        const goal =
          text.includes("compare") || text.includes("hotter")
            ? "TRACK_HEAT_CHANGE"
            : text.includes("monitor")
              ? "MONITOR_LOCATION"
              : text.includes("hottest") || text.includes("hotspot")
                ? "DETECT_HOTSPOTS"
                : "ANALYZE_LOCATION";
        return runAutonomousAgent({
          userId: ctx.user.id,
          organizationId: input.organizationId,
          locationId: input.locationId,
          goal,
        });
      }),
    runs: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36) }))
      .query(({ ctx, input }) =>
        listAutonomousAgentRuns(ctx.user.id, input.organizationId)
      ),
    detail: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          runId: z.string().min(8).max(36),
        })
      )
      .query(({ ctx, input }) =>
        getAutonomousAgentRun(ctx.user.id, input.organizationId, input.runId)
      ),
    cancel: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36), runId: z.string().min(8).max(36) }))
      .mutation(({ ctx, input }) => cancelAutonomousAgentRun(ctx.user.id, input.organizationId, input.runId)),
  }),
  workspace: router({
    current: protectedProcedure.query(async ({ ctx }) => {
      return getWorkspaceForUser(ctx.user.id);
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(160),
          agentMode: z
            .enum(["OBSERVE", "RECOMMEND", "AUTONOMOUS"])
            .default("OBSERVE"),
          riskThreshold: z.number().int().min(0).max(100).default(76),
        })
      )
      .mutation(async ({ ctx, input }) =>
        createWorkspace({ userId: ctx.user.id, ...input })
      ),
    settings: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36) }))
      .query(async ({ ctx, input }) => {
        const workspace = await requireWorkspaceMember(
          ctx.user.id,
          input.organizationId
        );
        return {
          ...workspace,
          isSimulation: workspace.organization.simulationMode,
        };
      }),
    updateSettings: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          agentMode: z.enum(["OBSERVE", "RECOMMEND", "AUTONOMOUS"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateWorkspaceSettings({ userId: ctx.user.id, ...input });
        return { success: true } as const;
      }),
    updatePolicies: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36), notificationPolicy: z.object({ enabledChannels: z.array(z.enum(["WEBHOOK", "SLACK", "EMAIL", "SMS"])).max(4).optional(), emailTo: z.string().email().max(320).optional(), smsTo: z.string().min(7).max(32).optional(), minimumRiskScore: z.number().int().min(0).max(100).optional(), quietHoursUtc: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(0).max(23) }).optional() }).optional(), providerPolicy: z.object({ dailyCallLimit: z.number().int().min(1).max(10_000).optional() }).optional() }))
      .mutation(async ({ ctx, input }) => { await updateWorkspacePolicies({ userId: ctx.user.id, ...input }); return { success: true } as const; }),
  }),
  locations: router({
    list: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36) }))
      .query(async ({ ctx, input }) =>
        listLocationsForWorkspace(ctx.user.id, input.organizationId)
      ),
    get: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          locationId: z.string().min(8).max(36),
        })
      )
      .query(async ({ ctx, input }) =>
        requireLocationMember(
          ctx.user.id,
          input.organizationId,
          input.locationId
        )
      ),
    create: protectedProcedure
      .input(locationInput)
      .mutation(async ({ ctx, input }) => {
        return createLocation({ userId: ctx.user.id, ...input });
      }),
    updateMonitoring: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          locationId: z.string().min(8).max(36),
          monitoringEnabled: z.boolean(),
          riskThreshold: z.number().int().min(0).max(100),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateLocationMonitoring({ userId: ctx.user.id, ...input });
        return { success: true } as const;
      }),
  }),
  onboarding: router({
    complete: protectedProcedure
      .input(
        z.object({
          workspace: z.object({
            name: z.string().trim().min(2).max(160),
            agentMode: z
              .enum(["OBSERVE", "RECOMMEND", "AUTONOMOUS"])
              .default("OBSERVE"),
            riskThreshold: z.number().int().min(0).max(100).default(76),
          }),
          location: locationInput.omit({ organizationId: true }),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await getWorkspaceForUser(ctx.user.id);
        if (existing)
          throw new TRPCError({
            code: "CONFLICT",
            message: "This account already has a Heatcheck workspace.",
          });
        const workspace = await createWorkspace({
          userId: ctx.user.id,
          ...input.workspace,
        });
        const location = await createLocation({
          userId: ctx.user.id,
          organizationId: workspace.id,
          ...input.location,
        });
        await writeAuditLog({
          organizationId: workspace.id,
          userId: ctx.user.id,
          eventType: "onboarding.completed",
          entityType: "location",
          entityId: location.id,
        });
        return { workspace, location };
      }),
  }),
  dashboard: router({
    get: protectedProcedure
      .input(z.object({ organizationId: z.string().min(8).max(36) }))
      .query(async ({ ctx, input }) =>
        getDashboardData({
          userId: ctx.user.id,
          organizationId: input.organizationId,
        })
      ),
  }),
  monitoring: router({
    run: heatAnalysisProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          locationId: z.string().min(8).max(36),
        })
      )
      .mutation(async ({ ctx, input }) =>
        runMonitoring({
          userId: ctx.user.id,
          organizationId: input.organizationId,
          locationId: input.locationId,
          requestedBy: "USER",
        })
      ),
  }),
  actions: router({
    approve: protectedProcedure
      .input(
        z.object({
          organizationId: z.string().min(8).max(36),
          actionId: z.string().min(8).max(36),
        })
      )
      .mutation(async ({ ctx, input }) =>
        approveAction({
          userId: ctx.user.id,
          organizationId: input.organizationId,
          actionId: input.actionId,
        })
      ),
  }),
});
