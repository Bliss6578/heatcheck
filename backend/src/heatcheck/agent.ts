import type { DecisionPlan, ProposedAction, RiskAssessment } from "./types";

const permittedActionTypes = ["RECORD_INCIDENT_NOTE", "DRAFT_HEAT_ALERT", "REQUEST_OUTDOOR_TASK_SHIFT", "ACTIVATE_HEATCHECK_PROTOCOL", "START_VERIFICATION"] as const;

function deterministicActions(assessment: RiskAssessment, locationName: string): ProposedAction[] {
  if (assessment.level === "LOW") return [{ actionType: "RECORD_INCIDENT_NOTE", target: locationName, rationale: "Record the low-risk environmental assessment." }];
  const actions: ProposedAction[] = [
    { actionType: "RECORD_INCIDENT_NOTE", target: locationName, rationale: "Create a durable incident note for the elevated risk assessment." },
    { actionType: "DRAFT_HEAT_ALERT", target: `${locationName} operations team`, rationale: "Prepare a human-reviewable heat alert for the identified exposure." },
    { actionType: "START_VERIFICATION", target: locationName, rationale: "Schedule a follow-up evaluation after the response window." },
  ];
  if (assessment.level === "SEVERE" || assessment.level === "CRITICAL") {
    actions.splice(2, 0,
      { actionType: "ACTIVATE_HEATCHECK_PROTOCOL", target: `${locationName} heat-response protocol`, rationale: "Activate Heatcheck’s internal heat-response protocol state and record the escalation for operational review." },
      { actionType: "REQUEST_OUTDOOR_TASK_SHIFT", target: `${locationName} outdoor work`, rationale: "Request approval for an outdoor task shift while severe heat conditions persist." },
    );
  }
  return actions;
}

function fallbackPlan(assessment: RiskAssessment, locationName: string, status: "COMPLETED" | "UNAVAILABLE" = "UNAVAILABLE"): DecisionPlan {
  return {
    status,
    decision: assessment.level === "LOW" ? "Continue monitored operations" : "Escalate operational heat response for review",
    summary: assessment.summary,
    reasoningSummary: "A deterministic policy applied Heatcheck’s configured environmental and exposure thresholds. No external decision model was used.",
    actions: deterministicActions(assessment, locationName),
    structuredOutput: { mode: status === "UNAVAILABLE" ? "DETERMINISTIC_FALLBACK" : "DETERMINISTIC", riskScore: assessment.score, riskLevel: assessment.level },
  };
}

export async function createDecisionPlan(input: { assessment: RiskAssessment; locationName: string }): Promise<DecisionPlan> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackPlan(input.assessment, input.locationName);

  const fallback = fallbackPlan(input.assessment, input.locationName, "COMPLETED");
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "system", content: [{ type: "input_text", text: "You are Heatcheck's constrained operational decision assistant. You do not give medical advice and you never claim to execute an external action. Use only the permitted action types given in the user content. Return concise operational reasoning." }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify({ location: input.locationName, assessment: input.assessment, permittedActionTypes }) }] }],
        text: { format: { type: "json_schema", name: "heatcheck_decision", strict: true, schema: { type: "object", additionalProperties: false, properties: { decision: { type: "string" }, summary: { type: "string" }, reasoningSummary: { type: "string" }, actions: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: { actionType: { type: "string", enum: permittedActionTypes }, target: { type: "string" }, rationale: { type: "string" } }, required: ["actionType", "target", "rationale"] } } }, required: ["decision", "summary", "reasoningSummary", "actions"] } } },
      }),
    });
    if (!response.ok) return fallback;
    const payload = await response.json() as { output_text?: string };
    const parsed = payload.output_text ? JSON.parse(payload.output_text) as Omit<DecisionPlan, "status" | "structuredOutput"> : null;
    if (!parsed || !Array.isArray(parsed.actions)) return fallback;
    const actions = parsed.actions.filter((action) => permittedActionTypes.includes(action.actionType as typeof permittedActionTypes[number]));
    return { status: "COMPLETED", decision: parsed.decision, summary: parsed.summary, reasoningSummary: parsed.reasoningSummary, actions, structuredOutput: { mode: "OPENAI_STRUCTURED", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" } };
  } catch {
    return fallback;
  }
}
