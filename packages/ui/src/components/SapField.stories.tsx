import { onboardingMapping } from "@cc/domain/sap-mapping";
import type { Meta, StoryObj } from "@storybook/react";

import { SapField } from "./SapField";

const meta: Meta<typeof SapField> = {
  title: "Domain/SapField",
  component: SapField,
};
export default meta;

type Story = StoryObj<typeof SapField>;

const legalEntityNameField = onboardingMapping.find((f) => f.portalField === "legalEntityName")!;
const gstinField = onboardingMapping.find((f) => f.portalField === "gstin")!;
const creditLimitField = onboardingMapping.find((f) => f.portalField === "requestedCreditLimit")!;
const sapCustomerCodeField = onboardingMapping.find((f) => f.portalField === "sapCustomerCode")!;

export const Default: Story = {
  args: { field: legalEntityNameField, placeholder: "As per registration certificate" },
};

export const SpecMode: Story = {
  args: { field: gstinField, specMode: true, placeholder: "29AAAAA9999A1Z5" },
};

export const WithError: Story = {
  args: {
    field: gstinField,
    specMode: true,
    error: "GSTIN state (29 — Karnataka) doesn't match your billing state (27 — Maharashtra).",
  },
};

export const CurrencyType: Story = { args: { field: creditLimitField, specMode: true } };

export const ReadOnly: Story = {
  args: { field: sapCustomerCodeField, specMode: true, value: "0000123456" },
};
