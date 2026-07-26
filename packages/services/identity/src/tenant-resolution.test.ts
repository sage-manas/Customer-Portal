import { describe, expect, it } from "vitest";

import { hostMatchesSession, resolveTenantFromHost } from "./tenant-resolution";

const ROOT = "customerconnect.in";

describe("resolveTenantFromHost", () => {
  it("reads the tenant slug from a subdomain", () => {
    expect(resolveTenantFromHost("acme.customerconnect.in", ROOT)).toEqual({ slug: "acme" });
    expect(resolveTenantFromHost("ACME.CustomerConnect.in:3000", ROOT)).toEqual({ slug: "acme" });
  });

  it("treats an unrelated host as a custom domain", () => {
    expect(resolveTenantFromHost("portal.acme-industries.com", ROOT)).toEqual({
      customDomain: "portal.acme-industries.com",
    });
  });

  it("resolves nothing for the apex, www and localhost", () => {
    expect(resolveTenantFromHost("customerconnect.in", ROOT)).toEqual({});
    expect(resolveTenantFromHost("www.customerconnect.in", ROOT)).toEqual({});
    expect(resolveTenantFromHost("localhost:3000", ROOT)).toEqual({});
    expect(resolveTenantFromHost(null, ROOT)).toEqual({});
  });

  it("supports <slug>.localhost for local multi-tenant development", () => {
    expect(resolveTenantFromHost("acme.localhost:3000", ROOT)).toEqual({ slug: "acme" });
  });

  it("ignores reserved and nested subdomains", () => {
    expect(resolveTenantFromHost("api.customerconnect.in", ROOT)).toEqual({});
    expect(resolveTenantFromHost("a.b.customerconnect.in", ROOT)).toEqual({});
  });
});

describe("hostMatchesSession", () => {
  const session = { tenantSlug: "acme" };

  it("accepts a matching subdomain and rejects another tenant's", () => {
    expect(hostMatchesSession({ slug: "acme" }, session)).toBe(true);
    expect(hostMatchesSession({ slug: "globex" }, session)).toBe(false);
  });

  it("falls back to the JWT when the host carries no tenant", () => {
    expect(hostMatchesSession({}, session)).toBe(true);
  });

  it("matches a custom domain only against that tenant's registered domain", () => {
    expect(
      hostMatchesSession({ customDomain: "portal.acme.com" }, session, "portal.acme.com"),
    ).toBe(true);
    expect(hostMatchesSession({ customDomain: "portal.acme.com" }, session, "other.com")).toBe(
      false,
    );
    expect(hostMatchesSession({ customDomain: "portal.acme.com" }, session, null)).toBe(false);
  });

  it("rejects when there is no session at all", () => {
    expect(hostMatchesSession({ slug: "acme" }, null)).toBe(false);
  });
});
