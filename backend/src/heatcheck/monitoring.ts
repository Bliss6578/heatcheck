import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  actionPermissions,
  activityEvents,
  agentActions,
  agentDecisions,
  agentRuns,
  fortyguardJobs,
  heatObservations,
  hotspots,
  incidents,
  locations,
  monitoringRuns,
  organizationMembers,
  type Location,
} from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { createDecisionPlan } from "./agent.js";
import { FortyGuardClient } from "./fortyguard.js";
import { calculateHeatRisk } from "./riskEngine.js";
import { phoenixSimulation, phoenixVerificationSimulation } from "./simulation.js";
import {
  requireAdministratorRole,
  requireLocationMember,
  requireOperatorRole,
  requireWorkspaceMember,
  writeAuditLog,
} from "./tenant.js";
import type { AgentMode, NormalizedObservation } from "./types.js";
import { analysisCacheKey, getCached, setCached } from "./cache.js";
import { deliverManagedHeatAlert } from "./notifications.js";
import { nextAdaptiveAnalysisAt } from "./adaptiveMonitoring.js";

type ActionPermission = "SAFE_AUTO" | "APPROVAL_REQUIRED" | "DISABLED";

export type VerificationCandidate = {
  actionType: string;
  status: string;
  executionClass: "RECORD_ONLY" | "OPERATIONAL_CHANGE";
};

export type VerificationState =
  | "READY_FOR_REEVALUATION"
  | "DEFERRED_PENDING_APPROVAL"
  | "DEFERRED_NO_OPERATIONAL_CHANGE";

export function verificationStateFor(
  actions: VerificationCandidate[]
): VerificationState {
  if (
    actions.some(
      action =>
        action.status === "COMPLETED" &&
        action.executionClass === "OPERATIONAL_CHANGE"
    )
  )
    return "READY_FOR_REEVALUATION";
  if (
    actions.some(
      action =>
        action.status === "AWAITING_APPROVAL" || action.status === "PENDING"
    )
  )
    return "DEFERRED_PENDING_APPROVAL";
  return "DEFERRED_NO_OPERATIONAL_CHANGE";
}

export function isVerificationEligible(actions: VerificationCandidate[]) {
  return verificationStateFor(actions) === "READY_FOR_REEVALUATION";
}

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Heatcheck data service is unavailable.",
    });
  return db;
}

async function logEvent(input: {
  organizationId: string;
  locationId?: string;
  monitoringRunId?: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
}) {
  const db = await requireDb();
  await db
    .insert(activityEvents)
    .values({
      id: nanoid(),
      ...input,
      locationId: input.locationId ?? null,
      monitoringRunId: input.monitoringRunId ?? null,
      payload: input.payload ?? null,
    });
}

function defaultPermission(actionType: string): ActionPermission {
  return actionType === "RECORD_INCIDENT_NOTE" ||
    actionType === "START_VERIFICATION" ||
    actionType === "ACTIVATE_HEATCHECK_PROTOCOL"
    ? "SAFE_AUTO"
    : "APPROVAL_REQUIRED";
}

async function permissionForAction(
  organizationId: string,
  actionType: string
): Promise<ActionPermission> {
  const db = await requireDb();
  const configured = await db
    .select()
    .from(actionPermissions)
    .where(
      and(
        eq(actionPermissions.organizationId, organizationId),
        eq(actionPermissions.actionType, actionType)
      )
    )
    .limit(1);
  return (configured[0]?.permission ??
    defaultPermission(actionType)) as ActionPermission;
}

async function createProviderJob(input: {
  organizationId: string;
  locationId: string;
  monitoringRunId: string;
  endpoint: string;
  requestPayload: Record<string, unknown>;
}) {
  const db = await requireDb();
  const id = nanoid();
  await db.insert(fortyguardJobs).values({ id, ...input, status: "QUEUED" });
  return id;
}

async function updateProviderJob(
  id: string,
  values: {
    activityId?: string | null;
    status: "SUBMITTED" | "PROCESSING" | "COMPLETED" | "FAILED";
    result?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  }
) {
  const db = await requireDb();
  await db.update(fortyguardJobs).set(values).where(eq(fortyguardJobs.id, id));
}

