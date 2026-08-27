# Heatcheck Operations Guide

## Product Modes

Heatcheck begins in **Simulation Mode**. This is an intentional, visible product state that keeps the dashboard, risk scoring, decision ledger, incidents, and approval queue usable before a live provider is configured. The Phoenix fixture is marked as simulation data at the API and interface layers; it is never presented as a real environmental observation.

| Mode | Environmental observation source | Decision behavior | Intended use |
|---|---|---|---|
| Simulation | Deterministic Phoenix Distribution Center fixture | Deterministic risk score plus constrained action proposal | Safe onboarding, interface evaluation, and local development |
| Live | Server-side FortyGuard requests | Deterministic score with optional structured response summary | Operational use after provider credentials and governance are configured |

## Adding Provider Credentials

Add the following secrets through the project settings when they are available. Keep every credential server-side; no provider key is exposed to the browser.

| Variable | Required | Purpose |
|---|---:|---|
| `FORTYGUARD_API_KEY` | Required for Live Mode | Authenticates FortyGuard heatmap and environmental-parameter activity requests. |
| `OPENAI_API_KEY` | Optional | Produces a constrained, structured decision summary after the deterministic risk engine has completed. |
| `OPENAI_MODEL` | Optional | Overrides the default structured-response model identifier. |

The FortyGuard adapter follows the provider’s documented `api-key` header and asynchronous activity pattern. A heatmap submission returns an activity ID, which is polled through the provider status endpoint using bounded attempts. Environmental parameter responses are normalized without coercing unavailable measurements to zero. FortyGuard identifies `Completed` and `Failed` as terminal states; completed environmental values and heatmap result layers are retained in the Heatcheck data model. [1] [2] [3]

### Live Mode Activation Record

On **25 August 2026**, Heatcheck’s server-side FortyGuard credential was configured successfully. A bounded environmental-parameter submission completed authentication successfully, and the public health contract reported `LIVE_READY`. The credential is stored as a server-side project secret and is not included in client bundles, user-facing API responses, logs, documentation, or source control.

> The Heat Intelligence report endpoint can return a temporary signed download link. Heatcheck does not log or send such signed URLs to the browser. [4]

## Risk, Action, and Verification Boundaries

Heatcheck calculates a transparent 0–100 operational risk score from ambient and apparent temperature, wet-bulb temperature, humidity, solar load, air-quality context, and worker-exposure input. The score is an operational prioritization aid, not medical advice or a replacement for workplace safety policies.

The response agent can create records, decision summaries, incident records, and action proposals. In **Autonomous** mode, Heatcheck may activate its own internal heat-response protocol state for severe conditions. That state change is persisted as an operational execution and permits a labelled follow-up re-evaluation. External notifications, scheduling changes, and third-party operational workflow changes remain **disabled** until a separate execution integration is configured. Approving a proposal records the human decision and audit trail but does not claim an external action was sent.

## Scheduled Monitoring

The application includes an authenticated callback at:

```
GET /api/cron/heatcheck-monitoring
```

The callback only accepts `Authorization: Bearer <CRON_SECRET>`, selects locations that are already due, avoids active duplicate analyses, and runs bounded work. Vercel Hobby permits only daily Cron invocations, so `vercel.json` retains a daily safety run. For genuine adaptive monitoring, use a signed external scheduler every 15 minutes; it only invokes locations whose `nextAnalysisAt` is due.

The included QStash script creates the recommended production schedule:

```bash
QSTASH_TOKEN=... HEATCHECK_APP_URL=https://your-app.vercel.app CRON_SECRET=... node scripts/create-monitoring-schedule.mjs
```

It registers `*/15 * * * *` with an authenticated Authorization header. Keep all three values server-side.

If you use a different scheduler, configure it to call the same endpoint every 15 minutes:

```bash
manus-heartbeat create \
  --name heatcheck-monitoring \
  --cron "0 */15 * * * *" \
  --path /api/cron/heatcheck-monitoring \
  --description "Run due Heatcheck location analyses"
```

