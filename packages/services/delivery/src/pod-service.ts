import type { SapAdapter } from "@cc/adapter-sap";
import { isStorageError } from "@cc/adapter-storage";
import { db, runWithTenant, writeOutboxEvent } from "@cc/db";
import type { Delivery, PodConfirmInput, PodDiscrepancy } from "@cc/domain";
import {
  describePodDiscrepancy,
  podConfirmSchema,
  podDiscrepancy,
  podReceiptDateIssue,
} from "@cc/domain";

import { getDeliveryStorage, podStorageKey } from "./adapters";
import { readOwnedDelivery, toDeliveryError } from "./delivery-service";
import { DeliveryError } from "./errors";
import { POD_SELECT, toRecord, type PodConfirmationRecord, type PodRow } from "./pod-store";

/**
 * Proof of delivery (docs/03 Screen 5.2, docs/05 §7.5, ADR-026).
 *
 * This is the delivery module's only write, and it spans two owners:
 *
 * 1. **SAP takes the receipt.** VLPOD sets LIKP-KOQUK and the received
 *    quantities. That happens first, because it is the part that can be
 *    refused — a delivery already signed for, or not yet despatched. A portal
 *    row written before SAP agreed would be a signature for a receipt SAP
 *    never accepted.
 * 2. **The portal keeps the evidence**, and — when the numbers didn't match —
 *    emits the event A3 turns into a support ticket. Both happen in *one*
 *    transaction (ADR-023), so a discrepancy can never be recorded without
 *    the ticket that chases it, nor a ticket raised for a receipt that rolled
 *    back.
 *
 * "Confirm Receipt" and "Report Discrepancy" are the same call. Doc 05 §7.5
 * draws them as two buttons, but which one *happened* is decided by the
 * quantities, not by which button was pressed — a customer who edits a line
 * down to 9 of 12 and clicks Confirm Receipt has reported a discrepancy,
 * and the portal records what is true rather than what was clicked.
 */

export interface ConfirmReceiptResult {
  pod: PodConfirmationRecord;
  discrepancy: PodDiscrepancy;
  /** The delivery as SAP reports it after the POD. */
  status: Delivery["status"];
}

