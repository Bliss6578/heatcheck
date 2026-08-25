import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => dbMocks);

import { updateWorkspaceSettings } from "./tenant";

function createDbForRole(role: "OWNER" | "ADMIN" | "OPERATOR" | "VIEWER") {
  const rows = [
    [{ userId: 7, organizationId: "org-001", role }],
    [{ id: "org-001", name: "Phoenix Operations", agentMode: "RECOMMEND" }],
  ];
  const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
  const insert = vi.fn(() => ({ values: () => Promise.resolve() }));
  const db = {
    select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(rows.shift() ?? []) }) }) })),
    update,
    insert,
  };
  return { db, update };
}

describe("Heatcheck agent-mode settings mutation", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["OWNER", "ADMIN"] as const)("allows a %s to change the organization agent mode", async (role) => {
    const { db, update } = createDbForRole(role);
    dbMocks.getDb.mockResolvedValue(db);

    await expect(updateWorkspaceSettings({ userId: 7, organizationId: "org-001", agentMode: "AUTONOMOUS" })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it.each(["OPERATOR", "VIEWER"] as const)("rejects a %s from changing the organization agent mode", async (role) => {
    const { db, update } = createDbForRole(role);
    dbMocks.getDb.mockResolvedValue(db);

    await expect(updateWorkspaceSettings({ userId: 7, organizationId: "org-001", agentMode: "AUTONOMOUS" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });
});
