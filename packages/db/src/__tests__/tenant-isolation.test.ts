import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "../../generated/client";
import {
  db,
  getTenantCredential,
  getTenantId,
  runWithTenant,
  setTenantCredential,
  writeOutboxEvent,
  TENANT_SCOPED_MODELS,
} from "../index";

/**
 * Cross-tenant isolation tests (docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md:
 * "Include automated cross-tenant isolation tests in CI"). Requires a real
 * Postgres reachable via DATABASE_URL — see packages/db/README.md.
 */
describe("tenant isolation", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  function createUser(tenantId: string, email: string) {
    // tenantId is passed to satisfy Prisma's static create-input type; the
    // middleware overwrites it with the bound context regardless (see
    // tenant-middleware.ts) — proven by the "middleware overrides a
    // mismatched tenantId" test below.
    return db.user.create({ data: { tenantId, email, roles: ["buyer_admin"] } });
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({
      data: { slug: `tenant-a-${runId}`, name: "Tenant A" },
    });
    tenantB = await db.tenant.create({
      data: { slug: `tenant-b-${runId}`, name: "Tenant B" },
    });
  });

  afterAll(async () => {
    await runWithTenant(tenantA.id, async () => {
      await db.notification.deleteMany();
      await db.tenantCredential.deleteMany();
      await db.tenantDataKey.deleteMany();
      await db.outboxEvent.deleteMany();
      await db.creditLimitRequest.deleteMany();
      await db.loyaltyTierSetting.deleteMany();
      await db.ticketAttachment.deleteMany();
      await db.ticketComment.deleteMany();
      await db.supportTicket.deleteMany();
      await db.ticketCounter.deleteMany();
      await db.podConfirmationLine.deleteMany();
      await db.podConfirmation.deleteMany();
      await db.inquiryDraftLine.deleteMany();
      await db.inquiryDraft.deleteMany();
      await db.cartLine.deleteMany();
      await db.cart.deleteMany();
      await db.onboardingEvent.deleteMany();
      await db.onboardingApplication.deleteMany();
      await db.user.deleteMany();
    });
    await runWithTenant(tenantB.id, async () => {
      await db.notification.deleteMany();
      await db.tenantCredential.deleteMany();
      await db.tenantDataKey.deleteMany();
      await db.outboxEvent.deleteMany();
      await db.creditLimitRequest.deleteMany();
      await db.loyaltyTierSetting.deleteMany();
      await db.ticketCounter.deleteMany();
      await db.user.deleteMany();
    });
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  it("throws when a query runs with no tenant context bound", async () => {
    await expect(db.user.findMany()).rejects.toThrow(/No tenant context bound/);
  });

  it("getTenantId throws outside runWithTenant", () => {
    expect(() => getTenantId()).toThrow(/No tenant context bound/);
  });

  it("scopes writes: a user created for tenant A carries tenant A's id", async () => {
    const user = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a-${runId}@example.com`),
    );
    expect(user.tenantId).toBe(tenantA.id);
  });

  it("the middleware overrides a mismatched tenantId with the bound context", async () => {
    // Caller claims tenant B in `data`, but the bound context is tenant A —
    // the context must win, proving scoping can't be spoofed via `data`.
    const user = await runWithTenant(tenantA.id, () =>
      createUser(tenantB.id, `spoof-${runId}@example.com`),
    );
    expect(user.tenantId).toBe(tenantA.id);
  });

  it("tenant B cannot read tenant A's user by id (findUnique returns null, never leaks)", async () => {
    const userA = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a2-${runId}@example.com`),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.user.findUnique({ where: { id: userA.id } }),
    );

    expect(asSeenByTenantB).toBeNull();
  });

  it("tenant B's findMany never includes tenant A's rows", async () => {
    await runWithTenant(tenantA.id, () => createUser(tenantA.id, `a3-${runId}@example.com`));
    await runWithTenant(tenantB.id, () => createUser(tenantB.id, `b-${runId}@example.com`));

    const tenantBUsers = await runWithTenant(tenantB.id, () => db.user.findMany());

    expect(tenantBUsers.length).toBeGreaterThan(0);
    expect(tenantBUsers.every((u) => u.tenantId === tenantB.id)).toBe(true);
  });

  it("a wrong-tenant update affects zero rows instead of the other tenant's row", async () => {
    const userA = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `a4-${runId}@example.com`),
    );

    const result = await runWithTenant(tenantB.id, () =>
      db.user.updateMany({
        where: { id: userA.id },
        data: { roles: ["tenant_admin"] },
      }),
    );

    expect(result.count).toBe(0);
  });

  it("scopes the Phase 2 onboarding models too", async () => {
    // Every model added to TENANT_SCOPED_MODELS earns a case here — the list
    // is the control, and an unlisted model would silently query unscoped.
    const application = await runWithTenant(tenantA.id, () =>
      db.onboardingApplication.create({
        data: { tenantId: tenantA.id, data: {}, draftToken: `token-${runId}` },
      }),
    );
    await runWithTenant(tenantA.id, () =>
      db.onboardingEvent.create({
        data: { tenantId: tenantA.id, applicationId: application.id, status: "draft" },
      }),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.onboardingApplication.findUnique({ where: { id: application.id } }),
    );
    const eventsForTenantB = await runWithTenant(tenantB.id, () =>
      db.onboardingEvent.findMany({ where: { applicationId: application.id } }),
    );

    expect(asSeenByTenantB).toBeNull();
    expect(eventsForTenantB).toEqual([]);
  });

  it("scopes the Phase 3 cart models too", async () => {
    const cart = await runWithTenant(tenantA.id, () =>
      db.cart.create({ data: { tenantId: tenantA.id, customerKunnr: `0000001000` } }),
    );
    await runWithTenant(tenantA.id, () =>
      db.cartLine.create({
        data: { tenantId: tenantA.id, cartId: cart.id, material: "MAT-10001", quantity: 5 },
      }),
    );

    const cartForTenantB = await runWithTenant(tenantB.id, () =>
      db.cart.findUnique({ where: { id: cart.id } }),
    );
    const linesForTenantB = await runWithTenant(tenantB.id, () =>
      db.cartLine.findMany({ where: { cartId: cart.id } }),
    );

    // Two customers may share a KUNNR string across tenants; the cart of one
    // must still be unreachable from the other.
    expect(cartForTenantB).toBeNull();
    expect(linesForTenantB).toEqual([]);
  });

  it("scopes the Phase A4 inquiry-draft models too", async () => {
    const draft = await runWithTenant(tenantA.id, () =>
      db.inquiryDraft.create({
        data: {
          tenantId: tenantA.id,
          customerKunnr: "0010001001",
          header: { requiredDeliveryDate: "2026-08-20" },
          lines: {
            create: [
              { tenantId: tenantA.id, lineNo: 10, material: "MAT-10001", quantity: 6, uom: "EA" },
            ],
          },
        },
      }),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.inquiryDraft.findUnique({ where: { id: draft.id } }),
    );
    const linesForTenantB = await runWithTenant(tenantB.id, () =>
      db.inquiryDraftLine.findMany({ where: { draftId: draft.id } }),
    );

    expect(asSeenByTenantB).toBeNull();
    expect(linesForTenantB).toEqual([]);
  });

  it("scopes the Phase 6 proof-of-delivery models too", async () => {
    const confirmation = await runWithTenant(tenantA.id, () =>
      db.podConfirmation.create({
        data: {
          tenantId: tenantA.id,
          customerKunnr: "0010001001",
          deliveryVbeln: `008000${runId.slice(0, 4)}`,
          salesOrder: "0000004712",
          outcome: "discrepancy",
          receiptDate: new Date(),
          lines: {
            create: [
              {
                tenantId: tenantA.id,
                lineNo: 10,
                material: "MAT-20002",
                dispatchedQty: 150,
                receivedQty: 140,
              },
            ],
          },
        },
      }),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.podConfirmation.findUnique({ where: { id: confirmation.id } }),
    );
    const linesForTenantB = await runWithTenant(tenantB.id, () =>
      db.podConfirmationLine.findMany({ where: { confirmationId: confirmation.id } }),
    );

    // Two tenants may legitimately hold the same LIKP-VBELN — SAP document
    // numbers are only unique within one SAP system, and each tenant has its
    // own. So the delivery number alone must never reach another tenant's row.
    const byDeliveryForTenantB = await runWithTenant(tenantB.id, () =>
      db.podConfirmation.findMany({ where: { deliveryVbeln: confirmation.deliveryVbeln } }),
    );

    expect(asSeenByTenantB).toBeNull();
    expect(linesForTenantB).toEqual([]);
    expect(byDeliveryForTenantB).toEqual([]);
  });

  it("scopes the Phase A3 support models too", async () => {
    const ticket = await runWithTenant(tenantA.id, () =>
      db.supportTicket.create({
        data: {
          tenantId: tenantA.id,
          ticketNo: `TKT-${runId}`,
          customerKunnr: "0010001001",
          category: "delivery",
          priority: "high",
          subject: "Short delivery",
          description: "Two cartons of ten did not arrive.",
          comments: {
            create: [
              {
                tenantId: tenantA.id,
                body: "Internal: chase the warehouse.",
                internal: true,
                authorIsAgent: true,
              },
            ],
          },
        },
      }),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.supportTicket.findUnique({ where: { id: ticket.id } }),
    );
    const commentsForTenantB = await runWithTenant(tenantB.id, () =>
      db.ticketComment.findMany({ where: { ticketId: ticket.id } }),
    );
    // The customer-facing reference is the one string a user reads off a
    // screen and types into a search box, so it is the most likely thing to
    // be quoted across a tenant boundary — deliberately probed by value.
    const byTicketNoForTenantB = await runWithTenant(tenantB.id, () =>
      db.supportTicket.findMany({ where: { ticketNo: ticket.ticketNo } }),
    );

    expect(asSeenByTenantB).toBeNull();
    expect(commentsForTenantB).toEqual([]);
    expect(byTicketNoForTenantB).toEqual([]);
  });

  it("gives each tenant its own ticket counter", async () => {
    // The counter is keyed by tenantId alone, so a scoping bug here would not
    // leak data — it would hand tenant B tenant A's next ticket number, and
    // the tenants' numbering would interleave visibly.
    const bump = (tenantId: string) =>
      runWithTenant(tenantId, () =>
        db.ticketCounter.upsert({
          where: { tenantId },
          create: { tenantId, value: 1 },
          update: { value: { increment: 1 } },
        }),
      );

    await bump(tenantA.id);
    await bump(tenantA.id);
    const forB = await bump(tenantB.id);

    const forA = await runWithTenant(tenantA.id, () =>
      db.ticketCounter.findUnique({ where: { tenantId: tenantA.id } }),
    );

    expect(forA?.value).toBe(2);
    expect(forB.value).toBe(1);
  });

  it("scopes the Phase A5 loyalty and credit models too", async () => {
    const request = await runWithTenant(tenantA.id, () =>
      db.creditLimitRequest.create({
        data: {
          tenantId: tenantA.id,
          customerKunnr: "0010001001",
          requestedLimit: 7_500_000,
          currentLimit: 5_000_000,
          justification: "Second production line commissioning in October.",
        },
      }),
    );

    // Tier thresholds are a tenant's commercial policy — what this tenant
    // considers a Gold customer is not something another tenant may read.
    await runWithTenant(tenantA.id, () =>
      db.loyaltyTierSetting.create({
        data: { tenantId: tenantA.id, tier: "gold", thresholdAmount: 8_000_000 },
      }),
    );

    const requestForB = await runWithTenant(tenantB.id, () =>
      db.creditLimitRequest.findUnique({ where: { id: request.id } }),
    );
    const queueForB = await runWithTenant(tenantB.id, () =>
      db.creditLimitRequest.findMany({ where: { state: "pending" } }),
    );
    const thresholdsForB = await runWithTenant(tenantB.id, () => db.loyaltyTierSetting.findMany());

    expect(requestForB).toBeNull();
    expect(queueForB).toEqual([]);
    expect(thresholdsForB).toEqual([]);

    // And tenant B may hold its own threshold for the same tier — the unique
    // constraint is (tenantId, tier), not tier alone.
    await runWithTenant(tenantB.id, () =>
      db.loyaltyTierSetting.create({
        data: { tenantId: tenantB.id, tier: "gold", thresholdAmount: 1_000_000 },
      }),
    );
    const goldForA = await runWithTenant(tenantA.id, () =>
      db.loyaltyTierSetting.findMany({ where: { tier: "gold" } }),
    );
    expect(goldForA).toHaveLength(1);
    expect(Number(goldForA[0]?.thresholdAmount)).toBe(8_000_000);
  });

  it("scopes the outbox, including its dedupe key (ADR-023)", async () => {
    const dedupeKey = `payment.captured:shared-${runId}`;

    const forA = await runWithTenant(tenantA.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: {
          occurredAt: new Date(),
          paymentId: `pay-a-${runId}`,
          kunnr: "0010001001",
          amount: 100,
          currency: "INR",
        },
        dedupeKey,
      }),
    );

    // The dedupe key is unique *per tenant*, not globally: two tenants
    // legitimately produce the same logical event, and one must not silence
    // the other's.
    const forB = await runWithTenant(tenantB.id, () =>
      writeOutboxEvent(db, {
        name: "payment.captured",
        payload: {
          occurredAt: new Date(),
          paymentId: `pay-b-${runId}`,
          kunnr: "0010001001",
          amount: 100,
          currency: "INR",
        },
        dedupeKey,
      }),
    );

    expect(forA).toBeTruthy();
    expect(forB).toBeTruthy();
    expect(forA).not.toBe(forB);

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.outboxEvent.findUnique({ where: { id: forA! } }),
    );
    expect(asSeenByTenantB).toBeNull();
  });

  it("scopes the A7 bell inbox, and keeps one event's row per user per tenant", async () => {
    const userA = await runWithTenant(tenantA.id, () =>
      createUser(tenantA.id, `bell-a-${runId}@example.com`),
    );
    const userB = await runWithTenant(tenantB.id, () =>
      createUser(tenantB.id, `bell-b-${runId}@example.com`),
    );

    const row = {
      eventName: "order.created",
      templateKey: "order.created.customer",
      // Deliberately the *same* event id in both tenants. The relay's job ids
      // are cuids and would not collide in practice, but the uniqueness that
      // makes the fan-out idempotent must be per tenant — a global one would
      // let tenant A's delivered notification suppress tenant B's.
      eventId: `evt-shared-${runId}`,
      title: "Order 0000004711 confirmed",
      body: "Your order is with SAP.",
      href: "/orders/0000004711",
      customerKunnr: "0010001001",
    };

    const created = await runWithTenant(tenantA.id, () =>
      db.notification.create({ data: { ...row, tenantId: tenantA.id, userId: userA.id } }),
    );
    await runWithTenant(tenantB.id, () =>
      db.notification.create({ data: { ...row, tenantId: tenantB.id, userId: userB.id } }),
    );

    const forB = await runWithTenant(tenantB.id, () =>
      db.notification.findUnique({ where: { id: created.id } }),
    );
    // A bell is read by user; the probe that matters is the unfiltered list a
    // buggy inbox query would run.
    const allForB = await runWithTenant(tenantB.id, () => db.notification.findMany());

    expect(forB).toBeNull();
    expect(allForB).toHaveLength(1);
    expect(allForB[0]?.userId).toBe(userB.id);

    // And the same event delivered twice writes one row, which is what makes
    // the at-least-once relay (ADR-023) safe to fan out from.
    const again = await runWithTenant(tenantA.id, () =>
      db.notification.createMany({
        data: [{ ...row, tenantId: tenantA.id, userId: userA.id }],
        skipDuplicates: true,
      }),
    );
    expect(again.count).toBe(0);
  });

  it("scopes the credential vault (B1): each tenant gets its own data key and reads only its own credential", async () => {
    const credentialA = { username: "svc_acme", password: "acme-only-secret" };
    const credentialB = { username: "svc_globex", password: "globex-secret" };

    await runWithTenant(tenantA.id, () => setTenantCredential(tenantA.id, "sap", credentialA));
    await runWithTenant(tenantB.id, () => setTenantCredential(tenantB.id, "sap", credentialB));

    // Each tenant round-trips its own credential correctly...
    expect(await runWithTenant(tenantA.id, () => getTenantCredential(tenantA.id, "sap"))).toEqual(
      credentialA,
    );
    expect(await runWithTenant(tenantB.id, () => getTenantCredential(tenantB.id, "sap"))).toEqual(
      credentialB,
    );

    // ...and gets its own data key row, wrapped separately, so a bug that
    // reused one tenant's key for another would show up here even before
    // any credential is decrypted.
    const dataKeyA = await runWithTenant(tenantA.id, () =>
      db.tenantDataKey.findUniqueOrThrow({ where: { tenantId: tenantA.id } }),
    );
    const dataKeyB = await runWithTenant(tenantB.id, () =>
      db.tenantDataKey.findUniqueOrThrow({ where: { tenantId: tenantB.id } }),
    );
    expect(dataKeyA.wrappedKey).not.toBe(dataKeyB.wrappedKey);

    // The tenant-scoped read itself is what the middleware guarantees: a
    // credential set for A is invisible to a query bound to B, exactly like
    // every other tenant-owned table in this suite.
    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.tenantCredential.findFirst({ where: { system: "sap" } }),
    );
    expect(asSeenByTenantB?.tenantId).toBe(tenantB.id);
  });

  it("scopes payments (ADR-019/ADR-044): a payment captured for tenant A is invisible to tenant B", async () => {
    const paymentA = await runWithTenant(tenantA.id, () =>
      db.payment.create({
        data: {
          tenantId: tenantA.id,
          customerKunnr: `KUNNR-A-${runId}`,
          amount: "1000.00",
          mode: "upi",
          gatewayReference: `gw-a-${runId}`,
        },
      }),
    );

    const asSeenByTenantB = await runWithTenant(tenantB.id, () =>
      db.payment.findUnique({ where: { id: paymentA.id } }),
    );
    expect(asSeenByTenantB).toBeNull();

    const tenantBList = await runWithTenant(tenantB.id, () => db.payment.findMany());
    expect(tenantBList.some((p) => p.id === paymentA.id)).toBe(false);

    await runWithTenant(tenantA.id, () => db.payment.deleteMany());
  });

  /**
   * docs/07 B6's "cross-tenant fuzz tests extended" line item, answered
   * generically rather than one model at a time (the same instinct
   * `rolesWithPermission` and the sap-mapping registries already follow):
   * every model the schema itself says is tenant-owned (a `tenantId` column)
   * must be in `TENANT_SCOPED_MODELS`, and nothing *without* one may be —
   * an `Operator` row (docs/DECISIONS.md ADR-045) with a `tenantId` column
   * would fail this the instant someone added one, without needing a test
   * written specifically for that model. A model added to the schema and
   * forgotten here would previously run entirely unscoped and pass every
   * other test in this file simply because nothing exercised it.
   */
  it("every model with a tenantId column is tenant-scoped, and nothing else is (schema/registry consistency)", () => {
    const models = Prisma.dmmf.datamodel.models;
    expect(models.length).toBeGreaterThan(0);

    for (const model of models) {
      const hasTenantId = model.fields.some((field) => field.name === "tenantId");
      const isRegistered = TENANT_SCOPED_MODELS.has(model.name);
      expect(
        isRegistered,
        `${model.name}: hasTenantId=${hasTenantId}, in TENANT_SCOPED_MODELS=${isRegistered}. ` +
          `A model with a tenantId column must be added to TENANT_SCOPED_MODELS (tenant-middleware.ts); ` +
          `a model without one — like the platform-plane Operator/Tenant tables — must not be.`,
      ).toBe(hasTenantId);
    }
  });

  it("the platform-plane Operator table has no tenantId column and is readable without runWithTenant (ADR-045)", async () => {
    const operatorModel = Prisma.dmmf.datamodel.models.find((model) => model.name === "Operator");
    expect(operatorModel?.fields.some((field) => field.name === "tenantId")).toBe(false);

    const email = `operator-isolation-${runId}@platform.example`;
    await db.operator.create({ data: { email, passwordHash: "unused" } });
    const found = await db.operator.findUnique({ where: { email } });
    expect(found?.email).toBe(email);

    await db.operator.deleteMany({ where: { email } });
  });
});