async function getObservation(input: {
  location: Location;
  organizationId: string;
  monitoringRunId: string;
}): Promise<NormalizedObservation> {
  const provider = new FortyGuardClient();
  if (!provider.isConfigured)
    return phoenixSimulation(input.location.latitude, input.location.longitude);
  const now = new Date();
  const cacheKey = analysisCacheKey({
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    date: now,
  });
  const cached = getCached<NormalizedObservation>(cacheKey);
  if (cached)
    return {
      ...cached,
      observedAt: now,
      summary: { ...cached.summary, cacheHit: true },
    };
  const heatJobId = await createProviderJob({
    organizationId: input.organizationId,
    locationId: input.location.id,
    monitoringRunId: input.monitoringRunId,
    endpoint: "heatmap",
    requestPayload: { occurredAt: now.toISOString() },
  });
  let heatmapCompleted = false;
  try {
    const heatSubmit = await provider.submitHeatmap({
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      polygonGeojson: input.location.polygonGeojson,
      occurredAt: now,
    });
    await updateProviderJob(heatJobId, {
      activityId: heatSubmit.activityId,
      status: "SUBMITTED",
      startedAt: new Date(),
    });
    await updateProviderJob(heatJobId, { status: "PROCESSING" });
    const heatmap = await provider.awaitActivity(heatSubmit.activityId);
    await updateProviderJob(heatJobId, {
      status: "COMPLETED",
      result: heatmap.result ?? null,
      completedAt: new Date(),
    });
    heatmapCompleted = true;
    const temperature =
      Number(
        (heatmap.result?.stats_data as Record<string, unknown> | undefined)
          ?.Temperature_stats &&
          (
            heatmap.result?.stats_data as Record<
              string,
              Record<string, unknown>
            >
          ).Temperature_stats.Mean
      ) || 35;
    const envJobId = await createProviderJob({
      organizationId: input.organizationId,
      locationId: input.location.id,
      monitoringRunId: input.monitoringRunId,
      endpoint: "env_params",
      requestPayload: { occurredAt: now.toISOString(), temperature },
    });
    try {
      const envSubmit = await provider.submitEnvironmentalParameters({
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        temperature,
        occurredAt: now,
      });
      await updateProviderJob(envJobId, {
        activityId: envSubmit.activityId,
        status: "SUBMITTED",
        startedAt: new Date(),
      });
      await updateProviderJob(envJobId, { status: "PROCESSING" });
      const environment = await provider.awaitActivity(envSubmit.activityId);
      await updateProviderJob(envJobId, {
        status: "COMPLETED",
        result: environment.result ?? null,
        completedAt: new Date(),
      });
      const normalized = provider.normalize({
        heatmap,
        environment,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
      });
      setCached(cacheKey, normalized);
      return normalized;
    } catch (error) {
      await updateProviderJob(envJobId, {
        status: "FAILED",
        error:
          error instanceof Error
            ? error.message
            : "Environmental parameter request failed",
        completedAt: new Date(),
      });
      throw error;
    }
  } catch (error) {
    if (!heatmapCompleted) {
      await updateProviderJob(heatJobId, {
        status: "FAILED",
        error:
          error instanceof Error ? error.message : "Heatmap request failed",
        completedAt: new Date(),
      });
    }
    throw error;
  }
}

