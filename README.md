# HeatCheck

HeatCheck is a tenant-aware urban heat intelligence SaaS. It preserves a public Thermal Cartography experience and provides a protected operational application that runs the Observe → Analyze → Decide → Act → Verify loop.

## Repository layout

```text
heatcheck/
├── frontend/          # React application, public assets, pages and UI components
│   ├── public/
│   ├── src/
│   └── index.html
├── backend/
│   ├── src/           # Express/tRPC API, auth, agent and provider services
│   └── drizzle/       # MySQL schema and migrations
├── shared/            # Types, constants and errors shared across boundaries
├── docs/
├── package.json       # Root orchestration scripts and shared dependencies
├── vite.config.ts
├── vitest.config.ts
└── drizzle.config.ts
```

The source trees are physically separated while retaining a single root package so tRPC can share its compile-time router type without publishing an extra package.

## Architecture

- React 19, Vite, Tailwind CSS, Framer Motion, wouter, TanStack Query, and tRPC on the client.
- Express and tRPC on the server, with Zod validation and managed OAuth sessions.
- Drizzle ORM with MySQL for organizations, locations, monitoring runs, FortyGuard jobs, observations, hotspots, incidents, decisions, actions, events, and audit records.
- A server-only FortyGuard adapter for heatmaps, environmental parameters, Street View, satellite, Heat Intelligence, and bounded activity polling.
- A deterministic operational risk and response engine. OpenAI is optional narration only.
- A bounded hybrid autonomous agent: deterministic safety planning plus GroqCloud native tool calling with `qwen/qwen3.6-27b`.

All provider requests originate on the server. `FORTYGUARD_API_KEY` is never part of a browser response or a `VITE_*` variable.

Live analysis is bounded for responsiveness: provider activities poll at 750 ms for up to 10 attempts by default, and normalized heatmap/environment results are cached for the configured cache TTL. Increase those values only when a specific provider region consistently needs longer processing time.

## Local setup

1. Install Node.js 20+ and pnpm 10.
2. Copy `.env.example` to `.env` and fill the managed application/database settings.
3. For safe development set `HEATCHECK_MOCK_MODE=true`. For live analysis, set `FORTYGUARD_ENABLED=true`, `HEATCHECK_MOCK_MODE=false`, and provide `FORTYGUARD_API_KEY`. Add `GROQ_API_KEY` to enable Qwen planning; without it the deterministic planner completes the same required safety workflow.
4. Install and validate:

```bash
pnpm install --frozen-lockfile
pnpm db:push
pnpm check
pnpm test
pnpm dev
```

`pnpm dev` starts the integrated backend with Vite middleware. `pnpm dev:frontend` starts only Vite, while `pnpm dev:backend` starts the backend entry point. The integrated command is recommended for normal local development because authentication and tRPC use the same origin.

The app starts on `http://localhost:3000` or the next available port.

## Provider behavior

Heatmap requests use `/v1/heatmap` with a closed GeoJSON AOI, `filter_type: 1`, `analytic_type: tcm`, and 100 m granularity. Environmental requests use `/v1/env_params`. All asynchronous operations poll `/v1/status/{activityId}` with configurable, bounded attempts. Optional `/v1/streetview`, `/v1/satellite`, and `/v1/heat_intelligence` capabilities treat HTTP 403 as a plan/region limitation rather than corrupting the core analysis.

The server classifies invalid input, authentication, plan restriction, missing activity, rate limit, upstream failure, timeout, and failed-task errors without returning provider payloads, secrets, stack traces, or signed report links to normal users.

## Autonomous agent

The server-side agent loads tenant memory, executes required observations through an allowlisted Zod-validated tool registry, calculates risk locally, compares previous conditions, optionally asks Qwen for additional registered tools, executes permitted internal actions, and stores its run, events, and sanitized tool summaries. Hard step, global tool-call, per-tool, request-timeout, action-permission, and API rate limits prevent runaway execution.

Registered tools include previous-analysis/history retrieval, heatmap and environmental observations, hotspot detection, deterministic risk calculation, condition comparison, optional satellite/street context, internal alerts, recommendations, report requests, analysis saving, and adaptive monitoring. Raw heatmap GeoJSON is processed locally and is never sent to Qwen.

The Agent Command Center accepts bounded operational commands such as “Analyze this location,” “Monitor this area,” “Find hotspots,” and “Compare with the previous analysis.” It is not a general chatbot. Run details are retained in the append-only `autonomous_agent_runs`, `autonomous_agent_events`, and `autonomous_agent_tool_calls` tables.

## Risk model and mock mode

The HeatCheck Operational Heat Risk Score is deterministic and explainable. It combines available thermal, apparent-temperature, wet-bulb, humidity, solar, air-quality, and operational-exposure inputs into a clamped 0–100 score. Stored legacy bands remain `LOW`, `MODERATE`, `HIGH`, `SEVERE`, and `CRITICAL`; the UI can label the final two as `VERY HIGH` and `EXTREME` without destructive historical-data migration.

Simulation Mode uses labelled deterministic fixtures and never claims they came from FortyGuard. Automatic provider-failure fallback is permitted only when `HEATCHECK_ALLOW_MOCK_FALLBACK=true`.

## Testing and production

```bash
pnpm check
pnpm test
pnpm build
pnpm start
```

For deployment, configure the environment variables in the hosting platform, run the Drizzle migrations against MySQL, publish the site, and register the signed scheduled callback documented in `docs/operations.md`. External notifications and schedule changes remain disabled until a separately authenticated execution integration is configured.

## Current limitations

- FortyGuard Street View, satellite, and Heat Intelligence availability depends on the account plan and supported region.
- Heat Intelligence signed download URLs must remain server-side; production report viewing requires an authenticated streaming proxy appropriate to the deployment platform.
- The operational score is decision support, not a medically validated diagnosis.
