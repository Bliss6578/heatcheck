import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardLayout = readFileSync(new URL("../../frontend/src/components/DashboardLayout.tsx", import.meta.url), "utf8");

describe("authenticated return-to-home controls", () => {
  it("keeps direct public-home controls in both desktop sidebar and mobile header variants", () => {
    expect(dashboardLayout).toContain('tooltip="View public site"');
    expect(dashboardLayout).toContain('aria-label="View public site"');
    expect(dashboardLayout.match(/setLocation\("\/"\)/g)).toHaveLength(2);
  });
});