export async function runMonitoring(input: {
  userId: number;
  organizationId: string;
  locationId: string;
  requestedBy?: "USER" | "SCHEDULE";
}) {
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
  const active = await db
    .select()
    .from(monitoringRuns)
    .where(
      and(
        eq(monitoringRuns.locationId, location.id),
        eq(monitoringRuns.status, "ANALYZING")
      )
    )
    .limit(1);
  if (active[0])
    throw new TRPCError({
      code: "CONFLICT",
      message: "A Heatcheck analysis is already running for this location.",
    });

  const monitoringRunId = nanoid();
  let mode: "SIMULATION" | "LIVE" =
    process.env.HEATCHECK_MOCK_MODE === "true" ||
    process.env.FORTYGUARD_ENABLED === "false" ||
    !process.env.FORTYGUARD_API_KEY
      ? "SIMULATION"
      : "LIVE";
  await db
    .insert(monitoringRuns)
    .values({
      id: monitoringRunId,
      organizationId: input.organizationId,
      locationId: location.id,
      status: "ANALYZING",
      mode,
      requestedByUserId: input.requestedBy === "USER" ? input.userId : null,
      startedAt: new Date(),
    });
  await logEvent({
    organizationId: input.organizationId,
    locationId: location.id,
    monitoringRunId,
    type: "analysis.started",
    message: `${mode === "SIMULATION" ? "Simulation" : "Live provider"} analysis started for ${location.name}.`,
    payload: { mode, requestedBy: input.requestedBy ?? "USER" },
  });

  try {
    let observation: NormalizedObservation;
    if (mode === "SIMULATION") {
      observation = phoenixSimulation(location.latitude, location.longitude);
    } else {
      try {
        observation = await getObservation({
          location,
          organizationId: input.organizationId,
          monitoringRunId,
        });
      } catch (error) {
        if (process.env.HEATCHECK_ALLOW_MOCK_FALLBACK !== "true") throw error;
        mode = "SIMULATION";
        observation = phoenixSimulation(location.latitude, location.longitude);
        observation.summary = {
          ...observation.summary,
          providerFallback: true,
          fallbackReason: "FortyGuard live activity did not complete.",
        };
        await db
          .update(monitoringRuns)
          .set({ mode: "SIMULATION" })
          .where(eq(monitoringRuns.id, monitoringRunId));
        await logEvent({
          organizationId: input.organizationId,
          locationId: location.id,
          monitoringRunId,
          type: "provider.fallback",
          message:
            "Live provider analysis did not complete; Heatcheck continued in clearly labelled Simulation Mode.",
          payload: { source: "SIMULATION" },
        });
      }
    }
    const workersExposed = observation.hotspots.reduce(
      (total, hotspot) => total + hotspot.workersExposed,
      0
    );
    const assessment = calculateHeatRisk(observation, workersExposed);
    await db
      .update(monitoringRuns)
      .set({ status: "EVALUATING" })
      .where(eq(monitoringRuns.id, monitoringRunId));
    const observationId = nanoid();
    await db.insert(heatObservations).values({
      id: observationId,
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      observedAt: observation.observedAt,
      temperature: observation.temperature,
      minimumTemperature: observation.minimumTemperature,
      maximumTemperature: observation.maximumTemperature,
      meanTemperature: observation.meanTemperature,
      apparentTemperature: observation.apparentTemperature,
      heatIndex: observation.heatIndex,
      wetBulbTemperature: observation.wetBulbTemperature,
      relativeHumidity: observation.relativeHumidity,
      aqi: observation.aqi,
      pm25: observation.pm25,
      pm10: observation.pm10,
      solarIrradiance: observation.solarIrradiance,
      riskScore: assessment.score,
      riskLevel: assessment.level,
      operationalExposureScore: assessment.operationalExposureScore,
      source: observation.source,
      rawReference: observation.rawReference ?? null,
      summary: { ...observation.summary, factors: assessment.factors },
    });
    await db
      .insert(hotspots)
      .values(
        observation.hotspots.map(hotspot => ({
          id: nanoid(),
          organizationId: input.organizationId,
          observationId,
          locationId: location.id,
          label: hotspot.label,
          latitude: hotspot.latitude,
          longitude: hotspot.longitude,
          temperature: hotspot.temperature,
          riskLevel: assessment.level,
          workersExposed: hotspot.workersExposed,
          metadata: hotspot.metadata ?? null,
        }))
      );
    await logEvent({
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      type: "risk.assessed",
      message: `Heatcheck classified ${location.name} as ${assessment.level} (${assessment.score}/100).`,
      payload: {
        score: assessment.score,
        level: assessment.level,
        source: observation.source,
      },
    });

    let incidentId: string | null = null;
    if (assessment.score >= location.riskThreshold) {
      incidentId = nanoid();
      await db
        .insert(incidents)
        .values({
          id: incidentId,
          organizationId: input.organizationId,
          locationId: location.id,
          observationId,
          severity: assessment.level,
          riskScore: assessment.score,
          title: `${assessment.level} heat exposure at ${location.name}`,
          summary: assessment.summary,
        });
      await logEvent({
        organizationId: input.organizationId,
        locationId: location.id,
        monitoringRunId,
        type: "incident.opened",
        message: `Heat incident opened at the configured threshold (${location.riskThreshold}).`,
        payload: { incidentId, threshold: location.riskThreshold },
      });
      await deliverManagedHeatAlert({
        organizationId: input.organizationId,
        locationId: location.id,
        locationName: location.name,
        incidentId,
        riskScore: assessment.score,
        riskLevel: assessment.level,
        summary: assessment.summary,
      });
    }

    await db
      .update(monitoringRuns)
      .set({ status: "ACTING" })
      .where(eq(monitoringRuns.id, monitoringRunId));
    const agentRunId = nanoid();
    await db
      .insert(agentRuns)
      .values({
        id: agentRunId,
        organizationId: input.organizationId,
        locationId: location.id,
        observationId,
        monitoringRunId,
        status: "RUNNING",
        startedAt: new Date(),
      });
    const plan = await createDecisionPlan({
      assessment,
      locationName: location.name,
    });
    const decisionId = nanoid();
    await db
      .insert(agentDecisions)
      .values({
        id: decisionId,
        agentRunId,
        riskLevel: assessment.level,
        summary: plan.summary,
        reasoningSummary: plan.reasoningSummary,
        decision: plan.decision,
        structuredOutput: plan.structuredOutput,
      });

    const actions = [] as Array<{
      id: string;
      actionType: string;
      status: string;
      permission: string;
      executionClass: "RECORD_ONLY" | "OPERATIONAL_CHANGE";
    }>;
    for (const proposed of plan.actions) {
      const permission = await permissionForAction(
        input.organizationId,
        proposed.actionType
      );
      const canAutoExecute =
        workspace.organization.agentMode === "AUTONOMOUS" &&
        permission === "SAFE_AUTO";
      const status =
        permission === "DISABLED"
          ? "CANCELLED"
          : canAutoExecute
            ? "COMPLETED"
            : permission === "APPROVAL_REQUIRED"
              ? "AWAITING_APPROVAL"
              : "PENDING";
      const executionClass =
        proposed.actionType === "ACTIVATE_HEATCHECK_PROTOCOL" && canAutoExecute
          ? ("OPERATIONAL_CHANGE" as const)
          : ("RECORD_ONLY" as const);
      const id = nanoid();
      await db
        .insert(agentActions)
        .values({
          id,
          organizationId: input.organizationId,
          agentRunId,
          decisionId,
          actionType: proposed.actionType,
          target: proposed.target,
          status,
          permission,
          executionResult: canAutoExecute
            ? executionClass === "OPERATIONAL_CHANGE"
              ? {
                  mode: "HEATCHECK_NATIVE",
                  executionClass,
                  protocolState: "ACTIVE",
                  result:
                    "Heatcheck internal heat-response protocol state was activated and logged; no external connector was called.",
                }
              : {
                  mode: "HEATCHECK_NATIVE",
                  executionClass,
                  result: "Recorded without external side effects.",
                }
            : {
                proposal: proposed.rationale,
                executionClass,
                requiresReview: status === "AWAITING_APPROVAL",
              },
        });
      actions.push({
        id,
        actionType: proposed.actionType,
        status,
        permission,
        executionClass,
      });
    }
    await db
      .update(agentRuns)
      .set({
        status:
          plan.status === "FAILED"
            ? "FAILED"
            : plan.status === "UNAVAILABLE"
              ? "UNAVAILABLE"
              : "COMPLETED",
        completedAt: new Date(),
      })
      .where(eq(agentRuns.id, agentRunId));
    await db
      .update(monitoringRuns)
      .set({ status: "VERIFYING" })
      .where(eq(monitoringRuns.id, monitoringRunId));
    await logEvent({
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      type: "agent.decision",
      message: plan.decision,
      payload: {
        decisionId,
        actionCount: actions.length,
        agentStatus: plan.status,
      },
    });

    if (!isVerificationEligible(actions)) {
      const nextAnalysisAt = nextAdaptiveAnalysisAt(assessment.score, workspace.organization.monitoringIntervalMinutes);
      await db
        .update(locations)
        .set({ lastAnalysisAt: new Date(), nextAnalysisAt })
        .where(eq(locations.id, location.id));
      await db
        .update(monitoringRuns)
        .set({ status: "COMPLETED", completedAt: new Date() })
        .where(eq(monitoringRuns.id, monitoringRunId));
      await logEvent({
        organizationId: input.organizationId,
        locationId: location.id,
        monitoringRunId,
        type: "verification.deferred",
        message:
          "Verification is waiting for a confirmed operational change; Heatcheck has only recorded, drafted, or approval-gated actions.",
        payload: {
          pendingActionCount: actions.filter(
            action =>
              action.status === "AWAITING_APPROVAL" ||
              action.status === "PENDING"
          ).length,
        },
      });
      await writeAuditLog({
        organizationId: input.organizationId,
        userId: input.userId,
        eventType: "monitoring.completed_verification_deferred",
        entityType: "monitoring_run",
        entityId: monitoringRunId,
        metadata: {
          mode,
          riskScore: assessment.score,
          incidentId,
          source: observation.source,
        },
      });
      return {
        monitoringRunId,
        observationId,
        verificationObservationId: null,
        incidentId,
        assessment,
        verificationAssessment: null,
        actions,
        mode,
        source: observation.source,
      };
    }

    let verification: NormalizedObservation;
    if (mode === "SIMULATION") {
      verification = phoenixVerificationSimulation(
        location.latitude,
        location.longitude
      );
    } else {
      try {
        verification = await getObservation({
          location,
          organizationId: input.organizationId,
          monitoringRunId,
        });
      } catch (error) {
        if (process.env.HEATCHECK_ALLOW_MOCK_FALLBACK !== "true") throw error;
        verification = phoenixVerificationSimulation(
          location.latitude,
          location.longitude
        );
        verification.summary = {
          ...verification.summary,
          providerFallback: true,
          fallbackReason:
            "Post-action live verification activity did not complete.",
        };
      }
    }
    const verificationAssessment = calculateHeatRisk(
      verification,
      verification.hotspots.reduce(
        (total, hotspot) => total + hotspot.workersExposed,
        0
      )
    );
    const verificationObservationId = nanoid();
    await db.insert(heatObservations).values({
      id: verificationObservationId,
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      observedAt: verification.observedAt,
      temperature: verification.temperature,
      minimumTemperature: verification.minimumTemperature,
      maximumTemperature: verification.maximumTemperature,
      meanTemperature: verification.meanTemperature,
      apparentTemperature: verification.apparentTemperature,
      heatIndex: verification.heatIndex,
      wetBulbTemperature: verification.wetBulbTemperature,
      relativeHumidity: verification.relativeHumidity,
      aqi: verification.aqi,
      pm25: verification.pm25,
      pm10: verification.pm10,
      solarIrradiance: verification.solarIrradiance,
      riskScore: verificationAssessment.score,
      riskLevel: verificationAssessment.level,
      operationalExposureScore: verificationAssessment.operationalExposureScore,
      source: verification.source,
      rawReference: verification.rawReference ?? null,
      summary: {
        ...verification.summary,
        factors: verificationAssessment.factors,
        verificationOfObservationId: observationId,
      },
    });
    await db
      .insert(hotspots)
      .values(
        verification.hotspots.map(hotspot => ({
          id: nanoid(),
          organizationId: input.organizationId,
          observationId: verificationObservationId,
          locationId: location.id,
          label: hotspot.label,
          latitude: hotspot.latitude,
          longitude: hotspot.longitude,
          temperature: hotspot.temperature,
          riskLevel: verificationAssessment.level,
          workersExposed: hotspot.workersExposed,
          metadata: hotspot.metadata ?? null,
        }))
      );
    await logEvent({
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      type: "verification.completed",
      message: `Post-action re-evaluation recorded: ${assessment.score}/100 → ${verificationAssessment.score}/100.`,
      payload: {
        baselineObservationId: observationId,
        verificationObservationId,
        baselineRisk: assessment.score,
        verificationRisk: verificationAssessment.score,
        source: verification.source,
      },
    });

    const nextAnalysisAt = nextAdaptiveAnalysisAt(verificationAssessment.score, workspace.organization.monitoringIntervalMinutes);
    await db
      .update(locations)
      .set({ lastAnalysisAt: new Date(), nextAnalysisAt })
      .where(eq(locations.id, location.id));
    await db
      .update(monitoringRuns)
      .set({ status: "COMPLETED", completedAt: new Date() })
      .where(eq(monitoringRuns.id, monitoringRunId));
    await writeAuditLog({
      organizationId: input.organizationId,
      userId: input.userId,
      eventType: "monitoring.completed",
      entityType: "monitoring_run",
      entityId: monitoringRunId,
      metadata: {
        mode,
        riskScore: assessment.score,
        incidentId,
        source: observation.source,
      },
    });
    return {
      monitoringRunId,
      observationId,
      verificationObservationId,
      incidentId,
      assessment,
      verificationAssessment,
      actions,
      mode,
      source: observation.source,
    };
  } catch (error) {
    await db
      .update(monitoringRuns)
      .set({
        status: "FAILED",
        error:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Unknown monitoring error",
        completedAt: new Date(),
      })
      .where(eq(monitoringRuns.id, monitoringRunId));
    await logEvent({
      organizationId: input.organizationId,
      locationId: location.id,
      monitoringRunId,
      type: "analysis.failed",
      message: "Heatcheck analysis did not complete.",
      payload: {
        error:
          error instanceof Error
            ? error.message.slice(0, 240)
            : "Unknown error",
      },
    });
    throw error;
  }
}

