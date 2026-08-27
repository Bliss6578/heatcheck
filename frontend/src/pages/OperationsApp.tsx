import { useAuth } from "@/_core/hooks/useAuth";
import { useAuth as useClerkAuth } from "@clerk/react";
import DashboardLayout from "@/components/DashboardLayout";
import { AIChatBox, type Message as ChatMessage } from "@/components/AIChatBox";
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
  Download,
  Loader2,
  MapPinned,
  Play,
  Settings2,
  ShieldAlert,
  ThermometerSun,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

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

type MappableHotspot = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  temperature: number;
};

function heatColor(score: number) {
  if (score >= 40) return "#d94032";
  if (score >= 35) return "#ff6b2c";
  if (score >= 30) return "#f5a623";
  return "#65856b";
}

function LocationMap({
  locations,
  selectedLocation,
  onSelect,
  geojson,
  hotspots = [],
}: {
  locations: MappableLocation[];
  selectedLocation?: MappableLocation;
  onSelect?: (id: string) => void;
  geojson?: unknown;
  hotspots?: MappableHotspot[];
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const [mapMode, setMapMode] = useState<"heat" | "street" | "satellite" | "terrain">("heat");

  useEffect(() => {
    if (!selectedLocation || !mapNode.current) return;
    const map = L.map(mapNode.current, { zoomControl: true }).setView(
      [selectedLocation.latitude, selectedLocation.longitude], 13
    );
    const tileLayers = {
      heat: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
      street: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      },
      satellite: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      },
      terrain: {
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        maxZoom: 17,
        attribution: '&copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap',
      },
    } as const;
    const tileLayer = tileLayers[mapMode];
    L.tileLayer(tileLayer.url, {
      maxZoom: tileLayer.maxZoom,
      attribution: tileLayer.attribution,
    }).addTo(map);
    const marker = L.circleMarker([selectedLocation.latitude, selectedLocation.longitude], {
      radius: 8, color: "#fff", weight: 2, fillColor: "#ff6b2c", fillOpacity: 1,
    }).addTo(map);
    const markerLabel = document.createElement("strong");
    markerLabel.textContent = selectedLocation.name;
    marker.bindPopup(markerLabel);
    if (mapMode === "heat" && geojson && typeof geojson === "object") {
      try {
        const layer = L.geoJSON(geojson as GeoJSON.GeoJsonObject, {
          style: feature => {
            const props = feature?.properties ?? {};
            const temperature = Number(props.temperature ?? props.Temperature ?? props.tcm ?? 0);
            const color = heatColor(temperature);
            return { color, fillColor: color, fillOpacity: .58, weight: 1 };
          },
          onEachFeature: (feature, featureLayer) => {
            const value = feature.properties?.temperature ?? feature.properties?.Temperature ?? feature.properties?.tcm;
            if (value != null) featureLayer.bindTooltip(`${Number(value).toFixed(1)}°C`);
          },
        }).addTo(map);
        if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [24, 24] });
      } catch (error) { console.warn("Heatcheck could not render provider GeoJSON.", error); }
    }
    if (mapMode === "heat") hotspots.forEach(hotspot => {
      const color = heatColor(hotspot.temperature);
      L.circle([hotspot.latitude, hotspot.longitude], {
        radius: 220,
        color,
        fillColor: color,
        fillOpacity: .32,
        weight: 2,
      })
        .bindTooltip(`${hotspot.label} · ${hotspot.temperature.toFixed(1)}°C`)
        .addTo(map);
      L.circleMarker([hotspot.latitude, hotspot.longitude], {
        radius: 5,
        color: "#fff",
        fillColor: color,
        fillOpacity: 1,
        weight: 1,
      }).addTo(map);
    });
    setTimeout(() => map.invalidateSize(), 0);
    return () => { map.remove(); };
  }, [geojson, hotspots, mapMode, selectedLocation]);

  return (
    <div className="ops-map-widget">
      <div className="ops-map-toolbar">
        <div className="ops-map-mode-switcher" aria-label="Map display mode">
          <span>Map layers</span>
          {(["heat", "street", "satellite", "terrain"] as const).map(mode => (
            <button
              type="button"
              key={mode}
              className={mapMode === mode ? "is-selected" : ""}
              onClick={() => setMapMode(mode)}
              aria-pressed={mapMode === mode}
            >
              {mode === "heat" ? "Heat map" : mode}
            </button>
          ))}
        </div>
        {locations.length > 1 && (
          <div className="ops-map-site-switcher" aria-label="Map locations">
            {locations.map(location => (
              <button
                type="button"
                key={location.id}
                className={selectedLocation?.id === location.id ? "is-selected" : ""}
                onClick={() => onSelect?.(location.id)}
              >
                {location.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ops-live-map" aria-label="Monitored location map">
        {selectedLocation ? (
          <div ref={mapNode} className="ops-google-map" />
        ) : (
          <div className="ops-live-map__empty">Add a location to open the interactive map.</div>
        )}
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
  const { getToken } = useClerkAuth();
  const [path, navigate] = useLocation();
  const workspace = trpc.heatcheck.workspace.current.useQuery();
  const organizationId = workspace.data?.organization.id ?? "pending-workspace";
  const [newLocationName, setNewLocationName] = useState("");
  const [newLatitude, setNewLatitude] = useState("");
  const [newLongitude, setNewLongitude] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [agentCommand, setAgentCommand] = useState(
    "Analyze this location and explain any change."
  );
  const [agentRunning, setAgentRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState("");
  const [agentError, setAgentError] = useState("");
  const [liveEvents, setLiveEvents] = useState<Array<{ type: string; message: string; createdAt: string }>>([]);
  const [agentResult, setAgentResult] = useState<any>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [reportPending, setReportPending] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertSms, setAlertSms] = useState("");
  const [notificationThreshold, setNotificationThreshold] = useState("65");
  const [providerDailyLimit, setProviderDailyLimit] = useState("500");
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
  const assistantChat = trpc.heatcheck.agent.chat.useMutation({
    onSuccess: response => setChatMessages(current => [...current, { role: "assistant", content: response.message }]),
    onError: error => setChatMessages(current => [...current, { role: "assistant", content: `I could not read the workspace right now: ${error.message}` }]),
  });
  const routeRunId = path.startsWith("/app/agent-runs/") ? path.split("/").pop() ?? "" : "";
  const detailRunId = routeRunId || selectedRunId;
  const agentDetail = trpc.heatcheck.agent.detail.useQuery(
    { organizationId, runId: detailRunId },
    { enabled: Boolean(detailRunId && workspace.data?.organization.id) }
  );
  const downloadReport = async () => {
    setReportPending(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/reports/heat-intelligence?organizationId=${encodeURIComponent(organizationId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("Report generation failed.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `heat-intelligence-${new Date().toISOString().slice(0, 10)}.html`; anchor.click(); URL.revokeObjectURL(url);
    } finally { setReportPending(false); }
  };
  const streamAgent = async () => {
    if (!selectedLocation) return;
    setAgentRunning(true); setAgentError(""); setLiveEvents([]); setAgentResult(null);
    let currentRunId = "";
    try {
      const token = await getToken();
      const response = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ organizationId, locationId: selectedLocation.id, command: agentCommand }),
      });
      if (!response.ok || !response.body) throw new Error("The live agent stream could not be opened.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const eventType = frame.match(/^event: (.+)$/m)?.[1];
          const raw = frame.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const payload = JSON.parse(raw);
          if (eventType === "activity") { setLiveEvents(current => [...current, payload]); if (payload.type === "agent.started" && payload.metadata?.runId) { currentRunId = payload.metadata.runId; setActiveRunId(currentRunId); } }
          if (eventType === "result") { setAgentResult(payload); setSelectedRunId(payload.runId); }
          if (eventType === "failure") throw new Error(payload.message);
        }
        if (done) break;
      }
      await agentRuns.refetch(); await utils.heatcheck.dashboard.get.invalidate({ organizationId });
    } catch (error) {
      if (currentRunId) {
        try { const token = await getToken(); const replay = await fetch(`/api/agent/runs/${currentRunId}/events?organizationId=${encodeURIComponent(organizationId)}&after=${liveEvents.length}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }); if (replay.ok) { const snapshot = await replay.json(); setLiveEvents(current => [...current, ...snapshot.events]); if (snapshot.run?.result) setAgentResult(snapshot.run.result); } } catch { /* retain the original stream error */ }
      }
      setAgentError(error instanceof Error ? error.message : "Agent run failed.");
    }
    finally { setAgentRunning(false); setActiveRunId(""); }
  };
  const cancelAgent = async () => {
    if (!activeRunId) return; const token = await getToken();
    await fetch(`/api/agent/runs/${activeRunId}/cancel`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ organizationId }) });
  };
  const downloadAgentReport = async (runId: string) => {
    const token = await getToken(); const response = await fetch(`/api/agent/runs/${runId}/report?organizationId=${encodeURIComponent(organizationId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("Agent report generation failed."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `heatcheck-agent-${runId}.html`; anchor.click(); URL.revokeObjectURL(url);
  };
  const approve = trpc.heatcheck.actions.approve.useMutation({
    onSuccess: () =>
      utils.heatcheck.dashboard.get.invalidate({ organizationId }),
  });
  const updateSettings = trpc.heatcheck.workspace.updateSettings.useMutation({
    onSuccess: () =>
      utils.heatcheck.dashboard.get.invalidate({ organizationId }),
  });
  const updatePolicies = trpc.heatcheck.workspace.updatePolicies.useMutation({ onSuccess: () => utils.heatcheck.dashboard.get.invalidate({ organizationId }) });
  useEffect(() => {
    const organization = dashboard.data?.workspace.organization as any; if (!organization) return;
    setAlertEmail(organization.notificationPolicy?.emailTo ?? ""); setAlertSms(organization.notificationPolicy?.smsTo ?? ""); setNotificationThreshold(String(organization.notificationPolicy?.minimumRiskScore ?? 65)); setProviderDailyLimit(String(organization.providerPolicy?.dailyCallLimit ?? 500));
  }, [dashboard.data?.workspace.organization]);
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
  const heatmapGeojson =
    observation?.summary && typeof observation.summary === "object"
      ? (observation.summary as { geojson?: unknown }).geojson
      : undefined;
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
  const sendChatMessage = (content: string) => {
    if (!selectedLocation || assistantChat.isPending) return;
    const nextMessage: ChatMessage = { role: "user", content };
    const history = [...chatMessages, nextMessage].filter((message): message is ChatMessage & { role: "user" | "assistant" } => message.role !== "system").slice(-8);
    setChatMessages(current => [...current, nextMessage]);
    assistantChat.mutate({ organizationId, locationId: selectedLocation.id, message: content, history });
  };

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
          <Button onClick={() => void downloadReport()} disabled={reportPending} size="sm" variant="outline">
            {reportPending ? <Loader2 className="animate-spin" /> : <Download />} Report
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

      {routeRunId && (
        <section className="ops-section-list ops-agent-run-page">
          <div className="ops-section-list__head"><div><p>AGENT RUN / AUDIT RECORD</p><h2>Heat intelligence timeline</h2></div><Button variant="outline" onClick={() => navigate("/app")}>Back to overview</Button></div>
          {agentDetail.isLoading && <div className="ops-loading"><Loader2 className="animate-spin" /> Loading agent evidence…</div>}
          {agentDetail.data && <div className="ops-run-detail ops-run-detail--page"><div className="ops-run-summary"><strong>{displayRisk(agentDetail.data.run.riskLevel)}</strong><span>{agentDetail.data.run.riskScore ?? "—"}/100</span><span>{agentDetail.data.run.status}</span><span>{agentDetail.data.run.stepsUsed} planning steps</span><Button variant="outline" onClick={() => void downloadAgentReport(agentDetail.data.run.id)}><Download /> Download run report</Button></div><h3>Event timeline</h3><ol>{agentDetail.data.events.map(item => <li key={item.id}><span>{readableDate(item.createdAt)}</span><strong>{item.message}</strong></li>)}</ol><h3>Tool evidence</h3>{agentDetail.data.toolCalls.map(call => <div key={call.id}><strong>{call.toolName.replaceAll("_", " ")}</strong><span>{call.status} · {call.durationMs ?? 0} ms</span></div>)}</div>}
        </section>
      )}

      {activeTab === "/app" && !routeRunId && (
        <section className="ops-grid">
          <article className="ops-agent-command">
            <div className="ops-agent-command__head">
              <div>
                <p>HEATCHECK AGENT</p>
                <h2>Agent Command Center</h2>
              </div>
              <span
                className={
                  agentRunning ? "ops-agent-live" : ""
                }
              >
                <Bot size={17} />{" "}
                {agentRunning ? "RUNNING" : "READY"}
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
                void streamAgent();
              }}
            >
              <Input
                aria-label="Ask HeatCheck Agent"
                value={agentCommand}
                onChange={event => setAgentCommand(event.target.value)}
              />
              <Button
                type="submit"
                disabled={!selectedLocation || agentRunning}
              >
                {agentRunning ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Bot />
                )}{" "}
                Analyze with HeatCheck Agent
              </Button>
              {agentRunning && activeRunId && <Button type="button" variant="outline" onClick={() => void cancelAgent()}>Cancel run</Button>}
            </form>
            {agentError && <p className="ops-form__error">{agentError}</p>}
            {liveEvents.length > 0 && <ol className="ops-live-agent-events">{liveEvents.map((item, index) => <li key={`${item.createdAt}-${index}`}><i /> <span>{item.message}</span></li>)}</ol>}
            {agentResult && (
              <div className="ops-agent-result">
                <div>
                  <span>RISK</span>
                  <strong>
                    {agentResult.risk.score}/100 · {agentResult.risk.level}
                  </strong>
                </div>
                <div>
                  <span>PLANNER</span>
                  <strong>
                    {agentResult.agent.fallbackUsed
                      ? "DETERMINISTIC FALLBACK"
                      : "GROQ / QWEN"}
                  </strong>
                </div>
                <ol>
                  {agentResult.toolCalls.map((tool: string, index: number) => (
                    <li key={`${tool}-${index}`}>
                      ✓ {tool.replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </article>
          <article className="ops-chat-panel">
            <div className="ops-chat-panel__head">
              <div><p>WORKSPACE COPILOT</p><h2>Ask HeatCheck</h2></div>
              <span><Bot size={16} /> QWEN / GROQ</span>
            </div>
            <AIChatBox
              messages={chatMessages}
              onSendMessage={sendChatMessage}
              isLoading={assistantChat.isPending}
              height={420}
              placeholder={selectedLocation ? `Ask about ${selectedLocation.name}…` : "Add a location to start chatting"}
              emptyStateMessage="Ask about the latest risk, trend, hotspots, incidents, or pending actions."
              suggestedPrompts={["What is the latest heat risk?", "Is the location getting worse?", "Explain the current risk factors."]}
            />
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
              geojson={heatmapGeojson}
              hotspots={data.hotspots}
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
                  <button type="button" className="ops-history__row" key={runItem.id} onClick={() => navigate(`/app/agent-runs/${runItem.id}`)}>
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
                  </button>
                ))
              ) : (
                <div className="ops-empty">
                  Run the HeatCheck Agent to create its first durable memory.
                </div>
              )}
            </div>
            {agentDetail.data && <div className="ops-run-detail"><h3>Agent run timeline</h3><p>{agentDetail.data.run.goal.replaceAll("_", " ")} · {agentDetail.data.run.status}</p><ol>{agentDetail.data.events.map(item => <li key={item.id}><span>{readableDate(item.createdAt)}</span><strong>{item.message}</strong></li>)}</ol><h4>Tool evidence</h4>{agentDetail.data.toolCalls.map(call => <div key={call.id}><strong>{call.toolName.replaceAll("_", " ")}</strong><span>{call.status} · {call.durationMs ?? 0} ms</span></div>)}</div>}
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
              geojson={heatmapGeojson}
              hotspots={data.hotspots}
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
            <form onSubmit={event => { event.preventDefault(); updatePolicies.mutate({ organizationId, notificationPolicy: { enabledChannels: ["WEBHOOK", "SLACK", "EMAIL", "SMS"], ...(alertEmail ? { emailTo: alertEmail } : {}), ...(alertSms ? { smsTo: alertSms } : {}), minimumRiskScore: Number(notificationThreshold) }, providerPolicy: { dailyCallLimit: Number(providerDailyLimit) } }); }}>
              <span>Managed alert routing</span>
              <Label htmlFor="alert-email">Alert email</Label><Input id="alert-email" type="email" value={alertEmail} onChange={event => setAlertEmail(event.target.value)} placeholder="operations@example.com" />
              <Label htmlFor="alert-sms">Alert SMS</Label><Input id="alert-sms" value={alertSms} onChange={event => setAlertSms(event.target.value)} placeholder="+15551234567" />
              <Label htmlFor="alert-threshold">Minimum alert score</Label><Input id="alert-threshold" type="number" min="0" max="100" value={notificationThreshold} onChange={event => setNotificationThreshold(event.target.value)} />
              <Label htmlFor="provider-budget">Daily provider-call budget</Label><Input id="provider-budget" type="number" min="1" max="10000" value={providerDailyLimit} onChange={event => setProviderDailyLimit(event.target.value)} />
              <Button type="submit" disabled={updatePolicies.isPending}>{updatePolicies.isPending ? <Loader2 className="animate-spin" /> : <Settings2 />} Save operating policies</Button>
              {updatePolicies.error && <small className="ops-form__error">{updatePolicies.error.message}</small>}
            </form>
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
