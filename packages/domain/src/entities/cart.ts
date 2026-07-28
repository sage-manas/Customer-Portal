import { z } from "zod";

import { orderMapping } from "../sap-mapping/order";
import { sapStringSchema } from "../sap-mapping/to-zod";

/**
 * Cart (docs/05-UI-UX-DESIGN.md §7.2: "Cart (persistent drawer): line edit,
 * MOQ/stock warnings, split CTA — Request Quote vs Create Order").
 *
 * The cart is the one catalogue entity SAP does not own: it is a portal
 * staging area that becomes either an inquiry (VA11) or a sales order
 * (VA01). Its lines are therefore *prospective order lines*, and their
 * validation is derived from the order registry slice rather than written
 * again here — a cart quantity that SAP would reject is not worth
 * accepting into the cart (CLAUDE.md rule 3).
 */

/**
 * The cart line as the client sends it.
 *
 * `uom` is deliberately absent: it is a property of the material master
 * (MARA-MEINS), not a choice, so the service stamps it from the material
 * rather than trusting the client. The MATNR constraint still comes from the
 * registry via `sapStringSchema` — `buildZodSchema` isn't used here only
 * because this schema needs concrete inferred types for arithmetic
 * downstream, not because the constraint is hand-copied (CLAUDE.md rule 3).
 */
export const cartLineWriteSchema = z.object({
  material: sapStringSchema(orderMapping, "material", { required: true }),
  // The registry only knows QUAN is non-negative; a cart line of zero is a
  // removal, not a line, so the cart tightens it to positive.
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
});
export type CartLineInput = z.infer<typeof cartLineWriteSchema>;

/** Body of a quantity change on an existing line. */
export const cartQuantitySchema = z.object({
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
});

/**
 * Why a line cannot go through as it stands. Warnings are advisory (the
 * customer may still request a quote); blockers stop the Create Order CTA.
 * Both are computed in the service from SAP reads — never in a component.
 */
export type CartLineIssueCode =
  /** Below MVKE-MINBM for the material. */
  | "below_moq"
  /** Requested quantity exceeds MARD-LABST across all plants. */
  | "insufficient_stock"
  /** Nothing in stock anywhere — orderable, but only on lead time. */
  | "out_of_stock"
  /** No PR00 condition record, so SAP cannot price the line. */
  | "not_priced";

export interface CartLineIssue {
  code: CartLineIssueCode;
  message: string;
  /** Blockers stop order creation; warnings only inform. */
  severity: "warning" | "blocker";
}

export interface CartLine {
  id: string;
  /** MARA-MATNR */
  material: string;
  /** MAKT-MAKTX, denormalized for display so the drawer needs no extra read. */
  description: string;
  /** VBAP-KWMENG */
  quantity: number;
  /** MARA-MEINS / VBAP-VRKME */
  uom: string;
  /** MVKE-MINBM, so the stepper can enforce it client-side too. */
  minimumOrderQty: number;
  /** VBAP-NETPR — customer-specific, ex-GST. Null when SAP could not price it. */
  netPrice: number | null;
  /** netPrice * quantity, or null when unpriced. */
  lineValue: number | null;
  /** MARD-LABST at the determined plant, null when the stock read failed. */
  availableStock: number | null;
  /** MARC-WERKS the stock/price were determined for. */
  plant?: string;
  issues: CartLineIssue[];
  addedAt: Date;
}

export interface Cart {
  id: string;
  /** The sold-to account the cart belongs to — carts are per KUNNR, not per user. */
  kunnr: string;
  lines: CartLine[];
  /** Sum of priced lines, ex-GST. The portal never computes tax (docs/02 §5). */
  netValue: number;
  currency: string;
  /** True when any line carries a blocker — the Create Order CTA is disabled. */
  hasBlockingIssues: boolean;
  /** False when prices/stock could not be refreshed; the drawer says so. */
  priced: boolean;
  updatedAt: Date;
}
