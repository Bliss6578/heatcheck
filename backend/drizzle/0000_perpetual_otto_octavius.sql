CREATE TABLE `action_permissions` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`actionType` varchar(96) NOT NULL,
	`permission` enum('SAFE_AUTO','APPROVAL_REQUIRED','DISABLED') NOT NULL DEFAULT 'APPROVAL_REQUIRED',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `action_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `activity_events` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36),
	`monitoringRunId` varchar(36),
	`type` varchar(120) NOT NULL,
	`message` text NOT NULL,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_actions` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`agentRunId` varchar(36) NOT NULL,
	`decisionId` varchar(36),
	`actionType` varchar(96) NOT NULL,
	`target` varchar(240) NOT NULL,
	`status` enum('PENDING','AWAITING_APPROVAL','EXECUTING','COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`permission` enum('SAFE_AUTO','APPROVAL_REQUIRED','DISABLED') NOT NULL DEFAULT 'APPROVAL_REQUIRED',
	`approvedByUserId` int,
	`executionResult` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`executedAt` timestamp,
	CONSTRAINT `agent_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_decisions` (
	`id` varchar(36) NOT NULL,
	`agentRunId` varchar(36) NOT NULL,
	`riskLevel` enum('LOW','MODERATE','HIGH','SEVERE','CRITICAL') NOT NULL,
	`summary` text NOT NULL,
	`reasoningSummary` text NOT NULL,
	`decision` varchar(80) NOT NULL,
	`structuredOutput` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_decisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`observationId` varchar(36) NOT NULL,
	`monitoringRunId` varchar(36),
	`status` enum('SKIPPED','RUNNING','COMPLETED','UNAVAILABLE','FAILED') NOT NULL DEFAULT 'SKIPPED',
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agent_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36),
	`name` varchar(160) NOT NULL,
	`assetType` varchar(64) NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36),
	`userId` int,
	`eventType` varchar(120) NOT NULL,
	`entityType` varchar(80),
	`entityId` varchar(36),
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `autonomous_agent_events` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`type` varchar(80) NOT NULL,
	`message` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `autonomous_agent_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `autonomous_agent_runs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`goal` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`plannerType` varchar(32) NOT NULL,
	`llmProvider` varchar(32) NOT NULL,
	`llmModel` varchar(100) NOT NULL,
	`fallbackUsed` boolean NOT NULL DEFAULT false,
	`stepsUsed` int NOT NULL DEFAULT 0,
	`toolCallsUsed` int NOT NULL DEFAULT 0,
	`riskScore` int,
	`riskLevel` varchar(32),
	`result` json,
	`errorCode` varchar(64),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `autonomous_agent_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `autonomous_agent_tool_calls` (
	`id` varchar(36) NOT NULL,
	`runId` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`toolName` varchar(96) NOT NULL,
	`status` varchar(32) NOT NULL,
	`durationMs` int NOT NULL,
	`inputJson` json,
	`outputSummary` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `autonomous_agent_tool_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `fortyguard_jobs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`monitoringRunId` varchar(36),
	`endpoint` varchar(80) NOT NULL,
	`activityId` varchar(100),
	`requestPayload` json,
	`status` enum('QUEUED','SUBMITTED','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
	`result` json,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `fortyguard_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `heat_observations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`monitoringRunId` varchar(36),
	`observedAt` timestamp NOT NULL,
	`temperature` double,
	`minimumTemperature` double,
	`maximumTemperature` double,
	`meanTemperature` double,
	`apparentTemperature` double,
	`heatIndex` double,
	`wetBulbTemperature` double,
	`relativeHumidity` double,
	`aqi` double,
	`pm25` double,
	`pm10` double,
	`solarIrradiance` double,
	`riskScore` int NOT NULL,
	`riskLevel` enum('LOW','MODERATE','HIGH','SEVERE','CRITICAL') NOT NULL,
	`operationalExposureScore` int NOT NULL DEFAULT 0,
	`source` varchar(64) NOT NULL,
	`rawReference` varchar(512),
	`summary` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `heat_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `hotspots` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`observationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`label` varchar(160) NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`temperature` double NOT NULL,
	`riskLevel` enum('LOW','MODERATE','HIGH','SEVERE','CRITICAL') NOT NULL,
	`workersExposed` int NOT NULL DEFAULT 0,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `hotspots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`observationId` varchar(36),
	`severity` enum('LOW','MODERATE','HIGH','SEVERE','CRITICAL') NOT NULL,
	`riskScore` int NOT NULL,
	`status` enum('OPEN','MONITORING','MITIGATED','RESOLVED') NOT NULL DEFAULT 'OPEN',
	`title` varchar(240) NOT NULL,
	`summary` text NOT NULL,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`provider` varchar(80) NOT NULL,
	`status` enum('DISCONNECTED','CONFIGURED','ACTIVE','ERROR') NOT NULL DEFAULT 'DISCONNECTED',
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`polygonGeojson` json,
	`timezone` varchar(80) NOT NULL DEFAULT 'America/Phoenix',
	`monitoringEnabled` boolean NOT NULL DEFAULT true,
	`riskThreshold` int NOT NULL DEFAULT 76,
	`lastAnalysisAt` timestamp,
	`nextAnalysisAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitoring_runs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36) NOT NULL,
	`status` enum('QUEUED','ANALYZING','EVALUATING','ACTING','VERIFYING','COMPLETED','FAILED') NOT NULL DEFAULT 'QUEUED',
	`mode` enum('LIVE','SIMULATION') NOT NULL DEFAULT 'SIMULATION',
	`requestedByUserId` int,
	`error` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `monitoring_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notification_logs` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`channel` varchar(64) NOT NULL,
	`status` enum('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'QUEUED',
	`message` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('OWNER','ADMIN','OPERATOR','VIEWER') NOT NULL DEFAULT 'VIEWER',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organization_members_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(36) NOT NULL,
	`name` varchar(160) NOT NULL,
	`agentMode` enum('OBSERVE','RECOMMEND','AUTONOMOUS') NOT NULL DEFAULT 'OBSERVE',
	`riskThreshold` int NOT NULL DEFAULT 76,
	`monitoringIntervalMinutes` int NOT NULL DEFAULT 15,
	`simulationMode` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` varchar(36) NOT NULL,
	`organizationId` varchar(36) NOT NULL,
	`locationId` varchar(36),
	`displayName` varchar(160) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `action_permissions_org_type_idx` ON `action_permissions` (`organizationId`,`actionType`);--> statement-breakpoint
