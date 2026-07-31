import { describe, expect, it } from "vitest";

import { PlatformError } from "./errors";
import { issueOperatorTokens, verifyOperatorToken } from "./jwt";

const SECRET = "a".repeat(32);

describe("operator JWT", () => {
  it("round-trips claims through issue and verify", async () => {
    const tokens = await issueOperatorTokens(
      { operatorId: "op_1", email: "ops@example.com" },
      SECRET,
    );
    const claims = await verifyOperatorToken(tokens.accessToken, SECRET);
    expect(claims).toEqual({ operatorId: "op_1", email: "ops@example.com" });
  });

  it("rejects a refresh token presented as access", async () => {
    const tokens = await issueOperatorTokens(
      { operatorId: "op_1", email: "ops@example.com" },
      SECRET,
    );
    await expect(verifyOperatorToken(tokens.refreshToken, SECRET, "access")).rejects.toThrow(
      PlatformError,
    );
  });

  it("rejects a token signed under a different secret", async () => {
    const tokens = await issueOperatorTokens(
      { operatorId: "op_1", email: "ops@example.com" },
      SECRET,
    );
    await expect(verifyOperatorToken(tokens.accessToken, "b".repeat(32))).rejects.toThrow(
      PlatformError,
    );
  });

  it("never verifies against a tenant-realm secret's token shape (no tenantId claim at all)", async () => {
    const tokens = await issueOperatorTokens(
      { operatorId: "op_1", email: "ops@example.com" },
      SECRET,
    );
    const claims = await verifyOperatorToken(tokens.accessToken, SECRET);
    expect(claims).not.toHaveProperty("tenantId");
    expect(claims).not.toHaveProperty("roles");
  });
});
