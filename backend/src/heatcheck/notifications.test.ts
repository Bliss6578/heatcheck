import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({ getDb: vi.fn().mockResolvedValue(null) }));

import { deliverManagedHeatAlert } from "./notifications";

const managedKeys = [
  "HEATCHECK_ALERT_WEBHOOK_URL", "SLACK_WEBHOOK_URL", "RESEND_API_KEY",
  "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO", "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "ALERT_SMS_TO",
] as const;

const alert = {
  organizationId: "org-1", locationId: "location-1", locationName: "Phoenix",
  incidentId: "incident-1", riskScore: 91, riskLevel: "CRITICAL",
  summary: "Immediate controls required.",
};

beforeEach(() => managedKeys.forEach(key => delete process.env[key]));
afterEach(() => { vi.unstubAllGlobals(); managedKeys.forEach(key => delete process.env[key]); });

describe("managed alert delivery", () => {
  it("does not require users to provide credentials", async () => {
    await expect(deliverManagedHeatAlert(alert)).resolves.toEqual({
      configured: false, delivered: false, channels: [],
    });
  });

  it("delivers webhook, Slack, email, and SMS through server credentials", async () => {
    Object.assign(process.env, {
      HEATCHECK_ALERT_WEBHOOK_URL: "https://alerts.example.test/hook",
      SLACK_WEBHOOK_URL: "https://hooks.slack.test/heatcheck",
      RESEND_API_KEY: "resend-test", ALERT_EMAIL_TO: "ops@example.test",
      TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "twilio-test",
      TWILIO_FROM_NUMBER: "+15550000001", ALERT_SMS_TO: "+15550000002",
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await deliverManagedHeatAlert(alert);
    expect(result.configured).toBe(true);
    expect(result.delivered).toBe(true);
    expect(result.channels.map(channel => channel.channel)).toEqual([
      "WEBHOOK", "SLACK", "EMAIL", "SMS",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("undefined");
  });

  it("isolates one provider failure from the other channels", async () => {
    Object.assign(process.env, {
      SLACK_WEBHOOK_URL: "https://hooks.slack.test/heatcheck",
      RESEND_API_KEY: "resend-test", ALERT_EMAIL_TO: "ops@example.test",
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("failed", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })));
    const result = await deliverManagedHeatAlert(alert);
    expect(result.channels).toEqual([
      { channel: "SLACK", delivered: false },
      { channel: "EMAIL", delivered: true },
    ]);
  });
});
