import { describe, expect, it } from "vitest";

import {
  SAP_CONNECTION_FIELDS,
  missingSapConnectionFields,
  sapConfigActionLabel,
  sapConnectionDiff,
  sapConnectionFields,
  sapConnectionSchema,
  SAP_CONFIG_ACTIONS,
  isSapConfigAction,
} from "./sap-config";

describe("SAP connection registry", () => {
  it("gives the mock driver no fields to configure", () => {
    // Not an oversight worth "fixing" later: the mock driver has no
    // external system, so a form here would be inert. The ops screen
    // renders an empty state from this fact.
    expect(sapConnectionFields("mock")).toEqual([]);
  });

  it("keeps every field key unique within a driver", () => {
    for (const [driver, fields] of Object.entries(SAP_CONNECTION_FIELDS)) {
      const keys = fields.map((field) => field.key);
      expect(new Set(keys).size, driver).toBe(keys.length);
    }
  });

  it("marks passwords secret and connection targets not", () => {
    // The property the whole screen's safety rests on: `getTenantSapConfig`
    // returns values for non-secret fields and only `isSet` for secrets, so
    // a field mis-flagged here is a credential rendered into a page.
    for (const driver of ["ecc", "s4"] as const) {
      const byKey = new Map(sapConnectionFields(driver).map((f) => [f.key, f]));
      expect(byKey.get("password")?.secret, driver).toBe(true);
      expect(byKey.get("user")?.secret, driver).toBe(false);
    }
    expect(sapConnectionFields("ecc").find((f) => f.key === "endpoint")?.secret).toBe(false);
    expect(sapConnectionFields("s4").find((f) => f.key === "baseUrl")?.secret).toBe(false);
  });
});

describe("sapConnectionSchema", () => {
  it("accepts a partial submission — an unchanged secret is not re-sent", () => {
    const parsed = sapConnectionSchema("ecc").safeParse({ endpoint: "sap.example:3300" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a key the driver does not declare", () => {
    // `.strict()` is what stops the vault accumulating keys nothing reads —
    // a bag full of typos looks configured and behaves unconfigured.
    const parsed = sapConnectionSchema("ecc").safeParse({ enpoint: "typo" });
    expect(parsed.success).toBe(false);
  });
});

describe("missingSapConnectionFields", () => {
  it("reports required fields with nothing stored", () => {
    const missing = missingSapConnectionFields("ecc", { endpoint: "sap.example:3300" });
    expect(missing.map((field) => field.key).sort()).toEqual(["client", "password", "user"]);
  });

  it("treats whitespace as unset", () => {
    expect(missingSapConnectionFields("s4", { baseUrl: "   " }).map((f) => f.key)).toContain(
      "baseUrl",
    );
  });

  it("is always empty for the mock driver", () => {
    expect(missingSapConnectionFields("mock", {})).toEqual([]);
  });
});

describe("sapConnectionDiff", () => {
  it("names the fields that changed", () => {
    const changed = sapConnectionDiff(
      "ecc",
      { endpoint: "old:3300", client: "100", password: "a" },
      { endpoint: "new:3300", client: "100", password: "b" },
    );
    expect(changed).toEqual(["endpoint", "password"]);
  });

  it("never returns a value — only keys (ADR-053)", () => {
    // The audit trail is written from this function's output. If it ever
    // returned values, the trail would become an unencrypted copy of the
    // credential store; asserting the shape is how that stays impossible
    // to do by accident.
    const changed = sapConnectionDiff("ecc", { password: "hunter2" }, { password: "hunter3" });
    expect(changed).toEqual(["password"]);
    expect(JSON.stringify(changed)).not.toContain("hunter");
  });

  it("ignores keys the driver does not declare", () => {
    expect(sapConnectionDiff("s4", { leftover: "x" }, {})).toEqual([]);
  });
});

describe("SAP config actions", () => {
  it("labels every action in the registry", () => {
    for (const action of SAP_CONFIG_ACTIONS) {
      expect(sapConfigActionLabel(action)).toBeTruthy();
    }
  });

  it("recognises only declared actions", () => {
    expect(isSapConfigAction("driver.changed")).toBe(true);
    expect(isSapConfigAction("driver.deleted")).toBe(false);
  });
});
