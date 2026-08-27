import type { NormalizedObservation, RiskAssessment, RiskLevel } from "./types.js";

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const presentScore = (value: number | null, start: number, end: number) =>
  value === null ? 0 : clamp(((value - start) / (end - start)) * 100);

export function riskLevelForScore(score: number): RiskLevel {
  if (score >= 90) return "CRITICAL";
  if (score >= 76) return "SEVERE";
  if (score >= 61) return "HIGH";
  if (score >= 36) return "MODERATE";
  return "LOW";
}

export function calculateHeatRisk(
  observation: NormalizedObservation,
  workersExposed: number,
  context: {
    heatAnomaly?: number | null;
    vegetationFraction?: number | null;
    builtUpFraction?: number | null;
  } = {}
): RiskAssessment {
  const temperatureValue =
    observation.maximumTemperature ?? observation.temperature;
  const apparentValue =
    observation.apparentTemperature ?? observation.heatIndex;
  const exposure = clamp((workersExposed / 30) * 100);
  const candidates = [
    {
      factor: "Ambient temperature",
      value: temperatureValue,
      score: presentScore(temperatureValue, 28, 46),
      weight: 0.23,
    },
    {
      factor: "Apparent temperature",
      value: apparentValue,
      score: presentScore(apparentValue, 30, 50),
      weight: 0.25,
    },
    {
      factor: "Wet-bulb temperature",
      value: observation.wetBulbTemperature,
      score: presentScore(observation.wetBulbTemperature, 20, 34),
      weight: 0.2,
    },
    {
      factor: "Humidity",
      value: observation.relativeHumidity,
      score: presentScore(observation.relativeHumidity, 35, 85),
      weight: 0.03,
    },
    {
      factor: "Solar load",
      value: observation.solarIrradiance,
      score: presentScore(observation.solarIrradiance, 150, 950),
      weight: 0.12,
    },
    {
      factor: "Air-quality context",
      value: observation.aqi,
      score: presentScore(observation.aqi, 50, 200),
      weight: 0.02,
    },
    {
      factor: "Operational exposure",
      value: workersExposed,
      score: exposure,
      weight: 0.15,
    },
    {
      factor: "Local heat anomaly",
      value: context.heatAnomaly ?? null,
      score: presentScore(context.heatAnomaly ?? null, 0, 8),
      weight: 0.08,
    },
    {
      factor: "Low vegetation cover",
      value: context.vegetationFraction ?? null,
      score: context.vegetationFraction == null ? 0 : clamp((1 - context.vegetationFraction) * 100),
      weight: 0.08,
    },
    {
      factor: "Built-up surface",
      value: context.builtUpFraction ?? null,
      score: context.builtUpFraction == null ? 0 : clamp(context.builtUpFraction * 100),
      weight: 0.08,
    },
  ].filter(item => item.value !== null);
  const availableWeight = candidates.reduce(
    (sum, item) => sum + item.weight,
    0
  );
  const factors = candidates.map(item => ({
    ...item,
    weight: item.weight / availableWeight,
    contribution: item.score * (item.weight / availableWeight),
  }));

  const score = Math.round(
    clamp(factors.reduce((total, item) => total + item.contribution, 0))
  );
  const level = riskLevelForScore(score);
  return {
    score,
    level,
    operationalExposureScore: Math.round(exposure),
    factors,
    summary: `${level} operational heat risk (${score}/100) based on thermal, humidity, solar, land-cover, anomaly, air-quality, and exposure inputs.`,
  };
}
