import { z } from "zod";

import { onboardingMapping } from "../sap-mapping/onboarding";
import { buildZodSchema } from "../sap-mapping/to-zod";
import type { OnboardingApplicationStatus } from "../status";

/** What the customer submits across the 4-step wizard. */
export const onboardingWriteSchema = buildZodSchema(onboardingMapping, "write");
export type OnboardingApplicationInput = z.infer<typeof onboardingWriteSchema>;

/** Full shape as read back (includes SAP-populated fields once approved). */
export const onboardingReadSchema = buildZodSchema(onboardingMapping, "read");
export type OnboardingApplicationView = z.infer<typeof onboardingReadSchema>;

export interface OnboardingApplication {
  id: string;
  tenantId: string;
  status: OnboardingApplicationStatus;
  data: OnboardingApplicationInput;
  sapCustomerCode?: string;
  rejectionReasons?: string[];
  submittedAt?: Date;
  decidedAt?: Date;
}
