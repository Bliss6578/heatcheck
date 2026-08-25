import { describe, expect, it } from "vitest";
import { FortyGuardClient } from "./fortyguard";

const runLiveProbe = process.env.FORTYGUARD_API_KEY ? describe : describe.skip;

runLiveProbe("FortyGuard Live Mode credential", () => {
  it("submits a bounded environmental analysis with the server-side credential", async () => {
    const client = new FortyGuardClient();
    expect(client.isConfigured).toBe(true);

    const result = await client.submitEnvironmentalParameters({
      latitude: 33.4484,
      longitude: -112.074,
      temperature: 36,
      occurredAt: new Date(),
    });

    expect(result.endpoint).toBe("env_params");
    expect(result.activityId).toEqual(expect.any(String));
    expect(result.activityId.length).toBeGreaterThan(4);
  }, 30_000);
});
