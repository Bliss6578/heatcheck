import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const allowedTools = new Set(["get_weather_summary", "get_current_conditions", "get_forecast", "get_alerts"]);
let clientPromise: Promise<Client> | null = null;

function coordinates(args: Record<string, unknown>) {
  const latitude = Number(args.latitude);
  const longitude = Number(args.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Weather requests require latitude and longitude.");
  return { latitude, longitude };
}

/**
 * Vercel functions do not guarantee a long-lived child process. Keep the MCP
 * implementation for local/container execution, and use Open-Meteo only as a
 * keyless HTTP transport fallback in serverless environments.
 */
async function callServerlessWeather(tool: string, args: Record<string, unknown>) {
  const { latitude, longitude } = coordinates(args);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code");
  url.searchParams.set("hourly", "temperature_2m,apparent_temperature,relative_humidity_2m");
  url.searchParams.set("forecast_days", String(Math.max(1, Math.min(7, Number(args.days ?? 2)))));
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Weather fallback returned ${response.status}.`);
  const payload = await response.json() as Record<string, unknown>;
  const current = (payload.current ?? {}) as Record<string, unknown>;
  const summary = {
    source: "Open-Meteo serverless fallback",
    current: {
      temperatureC: current.temperature_2m ?? null,
      apparentTemperatureC: current.apparent_temperature ?? null,
      relativeHumidity: current.relative_humidity_2m ?? null,
      weatherCode: current.weather_code ?? null,
    },
    timezone: payload.timezone ?? "unknown",
    alerts: tool === "get_alerts" ? "No alert feed is available through the serverless fallback." : undefined,
  };
  return { server: "open-meteo-serverless-fallback", tool, text: JSON.stringify(summary) };
}

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
  if ((process.env.VERCEL || process.env.WEATHER_MCP_TRANSPORT === "http") && process.env.WEATHER_MCP_HTTP_FALLBACK !== "false") {
    return callServerlessWeather(tool, args);
  }
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
  transport: "stdio with keyless HTTP fallback for serverless",
  tools: Array.from(allowedTools),
} as const;
