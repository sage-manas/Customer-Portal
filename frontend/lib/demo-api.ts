"use server";

import { hasPermission, type Permission } from "@cc/domain";
import * as catalogue from "@cc/service-catalogue";
import * as customer from "@cc/service-customer";
import * as delivery from "@cc/service-delivery";
import * as inquiry from "@cc/service-inquiry";
import * as invoice from "@cc/service-invoice";
import * as loyalty from "@cc/service-loyalty";
import * as notification from "@cc/service-notification";
import * as onboarding from "@cc/service-onboarding";
import * as order from "@cc/service-order";
import * as payment from "@cc/service-payment";
import * as platform from "@cc/service-platform";
import * as reconciliation from "@cc/service-reconciliation";
import { getSapAdapterForTenant } from "@cc/service-sap";
import * as support from "@cc/service-support";

import { getOperatorSession } from "./ops-session";
import { getSession } from "./session";

/**
 * The demo write path.
 *
 * /client's client components talk to `/api/*` route handlers that call the
 * service layer. Those handlers are backend and did not come across, but the
 * components did — untouched — so something has to answer them.
 *
 * That something is this file: a **Server Action** router, not an HTTP
 * endpoint. Two reasons it is a server action rather than a set of
 * `app/api/*` routes:
 *
 *   1. Phase 1 is explicitly not to stand up backend endpoints. A server
 *      action is a framework feature of the frontend — no route is
 *      published, no Express, no database.
 *   2. It runs on the *server*, so it shares the in-memory demo store with
 *      the server components that render the pages. A browser-only mock
 *      would let you add a cart line the next page render knew nothing
 *      about. Adding a line here and calling `router.refresh()` shows it,
 *      exactly as the real BFF did.
 *
 * Every guard the real handlers applied is applied here too — the same
 * `hasPermission` calls against the same permission registry — so a
 * `customer` session still cannot reach an admin mutation by calling it
 * directly.
 *
 * TODO(BACKEND):
 * Delete this file and restore client/apps/web/app/api/** (and
 * client/apps/ops/app/api/**). The components call `demoFetch`, which is a
 * one-line-per-file change back to `fetch`.
 */

export interface DemoResponse {
  status: number;
  /** Already-serialised JSON, so the client can rebuild a real `Response`. */
  body: string;
}

function json(data: unknown, status = 200): DemoResponse {
  return { status, body: JSON.stringify(data ?? null) };
}

function fail(message: string, status = 400, extra: Record<string, unknown> = {}): DemoResponse {
  return json({ error: message, ...extra }, status);
}

/** Maps a thrown service error onto the response the components expect. */
function fromError(error: unknown): DemoResponse {
  const known = error as { status?: number; message?: string; code?: string; issues?: unknown };
  if (typeof known?.status === "number" && typeof known.message === "string") {
    return json({ error: known.message, code: known.code, issues: known.issues }, known.status);
  }
  // Never a raw 500 for a feature the backend simply hasn't been migrated to
  // yet — the component shows this sentence instead (Step 10).
  return fail(
    "This action isn't wired up yet — backend integration is pending.",
    503,
  );
}

type Body = Record<string, unknown>;

/**
 * The router. `path` and `method` are exactly what the component passed to
 * `demoFetch`, so the call sites keep their original URLs — which is what
 * makes them greppable against the real handlers when those return.
 */
export async function demoRequest(
  path: string,
  method: string,
  body: Body | null,
  formFields: Record<string, string> | null,
  headers: Record<string, string> | null = null,
): Promise<DemoResponse> {
  try {
    return await route(path, method.toUpperCase(), body ?? {}, formFields ?? {}, headers ?? {});
  } catch (error) {
    return fromError(error);
  }
}

