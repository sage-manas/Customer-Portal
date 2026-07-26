import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's stdlib.
 *
 * Why not bcrypt/argon2: both are native addons, and docs/02 §8 flags
 * native dependencies as the thing that makes managed PaaS deploys
 * painful (the same reason `node-rfc` is pushed out to the connector
 * agent). scrypt is memory-hard, in-stdlib, and has no build step.
 *
 * Parameters are stored *in* the hash string, so cost can be raised later
 * without invalidating existing hashes — `needsRehash` tells the login
 * flow when to transparently upgrade one.
 */

const N = 16384; // CPU/memory cost
const R = 8; // block size
const P = 1; // parallelisation
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** scrypt's default maxmem (32 MB) is below what N=16384,r=8 needs. */
const MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_HASH_PREFIX = "scrypt";

/** Format: scrypt$N$r$p$<salt-b64>$<hash-b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return [PASSWORD_HASH_PREFIX, N, R, P, salt.toString("base64"), derived.toString("base64")].join(
    "$",
  );
}

/**
 * Constant-time verification. Returns false (never throws) on a malformed
 * or absent hash, so a user row with no credentials yet behaves exactly
 * like a wrong password to anyone probing.
 */
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

/** True when a stored hash uses weaker parameters than the current policy. */
export function needsRehash(storedHash: string | null | undefined): boolean {
  if (!storedHash) return true;
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== PASSWORD_HASH_PREFIX) return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}
