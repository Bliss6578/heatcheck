import type { AgentAction, ToolRisk } from "../types";
const permissions: Record<AgentAction["type"], ToolRisk> = {
  STORE_ANALYSIS: "SAFE",
  CREATE_ALERT: "CONTROLLED",
  UPDATE_ALERT: "CONTROLLED",
  CREATE_RECOMMENDATION: "SAFE",
  MARK_HOTSPOT: "SAFE",
  GENERATE_REPORT: "CONTROLLED",
  CHANGE_MONITORING_FREQUENCY: "CONTROLLED",
  REQUEST_HUMAN_APPROVAL: "REQUIRES_APPROVAL",
};
export function permissionForAgentAction(type: AgentAction["type"]) {
  return permissions[type];
}
export function canExecuteAction(type: AgentAction["type"]) {
  return permissions[type] !== "REQUIRES_APPROVAL";
}
