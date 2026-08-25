import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const motionCss = readFileSync(new URL("../../frontend/src/motion.css", import.meta.url), "utf8");

describe("Heatcheck Field Signal motion contract", () => {
  it("defines the staged detail reveal, interactive spotlight transition, and reduced-motion override", () => {
    expect(motionCss).toContain("field-rise");
    expect(motionCss).toContain("signal-scale");
    expect(motionCss).toContain("scan-sweep");
    expect(motionCss).toContain("thermal-surge");
    expect(motionCss).toContain("transect-run");
    expect(motionCss).toContain("network-spin");
    expect(motionCss).toContain(".intelligence-spotlight");
    expect(motionCss).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
