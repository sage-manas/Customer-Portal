import { describe, expect, it } from "vitest";

import { hashPassword, needsRehash, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-1");
    await expect(verifyPassword("Correct-Horse-Battery-1", hash)).resolves.toBe(true);
    await expect(verifyPassword("correct-horse-battery-1", hash)).resolves.toBe(false);
  });

  it("salts each hash so identical passwords differ on disk", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same-password-1"),
      hashPassword("same-password-1"),
    ]);
    expect(a).not.toBe(b);
    await expect(verifyPassword("same-password-1", b)).resolves.toBe(true);
  });

  it("stores its parameters in the hash string", async () => {
    const hash = await hashPassword("whatever-long-password");
    expect(hash.split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
  });

  it("returns false rather than throwing for absent or malformed hashes", async () => {
    for (const stored of [null, undefined, "", "not-a-hash", "scrypt$1$2$3", "bcrypt$a$b$c$d$e"]) {
      await expect(verifyPassword("x", stored)).resolves.toBe(false);
    }
  });

  it("flags legacy/absent hashes for rehash but not current ones", async () => {
    expect(needsRehash(null)).toBe(true);
    expect(needsRehash("scrypt$1024$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(needsRehash(await hashPassword("current-policy-password"))).toBe(false);
  });
});
