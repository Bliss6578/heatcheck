import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import express from "express";
import { createContext } from "./_core/context.js";
import { registerStorageProxy } from "./_core/storageProxy.js";
import { getDb, getUserByOpenId } from "./db.js";
import { appRouter } from "./routers.js";
import { registerScheduledMonitoring } from "./scheduledMonitoring.js";
import { cancelAutonomousAgentRun, getAutonomousAgentRun, runAutonomousAgent } from "./agent/orchestrator/run-agent.js";
import { apiRateLimit } from "./rateLimit.js";
import { errorTelemetry, requestTelemetry } from "./observability.js";
import { getDashboardData } from "./heatcheck/monitoring.js";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.use(clerkMiddleware({
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ??
      process.env.VITE_CLERK_PUBLISHABLE_KEY,
  }));
  app.use(requestTelemetry);
  app.use(apiRateLimit);
  app.get("/api/health", async (_req, res) => {
    const configured = Boolean(process.env.DATABASE_URL);

    try {
      const database = await getDb();
      if (!database) {
        res.status(503).json({
          ok: false,
          database: { configured, connected: false, schemaReady: false },
        });
        return;
      }

      await database.execute(sql`SELECT 1 FROM users LIMIT 1`);
      res.status(200).json({
        ok: true,
        database: { configured: true, connected: true, schemaReady: true },
      });
    } catch (error) {
      console.error("[Health] Database probe failed:", error);
      res.status(503).json({
        ok: false,
        database: { configured, connected: false, schemaReady: false },
      });
    }
  });
  registerScheduledMonitoring(app);
  app.post("/api/agent/stream", async (req, res) => {
    const { userId } = getAuth(req);
    const user = userId ? await getUserByOpenId(userId) : null;
    if (!user) return res.status(401).json({ error: "Authentication required." });
    const { organizationId, locationId, command } = req.body ?? {};
    if (typeof organizationId !== "string" || typeof locationId !== "string")
      return res.status(400).json({ error: "A workspace and location are required." });
    const text = String(command ?? "analyze").toLowerCase();
    const goal = text.includes("compare") || text.includes("hotter")
      ? "TRACK_HEAT_CHANGE"
      : text.includes("monitor")
        ? "MONITOR_LOCATION"
        : text.includes("hottest") || text.includes("hotspot")
          ? "DETECT_HOTSPOTS"
          : "ANALYZE_LOCATION";
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    let sequence = 0;
    const send = (type: string, payload: unknown) => {
      sequence += 1;
      res.write(`id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 15_000);
    try {
      const result = await runAutonomousAgent({
        userId: user.id,
        organizationId,
        locationId,
        goal,
        idempotencyKey: req.get("idempotency-key")?.slice(0, 100),
        onEvent: item => send("activity", item),
      });
      send("result", result);
    } catch (error) {
      send("failure", { message: error instanceof Error ? error.message : "Agent run failed." });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });
  app.get("/api/agent/runs/:runId/events", async (req, res) => {
    const { userId } = getAuth(req); const user = userId ? await getUserByOpenId(userId) : null;
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!user) return res.status(401).json({ error: "Authentication required." });
    const detail = await getAutonomousAgentRun(user.id, organizationId, req.params.runId);
    const after = Math.max(0, Number(req.query.after ?? req.get("last-event-id") ?? 0));
    return res.json({ run: detail.run, events: detail.events.filter(item => item.sequence > after) });
  });
  app.post("/api/agent/runs/:runId/cancel", async (req, res) => {
    const { userId } = getAuth(req); const user = userId ? await getUserByOpenId(userId) : null;
    const organizationId = typeof req.body?.organizationId === "string" ? req.body.organizationId : "";
    if (!user) return res.status(401).json({ error: "Authentication required." });
    return res.json(await cancelAutonomousAgentRun(user.id, organizationId, req.params.runId));
  });
  app.get("/api/agent/runs/:runId/report", async (req, res) => {
    const { userId } = getAuth(req); const user = userId ? await getUserByOpenId(userId) : null;
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!user) return res.status(401).json({ error: "Authentication required." });
    const detail = await getAutonomousAgentRun(user.id, organizationId, req.params.runId);
    const result = (detail.run.result ?? {}) as Record<string, any>; const risk = result.risk ?? {};
    const report = `<!doctype html><html><head><meta charset="utf-8"><title>HeatCheck Agent Report</title><style>body{font:15px system-ui;margin:40px;color:#171713;max-width:900px}h1{font-size:44px}.score{font-size:64px;color:#ff6b2c}li{margin:8px 0}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save as PDF</button><h1>Heat Intelligence Agent Report</h1><p>Run ${escapeHtml(detail.run.id)} · ${escapeHtml(detail.run.goal)}</p><div class="score">${escapeHtml(risk.score ?? "—")}/100</div><h2>${escapeHtml(risk.level ?? "Awaiting result")}</h2><p>${escapeHtml(result.decision?.summary ?? "No summary available.")}</p><h2>Evidence timeline</h2><ol>${detail.events.map(item => `<li>${escapeHtml(item.message)}</li>`).join("")}</ol><h2>Tools</h2><ul>${detail.toolCalls.map(item => `<li>${escapeHtml(item.toolName)} · ${escapeHtml(item.status)} · ${item.durationMs} ms</li>`).join("")}</ul></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="heatcheck-agent-${detail.run.id}.html"`); res.send(report);
  });
  app.get("/api/reports/heat-intelligence", async (req, res) => {
    const { userId } = getAuth(req);
    const user = userId ? await getUserByOpenId(userId) : null;
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!user) return res.status(401).json({ error: "Authentication required." });
    if (!organizationId) return res.status(400).json({ error: "Workspace required." });
    const data = await getDashboardData({ userId: user.id, organizationId });
    const observation = data.latestObservation;
    const rows = data.locations.map(location => `<tr><td>${escapeHtml(location.name)}</td><td>${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}</td><td>${escapeHtml(location.nextAnalysisAt)}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Heat Intelligence Report</title><style>body{font:14px system-ui;margin:40px;color:#151515}h1{font-size:42px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border:1px solid #ccc;text-align:left}.risk{font-size:56px;color:#ff6b2c}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save as PDF</button><h1>Heat Intelligence Report</h1><p>${escapeHtml(data.workspace.organization.name)} · generated ${new Date().toISOString()}</p><div class="risk">${observation?.riskScore ?? "—"}/100</div><p>${escapeHtml(observation?.riskLevel ?? "Awaiting data")}</p><h2>Monitored locations</h2><table><thead><tr><th>Location</th><th>Coordinates</th><th>Next assessment</th></tr></thead><tbody>${rows}</tbody></table><h2>Current evidence</h2><p>Temperature: ${observation?.temperature ?? "—"}°C · Heat index: ${observation?.heatIndex ?? "—"}°C · Humidity: ${observation?.relativeHumidity ?? "—"}%</p><p>Open incidents: ${data.openIncidents.length} · Active hotspots: ${data.hotspots.length}</p></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="heat-intelligence-${new Date().toISOString().slice(0, 10)}.html"`);
    res.send(html);
  });
  registerStorageProxy(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  app.use(errorTelemetry);
  return app;
}
