import { riskLevelForScore } from "./riskEngine";
import type { RiskLevel } from "./types";

type Position = [number, number];
export type PolygonFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: { type: "Polygon"; coordinates: Position[][] };
  }>;
};

export function createBoundingPolygon(
  latitude: number,
  longitude: number,
  radiusKm = 1
): PolygonFeatureCollection {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    throw new Error("Latitude must be between -90 and 90.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    throw new Error("Longitude must be between -180 and 180.");
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 25)
    throw new Error("Radius must be greater than 0 and no more than 25 km.");
  const latDelta = radiusKm / 110.574;
  const lngDelta =
    radiusKm / (111.32 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  const ring: Position[] = [
    [longitude - lngDelta, latitude - latDelta],
    [longitude + lngDelta, latitude - latDelta],
    [longitude + lngDelta, latitude + latDelta],
    [longitude - lngDelta, latitude + latDelta],
    [longitude - lngDelta, latitude - latDelta],
  ];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

function centroid(coordinates: unknown): Position | null {
  const points: Position[] = [];
  const visit = (value: unknown) => {
    if (
      Array.isArray(value) &&
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    )
      points.push([value[0], value[1]]);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  return points.length
    ? [
        points.reduce((sum, p) => sum + p[0], 0) / points.length,
        points.reduce((sum, p) => sum + p[1], 0) / points.length,
      ]
    : null;
}

export type DetectedHotspot = {
  id: string;
  latitude: number;
  longitude: number;
  temperature: number;
  anomaly: number;
  riskScore: number;
  riskLevel: RiskLevel;
};
export function detectHotspots(geojson: unknown): DetectedHotspot[] {
  const features =
    geojson && typeof geojson === "object"
      ? (geojson as { features?: unknown[] }).features
      : undefined;
  if (!Array.isArray(features)) return [];
  const cells = features.flatMap((feature, index) => {
    if (!feature || typeof feature !== "object") return [];
    const item = feature as {
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: unknown };
    };
    const properties = item.properties ?? {};
    const temperature = ["temperature", "Temperature", "tcm", "value"]
      .map(key => properties[key])
      .find(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value)
      );
    const center = centroid(item.geometry?.coordinates);
    return temperature === undefined || !center
      ? []
      : [{ index, temperature, center }];
  });
  if (!cells.length) return [];
  const mean =
    cells.reduce((sum, cell) => sum + cell.temperature, 0) / cells.length;
  return cells
    .filter(cell => cell.temperature - mean >= 1)
    .map(cell => {
      const anomaly = cell.temperature - mean;
      const riskScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(((cell.temperature - 25) / 20) * 75 + anomaly * 5)
        )
      );
      return {
        id: `hotspot-${cell.index}`,
        latitude: cell.center[1],
        longitude: cell.center[0],
        temperature: cell.temperature,
        anomaly,
        riskScore,
        riskLevel: riskLevelForScore(riskScore),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

const riskOrder: RiskLevel[] = [
  "LOW",
  "MODERATE",
  "HIGH",
  "SEVERE",
  "CRITICAL",
];
export function detectRiskChange(
  previous: {
    score: number;
    level: RiskLevel;
    temperature?: number | null;
  } | null,
  current: { score: number; level: RiskLevel; temperature?: number | null }
) {
  if (!previous)
    return {
      significant: false,
      levelIncreased: false,
      scoreDelta: 0,
      temperatureDelta: null,
    };
  const temperatureDelta =
    previous.temperature != null && current.temperature != null
      ? current.temperature - previous.temperature
      : null;
  const levelIncreased =
    riskOrder.indexOf(current.level) > riskOrder.indexOf(previous.level);
  const scoreDelta = current.score - previous.score;
  return {
    significant:
      levelIncreased ||
      scoreDelta >= 10 ||
      (temperatureDelta !== null && temperatureDelta >= 2),
    levelIncreased,
    scoreDelta,
    temperatureDelta,
  };
}
