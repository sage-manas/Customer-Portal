import { ticketCreateSchema } from "@cc/domain";
import { getSapAdapterForTenant } from "@cc/service-sap";
import {
  createTicket,
  listTickets,
  type RelatedDocValidator,
  type TicketListFilter,
} from "@cc/service-support";
import { NextResponse } from "next/server";

import { handlePortal, requirePortal } from "@/lib/portal-route";

/**
 * Support tickets (docs/03 Module 8, docs/05 §7.8).
 *
 * `support:view` lists; `support:create` raises. Both belong to the one
 * `customer` role now (ADR-061), and stay separate for the same reason as
 * everywhere else on this plane: following a query and opening one are
 * different acts, and the split is the registry's, not a screen's
 * (docs/05 §4.3).
 */
export const runtime = "nodejs";

const FILTERS: readonly TicketListFilter[] = ["all", "open", "resolved", "closed"];

export async function GET(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("support:view");

    const requested = new URL(request.url).searchParams.get("filter");
    const filter = FILTERS.find((f) => f === requested) ?? "all";

    return NextResponse.json(
      await listTickets(
        { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
        { filter },
      ),
    );
  });
}

export async function POST(request: Request) {
  return handlePortal(async () => {
    const session = await requirePortal("support:create");

    const body = (await request.json().catch(() => null)) as unknown;
    const parsed = ticketCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Some details need fixing before we can raise this.",
          issues: parsed.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 },
      );
    }

    const ticket = await createTicket(
      { tenantId: session.tenantId, kunnr: session.kunnr, userId: session.userId },
      parsed.data,
      { validateRelatedDoc: await relatedDocValidator(session.tenantId, session.kunnr) },
    );

    return NextResponse.json(ticket, { status: 201 });
  });
}

/**
 * The related-document check, sequenced here rather than inside the support
 * service.
 *
 * `@cc/service-support` may not import `@cc/service-sap` (ADR-011), so the
 * route handler resolves the adapter and hands the service a function. It is
 * the same shape ADR-011 already uses for onboarding approval — cross-service
 * work is sequenced from above.
 *
 * The KUNNR check is the point. A document that exists but belongs to another
 * customer must fail exactly as one that doesn't exist, so this compares the
 * document's own sold-to account to the session's rather than trusting that a
 * read succeeded.
 */
async function relatedDocValidator(
  tenantId: string,
  kunnr: string | undefined,
): Promise<RelatedDocValidator> {
  const sap = await getSapAdapterForTenant(tenantId);

  return async (docType, docNumber) => {
    if (!kunnr) return false;

    try {
      switch (docType) {
        case "order": {
          const read = await sap.getOrderStatus(docNumber);
          return read.data.kunnr === kunnr;
        }
        case "delivery": {
          const read = await sap.getDelivery(docNumber);
          return read.data.kunnr === kunnr;
        }
        case "invoice": {
          const read = await sap.getInvoice(docNumber);
          return read.data.kunnr === kunnr;
        }
      }
    } catch {
      // A document SAP can't produce is not one the customer can reference.
      // This deliberately conflates "doesn't exist" with "SAP is down": the
      // alternative is accepting an unchecked reference during an outage.
      return false;
    }
  };
}
