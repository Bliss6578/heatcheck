# Heatcheck Full-Stack Architecture

## Implementation Decision

Heatcheck will remain a managed web application with the existing public landing page preserved. The product layer will add authenticated dashboard routes, database-backed tenant data, and periodic monitoring jobs that run as bounded background work. The operational environment defaults to **Simulation Mode** when provider credentials are unavailable; live environmental intelligence is used only after a server-side FortyGuard key is configured.

| Layer | Responsibility | Implementation boundary |
|---|---|---|
| Public experience | Preserve the cinematic Heatcheck landing page and its original motion system. | Public client routes only. |
| Product experience | Deliver onboarding, dashboard, location, analysis, incident, agent, and settings interfaces. | Authenticated client routes. |
| Application API | Enforce tenant membership, validate input, coordinate analysis, and expose aggregated dashboard data. | Server-side routes only. |
| Operational data | Persist organizations, locations, observations, incidents, actions, approvals, activity events, and analysis records. | Database, scoped by organization ID. |
| Environmental provider | Submit, poll, normalize, and retain bounded results from FortyGuard; switch to realistic fixtures in Simulation Mode. | Server-side provider abstraction. |
| Intelligence | Calculate a deterministic, configurable 0–100 operational heat-risk score and generate a constrained action proposal. | Risk engine and action-policy service. |
| Monitoring | Select due locations, deduplicate runs, execute bounded analyses, and schedule verification. | Periodic background job. |

## Operational Flow

The core flow is **Observe → Analyze → Decide → Act → Verify**. A monitoring run is created for a due location, then submits an environmental request through the provider abstraction. After bounded polling completes, normalized observations and hotspots are persisted. The deterministic risk engine calculates the Heatcheck Risk Score and exposure context. If an organization threshold is met, the action-policy service produces an auditable response record. Only explicitly permitted Heatcheck-native actions execute automatically; approval-required actions remain pending until an authorized user decides.

## Security and Tenant Isolation

Every tenant-owned row carries an organization identifier. Every API handler derives the caller from the authenticated session and rejects requests outside their membership. Provider and model credentials remain server-side. Input validation covers location coordinates, GeoJSON area limits, status transitions, and action approval permissions. The dashboard consumes aggregated API responses rather than calling external providers from the browser.

## Live and Simulation Modes

Simulation Mode is an intentional operational state, not a hidden mock. It returns deterministic Phoenix Distribution Center fixtures, timestamps, job statuses, observations, hotspots, risk evolution, agent actions, and verification outcomes from the same application API used by the user interface. Live Mode is enabled only when provider configuration is complete and requests pass provider capability validation.

## Background Execution Strategy

Scheduled monitoring is selected for the initial product implementation. The monitoring service is idempotent, records status transitions, avoids duplicate runs per location, respects a configurable minimum interval, and uses bounded backoff when polling provider jobs. Continuous worker infrastructure can be added later without changing the provider, risk, decision, or dashboard contracts.

## Verified FortyGuard Provider Contract

The implementation uses FortyGuard’s server-side `api-key` authentication and treats all analysis POSTs as asynchronous. Heatmap requests go to `/v1/heatmap` with an AOI FeatureCollection, a date/time filter, and a 60 m, 80 m, or 100 m granularity. Environmental parameters go to `/v1/env_params` with the location, heatmap-derived temperature, and aligned time context. Both return an activity identifier and are retrieved through `/v1/status/{activityId}` using bounded polling; completion returns the endpoint-specific result while failed statuses are terminal. Missing environmental values remain absent rather than becoming zero. Heat Intelligence reports use the same status process but expose a temporary signed download link that is not logged or returned to the browser. See the official [quickstart](https://docs-api.fortyguard.com/docs/quickstart), [heatmap](https://docs-api.fortyguard.com/docs/create-heatmap), [environmental parameters](https://docs-api.fortyguard.com/docs/environmental-parameters), and [Heat Intelligence](https://docs-api.fortyguard.com/docs/heat-intelligence) documentation.
