import { CUSTOMER_TYPES, GST_REGISTRATION_TYPES, STATE_OPTIONS } from "@cc/domain";
import type { SelectOption } from "@cc/ui";

/**
 * Which onboarding fields render as a select, and from which domain list.
 *
 * The lists themselves live in `@cc/domain` (T005S region codes, GST
 * registration types, KNA1-KTOKD account groups) — this is only the
 * field -> list wiring, so no screen carries an inline `<option>` list that
 * could drift from the registry.
 */
const toOptions = (values: readonly { code: string; name: string }[]): SelectOption[] =>
  values.map((value) => ({ value: value.code, label: `${value.name} (${value.code})` }));

export const FIELD_OPTIONS: Readonly<Record<string, SelectOption[]>> = {
  customerType: toOptions(CUSTOMER_TYPES),
  state: toOptions(STATE_OPTIONS),
  gstRegistrationType: toOptions(GST_REGISTRATION_TYPES),
  country: [{ value: "IN", label: "India (IN)" }],
};
