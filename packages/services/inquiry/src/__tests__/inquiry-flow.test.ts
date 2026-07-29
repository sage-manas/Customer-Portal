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
import { isInquiryError } from "../errors";
import { createInquiry, getInquiry } from "../inquiry-service";
import { acceptQuotation, getQuotation, requestRevision } from "../quotation-service";
import { issueQuotation, listInquiryQueue } from "../workbench-service";

/**
 * Module 3 end to end against a real database and the mock SAP driver:
 * draft -> inquiry -> quotation -> accept -> sales order, with the events each
 * step owes, plus the cross-account and cross-tenant 404s.
 *
 * The events are checked here rather than in the unit suite because they are
 * the part that needs Postgres — and because ADR-030's claim (the document is
 * created first, the event follows, and a lost event never fails the write) is
 * only observable against a real outbox. Requires Postgres (see the README).
 */

const KUNNR = "0010001001";
const OTHER_KUNNR = "0010001002";
const TODAY = "2026-07-26";

const sap = (options = {}) => new MockSapAdapter({ today: TODAY, ...options });

const inquiryInput = {
  requiredDeliveryDate: "2026-08-20",
  validityDays: 30,
  notes: "Annual shutdown spares.",
  lines: [{ material: "MAT-10001", quantity: 6, uom: "EA" }],
};

