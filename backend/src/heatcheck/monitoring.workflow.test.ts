import { describe, expect, it } from "vitest";
import { verificationStateFor } from "./monitoring";

describe("Heatcheck monitoring verification workflow", () => {
  it("defers the verify phase while a heat-response proposal is awaiting human approval", () => {
    const state = verificationStateFor([
      { actionType: "DRAFT_HEAT_ALERT", status: "AWAITING_APPROVAL", executionClass: "RECORD_ONLY" },
      { actionType: "REQUEST_OUTDOOR_TASK_SHIFT", status: "AWAITING_APPROVAL", executionClass: "RECORD_ONLY" },
    ]);
    expect(state).toBe("DEFERRED_PENDING_APPROVAL");
  });

  it("does not falsely verify after a Heatcheck record-only action completes", () => {
    const state = verificationStateFor([
      { actionType: "RECORD_INCIDENT_NOTE", status: "COMPLETED", executionClass: "RECORD_ONLY" },
    ]);
    expect(state).toBe("DEFERRED_NO_OPERATIONAL_CHANGE");
  });

  it("makes a re-evaluation available only after an operational change is confirmed complete", () => {
    const state = verificationStateFor([
      { actionType: "OPERATIONS_WORKFLOW_EXECUTED", status: "COMPLETED", executionClass: "OPERATIONAL_CHANGE" },
    ]);
    expect(state).toBe("READY_FOR_REEVALUATION");
  });
});
