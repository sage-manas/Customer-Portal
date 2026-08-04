import type { SessionClaims } from "@cc/domain";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { isAuthError } from "./errors";
import { CLAIM_VERSION, issueTokens, verifyToken } from "./jwt";

const SECRET = "test-secret-that-is-long-enough-32chars";
const OTHER_SECRET = "another-secret-that-is-long-enough-32ch";

const claims: SessionClaims = {
  userId: "usr_1",
  tenantId: "tnt_1",
  tenantSlug: "acme",
  email: "buyer@acme.example",
  roles: ["customer"],
  kunnr: "0010001001",
  availableKunnrs: ["0010001001", "0010001002"],
};

describe("token issue/verify", () => {
  it("round-trips every claim the tenant middleware and guards depend on", async () => {
    const { accessToken } = await issueTokens(claims, SECRET);
    await expect(verifyToken(accessToken, SECRET)).resolves.toEqual(claims);
  });

  it("rejects a token signed with a different secret", async () => {
    const { accessToken } = await issueTokens(claims, SECRET);
    await expect(verifyToken(accessToken, OTHER_SECRET)).rejects.toMatchObject({
      code: "session_invalid",
    });
  });

  it("rejects a tampered payload", async () => {
    const { accessToken } = await issueTokens(claims, SECRET);
    const [header, payload, signature] = accessToken.split(".");
    const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
    forged.roles = ["client_admin"];
    const tampered = [
      header,
      Buffer.from(JSON.stringify(forged)).toString("base64url"),
      signature,
    ].join(".");
    await expect(verifyToken(tampered, SECRET)).rejects.toSatisfy(isAuthError);
  });

  it("will not accept a refresh token where an access token is required", async () => {
    const { refreshToken } = await issueTokens(claims, SECRET);
    await expect(verifyToken(refreshToken, SECRET)).rejects.toMatchObject({
      code: "session_invalid",
    });
    await expect(verifyToken(refreshToken, SECRET, "refresh")).resolves.toMatchObject({
      userId: "usr_1",
    });
  });

  it("reports an expired token distinctly so the UI can say 'sign in again'", async () => {
    const expired = await new SignJWT({ typ: "access", tenantId: "tnt_1", roles: ["customer"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("usr_1")
      .setIssuer("customerconnect-portal")
      .setAudience("customerconnect-web")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyToken(expired, SECRET)).rejects.toMatchObject({ code: "session_expired" });
  });

  it("rejects a token from before the five-tier role collapse", async () => {
    // Correctly signed, unexpired, and carrying a role that no longer
    // exists. Without the version check `verifyToken` would drop the role
    // and hand back a session with no permissions at all — a tenant admin
    // silently 403ing everywhere for up to a refresh lifetime, with nothing
    // telling them to sign in again (doc 09 §4.3).
    const stale = await new SignJWT({
      typ: "access",
      ver: CLAIM_VERSION - 1,
      tenantId: "tnt_1",
      tenantSlug: "acme",
      email: "admin@acme.example",
      roles: ["tenant_admin"],
      availableKunnrs: [],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("usr_1")
      .setIssuer("customerconnect-portal")
      .setAudience("customerconnect-web")
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyToken(stale, SECRET)).rejects.toMatchObject({ code: "session_invalid" });
  });

  it("drops unknown roles instead of trusting them", async () => {
    const token = await new SignJWT({
      typ: "access",
      ver: CLAIM_VERSION,
      tenantId: "tnt_1",
      tenantSlug: "acme",
      email: "x@acme.example",
      roles: ["customer", "superuser", 42],
      availableKunnrs: ["0010001001", 7],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("usr_1")
      .setIssuer("customerconnect-portal")
      .setAudience("customerconnect-web")
      .setIssuedAt()
      .setExpirationTime("30m")
      .sign(new TextEncoder().encode(SECRET));

    const session = await verifyToken(token, SECRET);
    expect(session.roles).toEqual(["customer"]);
    expect(session.availableKunnrs).toEqual(["0010001001"]);
  });

  it("refuses to sign with a weak secret", async () => {
    await expect(issueTokens(claims, "too-short")).rejects.toThrow(/at least 32 characters/);
  });
});
