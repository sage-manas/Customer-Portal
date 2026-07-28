import { randomUUID } from "node:crypto";

import { MockSapAdapter } from "@cc/adapter-sap";
import { db, runWithTenant } from "@cc/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  countDrafts,
  deleteDraft,
  getDraft,
  listDrafts,
  markDraftSubmitted,
  saveDraft,
} from "../draft-service";
import { createOrder, getOrder } from "../order-service";

/**
 * The order vertical end to end against a real database and the mock SAP
 * driver: draft -> submit -> readable in SAP, plus the cross-account and
 * cross-tenant 404 cases. Requires Postgres (see the package README).
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";

const sap = (options = {}) => new MockSapAdapter(options);

const draftInput = {
  customerPoRef: "PO-DRAFT-1",
  requestedDeliveryDate: "2026-08-20",
  shipTo: KUNNR,
  lines: [{ material: "MAT-10001", quantity: 2, uom: "EA" }],
};

describe("order flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.salesOrderLine.deleteMany();
        await db.salesOrder.deleteMany();
      });
    }
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `order-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `order-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  it("saves an incomplete draft — the customer can leave and come back", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, { lines: [] });

    expect(draft.id).toBeTruthy();
    expect(draft.lines).toEqual([]);
    expect(draft.soNumber).toBeUndefined();
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(1);
  });

  it("replaces lines wholesale rather than merging two snapshots of one form", async () => {
    const created = await saveDraft(tenantA.id, KUNNR, draftInput);
    expect(created.lines).toHaveLength(1);

    const updated = await saveDraft(
      tenantA.id,
      KUNNR,
      { ...draftInput, lines: [{ material: "MAT-10003", quantity: 5, uom: "EA" }] },
      created.id,
    );

    expect(updated.id).toBe(created.id);
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]!.material).toBe("MAT-10003");
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(1);
  });

  it("round-trips header and lines through Prisma's Decimal without drifting", async () => {
    const saved = await saveDraft(tenantA.id, KUNNR, {
      ...draftInput,
      lines: [{ material: "MAT-10001", quantity: 2.5, uom: "EA", price: 42437.5 }],
    });

    const read = await getDraft(tenantA.id, KUNNR, saved.id);
    expect(read.header.customerPoRef).toBe("PO-DRAFT-1");
    expect(read.header.shipTo).toBe(KUNNR);
    expect(read.lines[0]).toEqual({
      material: "MAT-10001",
      quantity: 2.5,
      uom: "EA",
      price: 42437.5,
    });
  });

  it("validates a draft line against the registry before storing it", async () => {
    await expect(
      saveDraft(tenantA.id, KUNNR, { lines: [{ material: "MAT-10001", quantity: 0, uom: "EA" }] }),
    ).rejects.toMatchObject({ code: "invalid", status: 422 });
  });

  it("submits a draft, records what it became, and reads it back from SAP", async () => {
    const adapter = sap();
    const draft = await saveDraft(tenantA.id, KUNNR, draftInput);

    const result = await createOrder(adapter, KUNNR, {
      ...draftInput,
      customerPoRef: "PO-SUBMIT-1",
    });
    await markDraftSubmitted(tenantA.id, KUNNR, draft.id, result);

    // The draft is no longer offered for editing...
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(0);
    expect((await getDraft(tenantA.id, KUNNR, draft.id)).soNumber).toBe(result.vbeln);

    // ...and the order itself now comes from SAP, not from that row.
    const detail = await getOrder(adapter, KUNNR, result.vbeln);
    expect(detail.order.customerPoRef).toBe("PO-SUBMIT-1");
    expect(detail.timeline.find((s) => s.key === "order")?.status).toBe("Open");
  });

  it("refuses to edit a draft that has already become a sales order", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, draftInput);
    await markDraftSubmitted(tenantA.id, KUNNR, draft.id, {
      vbeln: "0000004999",
      orderStatus: "Open",
      creditStatus: "Confirmed",
    });

    await expect(saveDraft(tenantA.id, KUNNR, draftInput, draft.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(deleteDraft(tenantA.id, KUNNR, draft.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("hides another account's draft within the same tenant behind a 404", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, draftInput);

    await expect(getDraft(tenantA.id, OTHER_KUNNR, draft.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(saveDraft(tenantA.id, OTHER_KUNNR, draftInput, draft.id)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await listDrafts(tenantA.id, OTHER_KUNNR)).toEqual([]);
  });

  it("keeps drafts of the same KUNNR in different tenants apart", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, draftInput);

    await expect(getDraft(tenantB.id, KUNNR, draft.id)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(await countDrafts(tenantB.id, KUNNR)).toBe(0);
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(1);
  });

  it("deletes a draft and its lines together", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, draftInput);
    await deleteDraft(tenantA.id, KUNNR, draft.id);

    expect(await countDrafts(tenantA.id, KUNNR)).toBe(0);
    await runWithTenant(tenantA.id, async () => {
      expect(await db.salesOrderLine.count({ where: { orderId: draft.id } })).toBe(0);
    });
  });

  it("refuses to work without a sold-to account", async () => {
    await expect(saveDraft(tenantA.id, undefined, draftInput)).rejects.toMatchObject({
      code: "no_account",
      status: 409,
    });
  });
});