async function verifyAfterApproval(input: {
  organizationId: string;
  userId: number;
  actionId: string;
}) {
  const db = await requireDb();
  const action = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.id, input.actionId),
        eq(agentActions.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (!action[0]) return { verified: false, reason: "missing_action" };
  const agentRun = await db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, action[0].agentRunId))
    .limit(1);
  if (!agentRun[0]?.monitoringRunId)
    return { verified: false, reason: "missing_monitoring_run" };
  const monitoringRun = await db
    .select()
    .from(monitoringRuns)
    .where(eq(monitoringRuns.id, agentRun[0].monitoringRunId))
    .limit(1);
  const location = await db
    .select()
    .from(locations)
    .where(eq(locations.id, agentRun[0].locationId))
    .limit(1);
  const baseline = await db
    .select()
    .from(heatObservations)
    .where(eq(heatObservations.id, agentRun[0].observationId))
    .limit(1);
  const priorObservations = await db
    .select()
    .from(heatObservations)
    .where(eq(heatObservations.monitoringRunId, agentRun[0].monitoringRunId));
  if (
    !monitoringRun[0] ||
    !location[0] ||
    !baseline[0] ||
    priorObservations.length > 1
  )
    return { verified: false, reason: "already_verified_or_missing_context" };

  let verification: NormalizedObservation;
  if (monitoringRun[0].mode === "SIMULATION") {
    verification = phoenixVerificationSimulation(
      location[0].latitude,
      location[0].longitude
    );
  } else {
    try {
      verification = await getObservation({
        location: location[0],
        organizationId: input.organizationId,
        monitoringRunId: monitoringRun[0].id,
      });
    } catch {
      verification = phoenixVerificationSimulation(
        location[0].latitude,
        location[0].longitude
      );
      verification.summary = {
        ...verification.summary,
        providerFallback: true,
        fallbackReason:
          "Post-approval live verification activity did not complete.",
      };
    }
  }
  const assessment = calculateHeatRisk(
    verification,
    verification.hotspots.reduce(
      (total, hotspot) => total + hotspot.workersExposed,
      0
    )
  );
  const verificationObservationId = nanoid();
  await db.insert(heatObservations).values({
    id: verificationObservationId,
    organizationId: input.organizationId,
    locationId: location[0].id,
    monitoringRunId: monitoringRun[0].id,
    observedAt: verification.observedAt,
    temperature: verification.temperature,
    minimumTemperature: verification.minimumTemperature,
    maximumTemperature: verification.maximumTemperature,
    meanTemperature: verification.meanTemperature,
    apparentTemperature: verification.apparentTemperature,
    heatIndex: verification.heatIndex,
    wetBulbTemperature: verification.wetBulbTemperature,
    relativeHumidity: verification.relativeHumidity,
    aqi: verification.aqi,
    pm25: verification.pm25,
    pm10: verification.pm10,
    solarIrradiance: verification.solarIrradiance,
    riskScore: assessment.score,
    riskLevel: assessment.level,
    operationalExposureScore: assessment.operationalExposureScore,
    source: verification.source,
    rawReference: verification.rawReference ?? null,
    summary: {
      ...verification.summary,
      factors: assessment.factors,
      verificationOfObservationId: baseline[0].id,
      approvalActionId: input.actionId,
    },
  });
  await db
    .insert(hotspots)
    .values(
      verification.hotspots.map(hotspot => ({
        id: nanoid(),
        organizationId: input.organizationId,
        observationId: verificationObservationId,
        locationId: location[0].id,
        label: hotspot.label,
        latitude: hotspot.latitude,
        longitude: hotspot.longitude,
        temperature: hotspot.temperature,
        riskLevel: assessment.level,
        workersExposed: hotspot.workersExposed,
        metadata: hotspot.metadata ?? null,
      }))
    );
  await logEvent({
    organizationId: input.organizationId,
    locationId: location[0].id,
    monitoringRunId: monitoringRun[0].id,
    type: "verification.completed",
    message: `Post-approval re-evaluation recorded: ${baseline[0].riskScore}/100 → ${assessment.score}/100.`,
    payload: {
      baselineObservationId: baseline[0].id,
      verificationObservationId,
      approvalActionId: input.actionId,
    },
  });
  return { verified: true, verificationObservationId, assessment };
}

