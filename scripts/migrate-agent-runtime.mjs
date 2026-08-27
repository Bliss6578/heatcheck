import "dotenv/config";
import mysql from "mysql2/promise";
import tzLookup from "tz-lookup";

if (!process.env.DATABASE_URL) {
  console.log("Agent runtime migration skipped: DATABASE_URL is not available.");
  process.exit(0);
}

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const columns = [
  ["organizations", "notificationPolicy", "ALTER TABLE `organizations` ADD `notificationPolicy` json"],
  ["organizations", "providerPolicy", "ALTER TABLE `organizations` ADD `providerPolicy` json"],
  ["autonomous_agent_runs", "idempotencyKey", "ALTER TABLE `autonomous_agent_runs` ADD `idempotencyKey` varchar(100)"],
  ["autonomous_agent_runs", "monitoringRunId", "ALTER TABLE `autonomous_agent_runs` ADD `monitoringRunId` varchar(36)"],
  ["autonomous_agent_runs", "operationalAgentRunId", "ALTER TABLE `autonomous_agent_runs` ADD `operationalAgentRunId` varchar(36)"],
  ["autonomous_agent_runs", "cancelRequested", "ALTER TABLE `autonomous_agent_runs` ADD `cancelRequested` boolean NOT NULL DEFAULT false"],
  ["autonomous_agent_runs", "lastHeartbeatAt", "ALTER TABLE `autonomous_agent_runs` ADD `lastHeartbeatAt` timestamp"],
  ["autonomous_agent_events", "sequence", "ALTER TABLE `autonomous_agent_events` ADD `sequence` int NOT NULL DEFAULT 0"],
];

let applied = 0;
try {
  for (const [table, column, statement] of columns) {
    const [existing] = await connection.query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1", [table, column]);
    if (existing.length === 0) { await connection.query(statement); applied += 1; }
  }
  const [index] = await connection.query("SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=? LIMIT 1", ["autonomous_agent_runs", "autonomous_runs_org_idempotency_uidx"]);
  if (index.length === 0) { await connection.query("CREATE UNIQUE INDEX `autonomous_runs_org_idempotency_uidx` ON `autonomous_agent_runs` (`organizationId`,`idempotencyKey`)"); applied += 1; }
  const [timezoneColumn] = await connection.query("SELECT COLUMN_DEFAULT AS columnDefault FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='locations' AND COLUMN_NAME='timezone' LIMIT 1");
  if (timezoneColumn[0]?.columnDefault !== "UTC") {
    await connection.query("ALTER TABLE `locations` MODIFY `timezone` varchar(80) NOT NULL DEFAULT 'UTC'");
    applied += 1;
  }
  const [locationRows] = await connection.query("SELECT `id`, `latitude`, `longitude`, `timezone` FROM `locations`");
  let correctedTimezones = 0;
  for (const location of locationRows) {
    let timezone = "UTC";
    try { timezone = tzLookup(Number(location.latitude), Number(location.longitude)); } catch { /* retain UTC */ }
    if (timezone !== location.timezone) {
      await connection.query("UPDATE `locations` SET `timezone`=? WHERE `id`=?", [timezone, location.id]);
      correctedTimezones += 1;
    }
  }
  const [staleRuns] = await connection.query("UPDATE `monitoring_runs` SET `status`='FAILED', `error`='The analysis was interrupted before completion.', `completedAt`=UTC_TIMESTAMP() WHERE `status` IN ('ANALYZING','EVALUATING','ACTING','VERIFYING') AND `createdAt` < UTC_TIMESTAMP() - INTERVAL 6 MINUTE");
  console.log(`Agent runtime schema ready; applied ${applied} missing change(s), corrected ${correctedTimezones} location timezone(s), and released ${staleRuns.affectedRows ?? 0} stale monitoring run(s).`);
} finally {
  await connection.end();
}
