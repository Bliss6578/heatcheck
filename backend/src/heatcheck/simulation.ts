import type { NormalizedObservation } from "./types";

/**
 * Explicit simulation fixtures for the Phoenix Distribution Center journey.
 * These values are only returned from Simulation Mode and are never represented as live provider data.
 */
export function phoenixSimulation(latitude: number, longitude: number): NormalizedObservation {
  const observedAt = new Date();
  return {
    observedAt,
    temperature: 41.8,
    minimumTemperature: 37.2,
    maximumTemperature: 43.1,
    meanTemperature: 40.2,
    apparentTemperature: 46.1,
    heatIndex: 45.4,
    wetBulbTemperature: 28.7,
    relativeHumidity: 38,
    aqi: 96,
    pm25: 28,
    pm10: 54,
    solarIrradiance: 881,
    source: "SIMULATION",
    rawReference: "simulation:phoenix-distribution-center:v1",
    summary: { mode: "SIMULATION", locationProfile: "Phoenix Distribution Center", fixtureVersion: "v1" },
    hotspots: [
      { label: "Loading Dock", latitude: latitude + 0.00052, longitude: longitude + 0.00071, temperature: 43.1, workersExposed: 21, metadata: { surface: "concrete apron" } },
      { label: "North Yard", latitude: latitude + 0.00092, longitude: longitude - 0.00066, temperature: 40.8, workersExposed: 8, metadata: { surface: "staging yard" } },
      { label: "Roof Plant", latitude: latitude - 0.00043, longitude: longitude + 0.00032, temperature: 39.7, workersExposed: 3, metadata: { surface: "roof equipment" } },
    ],
  };
}

export function phoenixVerificationSimulation(latitude: number, longitude: number): NormalizedObservation {
  const baseline = phoenixSimulation(latitude, longitude);
  return {
    ...baseline,
    observedAt: new Date(),
    temperature: 36.9,
    minimumTemperature: 34.8,
    maximumTemperature: 38.1,
    meanTemperature: 36.4,
    apparentTemperature: 39.7,
    heatIndex: 39.2,
    wetBulbTemperature: 25.8,
    relativeHumidity: 31,
    aqi: 78,
    pm25: 19,
    pm10: 40,
    solarIrradiance: 520,
    rawReference: "simulation:phoenix-distribution-center:verification:v1",
    summary: { mode: "SIMULATION", locationProfile: "Phoenix Distribution Center", fixtureVersion: "v1", verification: true },
    hotspots: baseline.hotspots.map((hotspot, index) => ({ ...hotspot, temperature: [38.1, 36.7, 35.9][index], workersExposed: index === 0 ? 6 : hotspot.workersExposed })),
  };
}
