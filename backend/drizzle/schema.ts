import {
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Identity records are synchronized by the managed OAuth flow. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const organizations = mysqlTable("organizations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  agentMode: mysqlEnum("agentMode", ["OBSERVE", "RECOMMEND", "AUTONOMOUS"])
    .default("OBSERVE")
    .notNull(),
  riskThreshold: int("riskThreshold").default(76).notNull(),
  monitoringIntervalMinutes: int("monitoringIntervalMinutes")
    .default(15)
    .notNull(),
  simulationMode: boolean("simulationMode").default(true).notNull(),
  notificationPolicy: json("notificationPolicy"),
  providerPolicy: json("providerPolicy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const organizationMembers = mysqlTable(
  "organization_members",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    role: mysqlEnum("role", ["OWNER", "ADMIN", "OPERATOR", "VIEWER"])
      .default("VIEWER")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("organization_members_org_idx").on(table.organizationId),
    index("organization_members_user_idx").on(table.userId),
  ]
);

export const locations = mysqlTable(
  "locations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    latitude: double("latitude").notNull(),
    longitude: double("longitude").notNull(),
    polygonGeojson: json("polygonGeojson"),
    timezone: varchar("timezone", { length: 80 })
      .default("UTC")
      .notNull(),
    monitoringEnabled: boolean("monitoringEnabled").default(true).notNull(),
    riskThreshold: int("riskThreshold").default(76).notNull(),
    lastAnalysisAt: timestamp("lastAnalysisAt"),
    nextAnalysisAt: timestamp("nextAnalysisAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("locations_org_idx").on(table.organizationId)]
);

export const workers = mysqlTable(
  "workers",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    active: boolean("active").default(true).notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("workers_org_location_idx").on(
      table.organizationId,
      table.locationId
    ),
  ]
);

export const assets = mysqlTable(
  "assets",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }),
    name: varchar("name", { length: 160 }).notNull(),
    assetType: varchar("assetType", { length: 64 }).notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("assets_org_location_idx").on(table.organizationId, table.locationId),
  ]
);

export const monitoringRuns = mysqlTable(
  "monitoring_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    status: mysqlEnum("status", [
      "QUEUED",
      "ANALYZING",
      "EVALUATING",
      "ACTING",
      "VERIFYING",
      "COMPLETED",
      "FAILED",
    ])
      .default("QUEUED")
      .notNull(),
    mode: mysqlEnum("mode", ["LIVE", "SIMULATION"])
      .default("SIMULATION")
      .notNull(),
    requestedByUserId: int("requestedByUserId"),
    error: text("error"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("monitoring_runs_location_status_idx").on(
      table.locationId,
      table.status
    ),
  ]
);

export const fortyguardJobs = mysqlTable(
  "fortyguard_jobs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    monitoringRunId: varchar("monitoringRunId", { length: 36 }),
    endpoint: varchar("endpoint", { length: 80 }).notNull(),
    activityId: varchar("activityId", { length: 100 }),
    requestPayload: json("requestPayload"),
    status: mysqlEnum("status", [
      "QUEUED",
      "SUBMITTED",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
    ])
      .default("QUEUED")
      .notNull(),
    result: json("result"),
    error: text("error"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
  },
  table => [
    index("fortyguard_jobs_activity_idx").on(table.activityId),
    index("fortyguard_jobs_location_idx").on(table.locationId),
  ]
);

