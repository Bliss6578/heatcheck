import type { Express, Request, Response } from "express";
import { sdk } from "./_core/sdk";
import { runDueMonitoring } from "./heatcheck/monitoring";

export function registerScheduledMonitoring(app: Express) {
  app.post("/api/scheduled/heatcheck-monitoring", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: "cron-only" });
      }
      const result = await runDueMonitoring();
      return res.json({ ok: true, taskUid: user.taskUid, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scheduled monitoring error";
      return res.status(500).json({
        error: message,
        stack: error instanceof Error ? error.stack : undefined,
        context: { url: req.originalUrl },
        timestamp: new Date().toISOString(),
      });
    }
  });
}
