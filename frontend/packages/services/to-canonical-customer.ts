import type { CanonicalCustomer, OnboardingApplicationInput } from "@cc/domain";

/**
 * Portal application data -> the driver-neutral customer the SAP adapter
 * takes. Field provenance stays in the mapping registry; this is only the
 * reshaping, so the ECC driver's BAPI structures and the S/4 driver's BP
 * payload are both built from one canonical object.
 *
 * Kept IO-free and in its own module so it can be tested without a
 * database — everything else in the service touches Prisma.
 */
export function toCanonicalCustomer(
  data: OnboardingApplicationInput,
  assignment: { salesOrg: string; distributionChannel: string },
): CanonicalCustomer {
  const value = data as Record<string, string | number | undefined>;
  const optional = (key: string): string | undefined =>
    value[key] === undefined || value[key] === "" ? undefined : String(value[key]);

  return {
    legalEntityName: String(value.legalEntityName),
    tradeName: optional("tradeName"),
    customerType: String(value.customerType),
    address: {
      street: String(value.street),
      city: String(value.city),
      region: String(value.state),
      postalCode: String(value.pinCode),
      country: String(value.country),
    },
    contact: {
      contactPerson: String(value.contactPerson),
      email: String(value.email),
      phone: String(value.phone),
    },
    tax: {
      pan: String(value.pan),
      gstin: String(value.gstin),
      gstRegistrationType: optional("gstRegistrationType"),
      cin: optional("cin"),
      tan: optional("tan"),
      udyam: optional("msmeUdyamNo"),
    },
    salesOrg: assignment.salesOrg,
    distributionChannel: assignment.distributionChannel,
    paymentTerms: optional("paymentTermsRequested"),
  };
}