export const heatObservations = mysqlTable(
  "heat_observations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    monitoringRunId: varchar("monitoringRunId", { length: 36 }),
    observedAt: timestamp("observedAt").notNull(),
    temperature: double("temperature"),
    minimumTemperature: double("minimumTemperature"),
    maximumTemperature: double("maximumTemperature"),
    meanTemperature: double("meanTemperature"),
    apparentTemperature: double("apparentTemperature"),
    heatIndex: double("heatIndex"),
    wetBulbTemperature: double("wetBulbTemperature"),
    relativeHumidity: double("relativeHumidity"),
    aqi: double("aqi"),
    pm25: double("pm25"),
    pm10: double("pm10"),
    solarIrradiance: double("solarIrradiance"),
    riskScore: int("riskScore").notNull(),
    riskLevel: mysqlEnum("riskLevel", [
      "LOW",
      "MODERATE",
      "HIGH",
      "SEVERE",
      "CRITICAL",
    ]).notNull(),
    operationalExposureScore: int("operationalExposureScore")
      .default(0)
      .notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    rawReference: varchar("rawReference", { length: 512 }),
    summary: json("summary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("observations_location_time_idx").on(
      table.locationId,
      table.observedAt
    ),
  ]
);

export const hotspots = mysqlTable(
  "hotspots",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    observationId: varchar("observationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    latitude: double("latitude").notNull(),
    longitude: double("longitude").notNull(),
    temperature: double("temperature").notNull(),
    riskLevel: mysqlEnum("riskLevel", [
      "LOW",
      "MODERATE",
      "HIGH",
      "SEVERE",
      "CRITICAL",
    ]).notNull(),
    workersExposed: int("workersExposed").default(0).notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("hotspots_observation_idx").on(table.observationId)]
);

export const incidents = mysqlTable(
  "incidents",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    observationId: varchar("observationId", { length: 36 }),
    severity: mysqlEnum("severity", [
      "LOW",
      "MODERATE",
      "HIGH",
      "SEVERE",
      "CRITICAL",
    ]).notNull(),
    riskScore: int("riskScore").notNull(),
    status: mysqlEnum("status", ["OPEN", "MONITORING", "MITIGATED", "RESOLVED"])
      .default("OPEN")
      .notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    summary: text("summary").notNull(),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("incidents_org_status_idx").on(table.organizationId, table.status),
  ]
);

export const agentRuns = mysqlTable(
  "agent_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    observationId: varchar("observationId", { length: 36 }).notNull(),
    monitoringRunId: varchar("monitoringRunId", { length: 36 }),
    status: mysqlEnum("status", [
      "SKIPPED",
      "RUNNING",
      "COMPLETED",
      "UNAVAILABLE",
      "FAILED",
    ])
      .default("SKIPPED")
      .notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("agent_runs_location_idx").on(table.locationId)]
);

export const agentDecisions = mysqlTable(
  "agent_decisions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    agentRunId: varchar("agentRunId", { length: 36 }).notNull(),
    riskLevel: mysqlEnum("riskLevel", [
      "LOW",
      "MODERATE",
      "HIGH",
      "SEVERE",
      "CRITICAL",
    ]).notNull(),
    summary: text("summary").notNull(),
    reasoningSummary: text("reasoningSummary").notNull(),
    decision: varchar("decision", { length: 80 }).notNull(),
    structuredOutput: json("structuredOutput"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("agent_decisions_run_idx").on(table.agentRunId)]
);

export const agentActions = mysqlTable(
  "agent_actions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    agentRunId: varchar("agentRunId", { length: 36 }).notNull(),
    decisionId: varchar("decisionId", { length: 36 }),
    actionType: varchar("actionType", { length: 96 }).notNull(),
    target: varchar("target", { length: 240 }).notNull(),
    status: mysqlEnum("status", [
      "PENDING",
      "AWAITING_APPROVAL",
      "EXECUTING",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ])
      .default("PENDING")
      .notNull(),
    permission: mysqlEnum("permission", [
      "SAFE_AUTO",
      "APPROVAL_REQUIRED",
      "DISABLED",
    ])
      .default("APPROVAL_REQUIRED")
      .notNull(),
    approvedByUserId: int("approvedByUserId"),
    executionResult: json("executionResult"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    executedAt: timestamp("executedAt"),
  },
  table => [
    index("agent_actions_org_status_idx").on(
      table.organizationId,
      table.status
    ),
  ]
);

