import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { sql } from "drizzle-orm";
import express from "express";
import { createContext } from "./_core/context.js";
import { registerStorageProxy } from "./_core/storageProxy.js";
import { getDb, getUserByOpenId } from "./db.js";
import { appRouter } from "./routers.js";
import { registerScheduledMonitoring } from "./scheduledMonitoring.js";
import { runAutonomousAgent } from "./agent/orchestrator/run-agent.js";

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
    const send = (type: string, payload: unknown) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    try {
      const result = await runAutonomousAgent({
        userId: user.id,
        organizationId,
        locationId,
        goal,
        onEvent: item => send("activity", item),
      });
      send("result", result);
    } catch (error) {
      send("failure", { message: error instanceof Error ? error.message : "Agent run failed." });
    } finally {
      res.end();
    }
  });
  registerStorageProxy(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: appRouter, createContext })
  );
  return app;
}
