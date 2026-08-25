import { describe, expect, it } from "vitest";
import { calculateHeatRisk, riskLevelForScore } from "./riskEngine";
import { phoenixSimulation } from "./simulation";

describe("Heatcheck deterministic risk engine", () => {
  it("maps the operational score to transparent risk tiers", () => {
    expect(riskLevelForScore(0)).toBe("LOW");
    expect(riskLevelForScore(36)).toBe("MODERATE");
    expect(riskLevelForScore(61)).toBe("HIGH");
    expect(riskLevelForScore(76)).toBe("SEVERE");
    expect(riskLevelForScore(90)).toBe("CRITICAL");
  });

  it("marks the Phoenix fixture as simulation data and produces a severe exposure assessment", () => {
    const observation = phoenixSimulation(33.4484, -112.074);
    const assessment = calculateHeatRisk(observation, observation.hotspots.reduce((sum, hotspot) => sum + hotspot.workersExposed, 0));

    expect(observation.source).toBe("SIMULATION");
    expect(observation.summary.mode).toBe("SIMULATION");
    expect(assessment.score).toBeGreaterThanOrEqual(76);
    expect(["SEVERE", "CRITICAL"]).toContain(assessment.level);
    expect(assessment.factors).toHaveLength(7);
  });

  it("renormalizes available inputs instead of treating missing values as zero risk", () => {
    const observation = { ...phoenixSimulation(40.7128, -74.006), apparentTemperature: null, heatIndex: null, wetBulbTemperature: null, relativeHumidity: null, aqi: null, solarIrradiance: null };
    const assessment = calculateHeatRisk(observation, 0);
    expect(assessment.factors.map((factor) => factor.factor)).toEqual(["Ambient temperature", "Operational exposure"]);
    expect(assessment.factors.reduce((sum, factor) => sum + factor.weight, 0)).toBeCloseTo(1);
  });
});
