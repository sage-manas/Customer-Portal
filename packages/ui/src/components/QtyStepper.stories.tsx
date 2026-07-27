import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

import { QtyStepper } from "./QtyStepper";

const meta: Meta<typeof QtyStepper> = {
  title: "Primitives/QtyStepper",
  component: QtyStepper,
};
export default meta;

function Controlled({ initial = 1, ...props }: { initial?: number } & Record<string, unknown>) {
  const [value, setValue] = React.useState(initial);
  return <QtyStepper value={value} onChange={setValue} {...props} />;
}

export const Default: StoryObj = { render: () => <Controlled uom="EA" /> };

/** MVKE-MINBM is both the floor and the step: 50m of pipe, then 100, then 150. */
export const WithMoq: StoryObj = {
  render: () => <Controlled initial={50} minimumOrderQty={50} uom="M" />,
};

/** Capped at available stock on the product-detail page. */
export const CappedAtStock: StoryObj = {
  render: () => <Controlled initial={6} minimumOrderQty={2} max={8} uom="EA" />,
};

export const Disabled: StoryObj = {
  render: () => <QtyStepper value={5} onChange={() => {}} uom="EA" disabled />,
};
