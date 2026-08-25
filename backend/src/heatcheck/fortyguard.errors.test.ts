import { afterEach, describe, expect, it, vi } from "vitest";
import { FortyGuardClient, FortyGuardError } from "./fortyguard";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("FortyGuard controlled failures", () => {
  it.each([
    [403, "FORBIDDEN"],
    [429, "RATE_LIMIT"],
    [422, "INVALID_REQUEST"],
    [500, "UPSTREAM"],
  ] as const)(
    "maps HTTP %s without exposing an upstream payload",
    async (status, code) => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ secret: "must-not-leak" }), {
            status,
            headers: { "Content-Type": "application/json" },
          })
        );
      const client = new FortyGuardClient("test-key");
      await expect(
        client.submitStreetView(40.7128, -74.006)
      ).rejects.toMatchObject<Partial<FortyGuardError>>({ code, status });
      await expect(
        client.submitStreetView(40.7128, -74.006)
      ).rejects.not.toThrow(/must-not-leak/);
    }
  );

  it("returns a completed activity result", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { status: "Completed", result: { ok: true } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    await expect(
      new FortyGuardClient("test-key").awaitActivity("activity-1")
    ).resolves.toMatchObject({ status: "Completed", result: { ok: true } });
  });

  it("turns a failed activity into a controlled error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { status: "Failed" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    await expect(
      new FortyGuardClient("test-key").awaitActivity("activity-2")
    ).rejects.toMatchObject({ code: "FAILED_TASK" });
  });
});
