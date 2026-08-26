import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: "user-load-test" }) }));

import { apiRateLimit } from "./rateLimit";

function invoke() {
  return new Promise<{ status: number; headers: Record<string, string | number> }>(resolve => {
    const headers: Record<string, string | number> = {};
    let status = 200;
    const req = { path: "/api/trpc/heatcheck.dashboard", ip: "127.0.0.1" } as never;
    const res = {
      setHeader: (key: string, value: string | number) => { headers[key] = value; },
      status: (value: number) => { status = value; return res; },
      json: () => resolve({ status, headers }),
    } as never;
    apiRateLimit(req, res, () => resolve({ status, headers }));
  });
}

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("API rate limiting under concurrent load", () => {
  it("allows the configured burst and rejects excess requests", async () => {
    const responses = await Promise.all(Array.from({ length: 140 }, invoke));
    expect(responses.filter(response => response.status === 200)).toHaveLength(120);
    expect(responses.filter(response => response.status === 429)).toHaveLength(20);
    expect(responses.at(-1)?.headers["RateLimit-Remaining"]).toBe(0);
  });
});