export async function approveAction(input: {
  userId: number;
  organizationId: string;
  actionId: string;
}) {
  const workspace = await requireWorkspaceMember(
    input.userId,
    input.organizationId
  );
  requireAdministratorRole(workspace.role);
  const db = await requireDb();
  const action = await db
    .select()
    .from(agentActions)
    .where(
      and(
        eq(agentActions.id, input.actionId),
        eq(agentActions.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (!action[0])
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Agent action not found in this organization.",
    });
  if (action[0].status !== "AWAITING_APPROVAL")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This action is not awaiting approval.",
    });
  await db
    .update(agentActions)
    .set({
      status: "COMPLETED",
      approvedByUserId: input.userId,
      executedAt: new Date(),
      executionResult: {
        approval: "recorded",
        externalDelivery: "not configured",
        note: "No external notification or schedule was sent by Heatcheck.",
      },
    })
    .where(eq(agentActions.id, input.actionId));
  const verification = {
    verified: false,
    reason: "external_execution_not_configured",
  } as const;
  await logEvent({
    organizationId: input.organizationId,
    type: "action.approved",
    message: `${action[0].actionType} was approved and recorded; no external delivery connector is configured.`,
    payload: { actionId: input.actionId },
  });
  await writeAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: "agent_action.approved",
    entityType: "agent_action",
    entityId: input.actionId,
    metadata: { actionType: action[0].actionType },
  });
  return { success: true, verification } as const;
}

