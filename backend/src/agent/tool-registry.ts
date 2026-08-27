import { TRPCError } from "@trpc/server";
import type { AgentTool, HeatAgentState, ToolExecutionContext } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  register(tool: AgentTool) {
    if (this.tools.has(tool.name))
      throw new Error(`Duplicate agent tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }
  get(name: string) {
    return this.tools.get(name);
  }
  list() {
    return Array.from(this.tools.values());
  }
}

function safeSummary(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== "object")
    return { value: String(output).slice(0, 160) };
  const value = output as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !/key|authorization|download|signed|geojson|raw/i.test(key)
      )
      .slice(0, 12)
  );
}

export async function executeRegisteredTool(
  registry: ToolRegistry,
  state: HeatAgentState,
  name: string,
  args: unknown
) {
  const tool = registry.get(name);
  if (!tool)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The planner requested an unregistered HeatCheck tool.",
    });
  if (
    state.toolCalls.length >=
    Number(process.env.HEATCHECK_AGENT_MAX_TOOL_CALLS ?? 12)
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "The agent tool budget was exhausted.",
    });
  if (
    state.toolCalls.filter(call => call.tool === name).length >= tool.maxCalls
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `The ${name} per-run budget was exhausted.`,
    });
  const input = tool.schema.parse(args);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const output = await tool.execute(input, {
      state,
      signal: controller.signal,
    } satisfies ToolExecutionContext);
    state.toolCalls.push({
      tool: name,
      status: "COMPLETED",
      durationMs: Date.now() - started,
      input,
      outputSummary: safeSummary(output),
      createdAt: new Date().toISOString(),
    });
    state.events.push({
      type: "tool.completed",
      message: `${name.replaceAll("_", " ")} completed.`,
      createdAt: new Date().toISOString(),
      metadata: { tool: name },
    });
    state.observations[name] = output;
    return output;
  } catch (error) {
    state.toolCalls.push({
      tool: name,
      status: "FAILED",
      durationMs: Date.now() - started,
      input,
      outputSummary: { error: error instanceof Error ? error.name : "UNKNOWN" },
      createdAt: new Date().toISOString(),
    });
    state.events.push({
      type: "tool.failed",
      message: `${name.replaceAll("_", " ")} failed safely.`,
      createdAt: new Date().toISOString(),
      metadata: { tool: name, error: error instanceof Error ? error.name : "UNKNOWN" },
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
