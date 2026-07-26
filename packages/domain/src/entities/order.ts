import { z } from "zod";

import { orderMapping } from "../sap-mapping/order";
import { buildZodSchema } from "../sap-mapping/to-zod";
import type { CanonicalStatus } from "../status";

const orderLineWriteFields = ["material", "quantity", "uom", "price", "plant"] as const;
const lineMapping = orderMapping.filter((f) =>
  orderLineWriteFields.includes(f.portalField as (typeof orderLineWriteFields)[number]),
);
const headerMapping = orderMapping.filter(
  (f) => !orderLineWriteFields.includes(f.portalField as (typeof orderLineWriteFields)[number]),
);

export const orderLineWriteSchema = buildZodSchema(lineMapping, "write");
export type OrderLineInput = z.infer<typeof orderLineWriteSchema>;

export const orderHeaderWriteSchema = buildZodSchema(headerMapping, "write");
export type OrderHeaderInput = z.infer<typeof orderHeaderWriteSchema>;

export const salesOrderWriteSchema = orderHeaderWriteSchema.extend({
  lines: z.array(orderLineWriteSchema).min(1, "Order must have at least one line item"),
});
export type SalesOrderInput = z.infer<typeof salesOrderWriteSchema>;

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
