import { describe, expect, it } from "vitest";

import { MemoryRateLimiter } from "./memory";

describe("MemoryRateLimiter", () => {
  it("allows up to the limit within a window", async () => {
    const limiter = new MemoryRateLimiter({ now: () => 1_000 });

    const first = await limiter.consume("tenant-a", 2, 60_000);
    const second = await limiter.consume("tenant-a", 2, 60_000);
    const third = await limiter.consume("tenant-a", 2, 60_000);

    expect(first).toEqual({ allowed: true, remaining: 1, resetAtMs: 61_000 });
    expect(second).toEqual({ allowed: true, remaining: 0, resetAtMs: 61_000 });
    expect(third).toEqual({ allowed: false, remaining: 0, resetAtMs: 61_000 });
  });

  it("resets once the window elapses", async () => {
    let now = 1_000;
    const limiter = new MemoryRateLimiter({ now: () => now });

    await limiter.consume("tenant-a", 1, 1_000);
    const blocked = await limiter.consume("tenant-a", 1, 1_000);
    expect(blocked.allowed).toBe(false);

    now += 1_001;
    const afterReset = await limiter.consume("tenant-a", 1, 1_000);
    expect(afterReset).toEqual({ allowed: true, remaining: 0, resetAtMs: now + 1_000 });
  });

  it("tracks separate keys independently", async () => {
    const limiter = new MemoryRateLimiter({ now: () => 1_000 });

    await limiter.consume("tenant-a", 1, 1_000);
    const other = await limiter.consume("tenant-b", 1, 1_000);

    expect(other.allowed).toBe(true);
  });

  it("evicts the oldest key once maxKeys is exceeded", async () => {
    const limiter = new MemoryRateLimiter({ now: () => 1_000, maxKeys: 2 });

    await limiter.consume("a", 5, 1_000);
    await limiter.consume("b", 5, 1_000);
    await limiter.consume("c", 5, 1_000);

    // "a" was evicted, so it gets a fresh window rather than continuing "a"'s count.
    const result = await limiter.consume("a", 1, 1_000);
    expect(result).toEqual({ allowed: true, remaining: 0, resetAtMs: 2_000 });
  });
});
