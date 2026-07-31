import type { BillingAdapter } from "./contract";
import { MockBillingAdapter } from "./drivers/mock";

/** Only one driver exists yet; the factory shape is what makes adding a real one additive. */
export function createBillingAdapter(): BillingAdapter {
  return new MockBillingAdapter();
}