/** Today as an ISO date. Injectable so tests don't depend on the wall clock. */
function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function confirmReceipt(
  adapter: SapAdapter,
  context: { tenantId: string; kunnr: string | undefined; userId?: string },
  vbeln: string,
  input: PodConfirmInput,
  options: { today?: string } = {},
): Promise<ConfirmReceiptResult> {
  const account = context.kunnr;
  if (!account) throw new DeliveryError("no_account");

  const parsed = podConfirmSchema.safeParse(input);
  if (!parsed.success) {
    throw new DeliveryError("invalid", {
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const pod = parsed.data;

  // Ownership first, and against LIKP-KUNAG — a POST that quotes another
  // customer's delivery number gets the same 404 as one quoting a delivery
  // that never existed.
  const { delivery } = await readOwnedDelivery(adapter, account, vbeln);

  const dateIssue = podReceiptDateIssue(pod.receiptDate, delivery, options.today ?? isoToday());
  if (dateIssue) {
    throw new DeliveryError("invalid", { issues: [{ field: "receiptDate", message: dateIssue }] });
  }

  // A line number the customer sent that isn't on the delivery is a bug or a
  // tampered payload, not a receipt — reject rather than silently drop it,
  // which would record a confirmation the customer didn't make.
  const known = new Set(delivery.lines.map((line) => line.lineNo));
  const unknown = pod.lines.filter((line) => !known.has(line.lineNo));
  if (unknown.length > 0) {
    throw new DeliveryError("invalid", {
      issues: unknown.map((line) => ({
        field: `lines.${line.lineNo}`,
        message: `Line ${line.lineNo} isn't on this delivery.`,
      })),
    });
  }

  const discrepancy = podDiscrepancy(delivery.lines, pod.lines);

  // SAP first: it owns the receipt, and it is the step that can refuse.
  const sapResult = await adapter
    .confirmPod({
      deliveryVbeln: delivery.vbeln,
      receiptDate: pod.receiptDate,
      lines: discrepancy.lines.map((line) => ({
        lineNo: line.lineNo,
        receivedQty: line.receivedQty,
      })),
    })
    .catch((error: unknown) => {
      throw toDeliveryError(error, "delivery", delivery.vbeln);
    });

  const outcome = discrepancy.hasDiscrepancy ? "discrepancy" : "confirmed";

  const record = await recordPod(context, delivery, account, pod, discrepancy, outcome);

  return { pod: record, discrepancy, status: sapResult.status };
}

/**
 * A Postgres unique-constraint violation, as Prisma reports it. Typed
 * structurally rather than by importing Prisma's error class, which would
 * pull the generated client's namespace into this package just to name an
 * error code.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

async function recordPod(
  context: { tenantId: string; userId?: string },
  delivery: Delivery,
  account: string,
  pod: PodConfirmInput,
  discrepancy: PodDiscrepancy,
  outcome: "confirmed" | "discrepancy",
): Promise<PodConfirmationRecord> {
  try {
    return await runWithTenant(context.tenantId, () =>
      db.$transaction(async (tx) => {
        const created = await tx.podConfirmation.create({
          data: {
            tenantId: context.tenantId,
            customerKunnr: account,
            deliveryVbeln: delivery.vbeln,
            salesOrder: delivery.salesOrder,
            outcome,
            receiptDate: new Date(pod.receiptDate),
            notes: pod.notes,
            signedPodKey: pod.signedPodKey,
            confirmedByUserId: context.userId,
            lines: {
              create: discrepancy.lines.map((line) => ({
                tenantId: context.tenantId,
                lineNo: line.lineNo,
                material: line.material,
                dispatchedQty: line.dispatchedQty,
                receivedQty: line.receivedQty,
              })),
            },
          },
          select: POD_SELECT,
        });

        if (discrepancy.hasDiscrepancy) {
          // Written in the same transaction as the evidence it describes
          // (ADR-023). A3 consumes this and raises the Delivery-category
          // ticket; until A3 lands the relay publishes it and no handler is
          // registered, which is a legitimate no-op.
          await writeOutboxEvent(tx, {
            name: "delivery.discrepancy.reported",
            payload: {
              occurredAt: new Date(),
              kunnr: account,
              documentNumber: delivery.vbeln,
              salesOrder: delivery.salesOrder,
              reason: describePodDiscrepancy(discrepancy),
              reportedByUserId: context.userId,
              notes: pod.notes,
              lines: discrepancy.differences.map((line) => ({
                lineNo: line.lineNo,
                material: line.material,
                dispatchedQty: line.dispatchedQty,
                receivedQty: line.receivedQty,
              })),
            },
            // The delivery, not the attempt: SAP refuses a second POD anyway,
            // so one delivery can only ever justify one discrepancy event.
            dedupeKey: `delivery.discrepancy.reported:${delivery.vbeln}`,
          });
        } else {
          await writeOutboxEvent(tx, {
            name: "delivery.receipt.confirmed",
            payload: {
              occurredAt: new Date(),
              kunnr: account,
              documentNumber: delivery.vbeln,
              salesOrder: delivery.salesOrder,
              receiptDate: pod.receiptDate,
              confirmedByUserId: context.userId,
            },
            dedupeKey: `delivery.receipt.confirmed:${delivery.vbeln}`,
          });
        }

        return toRecord(created as PodRow);
      }),
    );
  } catch (error) {
    // `@@unique([tenantId, deliveryVbeln])` fired: this delivery already has
    // a proof of delivery in the portal. Normally SAP refuses first and we
    // never get here — but the two stores can disagree (a POD reversed in
    // VL03N, a restored database), and when they do the customer should get
    // the same "already signed for" answer rather than a 500.
    if (isUniqueViolation(error)) {
      throw new DeliveryError("not_allowed", {
        message: "Receipt for this delivery has already been recorded.",
        cause: error,
      });
    }
    throw error;
  }
}

export interface UploadSignedPodInput {
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * The signed-POD scan (docs/03 Screen 5.2 "Signed POD upload (GOS)").
 *
 * Uploaded *before* the receipt is submitted, and it returns a storage key
 * the form then carries into `confirmReceipt`. That ordering is deliberate:
 * the bytes are the slow, failure-prone part, and a customer whose upload
 * times out after SAP has already taken the receipt would have no way to
 * attach it — SAP refuses a second POD.
 *
 * The storage adapter enforces the type/size policy server-side; the
 * `FileUpload` check in the browser is a courtesy, not the control.
 */
export async function uploadSignedPod(
  adapter: SapAdapter,
  context: { tenantId: string; kunnr: string | undefined },
  vbeln: string,
  input: UploadSignedPodInput,
): Promise<{ storageKey: string }> {
  const account = context.kunnr;
  if (!account) throw new DeliveryError("no_account");

  // Ownership first: a POST that quotes another customer's delivery number
  // must not be able to write an object under that delivery's key.
  const { delivery } = await readOwnedDelivery(adapter, account, vbeln);

  try {
    const stored = await getDeliveryStorage().put({
      key: podStorageKey(context.tenantId, delivery.vbeln, input.fileName),
      body: input.body,
      contentType: input.contentType,
      fileName: input.fileName,
    });
    return { storageKey: stored.key };
  } catch (error) {
    if (isStorageError(error) && error.kind === "rejected") {
      throw new DeliveryError("invalid", {
        issues: [{ field: "signedPod", message: error.message }],
        cause: error,
      });
    }
    throw new DeliveryError("upstream_unavailable", { cause: error });
  }
}
