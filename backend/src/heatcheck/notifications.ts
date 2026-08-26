import { nanoid } from "nanoid";
import { notificationLogs } from "../../drizzle/schema.js";
import { getDb } from "../db.js";

type Alert = { organizationId: string; locationId: string; locationName: string; incidentId: string; riskScore: number; riskLevel: string; summary: string };
async function record(input: Alert, channel: string, status: "SENT" | "FAILED", message: string, error?: string) { const db = await getDb(); if (db) await db.insert(notificationLogs).values({ id: nanoid(), organizationId: input.organizationId, channel, status, message, metadata: { incidentId: input.incidentId, locationId: input.locationId, error } }); }
async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) { const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Provider returned ${response.status}`); }

export async function deliverManagedHeatAlert(input: Alert) {
  const message = `${input.riskLevel} heat risk at ${input.locationName} (${input.riskScore}/100): ${input.summary}`;
  const channels: Array<{ name: string; send: () => Promise<void> }> = [];
  if (process.env.HEATCHECK_ALERT_WEBHOOK_URL) channels.push({ name: "WEBHOOK", send: () => postJson(process.env.HEATCHECK_ALERT_WEBHOOK_URL!, { event: "heatcheck.incident.opened", text: message, ...input }) });
  if (process.env.SLACK_WEBHOOK_URL) channels.push({ name: "SLACK", send: () => postJson(process.env.SLACK_WEBHOOK_URL!, { text: `🔥 ${message}` }) });
  if (process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_TO) channels.push({ name: "EMAIL", send: () => postJson("https://api.resend.com/emails", { from: process.env.ALERT_EMAIL_FROM ?? "HeatCheck <alerts@heatcheck.app>", to: [process.env.ALERT_EMAIL_TO], subject: `HeatCheck alert: ${input.locationName}`, text: message }, { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }) });
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER && process.env.ALERT_SMS_TO) channels.push({ name: "SMS", send: async () => { const body = new URLSearchParams({ From: process.env.TWILIO_FROM_NUMBER!, To: process.env.ALERT_SMS_TO!, Body: message.slice(0, 1500) }); const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) }); if (!response.ok) throw new Error(`Twilio returned ${response.status}`); } });
  const results = await Promise.all(channels.map(async channel => { try { await channel.send(); await record(input, channel.name, "SENT", message); return { channel: channel.name, delivered: true }; } catch (cause) { const error = cause instanceof Error ? cause.message : "Delivery failed"; await record(input, channel.name, "FAILED", message, error); return { channel: channel.name, delivered: false }; } }));
  return { configured: channels.length > 0, delivered: results.some(result => result.delivered), channels: results };
}
