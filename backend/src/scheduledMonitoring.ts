import type { Express, Request, Response } from "express";
import { runDueMonitoring } from "./heatcheck/monitoring.js";

export function registerScheduledMonitoring(app: Express) {
  app.get("/api/cron/heatcheck-monitoring", async (req: Request, res: Response) => {
    try {
      const cronSecret = process.env.CRON_SECRET;
      const authorization = req.get("authorization");
      if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
        return res.status(403).json({ error: "cron-only" });
      }
      const result = await runDueMonitoring();
      return res.json({ ok: true, ...result });
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
