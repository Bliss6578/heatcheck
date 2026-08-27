import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const allowedTools = new Set(["get_weather_summary", "get_current_conditions", "get_forecast", "get_alerts"]);
let clientPromise: Promise<Client> | null = null;

async function createWeatherClient() {
  const require = createRequire(import.meta.url);
  const serverEntry = require.resolve("@dangahagan/weather-mcp");
  const client = new Client({ name: "heatcheck-weather", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: {
      ...process.env,
      ENABLED_TOOLS: "basic",
      WEATHER_UNITS: "metric",
      ANALYTICS_ENABLED: "false",
      ANALYTICS_SALT: "heatcheck-weather-mcp-disabled",
      LOG_LEVEL: "3",
      API_TIMEOUT_MS: "15000",
    },
    stderr: "pipe",
  });
  await client.connect(transport);
  return client;
}

async function weatherClient() {
  clientPromise ??= createWeatherClient().catch(error => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

export async function callWeatherMcp(
  tool: "get_weather_summary" | "get_current_conditions" | "get_forecast" | "get_alerts",
  args: Record<string, unknown>
) {
  if (process.env.WEATHER_MCP_ENABLED === "false") throw new Error("Weather MCP is disabled.");
  if (!allowedTools.has(tool)) throw new Error("Weather MCP tool is not allowlisted.");
  try {
    const client = await weatherClient();
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) throw new Error("Weather MCP returned an error response.");
    const text = (result.content as Array<{ type?: string; text?: string }>)
      .filter(item => item.type === "text" && typeof item.text === "string")
      .map(item => item.text)
      .join("\n")
      .slice(0, 12_000);
    return { server: "io.github.dgahagan/weather-mcp", tool, text };
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

export const WEATHER_MCP_SERVER = {
  registryName: "io.github.dgahagan/weather-mcp",
  package: "@dangahagan/weather-mcp",
  transport: "stdio",
  tools: Array.from(allowedTools),
} as const;
