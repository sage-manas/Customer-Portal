import { db, runWithTenant } from "@cc/db";
import type { LoyaltyTier, TierThresholdOverrides, TierThresholds } from "@cc/domain";
import { resolveTierThresholds, tierThresholdOverridesSchema } from "@cc/domain";

import { invalidFrom } from "./errors";

/**
 * The tenant's tier ladder.
 *
 * The registry in `@cc/domain` owns the tiers themselves — their order, labels
 * and default thresholds. This owns only the numbers a tenant has changed, one
 * row per tier, and an absent row means the default still applies. That is
 * the opt-*out* shape `moduleToggles` uses, and it matters here for a specific
 * reason: a tenant that has never opened the settings screen must still have a
 * complete, ascending ladder, because customers are being tiered against it
 * from the day the module goes live.
 */

export async function getTierThresholds(tenantId: string): Promise<TierThresholds> {
  const rows = await runWithTenant(tenantId, () =>
    db.loyaltyTierSetting.findMany({ select: { tier: true, thresholdAmount: true } }),
  );

  const overrides: TierThresholdOverrides = {};
  for (const row of rows) {
    overrides[row.tier as LoyaltyTier] = Number(row.thresholdAmount);
  }

  return resolveTierThresholds(overrides);
}

/**
 * Replaces the tenant's overrides with a new ladder (docs/05 §8 tenant
 * settings).
 *
 * Validated as a *whole* ladder rather than field by field, because the rule
 * that matters is a relationship between the tiers: Gold above Silver. A
 * per-field save would let a tenant pass through a state where the ladder does
 * not ascend, and every customer read taken in that window would tier people
 * wrongly with nothing to show for it afterwards.
 */
export async function saveTierThresholds(
  tenantId: string,
  overrides: unknown,
  options: { updatedByUserId?: string } = {},
): Promise<TierThresholds> {
  const parsed = tierThresholdOverridesSchema.safeParse(overrides);
  if (!parsed.success) throw invalidFrom(parsed.error);

  const entries = Object.entries(parsed.data) as Array<[LoyaltyTier, number]>;

  await runWithTenant(tenantId, () =>
    db.$transaction(
      entries.map(([tier, thresholdAmount]) =>
        db.loyaltyTierSetting.upsert({
          where: { tenantId_tier: { tenantId, tier } },
          create: {
            tenantId,
            tier,
            thresholdAmount,
            updatedByUserId: options.updatedByUserId,
          },
          update: { thresholdAmount, updatedByUserId: options.updatedByUserId },
        }),
      ),
    ),
  );

  return getTierThresholds(tenantId);
}
