import { describe, expect, it } from "vitest";

import {
  hasAnyPermission,
  hasPermission,
  isBackOfficeRole,
  isCustomerRole,
  isPlatformRole,
  rolesWithPermission,
  sessionPlane,
} from "./auth";

describe("hasPermission", () => {
  it("refuses admin:view to a plain customer", () => {
    expect(hasPermission({ roles: ["customer"] }, "admin:view")).toBe(false);
  });

  it("refuses platform:operate to a tenant admin", () => {
    expect(hasPermission({ roles: ["client_admin"] }, "platform:operate")).toBe(false);
  });

  it("grants a permission composed onto client_admin from its groups", () => {
    // finance:ap is only hand-listed under TENANT_AP, never under client_admin
    // directly -- this is the guarantee that composition (doc 09 §2) works.
    expect(hasPermission({ roles: ["client_admin"] }, "finance:ap")).toBe(true);
    expect(hasPermission({ roles: ["client_admin"] }, "finance:ar")).toBe(true);
  });

  it("refuses everything to a null or undefined session", () => {
    expect(hasPermission(null, "dashboard:view")).toBe(false);
    expect(hasPermission(undefined, "dashboard:view")).toBe(false);
  });

  it("grants ap_manager its own desk but not ar's", () => {
    expect(hasPermission({ roles: ["ap_manager"] }, "finance:ap")).toBe(true);
    expect(hasPermission({ roles: ["ap_manager"] }, "finance:ar")).toBe(false);
  });
});

describe("hasAnyPermission", () => {
  it("is true when at least one permission matches", () => {
    expect(hasAnyPermission({ roles: ["customer"] }, ["admin:view", "order:view"])).toBe(true);
  });

  it("is false when none match", () => {
    expect(hasAnyPermission({ roles: ["customer"] }, ["admin:view", "platform:operate"])).toBe(false);
  });
});

describe("rolesWithPermission", () => {
  it("finds every role sharing a permission", () => {
    expect(rolesWithPermission("finance:ap")).toEqual(["client_admin", "ap_manager"]);
  });
});

describe("plane classification", () => {
  it("classifies each role into exactly one plane", () => {
    expect(isPlatformRole("super_admin")).toBe(true);
    expect(isBackOfficeRole("super_admin")).toBe(false);
    expect(isCustomerRole("super_admin")).toBe(false);

    expect(isBackOfficeRole("client_admin")).toBe(true);
    expect(isPlatformRole("client_admin")).toBe(false);
    expect(isCustomerRole("client_admin")).toBe(false);

    expect(isCustomerRole("customer")).toBe(true);
    expect(isPlatformRole("customer")).toBe(false);
    expect(isBackOfficeRole("customer")).toBe(false);
  });
});

describe("sessionPlane", () => {
  it("sends a platform role to the console", () => {
    expect(sessionPlane({ roles: ["sap_manager"] })).toBe("platform");
  });

  it("sends a back-office role to the admin plane", () => {
    expect(sessionPlane({ roles: ["ar_manager"] })).toBe("back_office");
  });

  it("sends a buyer role to the customer plane", () => {
    expect(sessionPlane({ roles: ["customer"] })).toBe("customer");
  });

  it("returns none for a session with no roles", () => {
    expect(sessionPlane({ roles: [] })).toBe("none");
    expect(sessionPlane(null)).toBe("none");
  });

  it("prefers the widest plane when a session somehow holds two", () => {
    expect(sessionPlane({ roles: ["customer", "super_admin"] })).toBe("platform");
    expect(sessionPlane({ roles: ["customer", "client_admin"] })).toBe("back_office");
  });
});
