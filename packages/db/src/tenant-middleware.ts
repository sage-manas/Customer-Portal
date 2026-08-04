import type { PrismaClient } from "../generated/client";

import { getTenantId } from "./tenant-context";

/**
 * Models that carry a `tenantId` column and must be scoped on every query.
 * Keep in sync with prisma/schema.prisma — add here whenever a new
 * tenant-owned model is added to the schema.
 */
export const TENANT_SCOPED_MODELS = new Set([
  "User",
  "UserAccountLink",
  "OnboardingApplication",
  "OnboardingDocument",
  "OnboardingEvent",
  "Cart",
  "CartLine",
  "SalesOrder",
  "SalesOrderLine",
  "InquiryDraft",
  "InquiryDraftLine",
  "PodConfirmation",
  "PodConfirmationLine",
  "Payment",
  "PaymentAllocation",
  "SupportTicket",
  "TicketComment",
  "TicketAttachment",
  "TicketCounter",
  "LoyaltyTierSetting",
  "CreditLimitRequest",
  "Notification",
  "OutboxEvent",
  "AuditLog",
  "TenantDataKey",
  "TenantCredential",
  "SapConfigAudit",
]);

type Args = Record<string, unknown>;

/**
 * Prisma Client Extension that makes tenant scoping structural rather than
 * a convention every service call site has to remember:
 *  - reads/updates/deletes get `tenantId` merged into `where`
 *  - creates get `tenantId` merged into `data`
 *  - upserts get `tenantId` merged into `where` and `create`
 *
 * If no tenant context is bound (see tenant-context.ts), the underlying
 * `getTenantId()` call throws before any query reaches the database.
 *
 * Note on types: Prisma's generated `create`/`upsert` input types don't
 * know this extension exists, so they still require `tenantId` (or a
 * `tenant: { connect }` relation) at compile time. Callers should pass
 * `tenantId: getTenantId()` explicitly to satisfy the type — the value
 * written here always wins regardless of what (if anything) the caller
 * passed, so this is defense-in-depth, not a way to bypass scoping.
 */
export function withTenantScoping(prisma: PrismaClient) {
  return prisma.$extends({
    name: "tenant-scoping",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          const tenantId = getTenantId();
          const scopedArgs = args as Args;

          switch (operation) {
            case "create": {
              scopedArgs.data = { ...(scopedArgs.data as Args), tenantId };
              break;
            }
            case "createMany": {
              const data = scopedArgs.data;
              scopedArgs.data = Array.isArray(data)
                ? data.map((row) => ({ ...(row as Args), tenantId }))
                : { ...(data as Args), tenantId };
              break;
            }
            case "upsert": {
              scopedArgs.where = { ...(scopedArgs.where as Args), tenantId };
              scopedArgs.create = { ...(scopedArgs.create as Args), tenantId };
              break;
            }
            case "findFirst":
            case "findFirstOrThrow":
            case "findUnique":
            case "findUniqueOrThrow":
            case "findMany":
            case "update":
            case "updateMany":
            case "delete":
            case "deleteMany":
            case "count":
            case "aggregate":
            case "groupBy": {
              scopedArgs.where = { ...(scopedArgs.where as Args), tenantId };
              break;
            }
            default:
              break;
          }

          return query(scopedArgs);
        },
      },
    },
  });
}