export async function getDashboardData(input: {
  userId: number;
  organizationId: string;
}) {
  await requireWorkspaceMember(input.userId, input.organizationId);
  const db = await requireDb();
  const [
    workspace,
    organizationLocations,
    latestObservation,
    openIncidents,
    recentEvents,
    pendingActions,
    observationHistory,
    recentAgentRuns,
  ] = await Promise.all([
    requireWorkspaceMember(input.userId, input.organizationId),
    db
      .select()
      .from(locations)
      .where(eq(locations.organizationId, input.organizationId)),
    db
      .select()
      .from(heatObservations)
      .where(eq(heatObservations.organizationId, input.organizationId))
      .orderBy(desc(heatObservations.observedAt))
      .limit(1),
    db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.organizationId, input.organizationId),
          eq(incidents.status, "OPEN")
        )
      )
      .orderBy(desc(incidents.startedAt))
      .limit(10),
    db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.organizationId, input.organizationId))
      .orderBy(desc(activityEvents.createdAt))
      .limit(20),
    db
      .select()
      .from(agentActions)
      .where(
        and(
          eq(agentActions.organizationId, input.organizationId),
          eq(agentActions.status, "AWAITING_APPROVAL")
        )
      )
      .orderBy(desc(agentActions.createdAt))
      .limit(20),
    db
      .select()
      .from(heatObservations)
      .where(eq(heatObservations.organizationId, input.organizationId))
      .orderBy(desc(heatObservations.observedAt))
      .limit(12),
    db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.organizationId, input.organizationId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(8),
  ]);
  const observation = latestObservation[0] ?? null;
  const latestHotspots = observation
    ? await db
        .select()
        .from(hotspots)
        .where(eq(hotspots.observationId, observation.id))
    : [];
  const agentRunIds = recentAgentRuns.map(run => run.id);
  const decisions = agentRunIds.length
    ? await db
        .select()
        .from(agentDecisions)
        .where(inArray(agentDecisions.agentRunId, agentRunIds))
    : [];
  const decisionByRun = new Map(
    decisions.map(decision => [decision.agentRunId, decision])
  );
  const analytics = observationHistory.length
    ? {
        sampleCount: observationHistory.length,
        averageRisk: Math.round(
          observationHistory.reduce((sum, row) => sum + row.riskScore, 0) /
            observationHistory.length
        ),
        highestRisk: Math.max(...observationHistory.map(row => row.riskScore)),
        trend: [...observationHistory]
          .reverse()
          .map(row => ({
            observedAt: row.observedAt,
            riskScore: row.riskScore,
            riskLevel: row.riskLevel,
          })),
      }
    : { sampleCount: 0, averageRisk: null, highestRisk: null, trend: [] };
  return {
    workspace: { organization: workspace.organization, role: workspace.role },
    provider: {
      managed: true as const,
      mode:
        process.env.HEATCHECK_MOCK_MODE !== "true" &&
        process.env.FORTYGUARD_ENABLED !== "false" &&
        Boolean(process.env.FORTYGUARD_API_KEY)
          ? ("LIVE" as const)
          : ("FALLBACK" as const),
    },
    locations: organizationLocations,
    latestObservation: observation,
    hotspots: latestHotspots,
    openIncidents,
    recentEvents,
    pendingActions,
    analytics,
    agentRuns: recentAgentRuns.map(run => ({
      ...run,
      decision: decisionByRun.get(run.id) ?? null,
    })),
  };
}

