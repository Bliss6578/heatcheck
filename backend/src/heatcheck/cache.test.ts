import { describe, expect, it } from "vitest";
import { analysisCacheKey, getCached, setCached } from "./cache";

describe("HeatCheck provider cache", () => {
  it("rounds coordinates and groups requests by hour", () => {
    const date = new Date("2026-08-25T12:34:00Z");
    expect(analysisCacheKey({ latitude: 40.71281, longitude: -74.00601, date })).toBe(analysisCacheKey({ latitude: 40.71284, longitude: -74.00604, date }));
  });
  it("stores short-lived normalized values", () => {
    setCached("test-key", { score: 82 });
    expect(getCached<{ score: number }>("test-key")?.score).toBe(82);
  });
});
