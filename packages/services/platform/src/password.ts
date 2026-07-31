import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Byte-for-byte the same scheme as `@cc/service-identity`'s password module
 * (same format, same cost parameters), copied rather than imported: a
 * service may not import another service (rule 1), and the operator realm
 * is deliberately independent of the tenant one end to end (ADR-045). If
 * the cost parameters ever change, both copies need updating — that's the
 * price of the separation, not an oversight.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAXMEM = 64 * 1024 * 1024;

const PASSWORD_HASH_PREFIX = "scrypt";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return [PASSWORD_HASH_PREFIX, N, R, P, salt.toString("base64"), derived.toString("base64")].join(
    "$",
  );
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;

  try {
    const derived = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