describe("inquiry flow", () => {
  const runId = randomUUID().slice(0, 8);
  let tenantA: { id: string };
  let tenantB: { id: string };

  const context = () => ({ tenantId: tenantA.id, kunnr: KUNNR, userId: `user-${runId}` });

  async function wipe() {
    for (const tenant of [tenantA, tenantB]) {
      await runWithTenant(tenant.id, async () => {
        await db.inquiryDraftLine.deleteMany();
        await db.inquiryDraft.deleteMany();
        await db.outboxEvent.deleteMany();
      });
    }
  }

  async function events(tenantId: string) {
    return runWithTenant(tenantId, () =>
      db.outboxEvent.findMany({ orderBy: { createdAt: "asc" } }),
    );
  }

  beforeAll(async () => {
    tenantA = await db.tenant.create({ data: { slug: `inquiry-a-${runId}`, name: "Tenant A" } });
    tenantB = await db.tenant.create({ data: { slug: `inquiry-b-${runId}`, name: "Tenant B" } });
  });

  afterAll(async () => {
    await wipe();
    await db.tenant.deleteMany({ where: { id: { in: [tenantA.id, tenantB.id] } } });
    await db.$disconnect();
  });

  beforeEach(wipe);

  // ---- drafts -------------------------------------------------------------

  it("saves an incomplete draft — the customer can leave and come back", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, { lines: [] });

    expect(draft.id).toBeTruthy();
    expect(draft.lines).toEqual([]);
    expect(draft.inquiryNumber).toBeUndefined();
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(1);
  });

  it("replaces lines wholesale rather than merging two snapshots of one form", async () => {
    const first = await saveDraft(tenantA.id, KUNNR, {
      requiredDeliveryDate: "2026-08-20",
      lines: [
        { material: "MAT-10001", quantity: 6, uom: "EA" },
        { material: "MAT-10003", quantity: 10, uom: "EA" },
      ],
    });

    const second = await saveDraft(
      tenantA.id,
      KUNNR,
      {
        requiredDeliveryDate: "2026-08-20",
        lines: [{ material: "MAT-10001", quantity: 8, uom: "EA" }],
      },
      first.id,
    );

    expect(second.id).toBe(first.id);
    expect(second.lines).toEqual([{ material: "MAT-10001", quantity: 8, uom: "EA" }]);
  });

  it("keeps one account's drafts out of another's list, and another tenant's entirely", async () => {
    const mine = await saveDraft(tenantA.id, KUNNR, { lines: [] });
    await saveDraft(tenantA.id, OTHER_KUNNR, { lines: [] });

    expect((await listDrafts(tenantA.id, KUNNR)).map((d) => d.id)).toEqual([mine.id]);

    const fromOtherAccount = await expectInquiryError(() =>
      getDraft(tenantA.id, OTHER_KUNNR, mine.id),
    );
    expect(fromOtherAccount.code).toBe("not_found");

    const fromOtherTenant = await expectInquiryError(() => getDraft(tenantB.id, KUNNR, mine.id));
    expect(fromOtherTenant.code).toBe("not_found");
  });

  it("stops editing a draft once it has become an inquiry", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, { lines: [] });
    await markDraftSubmitted(tenantA.id, KUNNR, draft.id, "0010000899");

    expect(await countDrafts(tenantA.id, KUNNR)).toBe(0);
    const error = await expectInquiryError(() =>
      saveDraft(tenantA.id, KUNNR, { lines: [] }, draft.id),
    );
    expect(error.code).toBe("not_found");
  });

  it("deletes a draft the customer abandons", async () => {
    const draft = await saveDraft(tenantA.id, KUNNR, { lines: [] });
    await deleteDraft(tenantA.id, KUNNR, draft.id);
    expect(await countDrafts(tenantA.id, KUNNR)).toBe(0);
  });

  // ---- draft -> inquiry ---------------------------------------------------

  it("raises the inquiry in SAP and records the event that chases it", async () => {
    const adapter = sap();
    const draft = await saveDraft(tenantA.id, KUNNR, inquiryInput);

    const inquiry = await createInquiry(adapter, context(), inquiryInput);
    await markDraftSubmitted(tenantA.id, KUNNR, draft.id, inquiry.vbeln);

    // SAP owns it from here: the read goes to the adapter, not to a row.
    const readBack = await getInquiry(adapter, context(), inquiry.vbeln);
    expect(readBack.inquiry.vbeln).toBe(inquiry.vbeln);
    expect(readBack.awaitingQuotation).toBe(true);
    expect(readBack.freshness).toBe("live");

    const [event] = await events(tenantA.id);
    expect(event?.eventName).toBe("inquiry.created");
    expect(event?.dedupeKey).toBe(`inquiry.created:${inquiry.vbeln}`);
    expect(event?.queue).toBe("notifications");
    expect((event?.payload as { lineCount: number }).lineCount).toBe(1);

    // Nothing about the inquiry itself was stored — only the draft's link.
    const drafts = await runWithTenant(tenantA.id, () => db.inquiryDraft.findMany());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.inquiryNumber).toBe(inquiry.vbeln);
  });

  it("refuses an inquiry with no items and writes no event for it", async () => {
    const error = await expectInquiryError(() =>
      createInquiry(sap(), context(), { ...inquiryInput, lines: [] }),
    );

    expect(error.code).toBe("invalid");
    expect(await events(tenantA.id)).toEqual([]);
  });

  // ---- inquiry -> quotation -> order --------------------------------------

  it("carries a customer's inquiry through quote, accept and order", async () => {
    const adapter = sap();
    const inquiry = await createInquiry(adapter, context(), inquiryInput);

    // The sales desk sees it in the tenant-wide queue, no KUNNR involved.
    const queue = await listInquiryQueue(adapter);
    expect(queue.inquiries.map((i) => i.vbeln)).toContain(inquiry.vbeln);

    const quotation = await issueQuotation(
      adapter,
      { tenantId: tenantA.id, userId: `agent-${runId}` },
      {
        inquiryVbeln: inquiry.vbeln,
        validUntil: "2026-08-31",
        lines: [{ lineNo: 10, netPrice: 44000 }],
      },
      { today: TODAY },
    );

    expect(quotation.netValue).toBe(264000);
    // Tax is SAP's, and it is what makes the gross: the portal never adds it.
    expect(quotation.grossValue).toBe(311520);

    const view = await getQuotation(adapter, context(), quotation.vbeln, {
      now: new Date(`${TODAY}T09:00:00.000Z`),
    });
    expect(view.acceptBlock).toBeNull();
    expect(view.inquiry?.vbeln).toBe(inquiry.vbeln);

    const accepted = await acceptQuotation(
      adapter,
      context(),
      quotation.vbeln,
      { shipTo: KUNNR, customerPoRef: `PO-${runId}` },
      { now: new Date(`${TODAY}T09:00:00.000Z`) },
    );

    // Copy control: the order carries the quoted price, not a re-derived one.
    expect(accepted.order.lines[0]?.netPrice).toBe(44000);

    const names = (await events(tenantA.id)).map((e) => e.eventName);
    expect(names).toEqual(["inquiry.created", "quotation.issued", "quotation.accepted"]);
  });

  it("lets a customer ask twice for a revision without the second ask being deduped away", async () => {
    const adapter = sap();
    const now = new Date(`${TODAY}T09:00:00.000Z`);

    await requestRevision(
      adapter,
      context(),
      "0020000901",
      { comment: "Can you improve the rate?" },
      { now },
    );
    await requestRevision(
      adapter,
      context(),
      "0020000901",
      { comment: "Any movement on this one?" },
      { now },
    );

    const revisions = (await events(tenantA.id)).filter(
      (e) => e.eventName === "quotation.revision.requested",
    );
    expect(revisions).toHaveLength(2);
  });

  it("keeps events in the tenant that produced them", async () => {
    const adapter = sap();
    await createInquiry(adapter, context(), inquiryInput);

    expect(await events(tenantB.id)).toEqual([]);
  });

  it("404s another customer's quotation instead of converting it", async () => {
    const adapter = sap();
    const error = await expectInquiryError(() =>
      acceptQuotation(
        adapter,
        { tenantId: tenantA.id, kunnr: OTHER_KUNNR },
        "0020000901",
        { shipTo: OTHER_KUNNR },
        { now: new Date(`${TODAY}T09:00:00.000Z`) },
      ),
    );

    expect(error.code).toBe("not_found");
    expect(await events(tenantA.id)).toEqual([]);
  });
});

async function expectInquiryError(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (isInquiryError(error)) return error;
    throw error;
  }
  throw new Error("Expected an InquiryError to be thrown");
}
