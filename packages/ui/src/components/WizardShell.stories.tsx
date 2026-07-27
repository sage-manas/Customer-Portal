import { ONBOARDING_STEPS, onboardingStepFields, STATE_OPTIONS } from "@cc/domain";
import type { Meta, StoryObj } from "@storybook/react";

import { SapField } from "./SapField";
import { FormSection, WizardShell } from "./WizardShell";

const meta: Meta<typeof WizardShell> = {
  title: "Domain/WizardShell",
  component: WizardShell,
  parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof WizardShell>;

const steps = ONBOARDING_STEPS.map((step) => ({
  key: step.key,
  title: step.title,
  description: step.description,
}));

/** Renders a real step from the registry — no hand-written field list. */
function StepOne({ error }: { error?: Record<string, string> } = {}) {
  const fields = onboardingStepFields(1);
  return (
    <>
      {ONBOARDING_STEPS[0]!.sections.map((section) => (
        <FormSection key={section.title} title={section.title}>
          {section.fields.map((name) => {
            const field = fields.find((f) => f.portalField === name)!;
            return (
              <SapField
                key={name}
                field={field}
                error={error?.[name]}
                options={
                  name === "state"
                    ? STATE_OPTIONS.map((s) => ({ value: s.code, label: s.name }))
                    : undefined
                }
              />
            );
          })}
        </FormSection>
      ))}
    </>
  );
}

export const FirstStep: Story = {
  args: { steps, current: 1, onContinue: () => undefined, onSaveDraft: () => undefined },
  render: (args) => (
    <WizardShell {...args}>
      <StepOne />
    </WizardShell>
  ),
};

export const MidwayWithCompletedSteps: Story = {
  args: {
    steps,
    current: 3,
    completed: [1, 2],
    lastSavedAt: "2026-07-27T10:31:00.000Z",
    onBack: () => undefined,
    onContinue: () => undefined,
    onSaveDraft: () => undefined,
    onStepSelect: () => undefined,
  },
  render: (args) => (
    <WizardShell {...args}>
      <p className="text-[12.5px] text-text-mid">Step content goes here.</p>
    </WizardShell>
  ),
};

export const Saving: Story = {
  args: { ...MidwayWithCompletedSteps.args, busy: true } as Story["args"],
  render: (args) => (
    <WizardShell {...args}>
      <p className="text-[12.5px] text-text-mid">Step content goes here.</p>
    </WizardShell>
  ),
};

export const WithDocLevelError: Story = {
  args: {
    steps,
    current: 2,
    completed: [1],
    onBack: () => undefined,
    onContinue: () => undefined,
    error:
      "GSTIN state (29 — Karnataka) doesn't match your billing state (27 — Maharashtra). Update the billing address or check the GSTIN.",
  },
  render: (args) => (
    <WizardShell {...args}>
      <p className="text-[12.5px] text-text-mid">Step content goes here.</p>
    </WizardShell>
  ),
};

export const FinalStep: Story = {
  args: {
    steps,
    current: 4,
    completed: [1, 2, 3],
    continueLabel: "Submit application",
    onBack: () => undefined,
    onContinue: () => undefined,
  },
  render: (args) => (
    <WizardShell {...args}>
      <p className="text-[12.5px] text-text-mid">Uploads go here.</p>
    </WizardShell>
  ),
};