export const activityEvents = mysqlTable(
  "activity_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    locationId: varchar("locationId", { length: 36 }),
    monitoringRunId: varchar("monitoringRunId", { length: 36 }),
    type: varchar("type", { length: 120 }).notNull(),
    message: text("message").notNull(),
    payload: json("payload"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("activity_events_org_time_idx").on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

export const actionPermissions = mysqlTable(
  "action_permissions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    actionType: varchar("actionType", { length: 96 }).notNull(),
    permission: mysqlEnum("permission", [
      "SAFE_AUTO",
      "APPROVAL_REQUIRED",
      "DISABLED",
    ])
      .default("APPROVAL_REQUIRED")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("action_permissions_org_type_idx").on(
      table.organizationId,
      table.actionType
    ),
  ]
);

export const integrations = mysqlTable(
  "integrations",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    provider: varchar("provider", { length: 80 }).notNull(),
    status: mysqlEnum("status", [
      "DISCONNECTED",
      "CONFIGURED",
      "ACTIVE",
      "ERROR",
    ])
      .default("DISCONNECTED")
      .notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("integrations_org_idx").on(table.organizationId)]
);

export const notificationLogs = mysqlTable(
  "notification_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    channel: varchar("channel", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["QUEUED", "SENT", "FAILED"])
      .default("QUEUED")
      .notNull(),
    message: text("message").notNull(),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("notifications_org_idx").on(table.organizationId)]
);

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }),
    userId: int("userId"),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    entityType: varchar("entityType", { length: 80 }),
    entityId: varchar("entityId", { length: 36 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("audit_logs_org_time_idx").on(table.organizationId, table.createdAt),
  ]
);

export const autonomousAgentRuns = mysqlTable(
  "autonomous_agent_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    userId: int("userId").notNull(),
    locationId: varchar("locationId", { length: 36 }).notNull(),
    goal: varchar("goal", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    plannerType: varchar("plannerType", { length: 32 }).notNull(),
    llmProvider: varchar("llmProvider", { length: 32 }).notNull(),
    llmModel: varchar("llmModel", { length: 100 }).notNull(),
    fallbackUsed: boolean("fallbackUsed").default(false).notNull(),
    stepsUsed: int("stepsUsed").default(0).notNull(),
    toolCallsUsed: int("toolCallsUsed").default(0).notNull(),
    riskScore: int("riskScore"),
    riskLevel: varchar("riskLevel", { length: 32 }),
    result: json("result"),
    errorCode: varchar("errorCode", { length: 64 }),
    idempotencyKey: varchar("idempotencyKey", { length: 100 }),
    monitoringRunId: varchar("monitoringRunId", { length: 36 }),
    operationalAgentRunId: varchar("operationalAgentRunId", { length: 36 }),
    cancelRequested: boolean("cancelRequested").default(false).notNull(),
    lastHeartbeatAt: timestamp("lastHeartbeatAt"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("autonomous_runs_org_time_idx").on(
      table.organizationId,
      table.createdAt
    ),
    index("autonomous_runs_location_idx").on(table.locationId),
    uniqueIndex("autonomous_runs_org_idempotency_uidx").on(table.organizationId, table.idempotencyKey),
  ]
);

export const autonomousAgentEvents = mysqlTable(
  "autonomous_agent_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 }).notNull(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    message: text("message").notNull(),
    metadata: json("metadata"),
    sequence: int("sequence").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("autonomous_events_run_idx").on(table.runId)]
);

export const autonomousAgentToolCalls = mysqlTable(
  "autonomous_agent_tool_calls",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    runId: varchar("runId", { length: 36 }).notNull(),
    organizationId: varchar("organizationId", { length: 36 }).notNull(),
    toolName: varchar("toolName", { length: 96 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    durationMs: int("durationMs").notNull(),
    inputJson: json("inputJson"),
    outputSummary: json("outputSummary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("autonomous_tool_calls_run_idx").on(table.runId)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type HeatObservation = typeof heatObservations.$inferSelect;
export type Hotspot = typeof hotspots.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type AgentAction = typeof agentActions.$inferSelect;
