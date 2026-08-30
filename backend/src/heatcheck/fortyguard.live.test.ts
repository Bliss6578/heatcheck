import { describe, expect, it } from "vitest";
import { extractHeatmapGeojson, FortyGuardClient } from "./fortyguard";
import { createBoundingPolygon } from "./geo";

const runLiveProbe = process.env.FORTYGUARD_API_KEY ? describe : describe.skip;
const runRegionalProbe = process.env.FORTYGUARD_API_KEY && process.env.RUN_FORTYGUARD_REGIONAL_TESTS === "true" ? describe : describe.skip;

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

  it("returns renderable thermal cells in the documented map_data shape", async () => {
    const latitude = 40.7115;
    const longitude = -74.01;
    const client = new FortyGuardClient();
    const submitted = await client.submitHeatmap({
      latitude,
      longitude,
      polygonGeojson: createBoundingPolygon(latitude, longitude, 0.7),
      occurredAt: new Date("2024-07-15T14:00:00Z"),
    });
    const completed = await client.awaitActivity(submitted.activityId);
    const geojson = extractHeatmapGeojson(completed.result);
    const features = Array.isArray(geojson?.features) ? geojson.features : [];

    expect(completed.status.toLowerCase()).toBe("completed");
    expect(features.length).toBeGreaterThan(0);
    expect(features[0]).toMatchObject({
      properties: { average_temperature: expect.any(Number) },
    });
  }, 60_000);
});

runRegionalProbe("FortyGuard regional capability matrix", () => {
  it.each([
    ["Phoenix", 33.4484, -112.074],
    ["North Bengal", 26.7125, 88.4153],
  ])("accepts environmental analysis for %s", async (_region, latitude, longitude) => {
    const result = await new FortyGuardClient().submitEnvironmentalParameters({
      latitude, longitude, temperature: 36, occurredAt: new Date(),
    });
    expect(result.activityId).toEqual(expect.any(String));
  }, 30_000);

  it("reports restricted street-view regions as a controlled capability error", async () => {
    try {
      const result = await new FortyGuardClient().submitStreetView(26.7125, 88.4153);
      expect(result.activityId).toEqual(expect.any(String));
    } catch (error) {
      expect(error).toMatchObject({ code: expect.stringMatching(/FORBIDDEN|INVALID_REQUEST|NOT_FOUND/) });
    }
  }, 30_000);
});
