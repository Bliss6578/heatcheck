import { describe, expect, it } from "vitest";
import { FortyGuardClient } from "./fortyguard";
import { calculateHeatRisk } from "./riskEngine";
import { phoenixSimulation, phoenixVerificationSimulation } from "./simulation";

describe("FortyGuard normalization and verification fixtures", () => {
  it("maps the documented colon-form PM keys without converting unavailable values to zero", () => {
    const client = new FortyGuardClient("test-key");
    const observation = client.normalize({
      heatmap: { status: "Completed", raw: {}, result: { stats_data: { Temperature_stats: { Minimum: 34, Maximum: 41, Mean: 38 } } } },
      environment: { status: "Completed", raw: {}, result: { locations: [{ temperature: 38, parameters: { "air_quality_pm2p5:idx": [71], "air_quality_pm10:idx": [84], apparent_temperature_celsius: [43], heat_index_celsius: [42], wet_bulb_temperature_celsius: [28], relative_humidity_percent: [35], "air_quality:idx": [93] }, solar_irradiance: { clear_sky: { ghi: 750 } } }] } },
      latitude: 33.4484,
      longitude: -112.074,
    });
    expect(observation.pm25).toBe(71);
    expect(observation.pm10).toBe(84);
    expect(observation.aqi).toBe(93);
  });

  it("preserves heatmap evidence when environmental parameters are unavailable", () => {
    const observation = new FortyGuardClient("test-key").normalize({
      heatmap: {
        status: "Completed",
        raw: {},
        result: {
          stats_data: {
            Temperature_stats: { Minimum: 32, Maximum: 39, Mean: 36 },
          },
        },
      },
      environment: { status: "Unavailable", raw: {}, result: {} },
      latitude: 33.4484,
      longitude: -112.074,
    });

    expect(observation.temperature).toBe(36);
    expect(observation.maximumTemperature).toBe(39);
    expect(observation.relativeHumidity).toBeNull();
    expect(observation.source).toBe("FORTYGUARD");
  });

  it("uses a clearly labelled verification fixture with a lower deterministic risk than the simulated baseline", () => {
    const baseline = phoenixSimulation(33.4484, -112.074);
    const verification = phoenixVerificationSimulation(33.4484, -112.074);
    const baselineScore = calculateHeatRisk(baseline, baseline.hotspots.reduce((sum, hotspot) => sum + hotspot.workersExposed, 0)).score;
    const verificationScore = calculateHeatRisk(verification, verification.hotspots.reduce((sum, hotspot) => sum + hotspot.workersExposed, 0)).score;
    expect(verification.summary.verification).toBe(true);
    expect(verificationScore).toBeLessThan(baselineScore);
  });
});
