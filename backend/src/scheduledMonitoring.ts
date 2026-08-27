import type { Express, Request, Response } from "express";
import { runDueMonitoring } from "./heatcheck/monitoring.js";
import { processQueuedAgentRuns } from "./agent/queue.js";

export function registerScheduledMonitoring(app: Express) {
  app.get("/api/cron/heatcheck-monitoring", async (req: Request, res: Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const authorization = req.get("authorization");
      if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
        return res.status(403).json({ error: "cron-only" });
      }
      const [result, agentQueue] = await Promise.all([runDueMonitoring(), processQueuedAgentRuns()]);
      return res.json({ ok: true, ...result, agentQueue });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduled monitoring error";
      console.error("[ScheduledMonitoring] failed:", error);
      return res.status(500).json({
        error: message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
