import Groq from "groq-sdk";
import { z } from "zod";
import { AGENT_CONFIG } from "../config";
import type { AgentLLM, HeatAgentState, PlannerDecision } from "../types";
import { HEATCHECK_AGENT_SYSTEM_PROMPT } from "./prompts";

const completeSchema = z.object({
  type: z.literal("COMPLETE"),
  summary: z.string().max(800).optional(),
});
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function compactState(state: HeatAgentState) {
  return {
    goal: state.goal,
    location: state.location,
    completedTools: state.toolCalls.map(call => call.tool),
    risk: state.risk && { score: state.risk.score, level: state.risk.level },
    hotspotCount: state.hotspots.length,
    previousAnalysis: state.previousAnalysis,
    actions: state.actions.map(action => ({
      type: action.type,
      status: action.status,
    })),
  };
}

export class GroqAgentLLM implements AgentLLM {
  private readonly client: Groq;
  constructor(apiKey = process.env.GROQ_API_KEY) {
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
    this.client = new Groq({ apiKey, timeout: 20_000, maxRetries: 0 });
  }
  async plan(input: {
    state: HeatAgentState;
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }): Promise<PlannerDecision> {
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create({
          model: AGENT_CONFIG.model,
          temperature: AGENT_CONFIG.temperature,
          messages: [
            { role: "system", content: HEATCHECK_AGENT_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify(compactState(input.state)),
            },
          ],
          tools: input.tools.map(tool => ({
            type: "function",
            function: tool,
          })),
          tool_choice: "auto",
          response_format: { type: "json_object" },
        });
        const message = response.choices[0]?.message;
        const call = message?.tool_calls?.[0];
        if (call?.type === "function")
          return {
            type: "TOOL_CALL",
            tool: call.function.name,
            arguments: JSON.parse(call.function.arguments || "{}") as unknown,
          };
        return completeSchema.parse(JSON.parse(message?.content || "{}"));
      } catch (error) {
        const status =
          typeof error === "object" && error && "status" in error
            ? Number((error as { status?: unknown }).status)
            : 0;
        if (
          attempt < 2 &&
          (status === 429 || status === 500 || status === 503)
        ) {
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw error;
      }
    }
    return { type: "COMPLETE" };
  }
  async evaluate(input: { state: HeatAgentState }) {
    return { summary: await this.summarize(input) };
  }
  async summarize(input: { state: HeatAgentState }) {
    return `${input.state.risk?.level ?? "Unknown"} operational heat risk at ${input.state.location.name ?? "the selected location"}.`;
  }
}
