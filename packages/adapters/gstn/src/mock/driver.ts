import { isValidGstin, panFromGstin, stateCodeFromGstin } from "@cc/domain";

import type { GstnAdapter, GstnHealth, GstnTaxpayer } from "../contract";
import { GstnError } from "../errors";

import { GSTN_SEED, GSTN_UNREGISTERED_SPECIMEN, constitutionForPan } from "./seed";

/**
 * In-memory GSTN simulation.
 *
 * Seeded numbers answer with their fixture, including the cancelled and
 * suspended registrations. Any *other* structurally valid GSTIN gets a
 * synthesized Active taxpayer, derived deterministically from the number
 * itself — so a demo or a test can invent a GSTIN and still walk the happy
 * path, which is the whole point of mock-first (docs/06). The one exception
 * is `GSTN_UNREGISTERED_SPECIMEN`, which always answers "not found" so the
 * unregistered state stays reachable.
 *
 * The synthesized legal name is intentionally *not* the name the applicant
 * typed: a name mismatch is a warning the reviewer should see, and a mock
 * that echoed the input back would make that state untestable.
 */

export interface MockGstnOptions {
  /** Artificial latency, so the verify spinner is a real state. */
  latencyMs?: number;
  /** When true every call fails with a retryable `unavailable` error. */
  unavailable?: boolean;
  /** Fixed clock for deterministic `checkedAt` in tests. */
  now?: () => Date;
  /** Extra fixtures, merged over the seed (demo tenants, tests). */
  registry?: Record<string, Omit<GstnTaxpayer, "checkedAt">>;
}

const SYNTHETIC_SUFFIXES = ["Industries", "Enterprises", "Traders", "Exports", "Solutions"];

export class MockGstnAdapter implements GstnAdapter {
  readonly driver = "mock" as const;

  private readonly registry: Record<string, Omit<GstnTaxpayer, "checkedAt">>;
  private readonly options: Required<Omit<MockGstnOptions, "registry">>;

  constructor(options: MockGstnOptions = {}) {
    this.options = {
      latencyMs: options.latencyMs ?? 0,
      unavailable: options.unavailable ?? false,
      now: options.now ?? (() => new Date()),
    };
    this.registry = { ...GSTN_SEED, ...options.registry };
  }

  async health(): Promise<GstnHealth> {
    return {
      reachable: !this.options.unavailable,
      driver: this.driver,
      checkedAt: this.options.now().toISOString(),
    };
  }

  async verifyGstin(gstin: string): Promise<GstnTaxpayer> {
    const normalized = gstin.trim().toUpperCase();

    // Format is checked before the "call": the real API charges per lookup
    // and would reject it anyway, and the applicant gets a faster answer.
    if (!isValidGstin(normalized)) {
      throw new GstnError(
        "That GSTIN isn't valid. Check for typos — the last character is a checksum, so one wrong digit fails the whole number.",
        { kind: "invalid_format" },
      );
    }

    if (this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
    if (this.options.unavailable) {
      throw new GstnError(
        "We couldn't reach GSTN just now. You can continue — we'll verify your GSTIN during review.",
        { kind: "unavailable", upstreamMessage: "mock outage simulation" },
      );
    }

    const seeded = this.registry[normalized];
    if (seeded) return { ...seeded, checkedAt: this.options.now().toISOString() };

    if (normalized === GSTN_UNREGISTERED_SPECIMEN) {
      throw new GstnError("GSTN has no registration for this GSTIN.", { kind: "not_found" });
    }

    return this.synthesize(normalized);
  }

  private synthesize(gstin: string): GstnTaxpayer {
    const pan = panFromGstin(gstin);
    // Deterministic in the GSTIN, so the same number always answers the same
    // way across runs — a mock that drifts is worse than no mock.
    const seed = [...pan].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const suffix = SYNTHETIC_SUFFIXES[seed % SYNTHETIC_SUFFIXES.length]!;
    const legalName = `${pan.slice(0, 3)}${pan.slice(5, 9)} ${suffix} Private Limited`;

    return {
      gstin,
      legalName,
      tradeName: `${pan.slice(0, 3)}${pan.slice(5, 9)} ${suffix}`,
      stateCode: stateCodeFromGstin(gstin),
      status: "Active",
      constitution: constitutionForPan(pan),
      registrationType: "01",
      registeredOn: "2021-04-01",
      checkedAt: this.options.now().toISOString(),
    };
  }
}
