import { describe, expect, it } from "vitest";
import { requireAdministratorRole, requireOperatorRole } from "./tenant";

describe("Heatcheck workspace role boundaries", () => {
  it("allows organization owners and administrators to make administrator-scoped changes", () => {
    expect(() => requireAdministratorRole("OWNER")).not.toThrow();
    expect(() => requireAdministratorRole("ADMIN")).not.toThrow();
  });

  it("blocks operators and viewers from changing administrator-scoped settings", () => {
    expect(() => requireAdministratorRole("OPERATOR")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => requireAdministratorRole("VIEWER")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("allows an operator to perform routine location work while keeping viewers read-only", () => {
    expect(() => requireOperatorRole("OPERATOR")).not.toThrow();
    expect(() => requireOperatorRole("VIEWER")).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
