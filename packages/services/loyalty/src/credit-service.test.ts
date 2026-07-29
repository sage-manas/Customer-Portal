import { MockSapAdapter } from "@cc/adapter-sap";
import { describe, expect, it } from "vitest";

import { getCreditPosition, getCreditPositionForDesk } from "./credit-service";
import { isLoyaltyError } from "./errors";

async function expectLoyaltyError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isLoyaltyError(error)) return error;
    throw error;
  }
  throw new Error("Expected a LoyaltyError to be thrown");
}

/**
 * The credit position is composed from SAP reads and stores nothing, so the
 * whole of it is testable against the mock driver with no database.
 */

const KUNNR = "0010001001";
/** Seeded at ~98% utilisation — the ">95% danger" state doc 05 §7.9 wants. */
const TIGHT = "0010001002";
/** Seeded over its limit and blocked (CTLPC). */
const BLOCKED = "0010001003";
const TODAY = "2026-07-26";

const context = (kunnr: string | undefined) => ({ tenantId: "t1", kunnr, userId: "u1" });

describe("getCreditPosition", () => {
  it("returns the account's position with utilisation and DSO derived", async () => {
    const { position, freshness } = await getCreditPosition(new MockSapAdapter(), context(KUNNR), {
      today: TODAY,
    });

    expect(position.kunnr).toBe(KUNNR);
    expect(position.available).toBe(position.creditLimit - position.utilized);
    expect(position.band).toBe("healthy");
    expect(position.dso).toBeGreaterThan(0);
    expect(position.dsoPeriodDays).toBe(90);
    expect(freshness).toBe("live");
  });

  it("reports the danger band for an account near its limit", async () => {
    const { position } = await getCreditPosition(new MockSapAdapter(), context(TIGHT), {
      today: TODAY,
    });
    expect(position.band).toBe("critical");
    expect(position.message).toContain("blocked");
  });

  it("reports a block as its own band, whatever the utilisation reads", async () => {
    const { position } = await getCreditPosition(new MockSapAdapter(), context(BLOCKED), {
      today: TODAY,
    });
    expect(position.blocked).toBe(true);
    expect(position.band).toBe("blocked");
  });

  it("refuses a session with no sold-to account", async () => {
    const error = await expectLoyaltyError(() =>
      getCreditPosition(new MockSapAdapter(), context(undefined)),
    );
    expect(error.code).toBe("no_account");
  });

  it("fails the call when KNKK itself can't be read — that read is the screen", async () => {
    const error = await expectLoyaltyError(() =>
      getCreditPosition(new MockSapAdapter({ unavailable: true }), context(KUNNR)),
    );
    expect(error.code).toBe("upstream_unavailable");
  });

  it("serves the position without a DSO when the AR read fails", async () => {
    const adapter = new MockSapAdapter();
    // Only the two best-effort reads fail; the credit master still answers.
    adapter.getOpenItems = () => Promise.reject(new Error("BSID unavailable"));

    const { position } = await getCreditPosition(adapter, context(KUNNR), { today: TODAY });

    expect(position.creditLimit).toBeGreaterThan(0);
    expect(position.dso).toBeNull();
  });

  it("gives the desk the same position through its own entry point", async () => {
    const customer = await getCreditPosition(new MockSapAdapter(), context(KUNNR), {
      today: TODAY,
    });
    const desk = await getCreditPositionForDesk(new MockSapAdapter(), KUNNR, { today: TODAY });

    expect(desk.position).toEqual(customer.position);
  });
});
