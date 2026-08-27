import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

const local = new Map<string, { count: number; resetAt: number }>();
const windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
const requestLimit = Number(process.env.RATE_LIMIT_REQUESTS ?? 120);

async function distributedIncrement(key: string) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["INCR", key], ["EXPIRE", key, windowSeconds, "NX"]]),
    signal: AbortSignal.timeout(2_500),
  });
  if (!response.ok) throw new Error("Distributed rate limiter unavailable");
  const result = await response.json() as Array<{ result?: number }>;
  return Number(result[0]?.result ?? 0);
}

export function apiRateLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
  const identity = getAuth(req).userId ?? req.ip ?? "unknown";
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `heatcheck:rate:${identity}:${bucket}`;
  void (async () => {
    let count: number;
    const requiresDistributed = process.env.RATE_LIMIT_REQUIRE_DISTRIBUTED === "true";
    try {
      count = (await distributedIncrement(key)) ?? 0;
    } catch {
      if (requiresDistributed) return res.status(503).json({ error: "Rate limiting is temporarily unavailable." });
      count = 0;
    }
    if (requiresDistributed && !count) return res.status(503).json({ error: "Distributed rate limiting is not configured." });
    if (!count) {
      const now = Date.now(); const current = local.get(key);
      const state = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowSeconds * 1000 } : { ...current, count: current.count + 1 };
      local.set(key, state); count = state.count;
    }
    res.setHeader("RateLimit-Limit", requestLimit);
    res.setHeader("RateLimit-Remaining", Math.max(0, requestLimit - count));
    res.setHeader("RateLimit-Policy", `${requestLimit};w=${windowSeconds}`);
    if (count > requestLimit) return res.status(429).json({ error: "Too many requests. Please retry shortly." });
    next();
  })().catch(next);
}
