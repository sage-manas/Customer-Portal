import type { Meta, StoryObj } from "@storybook/react";

import { CommentThread } from "./CommentThread";

const NOW = new Date("2026-07-29T12:00:00.000Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const meta = {
  title: "Domain/CommentThread",
  component: CommentThread,
  parameters: { layout: "padded" },
  args: { now: NOW },
} satisfies Meta<typeof CommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { comments: [] },
};

/** What the customer sees: their own posts and the team's replies. */
export const CustomerView: Story = {
  args: {
    comments: [
      {
        id: "c1",
        body: "Two of the ten cartons arrived crushed. Photos attached.",
        createdAt: ago(30),
        authorIsAgent: false,
        internal: false,
        attachments: [{ id: "f1", fileName: "carton-damage.jpg", sizeBytes: 428_000 }],
      },
      {
        id: "c2",
        body: "Thanks — we've raised this with the carrier and will confirm a replacement today.",
        createdAt: ago(26),
        authorIsAgent: true,
        authorName: "Priya (Support)",
        internal: false,
      },
    ],
  },
};

/**
 * The agent's view of the same thread, with an internal note.
 *
 * The note only reaches this component because the *query* included it —
 * a customer's read excludes internal comments in SQL, so their props never
 * contain one. The dashed amber treatment is so an agent scanning the thread
 * can never mistake a note for something the customer has seen.
 */
export const AgentView: Story = {
  args: {
    comments: [
      {
        id: "c1",
        body: "Two of the ten cartons arrived crushed. Photos attached.",
        createdAt: ago(30),
        authorIsAgent: false,
        authorName: "R. Mehta (Acme)",
        internal: false,
      },
      {
        id: "c2",
        body: "Carrier claim CLM-88213 opened. Don't promise a date until they respond.",
        createdAt: ago(28),
        authorIsAgent: true,
        authorName: "Priya (Support)",
        internal: true,
      },
      {
        id: "c3",
        body: "Thanks — we've raised this with the carrier and will confirm a replacement today.",
        createdAt: ago(26),
        authorIsAgent: true,
        authorName: "Priya (Support)",
        internal: false,
      },
    ],
  },
};

/** Pasted stack traces and angle brackets stay text, never markup. */
export const PlainTextIsPreserved: Story = {
  args: {
    comments: [
      {
        id: "c1",
        body: 'The portal shows:\n\n  <error code="E42">Tax condition missing</error>\n\nEvery time I open invoice 90000123.',
        createdAt: ago(2),
        authorIsAgent: false,
        internal: false,
      },
    ],
  },
};