async function route(
  rawPath: string,
  method: string,
  body: Body,
  form: Record<string, string>,
  headers: Record<string, string>,
): Promise<DemoResponse> {
  const [pathname, query = ""] = rawPath.split("?");
  const params = new URLSearchParams(query);
  const segments = pathname.replace(/^\/api\//, "").replace(/\/$/, "").split("/");

  const session = await getSession();

  /** The guard every real handler starts with (docs/05 §4.3). */
  const require = (permission: Permission) => {
    if (!session) throw Object.assign(new Error("Not authenticated"), { status: 401 });
    if (!hasPermission(session, permission)) {
      throw Object.assign(new Error("You don't have permission to do that."), { status: 403 });
    }
    return session;
  };

  const sap = async () => getSapAdapterForTenant(session?.tenantId ?? "tenant-acme");
  const ctx = () => ({
    tenantId: session!.tenantId,
    kunnr: session!.kunnr,
    userId: session!.userId,
  });

  const [head, ...rest] = segments;

  // -------------------------------------------------------------------------
  // auth
  // -------------------------------------------------------------------------
  if (head === "auth") {
    // Login and logout are handled entirely in the browser (see
    // components/DemoAuth.tsx) — no endpoint, per the phase brief.
    return fail("Demo authentication is handled in the browser.", 404);
  }

  // -------------------------------------------------------------------------
  // cart
  // -------------------------------------------------------------------------
  if (head === "cart") {
    require("catalogue:view");
    const adapter = await sap();

    if (rest.length === 0) {
      if (method === "GET") {
        return json({ cart: await catalogue.getCart(session!.tenantId, session!.kunnr, adapter) });
      }
      if (method === "DELETE") {
        require("cart:manage");
        return json({ cart: await catalogue.clearCart(adapter, session!.tenantId, session!.kunnr) });
      }
    }

    if (rest[0] === "lines") {
      require("cart:manage");
      if (rest.length === 1 && method === "POST") {
        const cart = await catalogue.addToCart(adapter, session!.tenantId, session!.kunnr, {
          material: String(body.material ?? ""),
          quantity: Number(body.quantity ?? 0),
        });
        return json({ cart }, 201);
      }
      const lineId = rest[1];
      if (lineId && method === "PATCH") {
        const cart = await catalogue.updateCartLine(
          adapter,
          session!.tenantId,
          session!.kunnr,
          lineId,
          Number(body.quantity ?? 0),
        );
        return json({ cart });
      }
      if (lineId && method === "DELETE") {
        const cart = await catalogue.removeCartLine(
          adapter,
          session!.tenantId,
          session!.kunnr,
          lineId,
        );
        return json({ cart });
      }
    }
  }

  // -------------------------------------------------------------------------
  // catalogue
  // -------------------------------------------------------------------------
  if (head === "catalogue" && rest[0] === "materials" && rest[1] === "search") {
    require("catalogue:view");
    const term = (body.q as string | undefined)?.trim() ?? "";
    // An empty term must return nothing, not the whole master.
    if (!term) return json({ materials: [] });
    return json({ materials: await catalogue.searchMaterials(await sap(), term, 12) });
  }

  if (head === "catalogue" && rest[0] === "materials" && rest[2] === "availability") {
    require("catalogue:view");
    const availability = await catalogue.getMaterialAvailability(
      await sap(),
      session!.kunnr,
      decodeURIComponent(rest[1]),
      { quantity: Number(params.get("quantity") ?? 1) || 1 },
    );
    return json({ availability });
  }

  if (head === "catalogue" && rest[0] === "availability" && method === "POST") {
    require("catalogue:view");
    const items = Array.isArray(body.materials)
      ? (body.materials as Array<{ material?: string; quantity?: number }>)
          .filter((item): item is { material: string; quantity?: number } => Boolean(item?.material))
      : [];
    const availability = await catalogue.getMaterialsAvailability(
      await sap(),
      session!.kunnr,
      items,
      typeof body.plant === "string" ? body.plant : undefined,
    );
    return json({ availability });
  }

  // -------------------------------------------------------------------------
  // orders
  // -------------------------------------------------------------------------
  if (head === "orders") {
    if (rest[0] === "availability" && method === "POST") {
      require("order:create");
      return json(await order.checkAvailability(await sap(), session!.kunnr, body as never));
    }

    if (rest.length === 0 && method === "POST") {
      require("order:create");
      const created = await order.createOrder(await sap(), session!.kunnr, body as never);
      return json({ order: created }, 201);
    }

    if (rest[1] === "cancel" && method === "POST") {
      require("order:cancel");
      const cancelled = await order.cancelOrder(
        await sap(),
        session!.kunnr,
        rest[0],
        typeof body.reason === "string" ? body.reason : undefined,
      );
      return json({ order: cancelled });
    }

    if (rest[0] === "drafts") {
      require("order:create");
      const draftId = rest[1];
      if (method === "POST") {
        return json(
          { draft: await order.saveDraft(session!.tenantId, session!.kunnr, body as never) },
          201,
        );
      }
      if (draftId && method === "PUT") {
        return json({
          draft: await order.saveDraft(session!.tenantId, session!.kunnr, {
            ...(body as Record<string, never>),
            id: draftId,
          } as never),
        });
      }
      if (draftId && method === "DELETE") {
        await order.deleteDraft(session!.tenantId, session!.kunnr, draftId);
        return json({ ok: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  // inquiries & quotations
  // -------------------------------------------------------------------------
  if (head === "inquiries") {
    if (rest[0] === "drafts") {
      require("inquiry:create");
      const draftId = rest[1];
      if (method === "POST") {
        return json(
          { draft: await inquiry.saveDraft(session!.tenantId, session!.kunnr, body as never) },
          201,
        );
      }
      if (draftId && method === "PUT") {
        return json({
          draft: await inquiry.saveDraft(session!.tenantId, session!.kunnr, {
            ...(body as Record<string, never>),
            id: draftId,
          } as never),
        });
      }
      if (draftId && method === "DELETE") {
        await inquiry.deleteDraft(session!.tenantId, session!.kunnr, draftId);
        return json({ ok: true });
      }
    }

    if (rest.length === 0 && method === "POST") {
      require("inquiry:create");
      const created = await inquiry.createInquiry(await sap(), ctx(), body as never);
      return json({ inquiry: created }, 201);
    }
  }

  if (head === "quotations") {
    const vbeln = rest[0];
    if (rest[1] === "accept" && method === "POST") {
      require("quotation:accept");
      const result = await inquiry.acceptQuotation(await sap(), ctx(), vbeln, body as never);
      return json(result, 201);
    }
    if (rest[1] === "revision" && method === "POST") {
      require("quotation:view");
      const quotation = await inquiry.requestRevision(await sap(), ctx(), vbeln, body as never);
      return json({ quotation }, 201);
    }
  }

  // -------------------------------------------------------------------------
  // deliveries (proof of delivery)
  // -------------------------------------------------------------------------
  if (head === "deliveries" && rest[1] === "pod") {
    require("delivery:confirm-receipt");
    const vbeln = rest[0];

    if (rest[2] === "signed" && method === "POST") {
      const record = await delivery.uploadSignedPod({
        tenantId: session!.tenantId,
        deliveryVbeln: vbeln,
        kunnr: session!.kunnr,
        fileName: form.fileName ?? "signed-pod.pdf",
        contentType: form.contentType ?? "application/pdf",
        body: new Uint8Array(),
      });
      return json(record, 201);
    }

    if (method === "POST") {
      const result = await delivery.confirmReceipt(await sap(), {
        tenantId: session!.tenantId,
        deliveryVbeln: vbeln,
        kunnr: session!.kunnr,
        receiptDate: String(body.receiptDate ?? ""),
        lines: (body.lines as never) ?? [],
        notes: typeof body.notes === "string" ? body.notes : undefined,
        userId: session!.userId,
      });
      return json(result, 201);
    }
  }

  // -------------------------------------------------------------------------
  // invoices
  // -------------------------------------------------------------------------
  if (head === "invoices" && rest[1] === "pdf" && method === "GET") {
    require("invoice:view");
    const url = await invoice.getInvoicePdfUrl(await sap(), session!.kunnr, rest[0]);
    return json({ url });
  }

  // -------------------------------------------------------------------------
  // payments
  // -------------------------------------------------------------------------
  if (head === "payments") {
    if (rest.length === 0 && method === "GET") {
      require("payment:view");
      return json({ payments: await payment.listPayments(session!.tenantId, session!.kunnr) });
    }
    if (rest.length === 0 && method === "POST") {
      require("payment:pay");
      const initiated = await payment.initiatePayment({
        tenantId: session!.tenantId,
        kunnr: session!.kunnr,
        amount: Number(body.amount ?? 0),
        mode: body.mode as never,
        allocations: (body.allocations as never) ?? [],
        userId: session!.userId,
      });
      return json(initiated, 201);
    }
    if (rest[1] === "complete-mock" && method === "POST") {
      require("payment:pay");
      const result = await payment.completeMockCheckout(await sap(), {
        tenantId: session!.tenantId,
        paymentId: rest[0],
        kunnr: session!.kunnr,
        outcome: body.outcome === "failure" ? "failure" : "success",
      });
      return json(result);
    }
  }

  // -------------------------------------------------------------------------
  // support
  // -------------------------------------------------------------------------
  if (head === "support") {
    if (rest[0] === "attachments" && method === "POST") {
      require("support:create");
      return json(
        await support.uploadTicketAttachment({
          tenantId: session!.tenantId,
          fileName: form.fileName ?? "attachment",
          contentType: form.contentType ?? "application/octet-stream",
          body: new Uint8Array(),
        }),
        201,
      );
    }

    if (rest.length === 0 && method === "POST") {
      require("support:create");
      return json(await support.createTicket(ctx(), body as never), 201);
    }

    const id = rest[0];
    if (id && rest[1] === "comments" && method === "POST") {
      require("support:view");
      return json(await support.addCustomerComment(ctx(), id, String(body.body ?? "")), 201);
    }
    if (id && rest[1] === "status" && method === "POST") {
      require("support:view");
      return json(await support.transitionTicketAsCustomer(ctx(), id, body.to as never));
    }
    if (id && rest[1] === "rating" && method === "POST") {
      require("support:view");
      return json(
        await support.rateTicket(ctx(), id, {
          rating: Number(body.rating ?? 0),
          comment: typeof body.comment === "string" ? body.comment : undefined,
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // notifications
  // -------------------------------------------------------------------------
  if (head === "notifications") {
    const inbox = { tenantId: session!.tenantId, userId: session!.userId };
    if (rest.length === 0 && method === "GET") {
      return json(
        await notification.listNotifications(inbox, {
          limit: Number(params.get("limit") ?? 20) || 20,
        }),
      );
    }
    if (rest[0] === "read" && method === "POST") {
      const changed = await notification.markNotificationsRead(inbox, body as never);
      return json({ updated: changed });
    }
  }

  // -------------------------------------------------------------------------
  // account (credit-increase requests)
  // -------------------------------------------------------------------------
  if (head === "account" && rest[0] === "credit" && rest[1] === "requests") {
    if (rest.length === 2 && method === "POST") {
      require("credit:request");
      const position = await loyalty.getCreditPosition(await sap(), ctx());
      const created = await loyalty.requestCreditIncrease(ctx(), {
        requestedLimit: Number(body.requestedLimit ?? 0),
        justification: String(body.justification ?? ""),
        currentLimit: position.position.creditLimit,
      });
      return json(created, 201);
    }
    if (rest[3] === "withdraw" && method === "POST") {
      require("credit:request");
      return json(await loyalty.withdrawCreditRequest(ctx(), rest[2]));
    }
  }

  // -------------------------------------------------------------------------
  // onboarding (public — the applicant holds a draft token, ADR-009)
  // -------------------------------------------------------------------------
  if (head === "onboarding") {
    const applicationId = rest[0];
    // The applicant plane has no session, so the draft token is the only
    // credential — carried as the `x-draft-token` header (ADR-009). Body/query
    // are checked too, for callers that don't go through `demoFetch`.
    const draftTokenHeader = headers["x-draft-token"];
    const handle = (token?: unknown) => ({
      applicationId,
      draftToken: String(token ?? draftTokenHeader ?? ""),
    });

    if (rest.length === 0 && method === "POST") {
      const started = await onboarding.startApplication("tenant-acme");
      return json({ application: started.application, draftToken: started.draftToken }, 201);
    }
    if (applicationId && rest.length === 1 && method === "GET") {
      return json({
        application: await onboarding.getDraftApplication(
          "tenant-acme",
          handle(params.get("draftToken")),
        ),
      });
    }
    if (rest[1] === "step") {
      return json({
        application: await onboarding.saveStep(
          "tenant-acme",
          handle(body.draftToken),
          Number(rest[2] ?? 1),
          (body.data as never) ?? (body as never),
        ),
      });
    }
    if (rest[1] === "submit" && method === "POST") {
      return json({
        application: await onboarding.submitApplication("tenant-acme", handle(body.draftToken)),
      });
    }
    if (rest[1] === "gstin-verify" && method === "POST") {
      const application = await onboarding.verifyApplicationGstin(
        "tenant-acme",
        handle(body.draftToken),
        String(body.gstin ?? ""),
      );
      return json({ verification: application.gstinVerification, application });
    }
    if (rest[1] === "documents") {
      const kind = rest[2] as never;
      if (method === "POST") {
        return json({
          application: await onboarding.uploadDocument("tenant-acme", handle(form.draftToken), {
            kind,
            fileName: form.fileName ?? "document.pdf",
            contentType: form.contentType ?? "application/pdf",
            body: new Uint8Array(),
          }),
        });
      }
      if (method === "DELETE") {
        return json({
          application: await onboarding.removeDocument(
            "tenant-acme",
            handle(body.draftToken),
            kind,
          ),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // admin (tenant back office)
  // -------------------------------------------------------------------------
  if (head === "admin") {
    const area = rest[0];

    if (area === "quotations" && method === "POST") {
      require("quotation:issue");
      const quotation = await inquiry.issueQuotation(
        await sap(),
        { tenantId: session!.tenantId, userId: session!.userId },
        body as never,
      );
      return json({ quotation }, 201);
    }

    if (area === "credit" && rest[1] === "requests" && rest[3] === "decision") {
      require("credit:decide-limit");
      return json({
        request: await loyalty.decideCreditRequest(
          { tenantId: session!.tenantId, userId: session!.userId },
          rest[2],
          {
            // DecisionPanel.tsx sends "approved" | "rejected" (matching the
            // customer-facing status vocabulary), not "approve" | "reject" --
            // comparing against "reject" here never matched, so every
            // Decline was silently recorded as an approval instead.
            decision: body.decision === "rejected" ? "reject" : "approve",
            approvedLimit:
              typeof body.approvedLimit === "number" ? body.approvedLimit : undefined,
            note: typeof body.note === "string" ? body.note : undefined,
          },
        ),
      });
    }

    if (area === "customers") {
      const kunnr = rest[1];
      if (kunnr === "registrations") {
        return await backOfficeRegistration(rest.slice(2), method, body, form, session!, require);
      }
      if (kunnr && rest[2] === "status" && method === "POST") {
        require("customer:deactivate");
        return json({
          customer: await customer.setCustomerAccountActive(session!.tenantId, kunnr, {
            isActive: Boolean(body.isActive),
            reason: typeof body.reason === "string" ? body.reason : undefined,
            actorUserId: session!.userId,
          }),
        });
      }
      if (kunnr && method === "PATCH") {
        require("customer:edit");
        const detail = await customer.updateCustomerAccount(
          session!.tenantId,
          kunnr,
          await sap(),
          body as never,
        );
        return json({ customer: detail });
      }
    }

    if (area === "tickets") {
      const id = rest[1];
      const agent = { tenantId: session!.tenantId, userId: session!.userId };
      if (id && rest[2] === "comments" && method === "POST") {
        require("support:resolve");
        return json(
          await support.addAgentComment(
            agent,
            id,
            String(body.body ?? ""),
            body.visibility === "agent" ? "agent" : "customer",
          ),
          201,
        );
      }
      if (id && rest[2] === "status" && method === "POST") {
        require("support:resolve");
        if (typeof body.resolution === "string") {
          return json(await support.resolveTicket(agent, id, body.resolution));
        }
        return json(await support.transitionTicketAsAgent(agent, id, body.to as never));
      }
      if (id && method === "PATCH") {
        require("support:resolve");
        return json(
          await support.assignTicket(
            agent,
            id,
            body.assigneeUserId === null ? null : String(body.assigneeUserId ?? session!.userId),
          ),
        );
      }
    }

    if (area === "onboarding") {
      const id = rest[1];
      const action = rest[2];
      if (action === "approve" && method === "POST") {
        require("onboarding:approve");
        const result = await onboarding.approveApplication(await sap(), session!.tenantId, id, {
          salesOrg: String(body.salesOrg ?? "1000"),
          distributionChannel: String(body.distributionChannel ?? "10"),
          creditApprovalStatus:
            typeof body.creditApprovalStatus === "string" ? body.creditApprovalStatus : undefined,
          actorUserId: session!.userId,
        });
        await customer.registerCustomerAccount(session!.tenantId, {
          kunnr: result.kunnr,
          onboardingApplicationId: id,
        });
        return json(result);
      }
      if (action === "reject" && method === "POST") {
        require("onboarding:approve");
        return json({
          application: await onboarding.rejectApplication(session!.tenantId, id, {
            reasons: (body.reasons as string[]) ?? [],
            note: typeof body.note === "string" ? body.note : undefined,
            actorUserId: session!.userId,
          }),
        });
      }
      if (action === "request-info" && method === "POST") {
        require("onboarding:review");
        return json({
          application: await onboarding.requestMoreInfo(session!.tenantId, id, {
            note: String(body.note ?? ""),
            actorUserId: session!.userId,
          }),
        });
      }
    }

    if (area === "ap") {
      if (rest[1] === "refunds" && rest[3] === "pay" && method === "POST") {
        require("finance:ap");
        return json(
          await invoice.payRefund(await sap(), {
            vbeln: rest[2],
            kunnr: String(body.kunnr ?? ""),
            amount: Number(body.amount ?? 0),
            currency: String(body.currency ?? "INR"),
            initiatedBy: session!.email,
            note: typeof body.note === "string" ? body.note : undefined,
          }),
        );
      }
      if (rest[1] === "rebates" && rest[3] === "settle" && method === "POST") {
        require("finance:ap");
        return json(
          await loyalty.settleRebate(await sap(), {
            agreement: rest[2],
            initiatedBy: session!.email,
            note: typeof body.note === "string" ? body.note : undefined,
          }),
        );
      }
    }

    if (area === "ar" && rest[1] === "credit-blocks" && rest[3] === "release") {
      require("credit:release");
      return json(
        await order.releaseCreditBlock(await sap(), rest[2], {
          initiatedBy: session!.email,
          note: typeof body.note === "string" ? body.note : undefined,
        }),
      );
    }

    if (area === "exceptions") {
      require("exceptions:view");
      const id = rest[2];
      if (rest[1] === "outbox" && method === "POST") {
        return json(await reconciliation.requeueOutboxEvent(session!.tenantId, id));
      }
      if (rest[1] === "payments" && method === "POST") {
        return json(await payment.reconcilePayment(await sap(), id, session!.tenantId));
      }
    }
  }

  // -------------------------------------------------------------------------
  // platform console (migrated from apps/ops)
  // -------------------------------------------------------------------------
  if (head === "tenants" || head === "operators" || head === "sap") {
    return await consoleRoute(head, rest, method, body);
  }

  return fail(`No demo handler for ${method} ${pathname}.`, 404);
}

// ---------------------------------------------------------------------------

async function backOfficeRegistration(
  rest: string[],
  method: string,
  body: Body,
  form: Record<string, string>,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  require: (permission: Permission) => unknown,
): Promise<DemoResponse> {
  require("customer:register");
  const id = rest[0];

  if (!id && method === "POST") {
    return json(await onboarding.startBackOfficeRegistration(session.tenantId), 201);
  }
  if (id && rest.length === 1 && method === "GET") {
    return json({ application: await onboarding.getBackOfficeRegistration(session.tenantId, id) });
  }
  if (id && rest[1] === "step" && method === "PUT") {
    return json({
      application: await onboarding.saveBackOfficeStep(
        session.tenantId,
        id,
        Number(rest[2] ?? 1),
        (body.data as never) ?? (body as never),
      ),
    });
  }
  if (id && rest[1] === "gstin-verify" && method === "POST") {
    const application = await onboarding.verifyBackOfficeGstin(
      session.tenantId,
      id,
      String(body.gstin ?? ""),
    );
    return json({ verification: application.gstinVerification, application });
  }
  if (id && rest[1] === "documents") {
    const kind = rest[2] as never;
    if (method === "POST") {
      return json({
        application: await onboarding.uploadBackOfficeDocument(session.tenantId, id, {
          kind,
          fileName: form.fileName ?? "document.pdf",
          contentType: form.contentType ?? "application/pdf",
          body: new Uint8Array(),
        }),
      });
    }
    if (method === "DELETE") {
      return json({
        application: await onboarding.removeBackOfficeDocument(session.tenantId, id, kind),
      });
    }
  }
  if (id && rest[1] === "complete" && method === "POST") {
    const sapAdapter = await getSapAdapterForTenant(session.tenantId);
    const result = await onboarding.registerCustomer(sapAdapter, session.tenantId, id, {
      salesOrg: String(body.salesOrg ?? "1000"),
      distributionChannel: String(body.distributionChannel ?? "10"),
      creditApprovalStatus:
        typeof body.creditApprovalStatus === "string" ? body.creditApprovalStatus : undefined,
      actorUserId: session.userId,
    });
    await customer.registerCustomerAccount(session.tenantId, {
      kunnr: result.kunnr,
      registeredByUserId: session.userId,
      onboardingApplicationId: id,
    });
    return json(result, 201);
  }

  return fail("No demo handler for that registration step.", 404);
}

async function consoleRoute(
  head: string,
  rest: string[],
  method: string,
  body: Body,
): Promise<DemoResponse> {
  const operator = await getOperatorSession();
  const require = (permission: Permission) => {
    if (!operator) throw Object.assign(new Error("Not authenticated"), { status: 401 });
    if (!hasPermission(operator, permission)) {
      throw Object.assign(new Error("You don't have permission to do that."), { status: 403 });
    }
    return operator;
  };

  if (head === "tenants") {
    const id = rest[0];
    if (!id && method === "POST") {
      require("platform:tenant-crud");
      return json(await platform.createTenant(body as never), 201);
    }
    if (id && rest[1] === "status" && method === "POST") {
      require("platform:tenant-crud");
      return json(await platform.setTenantActive(id, Boolean(body.isActive)));
    }
    if (id && rest[1] === "sap-config") {
      require("platform:sap-config");
      if (rest[2] === "test" && method === "POST") {
        return json(await platform.testSapConnection(id));
      }
      if (method === "PUT" || method === "POST") {
        return json(
          await platform.updateTenantSapConfig({
            tenantId: id,
            driver: (body.driver as never) ?? "mock",
            params: (body.params as Record<string, string>) ?? {},
            clearSecrets: (body.clearSecrets as string[]) ?? [],
            operatorId: operator!.operatorId,
            operatorEmail: operator!.email,
          }),
        );
      }
    }
    if (id && method === "PATCH") {
      require("platform:tenant-crud");
      return json(await platform.updateTenant(id, body as never));
    }
  }

  if (head === "operators") {
    require("platform:operators-manage");
    const id = rest[0];
    if (!id && method === "POST") {
      return json(
        await platform.createOperator({
          email: String(body.email ?? ""),
          roles: (body.roles as never) ?? ["sap_manager"],
        }),
        201,
      );
    }
    if (id && rest[1] === "status" && method === "POST") {
      return json({ operator: await platform.setOperatorActive(id, Boolean(body.isActive)) });
    }
  }

  if (head === "sap" && rest[0] === "health") {
    require("platform:sap-health");
    return json({ tenants: await platform.listTenants() });
  }

  return fail("No demo handler for that console action.", 404);
}
