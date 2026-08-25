import { describe, expect, it } from "vitest";
import { createBoundingPolygon, detectHotspots, detectRiskChange } from "./geo";

describe("HeatCheck spatial and change utilities", () => {
  it("creates a closed GeoJSON AOI in longitude/latitude order", () => {
    const ring = createBoundingPolygon(40.7128, -74.006, 1).features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring[0][0]).toBeLessThan(-74);
    expect(ring[0][1]).toBeLessThan(40.7128);
  });
  it("rejects invalid coordinates", () => expect(() => createBoundingPolygon(91, 0)).toThrow(/Latitude/));
  it("detects anomalously hot cells", () => {
    const features = [35, 36, 42].map((temperature, index) => ({ type: "Feature", properties: { temperature }, geometry: { type: "Point", coordinates: [-74 + index * .01, 40.7] } }));
    expect(detectHotspots({ type: "FeatureCollection", features })[0]).toMatchObject({ temperature: 42, riskLevel: "SEVERE" });
  });
  it("flags risk-band and meaningful temperature increases", () => {
    expect(detectRiskChange({ score: 60, level: "MODERATE", temperature: 35 }, { score: 62, level: "HIGH", temperature: 35.5 }).significant).toBe(true);
    expect(detectRiskChange({ score: 62, level: "HIGH", temperature: 35 }, { score: 63, level: "HIGH", temperature: 37.2 }).significant).toBe(true);
  });
});
