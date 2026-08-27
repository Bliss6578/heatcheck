import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { notificationLogs, organizations } from "../../drizzle/schema.js";
import { getDb } from "../db.js";

type Alert = { organizationId: string; locationId: string; locationName: string; incidentId: string; riskScore: number; riskLevel: string; summary: string };
async function record(input: Alert, channel: string, status: "SENT" | "FAILED", message: string, error?: string) { const db = await getDb(); if (db) await db.insert(notificationLogs).values({ id: nanoid(), organizationId: input.organizationId, channel, status, message, metadata: { incidentId: input.incidentId, locationId: input.locationId, error } }); }
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Provider returned ${response.status}`); }

export async function deliverManagedHeatAlert(input: Alert) {
  const message = `${input.riskLevel} heat risk at ${input.locationName} (${input.riskScore}/100): ${input.summary}`;
  const db = await getDb();
  const organization = db ? (await db.select().from(organizations).where(eq(organizations.id, input.organizationId)).limit(1))[0] : null;
  const policy = (organization?.notificationPolicy ?? {}) as { enabledChannels?: string[]; emailTo?: string; smsTo?: string; minimumRiskScore?: number; quietHoursUtc?: { start: number; end: number } };
  if (input.riskScore < Number(policy.minimumRiskScore ?? 0)) return { configured: true, delivered: false, suppressed: "BELOW_ORGANIZATION_THRESHOLD", channels: [] };
  const hour = new Date().getUTCHours(); const quiet = policy.quietHoursUtc;
  if (quiet && (quiet.start <= quiet.end ? hour >= quiet.start && hour < quiet.end : hour >= quiet.start || hour < quiet.end)) return { configured: true, delivered: false, suppressed: "QUIET_HOURS", channels: [] };
  const enabled = new Set((policy.enabledChannels ?? ["WEBHOOK", "SLACK", "EMAIL", "SMS"]).map(value => value.toUpperCase()));
  const channels: Array<{ name: string; send: () => Promise<void> }> = [];
  if (enabled.has("WEBHOOK") && process.env.HEATCHECK_ALERT_WEBHOOK_URL) channels.push({ name: "WEBHOOK", send: () => postJson(process.env.HEATCHECK_ALERT_WEBHOOK_URL!, { event: "heatcheck.incident.opened", text: message, ...input }) });
  if (enabled.has("SLACK") && process.env.SLACK_WEBHOOK_URL) channels.push({ name: "SLACK", send: () => postJson(process.env.SLACK_WEBHOOK_URL!, { text: `🔥 ${message}` }) });
  const emailTo = policy.emailTo ?? process.env.ALERT_EMAIL_TO;
  if (enabled.has("EMAIL") && process.env.RESEND_API_KEY && emailTo) channels.push({ name: "EMAIL", send: () => postJson("https://api.resend.com/emails", { from: process.env.ALERT_EMAIL_FROM ?? "HeatCheck <alerts@heatcheck.app>", to: [emailTo], subject: `HeatCheck alert: ${input.locationName}`, text: message }, { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }) });
  const smsTo = policy.smsTo ?? process.env.ALERT_SMS_TO;
  if (enabled.has("SMS") && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && smsTo) channels.push({ name: "SMS", send: async () => { const body = new URLSearchParams({ From: process.env.TWILIO_FROM_NUMBER!, To: smsTo, Body: message.slice(0, 1500) }); const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Twilio returned ${response.status}`); } });
  const results = await Promise.all(channels.map(async channel => { try { await channel.send(); await record(input, channel.name, "SENT", message); return { channel: channel.name, delivered: true }; } catch (cause) { const error = cause instanceof Error ? cause.message : "Delivery failed"; await record(input, channel.name, "FAILED", message, error); return { channel: channel.name, delivered: false }; } }));
  return { configured: channels.length > 0, delivered: results.some(result => result.delivered), channels: results };
}
