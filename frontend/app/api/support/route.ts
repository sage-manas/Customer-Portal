import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@cc/domain";
import { createTicket, listTickets } from "@cc/service-support";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { z } from "zod";

import { parseBody, parseQuery } from "@/server/http/respond";
import { requireKunnr, route } from "@/server/http/route";

export const dynamic = "force-dynamic";

const listQuery = z.object({
  filter: z.enum(["all", "open", "resolved", "closed"]).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createSchema = z.object({
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  description: z.string().trim().min(1, "Describe the problem."),
  relatedDocType: z.enum(["order", "delivery", "invoice"]).optional(),
  relatedDocNumber: z.string().trim().optional(),
  attachmentKeys: z.array(z.string()).optional(),
});

export const GET = route(
  { guard: { kind: "permission", permission: "support:view" } },
  async ({ url, session }) => {
    const query = parseQuery(url, listQuery);
    return listTickets(
      { tenantId: session.tenantId, kunnr: requireKunnr(session), userId: session.userId },
      query,
    );
  },
);

export const POST = route(
  { guard: { kind: "permission", permission: "support:create" } },
  async ({ request, session }) => {
    const input = await parseBody(request, createSchema);
    const kunnr = requireKunnr(session);

    /**
     * A ticket may name an order, delivery or invoice. Those are SAP's
     * documents, so the check is a SAP read — and it is scoped to this
     * session's account, so a customer cannot attach their ticket to a
     * document belonging to somebody else.
     */
    const adapter = await getSapAdapterForTenant(session.tenantId);
    const validateRelatedDoc = async (
      docType: "order" | "delivery" | "invoice",
      docNumber: string,
    ) => {
      try {
        if (docType === "order") {
          const read = await adapter.getOrderStatus(docNumber);
          return read.data.kunnr === kunnr;
        }
        if (docType === "delivery") {
          const read = await adapter.getDelivery(docNumber);
          return read.data.kunnr === kunnr;
        }
        const read = await adapter.getInvoice(docNumber);
        return read.data.kunnr === kunnr;
      } catch {
        // An unreachable SAP must not block raising a support ticket — which
        // is very often what the customer is trying to tell us about.
        return true;
      }
    };

    const ticket = await createTicket(
      { tenantId: session.tenantId, kunnr, userId: session.userId },
      input,
      validateRelatedDoc,
    );

    return Response.json(ticket, { status: 201 });
  },
);