CREATE INDEX `activity_events_org_time_idx` ON `activity_events` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `agent_actions_org_status_idx` ON `agent_actions` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `agent_decisions_run_idx` ON `agent_decisions` (`agentRunId`);--> statement-breakpoint
CREATE INDEX `agent_runs_location_idx` ON `agent_runs` (`locationId`);--> statement-breakpoint
CREATE INDEX `assets_org_location_idx` ON `assets` (`organizationId`,`locationId`);--> statement-breakpoint
CREATE INDEX `audit_logs_org_time_idx` ON `audit_logs` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `autonomous_events_run_idx` ON `autonomous_agent_events` (`runId`);--> statement-breakpoint
CREATE INDEX `autonomous_runs_org_time_idx` ON `autonomous_agent_runs` (`organizationId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `autonomous_runs_location_idx` ON `autonomous_agent_runs` (`locationId`);--> statement-breakpoint
CREATE INDEX `autonomous_tool_calls_run_idx` ON `autonomous_agent_tool_calls` (`runId`);--> statement-breakpoint
CREATE INDEX `fortyguard_jobs_activity_idx` ON `fortyguard_jobs` (`activityId`);--> statement-breakpoint
CREATE INDEX `fortyguard_jobs_location_idx` ON `fortyguard_jobs` (`locationId`);--> statement-breakpoint
CREATE INDEX `observations_location_time_idx` ON `heat_observations` (`locationId`,`observedAt`);--> statement-breakpoint
CREATE INDEX `hotspots_observation_idx` ON `hotspots` (`observationId`);--> statement-breakpoint
CREATE INDEX `incidents_org_status_idx` ON `incidents` (`organizationId`,`status`);--> statement-breakpoint
CREATE INDEX `integrations_org_idx` ON `integrations` (`organizationId`);--> statement-breakpoint
CREATE INDEX `locations_org_idx` ON `locations` (`organizationId`);--> statement-breakpoint
CREATE INDEX `monitoring_runs_location_status_idx` ON `monitoring_runs` (`locationId`,`status`);--> statement-breakpoint
CREATE INDEX `notifications_org_idx` ON `notification_logs` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organization_members_org_idx` ON `organization_members` (`organizationId`);--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organization_members` (`userId`);--> statement-breakpoint
CREATE INDEX `workers_org_location_idx` ON `workers` (`organizationId`,`locationId`);