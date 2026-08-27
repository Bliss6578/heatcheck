import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  activityEvents,
  agentActions,
  agentDecisions,
  agentRuns,
  assets,
  auditLogs,
  autonomousAgentEvents,
  autonomousAgentRuns,
  autonomousAgentToolCalls,
  fortyguardJobs,
  heatObservations,
  hotspots,
  incidents,
  locations,
  monitoringRuns,
  organizationMembers,
  organizations,
  workers,
  type Location,
  type Organization,
} from "../../drizzle/schema.js";
import { getDb } from "../db.js";
import { timezoneForCoordinates } from "./timezone.js";

export type OrganizationRole = "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER";

export type WorkspaceContext = {
  organization: Organization;
  role: OrganizationRole;
};

export type LocationInput = {
  name: string;
  latitude: number;
  longitude: number;
  polygonGeojson?: unknown;
  timezone?: string;
  riskThreshold: number;
  monitoringEnabled: boolean;
};

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Heatcheck data service is unavailable. Please try again shortly.",
    });
  }
  return db;
}

export async function getWorkspaceForUser(userId: number): Promise<WorkspaceContext | null> {
  const db = await requireDb();
  const membership = await db
    .select()
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);

  if (!membership[0]) return null;
  const organization = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, membership[0].organizationId))
    .limit(1);

  if (!organization[0]) return null;
  return { organization: organization[0], role: membership[0].role as OrganizationRole };
}

export async function requireWorkspaceMember(userId: number, organizationId: string): Promise<WorkspaceContext> {
  const db = await requireDb();
  const membership = await db
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.organizationId, organizationId)))
    .limit(1);

  if (!membership[0]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this Heatcheck organization." });
  }

  const organization = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Heatcheck organization not found." });
  }
  return { organization: organization[0], role: membership[0].role as OrganizationRole };
}

export function requireOperatorRole(role: OrganizationRole) {
  if (role === "VIEWER") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Operator, administrator, or owner access is required." });
  }
}

export function requireAdministratorRole(role: OrganizationRole) {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Administrator or owner access is required." });
  }
}

export async function writeAuditLog(input: {
  organizationId?: string;
  userId?: number;
  eventType: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = await requireDb();
  await db.insert(auditLogs).values({
    id: nanoid(),
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    eventType: input.eventType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function createWorkspace(input: {
  userId: number;
  name: string;
  agentMode: "OBSERVE" | "RECOMMEND" | "AUTONOMOUS";
  riskThreshold: number;
}) {
  const db = await requireDb();
  const organizationId = nanoid();
  await db.insert(organizations).values({
    id: organizationId,
    name: input.name,
    agentMode: input.agentMode,
    riskThreshold: input.riskThreshold,
    simulationMode: !Boolean(process.env.FORTYGUARD_API_KEY),
  });
  await db.insert(organizationMembers).values({
    id: nanoid(),
    organizationId,
    userId: input.userId,
    role: "OWNER",
  });
  await writeAuditLog({
    organizationId,
    userId: input.userId,
    eventType: "organization.created",
    entityType: "organization",
    entityId: organizationId,
    metadata: { simulationMode: !Boolean(process.env.FORTYGUARD_API_KEY) },
  });
  return (await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1))[0];
}

export async function createLocation(input: { userId: number; organizationId: string } & LocationInput) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId);
  requireOperatorRole(workspace.role);
  const db = await requireDb();
  const locationId = nanoid();
  await db.insert(locations).values({
    id: locationId,
    organizationId: input.organizationId,
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    polygonGeojson: input.polygonGeojson ?? null,
    timezone: timezoneForCoordinates(input.latitude, input.longitude),
    monitoringEnabled: input.monitoringEnabled,
    riskThreshold: input.riskThreshold,
  });
  await writeAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: "location.created",
    entityType: "location",
    entityId: locationId,
    metadata: { monitoringEnabled: input.monitoringEnabled, riskThreshold: input.riskThreshold },
  });
  return (await db.select().from(locations).where(eq(locations.id, locationId)).limit(1))[0];
}

export async function listLocationsForWorkspace(userId: number, organizationId: string): Promise<Location[]> {
  await requireWorkspaceMember(userId, organizationId);
  const db = await requireDb();
  return db.select().from(locations).where(eq(locations.organizationId, organizationId));
}

