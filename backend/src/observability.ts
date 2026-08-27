import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";

function sentryEnvelope(event: Record<string, unknown>) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const parsed = new URL(dsn);
    const projectId = parsed.pathname.replace(/^\//, "");
    if (!parsed.username || !projectId) return null;
    const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(parsed.username)}`;
    const payload = { event_id: randomUUID().replace(/-/g, ""), level: "error", platform: "node", timestamp: new Date().toISOString(), request: { method: event.method, url: event.path }, exception: { values: [{ type: "HeatCheckError", value: event.message }] }, tags: { request_id: event.requestId } };
    return { endpoint, body: `{}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(payload)}` };
  } catch { return null; }
}

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
  const sentry = sentryEnvelope(event);
  if (sentry) void fetch(sentry.endpoint, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope" }, body: sentry.body, signal: AbortSignal.timeout(3_000) }).catch(() => undefined);
  if (!res.headersSent) res.status(500).json({ error: "Internal server error", requestId: event.requestId });
};
