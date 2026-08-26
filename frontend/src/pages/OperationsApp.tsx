import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Compass,
  Loader2,
  MapPinned,
  Play,
  Settings2,
  ShieldAlert,
  ThermometerSun,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useLocation } from "wouter";

const productTabs = [
  "/app",
  "/app/locations",
  "/app/incidents",
  "/app/actions",
  "/app/settings",
] as const;

function readableDate(value: Date | string | null | undefined) {
  if (!value) return "No analysis yet";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function riskClass(level?: string | null) {
  return `risk-chip risk-chip--${(level ?? "LOW").toLowerCase()}`;
}

function displayRisk(level?: string | null) {
  return level === "SEVERE"
    ? "VERY HIGH"
    : level === "CRITICAL"
      ? "EXTREME"
      : (level ?? "AWAITING DATA").replaceAll("_", " ");
}

type MappableLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

function LocationMap({
  locations,
  selectedLocation,
  onSelect,
}: {
  locations: MappableLocation[];
  selectedLocation?: MappableLocation;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="ops-live-map" aria-label="Monitored location map">
      <svg viewBox="0 0 1000 500" role="img">
        <title>Heatcheck monitored locations</title>
        <path className="ops-map-land" d="M83 109l72-49 105 17 54 47-24 51-58 24-27 66-55 24-56-53-47-35 16-49zm264-5 62-42 92 11 29 46-23 35 44 51-30 78-54 17-34-42-34-10-17-67-48-31zm239-9 71-31 105 23 91 68-24 52-72 15-42-18-52 43-65-16-25-61zm44 198 55-28 68 26 37 57-25 54-81 15-52-47z" />
        <path className="ops-map-grid" d="M0 100h1000M0 200h1000M0 300h1000M0 400h1000M200 0v500M400 0v500M600 0v500M800 0v500" />
        {locations.map(location => {
          const x = ((location.longitude + 180) / 360) * 1000;
          const y = ((90 - location.latitude) / 180) * 500;
          const selected = selectedLocation?.id === location.id;
          return (
            <g
              key={location.id}
              className={selected ? "ops-map-marker is-selected" : "ops-map-marker"}
              transform={`translate(${x} ${y})`}
              onClick={() => onSelect?.(location.id)}
              role="button"
              tabIndex={0}
              aria-label={`Select ${location.name}`}
            >
              <circle r={selected ? 15 : 10} />
              <circle r="4" />
            </g>
          );
        })}
      </svg>
      {selectedLocation ? (
        <div className="ops-live-map__label">
          <MapPinned size={16} />
          <span>
            {selectedLocation.name}
            <small>
              {selectedLocation.latitude.toFixed(4)}°, {selectedLocation.longitude.toFixed(4)}°
            </small>
          </span>
        </div>
      ) : (
        <div className="ops-live-map__label">Add a location to begin monitoring.</div>
      )}
    </div>
  );
}

function Onboarding() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [workspaceName, setWorkspaceName] = useState("Phoenix Operations");
  const [locationName, setLocationName] = useState(
    "Phoenix Distribution Center"
  );
  const [latitude, setLatitude] = useState("33.4484");
  const [longitude, setLongitude] = useState("-112.0740");
  const complete = trpc.heatcheck.onboarding.complete.useMutation({
    onSuccess: async () => {
      await utils.heatcheck.workspace.current.invalidate();
      setLocation("/app");
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    complete.mutate({
      workspace: {
        name: workspaceName,
        agentMode: "RECOMMEND",
        riskThreshold: 76,
      },
      location: {
        name: locationName,
        latitude: Number(latitude),
        longitude: Number(longitude),
        timezone: "America/Phoenix",
        monitoringEnabled: true,
        riskThreshold: 76,
      },
    });
  };

  return (
    <section className="ops-onboarding">
      <div className="ops-onboarding__seal">
        <ThermometerSun size={17} />
        <span>HC / FIELD SETUP</span>
      </div>
      <h1>Calibrate the first operational location.</h1>
      <p>
        Add the first place you want Heatcheck to monitor. Live heat
        intelligence and the response agent use Heatcheck's managed provider
        integration—no personal API key is required.
      </p>
      <form onSubmit={submit} className="ops-form">
        <div>
          <Label htmlFor="workspace">Organization</Label>
          <Input
            id="workspace"
            value={workspaceName}
            onChange={event => setWorkspaceName(event.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="location">First location</Label>
          <Input
            id="location"
            value={locationName}
            onChange={event => setLocationName(event.target.value)}
            required
          />
        </div>
        <div className="ops-form__coordinates">
          <div>
            <Label htmlFor="latitude">Latitude</Label>
            <Input
              id="latitude"
              inputMode="decimal"
              value={latitude}
              onChange={event => setLatitude(event.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="longitude">Longitude</Label>
            <Input
              id="longitude"
              inputMode="decimal"
              value={longitude}
              onChange={event => setLongitude(event.target.value)}
              required
            />
          </div>
        </div>
        {complete.error && (
          <p className="ops-form__error">{complete.error.message}</p>
        )}
        <Button type="submit" disabled={complete.isPending}>
          {complete.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Compass />
          )}{" "}
          Create workspace <ArrowRight />
        </Button>
      </form>
    </section>
  );
}

function OperationsContent() {
  const [path] = useLocation();
  const workspace = trpc.heatcheck.workspace.current.useQuery();
  const organizationId = workspace.data?.organization.id ?? "pending-workspace";
  const [newLocationName, setNewLocationName] = useState("");
  const [newLatitude, setNewLatitude] = useState("");
  const [newLongitude, setNewLongitude] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [agentCommand, setAgentCommand] = useState(
    "Analyze this location and explain any change."
  );
  const dashboard = trpc.heatcheck.dashboard.get.useQuery(
    { organizationId },
    {
      enabled: Boolean(workspace.data?.organization.id),
      refetchInterval: 30_000,
    }
  );
  const utils = trpc.useUtils();
  const run = trpc.heatcheck.monitoring.run.useMutation({
    onSuccess: () =>
      utils.heatcheck.dashboard.get.invalidate({ organizationId }),
  });
  const agentRuns = trpc.heatcheck.agent.runs.useQuery(
    { organizationId },
    { enabled: Boolean(workspace.data?.organization.id) }
  );
  const agentCommandMutation = trpc.heatcheck.agent.command.useMutation({
    onSuccess: async () => {
      await agentRuns.refetch();
      await utils.heatcheck.dashboard.get.invalidate({ organizationId });
    },
  });
  const approve = trpc.heatcheck.actions.approve.useMutation({
    onSuccess: () =>
      utils.heatcheck.dashboard.get.invalidate({ organizationId }),
  });
  const updateSettings = trpc.heatcheck.workspace.updateSettings.useMutation({
    onSuccess: () =>
      utils.heatcheck.dashboard.get.invalidate({ organizationId }),
  });
  const createLocation = trpc.heatcheck.locations.create.useMutation({
    onSuccess: async () => {
      setNewLocationName("");
      setNewLatitude("");
      setNewLongitude("");
      await utils.heatcheck.dashboard.get.invalidate({ organizationId });
    },
  });

  if (workspace.isLoading)
    return (
      <div className="ops-loading">
        <Loader2 className="animate-spin" /> Preparing the Heatcheck workspace…
      </div>
    );
  if (workspace.error)
    return (
      <div className="ops-loading ops-loading--error">
        <ShieldAlert /> Secure workspace access could not be established.
        Refresh the page or sign in again.
      </div>
    );
  if (!workspace.data) return <Onboarding />;
  if (dashboard.isLoading)
    return (
      <div className="ops-loading">
        <Loader2 className="animate-spin" /> Reading operational conditions…
      </div>
    );
  if (dashboard.error || !dashboard.data)
    return (
      <div className="ops-loading ops-loading--error">
        <ShieldAlert /> The Heatcheck dashboard could not load. Refresh the page
        and try again.
      </div>
    );

  const data = dashboard.data;
  const observation = data.latestObservation;
  const activeTab = productTabs.includes(path as (typeof productTabs)[number])
    ? path
    : "/app";
  const firstLocation = data.locations[0];
  const selectedLocation =
    data.locations.find(location => location.id === selectedLocationId) ??
    firstLocation;
  const canRun = Boolean(selectedLocation) && !run.isPending;
  const runNow = () =>
    selectedLocation &&
    run.mutate({ organizationId, locationId: selectedLocation.id });

  return (
    <div className="ops-shell">
      <header className="ops-header">
        <div>
          <p>HC / COMMAND SURFACE</p>
          <h1>
            {activeTab === "/app"
              ? "Operations overview"
              : activeTab
                  .slice(5)
                  .replace(/\b\w/g, letter => letter.toUpperCase())}
          </h1>
        </div>
        <div className="ops-header__status">
          <span
            className={
              data.provider.mode !== "LIVE"
                ? "ops-status ops-status--simulation"
                : "ops-status"
            }
          >
            {data.provider.mode !== "LIVE"
              ? "SIMULATION MODE"
              : "LIVE MODE"}
          </span>
          <Button onClick={runNow} disabled={!canRun} size="sm">
            {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}{" "}
            Run analysis
          </Button>
        </div>
      </header>

      {run.error && (
        <p className="ops-notice ops-notice--warning">{run.error.message}</p>
      )}
      {run.data?.mode === "SIMULATION" && (
        <p className="ops-notice">
          The managed live provider was temporarily unavailable, so this run
          used clearly labelled fallback data. Users never need to supply a
          provider key.
        </p>
      )}

      {activeTab === "/app" && (
        <section className="ops-grid">
          <article className="ops-agent-command">
            <div className="ops-agent-command__head">
              <div>
                <p>HEATCHECK AGENT</p>
                <h2>Agent Command Center</h2>
              </div>
              <span
                className={
                  agentCommandMutation.isPending ? "ops-agent-live" : ""
                }
              >
                <Bot size={17} />{" "}
                {agentCommandMutation.isPending ? "RUNNING" : "READY"}
              </span>
            </div>
            <div
              className="ops-agent-graph"
              aria-label="HeatCheck agent workflow"
            >
              <span>OBSERVE</span>
              <i>→</i>
              <span>HEATMAP + ENVIRONMENT + MEMORY</span>
              <i>→</i>
              <span>RISK ENGINE</span>
              <i>→</i>
              <span>QWEN PLAN</span>
              <i>→</i>
              <span>ALERT · RECOMMEND · MONITOR</span>
            </div>
            <form
              onSubmit={event => {
                event.preventDefault();
                if (selectedLocation)
                  agentCommandMutation.mutate({
                    organizationId,
                    locationId: selectedLocation.id,
                    command: agentCommand,
                  });
              }}
            >
              <Input
                aria-label="Ask HeatCheck Agent"
                value={agentCommand}
                onChange={event => setAgentCommand(event.target.value)}
              />
              <Button
                type="submit"
                disabled={!selectedLocation || agentCommandMutation.isPending}
              >
                {agentCommandMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Bot />
                )}{" "}
                Analyze with HeatCheck Agent
              </Button>
            </form>
            {agentCommandMutation.error && (
              <p className="ops-form__error">
                {agentCommandMutation.error.message}
              </p>
            )}
            {agentCommandMutation.data && (
              <div className="ops-agent-result">
                <div>
                  <span>RISK</span>
                  <strong>
                    {agentCommandMutation.data.risk.score}/100 ·{" "}
                    {agentCommandMutation.data.risk.level}
                  </strong>
                </div>
                <div>
                  <span>PLANNER</span>
                  <strong>
                    {agentCommandMutation.data.agent.fallbackUsed
                      ? "DETERMINISTIC FALLBACK"
                      : "GROQ / QWEN"}
                  </strong>
                </div>
                <ol>
                  {agentCommandMutation.data.toolCalls.map((tool, index) => (
                    <li key={`${tool}-${index}`}>
                      ✓ {tool.replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
          <article className="ops-card ops-card--risk">
            <span>Latest heat risk</span>
            <strong>{observation?.riskScore ?? "—"}</strong>
            <div>
              <span className={riskClass(observation?.riskLevel)}>
                {displayRisk(observation?.riskLevel)}
              </span>
              <small>{readableDate(observation?.observedAt)}</small>
            </div>
          </article>
          <article className="ops-card">
            <span>Current temperature</span>
            <strong>
              {observation?.temperature != null
                ? `${observation.temperature.toFixed(1)}°`
                : "—"}
            </strong>
            <small>latest observed air temperature</small>
          </article>
          <article className="ops-card">
            <span>Heat index</span>
            <strong>
              {observation?.heatIndex != null
                ? `${observation.heatIndex.toFixed(1)}°`
                : "—"}
            </strong>
            <small>apparent thermal exposure</small>
          </article>
          <article className="ops-card">
            <span>Relative humidity</span>
            <strong>
              {observation?.relativeHumidity != null
                ? `${Math.round(observation.relativeHumidity)}%`
                : "—"}
            </strong>
            <small>environmental parameter</small>
          </article>
          <article className="ops-card">
            <span>Active hotspots</span>
            <strong>{data.hotspots.length}</strong>
            <small>from the latest observation</small>
          </article>
          <article className="ops-card">
            <span>Open incidents</span>
            <strong>{data.openIncidents.length}</strong>
            <small>at configured thresholds</small>
          </article>
          <article className="ops-card">
            <span>Approval queue</span>
            <strong>{data.pendingActions.length}</strong>
            <small>human review required</small>
          </article>
          <article className="ops-panel ops-panel--map">
            <div className="ops-panel__head">
              <div>
                <span>Spatial heat layer</span>
                <small>{selectedLocation?.name ?? "No location"}</small>
              </div>
              <MapPinned size={18} />
            </div>
            <LocationMap
              locations={data.locations}
              selectedLocation={selectedLocation}
              onSelect={setSelectedLocationId}
            />
            {data.hotspots.length > 0 && (
              <div className="ops-map-alerts">
                {data.hotspots.slice(0, 4).map(hotspot => (
                  <span key={hotspot.id}>
                    <i /> {hotspot.label}
                    <strong>{hotspot.temperature.toFixed(1)}°C</strong>
                  </span>
                ))}
              </div>
            )}
          </article>
          <article className="ops-panel ops-panel--activity">
            <div className="ops-panel__head">
              <div>
                <span>Decision ledger</span>
                <small>most recent activity</small>
              </div>
              <Activity size={18} />
            </div>
            <ol className="ops-activity">
              {data.recentEvents.length ? (
                data.recentEvents.slice(0, 7).map(event => (
                  <li key={event.id}>
                    <i />
                    <div>
                      <p>{event.message}</p>
                      <small>{readableDate(event.createdAt)}</small>
                    </div>
                  </li>
                ))
              ) : (
                <li>
                  <i />
                  <div>
                    <p>No decisions have been recorded.</p>
                    <small>
                      Start a location analysis to begin the ledger.
                    </small>
                  </div>
                </li>
              )}
            </ol>
          </article>
          <article className="ops-panel ops-panel--agents">
            <div className="ops-panel__head">
              <div>
                <span>Response agents</span>
                <small>recent decision runs</small>
              </div>
              <ShieldAlert size={18} />
            </div>
            <div className="ops-agent-list">
              {data.agentRuns.length ? (
                data.agentRuns.map(run => (
                  <div key={run.id}>
                    <span className={riskClass(run.decision?.riskLevel)}>
                      {run.status}
                    </span>
                    <p>
                      {run.decision?.decision ?? "Decision record unavailable"}
                    </p>
                    <small>
                      {run.decision?.summary ?? readableDate(run.createdAt)}
                    </small>
                  </div>
                ))
              ) : (
                <div className="ops-empty">
                  Agent decisions appear here after an analysis completes.
                </div>
              )}
            </div>
          </article>
          <article className="ops-panel ops-panel--analytics">
            <div className="ops-panel__head">
              <div>
                <span>Risk analytics</span>
                <small>
                  {data.analytics.sampleCount} persisted observations
                </small>
              </div>
              <AlertTriangle size={18} />
            </div>
            <div className="ops-analytics">
              <div>
                <span>Average risk</span>
                <strong>{data.analytics.averageRisk ?? "—"}</strong>
              </div>
              <div>
                <span>Highest risk</span>
                <strong>{data.analytics.highestRisk ?? "—"}</strong>
              </div>
              <div className="ops-trend">
                {data.analytics.trend.length ? (
                  data.analytics.trend.map(point => (
                    <i
                      key={`${point.observedAt}-${point.riskScore}`}
                      style={{ height: `${Math.max(12, point.riskScore)}%` }}
                      title={`${point.riskScore} / 100`}
                    />
                  ))
                ) : (
                  <p>
                    Trend data appears after monitoring runs persist
                    observations.
                  </p>
                )}
              </div>
            </div>
          </article>
          <article className="ops-panel ops-panel--explanation">
            <div className="ops-panel__head">
              <div>
                <span>Why this risk</span>
                <small>measured-factor contributions</small>
              </div>
              <ThermometerSun size={18} />
            </div>
            {observation &&
            typeof observation.summary === "object" &&
            Array.isArray(
              (observation.summary as { factors?: unknown[] }).factors
            ) ? (
              <div className="ops-factor-list">
                {(
                  observation.summary as {
                    factors: Array<{
                      factor?: string;
                      score?: number;
                      contribution?: number;
                    }>;
                  }
                ).factors.map(factor => (
                  <div key={factor.factor}>
                    <span>{factor.factor}</span>
                    <strong>{Math.round(factor.score ?? 0)}/100</strong>
                    <i
                      style={{
                        width: `${Math.min(100, Math.max(3, factor.contribution ?? 0))}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="ops-empty">
                Run an analysis to see the measured factors behind the
                operational score.
              </div>
            )}
          </article>
          <article className="ops-panel ops-panel--history">
            <div className="ops-panel__head">
              <div>
                <span>Analysis history</span>
                <small>latest persisted assessments</small>
              </div>
              <Activity size={18} />
            </div>
            <div className="ops-history">
              <div className="ops-history__row ops-history__head">
                <span>Date</span>
                <span>Risk</span>
                <span>Level</span>
              </div>
              {data.analytics.trend
                .slice()
                .reverse()
                .map(point => (
                  <div
                    className="ops-history__row"
                    key={`${point.observedAt}-${point.riskScore}`}
                  >
                    <span>{readableDate(point.observedAt)}</span>
                    <strong>{point.riskScore}/100</strong>
                    <span className={riskClass(point.riskLevel)}>
                      {displayRisk(point.riskLevel)}
                    </span>
                  </div>
                ))}
            </div>
          </article>
          <article className="ops-panel ops-panel--agent-runs">
            <div className="ops-panel__head">
              <div>
                <span>Agent run memory</span>
                <small>durable autonomous-run audit</small>
              </div>
              <Bot size={18} />
            </div>
            <div className="ops-history">
              {agentRuns.data?.length ? (
                agentRuns.data.map(runItem => (
                  <div className="ops-history__row" key={runItem.id}>
                    <span>
                      {readableDate(runItem.createdAt)} ·{" "}
                      {runItem.goal.replaceAll("_", " ")}
                    </span>
                    <strong>
                      {runItem.stepsUsed}/{runItem.toolCallsUsed}
                    </strong>
                    <span className={riskClass(runItem.riskLevel)}>
                      {displayRisk(runItem.riskLevel ?? runItem.status)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="ops-empty">
                  Run the HeatCheck Agent to create its first durable memory.
                </div>
              )}
            </div>
          </article>
        </section>
      )}

      {activeTab === "/app/locations" && (
        <section className="ops-section-list">
          <div className="ops-section-list__head">
            <div>
              <p>LOCATION NETWORK</p>
              <h2>Configured field sites</h2>
            </div>
            <Button onClick={runNow} disabled={!canRun}>
              {run.isPending ? <Loader2 className="animate-spin" /> : <Play />}{" "}
              Analyze selected location
            </Button>
          </div>
          <form
            className="ops-add-location"
            onSubmit={event => {
              event.preventDefault();
              createLocation.mutate({
                organizationId,
                name: newLocationName,
                latitude: Number(newLatitude),
                longitude: Number(newLongitude),
                timezone: "America/Phoenix",
                monitoringEnabled: true,
                riskThreshold: 76,
              });
            }}
          >
            <div>
              <Label htmlFor="new-location-name">Add a location</Label>
              <Input
                id="new-location-name"
                placeholder="Name"
                value={newLocationName}
                onChange={event => setNewLocationName(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="new-location-latitude">Latitude</Label>
              <Input
                id="new-location-latitude"
                inputMode="decimal"
                placeholder="33.4484"
                value={newLatitude}
                onChange={event => setNewLatitude(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="new-location-longitude">Longitude</Label>
              <Input
                id="new-location-longitude"
                inputMode="decimal"
                placeholder="-112.0740"
                value={newLongitude}
                onChange={event => setNewLongitude(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={createLocation.isPending}>
              {createLocation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MapPinned />
              )}{" "}
              Add site
            </Button>
          </form>
          {createLocation.error && (
            <p className="ops-form__error">{createLocation.error.message}</p>
          )}
          <div className="ops-location-map-layout">
            <LocationMap
              locations={data.locations}
              selectedLocation={selectedLocation}
              onSelect={setSelectedLocationId}
            />
            <div className="ops-location-map-copy">
              <span>SELECTED FIELD SITE</span>
              <h3>{selectedLocation?.name ?? "No location selected"}</h3>
              <p>
                Select a monitored site, then let Heatcheck retrieve its heat
                conditions, classify alerts, and prepare a governed response.
              </p>
              <Button onClick={runNow} disabled={!canRun}>
                {run.isPending ? <Loader2 className="animate-spin" /> : <Bot />}
                Check heat conditions
              </Button>
            </div>
          </div>
          {data.locations.map(location => (
            <article
              key={location.id}
              className={`ops-location${selectedLocation?.id === location.id ? " ops-location--selected" : ""}`}
              onClick={() => setSelectedLocationId(location.id)}
            >
              <div>
                <span className="ops-location__index">
                  {location.monitoringEnabled ? "MONITORING" : "PAUSED"}
                </span>
                <h3>{location.name}</h3>
                <p>
                  {location.latitude.toFixed(4)}°,{" "}
                  {location.longitude.toFixed(4)}° · {location.timezone}
                </p>
              </div>
              <div>
                <span>Risk threshold</span>
                <strong>{location.riskThreshold}</strong>
              </div>
              <div>
                <span>Next assessment</span>
                <strong>{readableDate(location.nextAnalysisAt)}</strong>
              </div>
            </article>
          ))}
        </section>
      )}

      {activeTab === "/app/incidents" && (
        <section className="ops-section-list">
          <div className="ops-section-list__head">
            <div>
              <p>INCIDENT REGISTER</p>
              <h2>Threshold-driven events</h2>
            </div>
          </div>
          {data.openIncidents.length ? (
            data.openIncidents.map(incident => (
              <article key={incident.id} className="ops-incident">
                <div>
                  <span className={riskClass(incident.severity)}>
                    {incident.severity}
                  </span>
                  <h3>{incident.title}</h3>
                  <p>{incident.summary}</p>
                </div>
                <div>
                  <strong>{incident.riskScore}</strong>
                  <small>{readableDate(incident.startedAt)}</small>
                </div>
              </article>
            ))
          ) : (
            <div className="ops-empty">
              No open incidents. Heatcheck records one only when a location
              exceeds its configured risk threshold.
            </div>
          )}
        </section>
      )}

      {activeTab === "/app/actions" && (
        <section className="ops-section-list">
          <div className="ops-section-list__head">
            <div>
              <p>APPROVAL QUEUE</p>
              <h2>Human-governed responses</h2>
            </div>
          </div>
          {data.pendingActions.length ? (
            data.pendingActions.map(action => (
              <article key={action.id} className="ops-action">
                <div>
                  <span className="ops-location__index">APPROVAL REQUIRED</span>
                  <h3>{action.actionType.replaceAll("_", " ")}</h3>
                  <p>{action.target}</p>
                </div>
                <Button
                  onClick={() =>
                    approve.mutate({ organizationId, actionId: action.id })
                  }
                  disabled={approve.isPending}
                >
                  {approve.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CheckCircle2 />
                  )}{" "}
                  Record approval
                </Button>
              </article>
            ))
          ) : (
            <div className="ops-empty">
              No action is awaiting approval. Heatcheck never sends external
              notifications or changes schedules without a configured execution
              integration.
            </div>
          )}
        </section>
      )}

      {activeTab === "/app/settings" && (
        <section className="ops-settings">
          <p>WORKSPACE SETTINGS</p>
          <h2>{data.workspace.organization.name}</h2>
          <div className="ops-settings__grid">
            <div>
              <span>Agent mode</span>
              <strong>{data.workspace.organization.agentMode}</strong>
              <small>
                Current policy controls whether Heatcheck observes, recommends,
                or can activate its internal protocol state.
              </small>
              <div className="ops-mode-controls">
                {(["OBSERVE", "RECOMMEND", "AUTONOMOUS"] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={
                      data.workspace.organization.agentMode === mode
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() =>
                      updateSettings.mutate({ organizationId, agentMode: mode })
                    }
                    disabled={updateSettings.isPending}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
              {updateSettings.error && (
                <small className="ops-form__error">
                  {updateSettings.error.message}
                </small>
              )}
            </div>
            <div>
              <span>Heat intelligence service</span>
              <strong>
                {data.provider.mode !== "LIVE"
                  ? "Fallback mode"
                  : "Managed · Live"}
              </strong>
              <small>
                FortyGuard is configured once by Heatcheck on the server and
                shared securely across customer workspaces. API credentials
                are never requested from or exposed to users.
              </small>
            </div>
            <div>
              <span>Default threshold</span>
              <strong>{data.workspace.organization.riskThreshold}/100</strong>
              <small>
                Each location may apply its own threshold to open incidents.
              </small>
            </div>
            <div>
              <span>Monitoring interval</span>
              <strong>
                {data.workspace.organization.monitoringIntervalMinutes} min
              </strong>
              <small>
                Heatcheck automatically checks enabled locations on the
                workspace schedule and records alerts and agent decisions.
              </small>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default function OperationsApp() {
  const { loading } = useAuth();
  if (loading)
    return (
      <div className="ops-loading">
        <Loader2 className="animate-spin" /> Checking secure access…
      </div>
    );
  return (
    <DashboardLayout>
      <OperationsContent />
    </DashboardLayout>
  );
}