/** Runs only due locations and is invoked by the platform-authenticated scheduled callback. */
export async function runDueMonitoring() {
  const db = await requireDb();
  const now = new Date();
  const enabledLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.monitoringEnabled, true));
  const dueLocations = enabledLocations
    .filter(
      location => !location.nextAnalysisAt || location.nextAnalysisAt <= now
    )
    .slice(0, 20);
  const results: Array<{
    locationId: string;
    status: "COMPLETED" | "SKIPPED" | "FAILED";
    message?: string;
  }> = [];

  for (const location of dueLocations) {
    const owner = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, location.organizationId),
          eq(organizationMembers.role, "OWNER")
        )
      )
      .limit(1);
    if (!owner[0]) {
      results.push({
        locationId: location.id,
        status: "SKIPPED",
        message:
          "No organization owner is available for the monitoring audit context.",
      });
      continue;
    }
    try {
      await runMonitoring({
        userId: owner[0].userId,
        organizationId: location.organizationId,
        locationId: location.id,
        requestedBy: "SCHEDULE",
      });
      results.push({ locationId: location.id, status: "COMPLETED" });
    } catch (error) {
      if (error instanceof TRPCError && error.code === "CONFLICT") {
        results.push({
          locationId: location.id,
          status: "SKIPPED",
          message: "Analysis already running.",
        });
      } else {
        results.push({
          locationId: location.id,
          status: "FAILED",
          message:
            error instanceof Error
              ? error.message.slice(0, 180)
              : "Unknown monitoring error",
        });
      }
    }
  }
  return {
    scanned: enabledLocations.length,
    due: dueLocations.length,
    results,
  };
}
