import { describe, expect, it } from "vitest";
import { adaptiveMonitoringMinutes, nextAdaptiveAnalysisAt } from "./adaptiveMonitoring";

describe("adaptive monitoring cadence", () => {
  it.each([[95, 15, 5], [80, 30, 10], [65, 30, 15], [50, 15, 30], [20, 15, 60]])(
    "maps risk %i with base %i to %i minutes", (risk, base, expected) => {
      expect(adaptiveMonitoringMinutes(risk, base)).toBe(expected);
    }
  );
  it("returns a deterministic next assessment", () => {
    const now = new Date("2026-08-26T00:00:00Z");
    expect(nextAdaptiveAnalysisAt(95, 15, now).toISOString()).toBe("2026-08-26T00:05:00.000Z");
  });
});
