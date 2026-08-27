const requiredEvidence = ["get_heatmap", "get_environmental_conditions", "detect_heat_hotspots", "calculate_heat_risk"];

export function evaluateAgentReplay(input: { status: string; riskScore?: number | null; events: Array<{ type: string }>; toolCalls: Array<{ toolName: string; status: string }> }) {
  const completed = input.toolCalls.filter(call => call.status === "COMPLETED").map(call => call.toolName);
  const missingEvidence = requiredEvidence.filter(tool => !completed.includes(tool));
  const riskValid = input.riskScore == null || (Number.isInteger(input.riskScore) && input.riskScore >= 0 && input.riskScore <= 100);
  const terminalEvent = input.events.some(event => event.type === "agent.completed" || event.type === "agent.failed" || event.type === "agent.cancelled");
  return { passed: missingEvidence.length === 0 && riskValid && terminalEvent && input.status === "COMPLETED", missingEvidence, riskValid, terminalEvent, toolCount: input.toolCalls.length };
}