export async function deleteLocation(input: {
  userId: number;
  organizationId: string;
  locationId: string;
}) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId);
  requireOperatorRole(workspace.role);
  const location = await requireLocationMember(
    input.userId,
    input.organizationId,
    input.locationId
  );
  const db = await requireDb();

  await db.transaction(async tx => {
    const operationalRuns = await tx
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.locationId, location.id));
    const operationalRunIds = operationalRuns.map(run => run.id);
    if (operationalRunIds.length) {
      await tx
        .delete(agentActions)
        .where(inArray(agentActions.agentRunId, operationalRunIds));
      await tx
        .delete(agentDecisions)
        .where(inArray(agentDecisions.agentRunId, operationalRunIds));
    }

    const autonomousRuns = await tx
      .select({ id: autonomousAgentRuns.id })
      .from(autonomousAgentRuns)
      .where(eq(autonomousAgentRuns.locationId, location.id));
    const autonomousRunIds = autonomousRuns.map(run => run.id);
    if (autonomousRunIds.length) {
      await tx
        .delete(autonomousAgentEvents)
        .where(inArray(autonomousAgentEvents.runId, autonomousRunIds));
      await tx
        .delete(autonomousAgentToolCalls)
        .where(inArray(autonomousAgentToolCalls.runId, autonomousRunIds));
    }

    await tx.delete(agentRuns).where(eq(agentRuns.locationId, location.id));
    await tx
      .delete(autonomousAgentRuns)
      .where(eq(autonomousAgentRuns.locationId, location.id));
    await tx.delete(hotspots).where(eq(hotspots.locationId, location.id));
    await tx.delete(incidents).where(eq(incidents.locationId, location.id));
    await tx
      .delete(heatObservations)
      .where(eq(heatObservations.locationId, location.id));
    await tx
      .delete(fortyguardJobs)
      .where(eq(fortyguardJobs.locationId, location.id));
    await tx
      .delete(activityEvents)
      .where(eq(activityEvents.locationId, location.id));
    await tx
      .delete(monitoringRuns)
      .where(eq(monitoringRuns.locationId, location.id));
    await tx.delete(workers).where(eq(workers.locationId, location.id));
    await tx.delete(assets).where(eq(assets.locationId, location.id));
    await tx
      .delete(locations)
      .where(
        and(
          eq(locations.id, location.id),
          eq(locations.organizationId, input.organizationId)
        )
      );
  });

  await writeAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: "location.deleted",
    entityType: "location",
    entityId: location.id,
    metadata: { name: location.name },
  });
  return { id: location.id, name: location.name };
}

export async function requireLocationMember(userId: number, organizationId: string, locationId: string): Promise<Location> {
  await requireWorkspaceMember(userId, organizationId);
  const db = await requireDb();
  const location = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.organizationId, organizationId)))
    .limit(1);
  if (!location[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Location not found in this organization." });
  }
  return location[0];
}

export async function updateLocationMonitoring(input: {
  userId: number;
  organizationId: string;
  locationId: string;
  monitoringEnabled: boolean;
  riskThreshold: number;
}) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId);
  requireOperatorRole(workspace.role);
  await requireLocationMember(input.userId, input.organizationId, input.locationId);
  const db = await requireDb();
  await db
    .update(locations)
    .set({ monitoringEnabled: input.monitoringEnabled, riskThreshold: input.riskThreshold })
    .where(and(eq(locations.id, input.locationId), eq(locations.organizationId, input.organizationId)));
  await writeAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: "location.monitoring_updated",
    entityType: "location",
    entityId: input.locationId,
    metadata: { monitoringEnabled: input.monitoringEnabled, riskThreshold: input.riskThreshold },
  });
}

export async function updateWorkspaceSettings(input: {
  userId: number;
  organizationId: string;
  agentMode: "OBSERVE" | "RECOMMEND" | "AUTONOMOUS";
}) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId);
  requireAdministratorRole(workspace.role);
  const db = await requireDb();
  await db.update(organizations).set({ agentMode: input.agentMode }).where(eq(organizations.id, input.organizationId));
  await writeAuditLog({
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: "organization.agent_mode_updated",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: { agentMode: input.agentMode },
  });
}

export async function updateWorkspacePolicies(input: { userId: number; organizationId: string; notificationPolicy?: Record<string, unknown>; providerPolicy?: Record<string, unknown> }) {
  const workspace = await requireWorkspaceMember(input.userId, input.organizationId); requireAdministratorRole(workspace.role); const db = await requireDb();
  await db.update(organizations).set({ ...(input.notificationPolicy ? { notificationPolicy: input.notificationPolicy } : {}), ...(input.providerPolicy ? { providerPolicy: input.providerPolicy } : {}) }).where(eq(organizations.id, input.organizationId));
  await writeAuditLog({ organizationId: input.organizationId, userId: input.userId, eventType: "organization.policies_updated", entityType: "organization", entityId: input.organizationId, metadata: { notificationPolicyUpdated: Boolean(input.notificationPolicy), providerPolicyUpdated: Boolean(input.providerPolicy) } });
}
