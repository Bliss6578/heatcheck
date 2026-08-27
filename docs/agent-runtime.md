# HeatCheck agent runtime

## Runtime configuration

- Provider: GroqCloud (`groq-sdk`)
- Default model: `qwen/qwen3.6-27b` (overridable with `GROQ_MODEL`)
- Temperature: `0.2`
- Top-p: `0.9`
- Maximum completion tokens: `700`
- Planner step limit: `8` by default (`HEATCHECK_AGENT_MAX_STEPS`, bounded to 1–20)
- Tool-call limit: `16` by default (`HEATCHECK_AGENT_MAX_TOOL_CALLS`, bounded to 1–30)
- Request timeout: `20 seconds`
- Tool choice: `auto`
- Planner response format: JSON object
- Transient retries: two retries for HTTP 429, 500, and 503 with exponential backoff

HeatCheck uses the official `io.github.dgahagan/weather-mcp` server from the `@dangahagan/weather-mcp` npm package over stdio. The server provides keyless NOAA/Open-Meteo current conditions, short forecasts, and weather alerts. HeatCheck runs it as a server-side child process through the official MCP TypeScript SDK and exposes a single bounded `get_weather_context` tool to Qwen. Analytics are disabled, metric units are enforced, and only four weather methods are allowlisted.

FortyGuard remains integrated through server-side REST adapters. Both integrations feed the same private tool registry, so credentials and raw payloads stay outside the browser and the deterministic permission layer retains final authority.

## Planning boundary

The deterministic planner always establishes the minimum safe evidence chain: prior memory (when relevant), heatmap, environmental conditions, hotspot detection, official risk calculation, and trend comparison. Once that evidence exists, Qwen decides whether optional satellite or street-level context is useful. Qwen cannot calculate or overwrite the official score and cannot call unregistered tools.

## Feature coverage

| Capability | Implementation |
| --- | --- |
| Autonomous monitoring | Due-location worker plus protected cron endpoint |
| FortyGuard tools | Heatmap, environment, satellite, street view, and normalized heat intelligence |
| Weather MCP | Keyless current conditions, two-day forecast, and official alert context through `io.github.dgahagan/weather-mcp` |
| AI tool selection | Qwen chooses optional context tools after the deterministic safety baseline |
| Deterministic scoring | Temperature, apparent temperature/heat index, wet bulb, humidity, solar load, exposure, anomaly, vegetation, built-up surface, and air-quality context |
| Hotspots and trends | GeoJSON anomaly detection and improving/stable/worsening comparison |
| Long-term memory | Durable observations, hotspots, incidents, decisions, actions, runs, events, and tool calls |
| Actions and approvals | Safe-auto and approval-required execution classes |
| Adaptive monitoring | Risk-based 5–240 minute next-run calculation |
| Live activity | SSE activity events, replay, heartbeat, cancellation, and durable timeline |
| Natural language | Command goal routing plus tenant-scoped workspace chatbot |
| Fallback and demo | Deterministic planner and explicit simulation fixtures |
| Guardrails | Tenant authorization, schemas, allowlist, timeouts, budgets, rate limits, idempotency, and no arbitrary execution |

The scheduler endpoint should be invoked at least every five minutes for the highest-risk adaptive interval to be honored precisely. The included Vercel cron invokes it daily for compatibility with free-tier scheduling; a more frequent external scheduler can call the same authenticated endpoint without code changes.
