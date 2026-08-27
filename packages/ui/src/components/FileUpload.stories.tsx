import type { Meta, StoryObj } from "@storybook/react";

import { FileUpload } from "./FileUpload";

const meta: Meta<typeof FileUpload> = {
  title: "Domain/FileUpload",
  component: FileUpload,
  args: { label: "GST Certificate", required: true },
};
export default meta;

type Story = StoryObj<typeof FileUpload>;

export const Empty: Story = { args: {} };

export const Uploading: Story = { args: { state: "uploading" } };

export const Scanning: Story = { args: { state: "scanning" } };

export const Uploaded: Story = {
  args: {
    state: "uploaded",
    file: { fileName: "gst-certificate.pdf", sizeBytes: 284_512, href: "#" },
    onRemove: () => undefined,
  },
};

export const Rejected: Story = {
  args: { error: "gst-certificate.zip isn't a supported file type. Upload a PDF, JPG or PNG." },
};

export const Optional: Story = {
  args: { label: "Incorporation Certificate", required: false },
};

export const Disabled: Story = { args: { disabled: true } };
