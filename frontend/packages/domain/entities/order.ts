import { z } from "zod";

import { orderMapping } from "../sap-mapping/order";
import { sapStringSchema } from "../sap-mapping/to-zod";
import type { CanonicalStatus } from "../status";

import type { CreateSalesOrderInput } from "./sales-doc";

/** Field constraints come from the registry; only the composition is here. */
const orderField = (portalField: string, options?: { required?: boolean }) =>
  sapStringSchema(orderMapping, portalField, options);

/**
 * One line of the create-order form (docs/03 Screen 4.1).
 *
 * The registry supplies MATNR 18 / VRKME 3 / the NETPR shape. What it cannot
 * express is that a KWMENG of zero is not a line — SAP's own VA01 rejects it
 * with V1/319 — so the order tightens QUAN's non-negative to positive.
 */
export const orderLineWriteSchema = z.object({
  material: orderField("material", { required: true }),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  uom: orderField("uom", { required: true }),
  /** VBAP-NETPR: read-only and pre-filled from a quotation, absent otherwise
   *  — SAP prices the line from its own condition records either way. */
  price: z.coerce.number().nonnegative("Price must not be negative").optional(),
});
export type OrderLineInput = z.infer<typeof orderLineWriteSchema>;

export const orderHeaderWriteSchema = z.object({
  customerPoRef: orderField("customerPoRef").optional(),
  requestedDeliveryDate: orderField("requestedDeliveryDate", { required: true }),
  shipTo: orderField("shipTo", { required: true }),
  paymentTerms: orderField("paymentTerms").optional(),
  incoterms: orderField("incoterms").optional(),
  deliveryPriority: orderField("deliveryPriority").optional(),
});
export type OrderHeaderInput = z.infer<typeof orderHeaderWriteSchema>;

export const salesOrderWriteSchema = orderHeaderWriteSchema.extend({
  lines: z.array(orderLineWriteSchema).min(1, "Order must have at least one line item"),
});
export type SalesOrderInput = z.infer<typeof salesOrderWriteSchema>;

/**
 * A draft is the same order with nothing yet required: doc 03 Screen 4.1
 * offers "Save Draft" alongside Submit, and a draft the customer cannot
 * save until it is complete is not a draft. Submission validates against
 * `salesOrderWriteSchema`, which is where the mandatory fields bite.
 */
export const salesOrderDraftSchema = orderHeaderWriteSchema.partial().extend({
  lines: z.array(orderLineWriteSchema).default([]),
});
export type SalesOrderDraftInput = z.infer<typeof salesOrderDraftSchema>;

/**
 * Portal form shape -> adapter contract shape. The two differ in exactly
 * two places (`price` is VBAP-NETPR on the line, and the sold-to comes from
 * the session rather than the form), and translating in one function means
 * no route handler has to know that.
 */
export function toCreateSalesOrderInput(
  kunnr: string,
  input: SalesOrderInput,
): CreateSalesOrderInput {
  return {
    kunnr,
    customerPoRef: input.customerPoRef,
    requestedDeliveryDate: input.requestedDeliveryDate,
    shipTo: input.shipTo,
    paymentTerms: input.paymentTerms,
    incoterms: input.incoterms,
    deliveryPriority: input.deliveryPriority,
    lines: input.lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
      netPrice: line.price,
    })),
  };
}

/**
 * Doc 05 §7.4: "Cancel (only while GBSTK=A)". Past that a delivery document
 * already references the order, so withdrawing it is a conversation with
 * sales rather than a button — the detail screen offers Request Change
 * instead.
 */
export function isOrderCancellable(order: { orderStatus: CanonicalStatus }): boolean {
  return order.orderStatus === "Open";
}

export interface SalesOrder {
  id: string;
  tenantId: string;
  customerId: string;
  soNumber?: string;
  orderStatus: CanonicalStatus;
  creditStatus: CanonicalStatus;
  header: OrderHeaderInput;
  lines: OrderLineInput[];
  createdAt: Date;
}