The expression is a six-field UTC cron expression. Record the returned task identifier in the project’s operating notes so the job can later be inspected, paused, changed, or deleted. Do not use in-process timers for monitoring; managed periodic execution is durable across server restarts.

## Production integrations

Alert delivery is server-managed: users never supply provider keys. Add only the channels you intend to use in Vercel Production variables: `SLACK_WEBHOOK_URL`, `RESEND_API_KEY` plus `ALERT_EMAIL_FROM`/`ALERT_EMAIL_TO`, and/or `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `ALERT_SMS_TO`. Trigger one controlled high-risk test location and verify the resulting `notification_logs` records before enabling Autonomous mode.

For distributed multi-instance API protection, add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then set `RATE_LIMIT_REQUIRE_DISTRIBUTED=true`. In that mode the API fails closed rather than silently falling back to per-instance memory.

Set `SENTRY_DSN` to forward sanitized HTTP failures to Sentry; `OBSERVABILITY_WEBHOOK_URL` remains available for compatible error collectors. Neither receives request bodies, provider payloads, or credentials.

`@dangahagan/weather-mcp` runs over stdio locally. In Vercel functions, HeatCheck automatically uses a bounded keyless Open-Meteo HTTP fallback, preserving the weather-context tool contract without relying on a persistent child process.

## Validation Commands

Run the following checks after changing the application:

```bash
pnpm check
pnpm test
pnpm build
```

The current test suite covers authentication boundaries, deterministic risk tiers, explicit simulation fixtures, documented FortyGuard PM-field normalization, provider fallback policy, action-verification eligibility, and integration-style monitoring and approval workflows.

## Validation Record

The following validation was completed before the latest Heatcheck checkpoint.

| Area | States checked | Result |
|---|---|---|
| Build integrity | Type-check, production build, and test suite | Passed: `pnpm check`, `pnpm build`, and 25 automated tests. |
| Public experience | `/` at 1280×800 and 390×844 | The cinematic landing page remained responsive and its product entry points route to `/app`. |
| Protected product entry | `/app` at desktop and mobile sizes | The secure loading state resolves to the authenticated workspace onboarding view when the member has no workspace. |
| Protected route coverage | `/app`, `/app/locations`, `/app/incidents`, `/app/actions`, and `/app/settings` at 1280×800 and 390×844 | Every route resolves through the protected product shell and shares the workspace provisioning safeguard before any tenant data exists. |
| Simulation workflow | Integration-style `runMonitoring` execution | A simulated observation, hotspot set, threshold-driven incident, activity entries, decisions, and constrained actions are persisted through the application workflow. |
| Verification workflow | Recommend, approval-only, and Autonomous protocol-state paths | Record-only and approval-only paths defer re-evaluation. An Autonomous Heatcheck internal protocol-state execution persists a labelled follow-up re-evaluation. |
| Dashboard contract | Persisted observation, hotspot, incident, activity, action, agent, and analytics fixtures | The protected dashboard aggregation returns every required section from tenant-scoped data. |
| Access control | Unauthenticated procedures; owner, administrator, operator, and viewer role helpers | Public health remains non-sensitive; protected calls reject unauthenticated access; owner and administrator changes are allowed while lower-privilege roles are rejected. |
| Error states | Workspace and dashboard query failure UI | Protected-route error fallbacks are implemented and present recoverable guidance rather than blank screens. |

## Operator Flow

After signing in, open `/app`, create a workspace and first location, then run an analysis. In Simulation Mode, the dashboard persists a labelled environmental observation, heat hotspots, a threshold-driven incident when applicable, a decision record, permitted action proposals, and activity history. The Locations, Incidents, Actions, and Settings views are all backed by authenticated, organization-scoped procedures.

## References

[1]: https://docs-api.fortyguard.com/docs/quickstart "FortyGuard API Quickstart"
[2]: https://docs-api.fortyguard.com/docs/create-heatmap "FortyGuard Create Heatmap"
[3]: https://docs-api.fortyguard.com/docs/environmental-parameters "FortyGuard Environmental Parameters"
[4]: https://docs-api.fortyguard.com/docs/heat-intelligence "FortyGuard Heat Intelligence"
