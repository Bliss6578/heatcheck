import { describe, expect, it } from "vitest";
import { isVerificationEligible } from "./monitoring";

describe("Heatcheck verification eligibility", () => {
  it("defers verification for pending or approval-gated actions", () => {
    expect(isVerificationEligible([
      { actionType: "DRAFT_HEAT_ALERT", status: "AWAITING_APPROVAL", executionClass: "RECORD_ONLY" },
      { actionType: "START_VERIFICATION", status: "PENDING", executionClass: "RECORD_ONLY" },
    ])).toBe(false);
  });

  it("does not treat a completed record-only action or recorded approval as an operational intervention", () => {
    expect(isVerificationEligible([
      { actionType: "RECORD_INCIDENT_NOTE", status: "COMPLETED", executionClass: "RECORD_ONLY" },
    ])).toBe(false);
  });

  it("allows verification only after a confirmed operational-change execution", () => {
    expect(isVerificationEligible([
      { actionType: "OPERATIONS_WORKFLOW_EXECUTED", status: "COMPLETED", executionClass: "OPERATIONAL_CHANGE" },
    ])).toBe(true);
  });
});
