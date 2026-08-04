import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { PlatformError } from "./errors";
import { OPERATOR_CLAIM_VERSION, issueOperatorTokens, verifyOperatorToken } from "./jwt";

const SECRET = "a".repeat(32);
const OPERATOR = { operatorId: "op_1", email: "ops@example.com", roles: ["super_admin"] } as const;

describe("operator JWT", () => {
  it("round-trips claims through issue and verify", async () => {
    const tokens = await issueOperatorTokens({ ...OPERATOR, roles: ["super_admin"] }, SECRET);
    const claims = await verifyOperatorToken(tokens.accessToken, SECRET);
    expect(claims).toEqual({
      operatorId: "op_1",
      email: "ops@example.com",
      roles: ["super_admin"],
    });
  });

  it("rejects a refresh token presented as access", async () => {
    const tokens = await issueOperatorTokens({ ...OPERATOR, roles: ["super_admin"] }, SECRET);
    await expect(verifyOperatorToken(tokens.refreshToken, SECRET, "access")).rejects.toThrow(
      PlatformError,
    );
  });

  it("rejects a token signed under a different secret", async () => {
    const tokens = await issueOperatorTokens({ ...OPERATOR, roles: ["super_admin"] }, SECRET);
    await expect(verifyOperatorToken(tokens.accessToken, "b".repeat(32))).rejects.toThrow(
      PlatformError,
    );
  });

  it("never carries a tenant claim", async () => {
    const tokens = await issueOperatorTokens({ ...OPERATOR, roles: ["super_admin"] }, SECRET);
    const claims = await verifyOperatorToken(tokens.accessToken, SECRET);
    expect(claims).not.toHaveProperty("tenantId");
    expect(claims).not.toHaveProperty("kunnr");
  });

  it("drops a tenant role rather than admitting it to the operator realm", async () => {
    // Not reachable through `operatorLogin`, which filters the same way —
    // this asserts the *parse* is where plane separation is decided, so a
    // hand-forged or hand-migrated token cannot carry `client_admin` into
    // the console even with a valid signature (doc 09 §1).
    const token = await new SignJWT({
      typ: "access",
      ver: OPERATOR_CLAIM_VERSION,
      email: OPERATOR.email,
      roles: ["client_admin", "sap_manager", "not_a_role"],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("op_1")
      .setIssuer("customerconnect-ops")
      .setAudience("customerconnect-ops-console")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(SECRET));

    const claims = await verifyOperatorToken(token, SECRET);
    expect(claims.roles).toEqual(["sap_manager"]);
  });

  it("rejects a pre-restructure token instead of degrading it to no roles", async () => {
    // A version-1 token is correctly signed and unexpired but has no roles
    // claim; accepting it would produce a console session that 403s on
    // everything with nothing telling the operator to sign in again.
    const token = await new SignJWT({ typ: "access", email: OPERATOR.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("op_1")
      .setIssuer("customerconnect-ops")
      .setAudience("customerconnect-ops-console")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(SECRET));

    await expect(verifyOperatorToken(token, SECRET)).rejects.toThrow(PlatformError);
  });
});
