import { describe, expect, it } from "vitest";
import { createHeatcheckPdf } from "./reportPdf";

describe("native HeatCheck PDF reports", () => {
  it("generates a complete PDF document without an external rendering service", () => {
    const report = createHeatcheckPdf("Heat Intelligence", ["Risk: 81/100", "A long evidence entry that should be safely wrapped into the printable report output."]);
    expect(report.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(report.toString("binary")).toContain("%%EOF");
    expect(report.length).toBeGreaterThan(500);
  });
});
