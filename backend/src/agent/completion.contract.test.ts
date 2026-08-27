import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const orchestrator = readFileSync(
  new URL("./orchestrator/run-agent.ts", import.meta.url),
  "utf8"
);
const tools = readFileSync(new URL("./tools/index.ts", import.meta.url), "utf8");

describe("agent completion persistence contract", () => {
  it("persists the completed run before publishing the completed event", () => {
    const finalUpdate = orchestrator.indexOf('status: "COMPLETED",');
    const completedEvent = orchestrator.indexOf('"agent.completed"');

    expect(finalUpdate).toBeGreaterThan(-1);
    expect(completedEvent).toBeGreaterThan(finalUpdate);
  });

  it("keeps full provider observations out of the terminal report snapshot", () => {
    expect(tools).toContain("evidenceSummary:");
    expect(tools).not.toContain("evidence: state.observations");
    expect(orchestrator).not.toContain(
      "temperature: state.observations.get_environmental_conditions"
    );
  });
});
