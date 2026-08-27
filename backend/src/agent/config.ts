export const AGENT_CONFIG = {
  enabled: process.env.HEATCHECK_AGENT_ENABLED !== "false",
  model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
  maxSteps: Math.max(
    1,
    Math.min(20, Number(process.env.HEATCHECK_AGENT_MAX_STEPS ?? 8))
  ),
  maxToolCalls: Math.max(
    1,
    Math.min(30, Number(process.env.HEATCHECK_AGENT_MAX_TOOL_CALLS ?? 16))
  ),
  temperature: 0.2,
};
