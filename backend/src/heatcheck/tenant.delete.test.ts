import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => dbMocks);

import { deleteLocation } from "./tenant";

function createDb(rows: unknown[][]) {
  const remove = vi.fn(() => ({ where: () => Promise.resolve() }));
  const insert = vi.fn(() => ({ values: () => Promise.resolve() }));
  const select = vi.fn(() => ({
    from: () => ({
      where: () => {
        const result = rows.shift() ?? [];
        return {
          limit: () => Promise.resolve(result),
          then: (resolve: (value: unknown[]) => unknown) =>
            Promise.resolve(result).then(resolve),
        };
      },
    }),
  }));
  const db = {
    select,
    delete: remove,
    insert,
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) =>
      callback(db)
    ),
  };
  return { db, remove };
}

describe("location deletion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes the tenant-scoped location graph in a transaction", async () => {
    const membership = { userId: 7, organizationId: "org-001", role: "OPERATOR" };
    const organization = { id: "org-001", name: "Operations" };
    const location = {
      id: "location-001",
      organizationId: "org-001",
      name: "Test Site",
    };
    const { db, remove } = createDb([
      [membership],
      [organization],
      [membership],
      [organization],
      [location],
      [{ id: "operational-run-001" }],
      [{ id: "autonomous-run-001" }],
    ]);
    dbMocks.getDb.mockResolvedValue(db);

    await expect(
      deleteLocation({
        userId: 7,
        organizationId: "org-001",
        locationId: "location-001",
      })
    ).resolves.toEqual({ id: "location-001", name: "Test Site" });

    expect(db.transaction).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledTimes(15);
  });

  it("does not allow a viewer to delete a location", async () => {
    const { db } = createDb([
      [{ userId: 7, organizationId: "org-001", role: "VIEWER" }],
      [{ id: "org-001", name: "Operations" }],
    ]);
    dbMocks.getDb.mockResolvedValue(db);

    await expect(
      deleteLocation({
        userId: 7,
        organizationId: "org-001",
        locationId: "location-001",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
