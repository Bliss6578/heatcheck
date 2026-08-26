import { nanoid } from "nanoid";
import { notificationLogs } from "../../drizzle/schema.js";
import { getDb } from "../db.js";

export async function deliverManagedHeatAlert(input: {
  organizationId: string; locationId: string; locationName: string;
  incidentId: string; riskScore: number; riskLevel: string; summary: string;
}) {
  const url = process.env.HEATCHECK_ALERT_WEBHOOK_URL;
  if (!url) return { configured: false, delivered: false };
  const db = await getDb();
  const message = `${input.riskLevel} heat risk at ${input.locationName} (${input.riskScore}/100)`;
  let status: "SENT" | "FAILED" = "FAILED";
  let error: string | undefined;
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "heatcheck.incident.opened", text: message, ...input }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    status = "SENT";
  } catch (cause) { error = cause instanceof Error ? cause.message : "Delivery failed"; }
  if (db) await db.insert(notificationLogs).values({
    id: nanoid(), organizationId: input.organizationId, channel: "MANAGED_WEBHOOK",
    status, message, metadata: { incidentId: input.incidentId, locationId: input.locationId, error },
  });
  return { configured: true, delivered: status === "SENT" };
}
