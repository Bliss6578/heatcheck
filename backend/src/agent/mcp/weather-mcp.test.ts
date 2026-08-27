import { afterEach, describe, expect, it, vi } from "vitest";
import { callWeatherMcp } from "./weather-mcp";

afterEach(() => {
  delete process.env.VERCEL;
  delete process.env.WEATHER_MCP_TRANSPORT;
  vi.unstubAllGlobals();
});

describe("serverless weather transport", () => {
  it("uses the bounded HTTP fallback when running in Vercel", async () => {
    process.env.VERCEL = "1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ timezone: "America/Phoenix", current: { temperature_2m: 36, apparent_temperature: 39, relative_humidity_2m: 22, weather_code: 1 } }), { status: 200 })));
    const result = await callWeatherMcp("get_weather_summary", { latitude: 33.4484, longitude: -112.074 });
    expect(result.server).toBe("open-meteo-serverless-fallback");
    expect(result.text).toContain("36");
  });
});
