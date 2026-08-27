ALTER TABLE `organizations` ADD `notificationPolicy` json;
ALTER TABLE `organizations` ADD `providerPolicy` json;
ALTER TABLE `autonomous_agent_runs` ADD `idempotencyKey` varchar(100);
ALTER TABLE `autonomous_agent_runs` ADD `monitoringRunId` varchar(36);
ALTER TABLE `autonomous_agent_runs` ADD `operationalAgentRunId` varchar(36);
ALTER TABLE `autonomous_agent_runs` ADD `cancelRequested` boolean NOT NULL DEFAULT false;
ALTER TABLE `autonomous_agent_runs` ADD `lastHeartbeatAt` timestamp;
CREATE UNIQUE INDEX `autonomous_runs_org_idempotency_uidx` ON `autonomous_agent_runs` (`organizationId`,`idempotencyKey`);
ALTER TABLE `autonomous_agent_events` ADD `sequence` int NOT NULL DEFAULT 0;
