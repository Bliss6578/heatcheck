import { beforeEach, describe, expect, it, vi } from "vitest";

const tenantMocks = vi.hoisted(() => ({
  requireWorkspaceMember: vi.fn(),
  requireLocationMember: vi.fn(),
  requireOperatorRole: vi.fn(),
  requireAdministratorRole: vi.fn(),
  writeAuditLog: vi.fn(),
}));
const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("./tenant", () => tenantMocks);
vi.mock("../db", () => dbMocks);

import { approveAction, getDashboardData, runMonitoring } from "./monitoring";

function createDb(selectResults: unknown[][]) {
  const inserted: unknown[] = [];
  const select = vi.fn(() => ({
    from: () => ({
      where: () => {
        const result = selectResults.shift() ?? [];
        const query = {
          limit: () => Promise.resolve(result),
          orderBy: () => query,
          then: (onFulfilled: (value: unknown[]) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(result).then(onFulfilled, onRejected),
        };
        return query;
      },
    }),
  }));
  const insert = vi.fn(() => ({ values: (value: unknown) => { inserted.push(value); return Promise.resolve(); } }));
  const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  return { db: { select, insert, update }, inserted };
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantMocks.requireLocationMember.mockResolvedValue({ id: "location-001", organizationId: "org-001", name: "Phoenix Distribution Center", latitude: 33.4484, longitude: -112.074, polygonGeojson: null, timezone: "America/Phoenix", monitoringEnabled: true, riskThreshold: 76, lastAnalysisAt: null, nextAnalysisAt: null });
  tenantMocks.requireOperatorRole.mockReturnValue(undefined);
  tenantMocks.requireAdministratorRole.mockReturnValue(undefined);
  tenantMocks.writeAuditLog.mockResolvedValue(undefined);
});

describe("Heatcheck monitoring workflow integration", () => {
  it("persists the baseline simulation observation and defers verification when only record, draft, and approval-gated actions exist", async () => {
    const { db, inserted } = createDb([[], [], [], [], []]);
    dbMocks.getDb.mockResolvedValue(db);
    tenantMocks.requireWorkspaceMember.mockResolvedValue({ organization: { id: "org-001", simulationMode: true, agentMode: "RECOMMEND", monitoringIntervalMinutes: 15 }, role: "OPERATOR" });

    const result = await runMonitoring({ userId: 7, organizationId: "org-001", locationId: "location-001", requestedBy: "USER" });

    expect(result.mode).toBe("SIMULATION");
    expect(result.source).toBe("SIMULATION");
    expect(result.verificationObservationId).toBeNull();
    expect(result.actions.every((action) => action.executionClass === "RECORD_ONLY")).toBe(true);
    expect(inserted.filter((entry) => !Array.isArray(entry) && typeof entry === "object" && entry !== null && "source" in entry)).toHaveLength(1);
  });

  it("records approval without claiming that an unconfigured external execution was verified", async () => {
    const { db } = createDb([[{ id: "action-001", organizationId: "org-001", agentRunId: "run-001", status: "AWAITING_APPROVAL", actionType: "DRAFT_HEAT_ALERT" }]]);
    dbMocks.getDb.mockResolvedValue(db);
    tenantMocks.requireWorkspaceMember.mockResolvedValue({ organization: { id: "org-001" }, role: "OWNER" });

    const result = await approveAction({ userId: 7, organizationId: "org-001", actionId: "action-001" });

    expect(result).toMatchObject({ success: true, verification: { verified: false, reason: "external_execution_not_configured" } });
    expect(tenantMocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ eventType: "agent_action.approved", entityId: "action-001" }));
  });

  it("persists a post-action re-evaluation after an autonomous Heatcheck protocol-state execution", async () => {
    const { db, inserted } = createDb([[], [], [], [], [], []]);
    dbMocks.getDb.mockResolvedValue(db);
    tenantMocks.requireWorkspaceMember.mockResolvedValue({ organization: { id: "org-001", simulationMode: true, agentMode: "AUTONOMOUS", monitoringIntervalMinutes: 15 }, role: "OPERATOR" });

    const result = await runMonitoring({ userId: 7, organizationId: "org-001", locationId: "location-001", requestedBy: "USER" });

    expect(result.verificationObservationId).toEqual(expect.any(String));
    expect(result.actions).toContainEqual(expect.objectContaining({ actionType: "ACTIVATE_HEATCHECK_PROTOCOL", status: "COMPLETED", executionClass: "OPERATIONAL_CHANGE" }));
    expect(inserted.filter((entry) => !Array.isArray(entry) && typeof entry === "object" && entry !== null && "source" in entry)).toHaveLength(2);
  });

  it("aggregates persisted thermal, incident, activity, agent, and analytics data for the protected dashboard", async () => {
    const now = new Date();
    const observation = { id: "observation-001", organizationId: "org-001", riskScore: 84, riskLevel: "SEVERE", observedAt: now };
    const priorObservation = { id: "observation-000", organizationId: "org-001", riskScore: 65, riskLevel: "HIGH", observedAt: new Date(now.getTime() - 60_000) };
    const { db } = createDb([
      [{ id: "location-001", organizationId: "org-001", name: "Phoenix Distribution Center" }],
      [observation],
      [{ id: "incident-001", organizationId: "org-001", riskScore: 84, severity: "SEVERE", status: "OPEN" }],
      [{ id: "event-001", organizationId: "org-001", message: "Heat incident opened", createdAt: now }],
      [{ id: "action-001", organizationId: "org-001", status: "AWAITING_APPROVAL" }],
      [observation, priorObservation],
      [{ id: "agent-run-001", organizationId: "org-001", locationId: "location-001", status: "COMPLETED", createdAt: now }],
      [{ id: "hotspot-001", observationId: "observation-001", label: "Loading Dock", temperature: 43.1 }],
      [{ id: "decision-001", agentRunId: "agent-run-001", riskLevel: "SEVERE", decision: "Activate protocol", summary: "Severe heat response" }],
    ]);
    dbMocks.getDb.mockResolvedValue(db);
    tenantMocks.requireWorkspaceMember.mockResolvedValue({ organization: { id: "org-001", name: "Phoenix Operations" }, role: "OWNER" });

    const dashboard = await getDashboardData({ userId: 7, organizationId: "org-001" });

    expect(dashboard.latestObservation?.riskScore).toBe(84);
    expect(dashboard.hotspots).toHaveLength(1);
    expect(dashboard.openIncidents).toHaveLength(1);
    expect(dashboard.recentEvents).toHaveLength(1);
    expect(dashboard.pendingActions).toHaveLength(1);
    expect(dashboard.agentRuns[0]?.decision?.decision).toBe("Activate protocol");
    expect(dashboard.analytics).toMatchObject({ sampleCount: 2, averageRisk: 75, highestRisk: 84 });
  });
});
