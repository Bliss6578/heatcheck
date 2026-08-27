import "dotenv/config";
import mysql from "mysql2/promise";

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
  console.log(`Agent runtime schema ready; applied ${applied} missing change(s).`);
} finally {
  await connection.end();
}
