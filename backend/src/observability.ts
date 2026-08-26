import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";

export const requestTelemetry: RequestHandler = (req, res, next) => {
  const requestId = req.get("x-request-id")?.slice(0, 100) || randomUUID();
  const started = Date.now(); res.setHeader("x-request-id", requestId);
  res.on("finish", () => console.info(JSON.stringify({ type: "http.request", requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started })));
  next();
};

export const errorTelemetry: ErrorRequestHandler = (error, req, res, _next) => {
  const event = { type: "http.error", requestId: res.getHeader("x-request-id"), method: req.method, path: req.path, message: error instanceof Error ? error.message : "Unknown error" };
  console.error(JSON.stringify(event));
  const webhook = process.env.OBSERVABILITY_WEBHOOK_URL;
  if (webhook) void fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error", requestId: event.requestId });
};
