import { describe, expect, it } from "vitest";
import { timezoneForCoordinates } from "./timezone";

describe("location timezone lookup", () => {
  it("assigns the timezone from the site's coordinates", () => {
    expect(timezoneForCoordinates(33.4484, -112.074)).toBe("America/Phoenix");
    expect(timezoneForCoordinates(26.7125, 88.4153)).toBe("Asia/Kolkata");
  });

  it("falls back safely for invalid coordinates", () => {
    expect(timezoneForCoordinates(999, 999)).toBe("UTC");
  });
});
