# @cc/service-delivery

Delivery tracking and proof of delivery — docs/03 Module 5, docs/05 §7.5.

## Purpose

SAP owns delivery documents, so **nothing about a shipment is stored** (ADR-016, the same rule the order and invoice modules follow). Every read composes `SapAdapter` calls and carries their freshness; the list, the stepper and the O2C chain are all derived per request.

The one exception is the **proof of delivery**. SAP takes the receipt itself — VLPOD sets LIKP-KOQUK and the received quantities — but it has nowhere to put the customer's discrepancy notes, their signed-POD scan, or the dispatched quantities as they stood at signing time. Those are portal-owned and live in `PodConfirmation` / `PodConfirmationLine` (ADR-026).

**The sold-to account is the boundary.** Every entry point takes the session's KUNNR and compares it to `Delivery.kunnr` (LIKP-KUNAG). A mismatch is a **404**, never a 403 — SAP reads a delivery by VBELN alone, so this check is the control, not a convenience (ADR-025).

## Public API

```ts
import {
  listDeliveries, // (adapter, kunnr, { filter }) -> shipments + stepper, in-flight first
  getDelivery, // (adapter, { tenantId, kunnr }, vbeln) -> tracking screen; 404 on KUNNR mismatch
  getPodFormDefaults, // (adapter, kunnr, vbeln) -> POD form pre-filled at dispatched qty
  previewPodDiscrepancy, // the same rule the write path uses, for labelling the button
  confirmReceipt, // (adapter, { tenantId, kunnr, userId }, vbeln, input) -> SAP + evidence + event
  uploadSignedPod, // (adapter, { tenantId, kunnr }, vbeln, file) -> { storageKey }
  findPodConfirmation, // (tenantId, kunnr, vbeln) -> the stored POD, if any
  DeliveryError,
  isDeliveryError,
} from "@cc/service-delivery";
```

Domain logic it consumes rather than reimplements (`@cc/domain`): `buildDeliveryStages` / `DELIVERY_STAGES` (the stepper), `podDiscrepancy` (received vs dispatched), `isPodConfirmable`, `podConfirmSchema`, `ewayBillExpected`, `mapDeliveryWbstkToStatus`.

## Confirm Receipt vs Report Discrepancy

Doc 05 §7.5 draws two buttons. There is **one** call. Which one _happened_ is decided by the quantities the customer submitted, not by which button they pressed — a customer who edits a line down to 9 of 12 and clicks "Confirm Receipt" has reported a discrepancy, and the service records what is true. The screen relabels its own button from the same `podDiscrepancy` function, so it cannot promise something different from what gets stored.

## Ordering inside `confirmReceipt`

1. Validate, check ownership, compare quantities.
2. **SAP first** (`confirmPod`) — it owns the receipt and it is the step that can refuse (already signed for, not yet despatched). A portal row written before SAP agreed would be a signature for a receipt SAP never accepted.
3. **One transaction** for the evidence row _and_ the outbox event (ADR-023), so a discrepancy can never be recorded without the `delivery.discrepancy.reported` event that chases it — A3 turns that into a Delivery-category support ticket. A clean receipt emits `delivery.receipt.confirmed` instead.

A signed-POD scan is uploaded _before_ the receipt (`uploadSignedPod`) and carried in as a storage key: the bytes are the slow, failure-prone part, and a customer whose upload times out after SAP has taken the receipt could never attach it, because SAP refuses a second POD.

## Testing

```
pnpm --filter @cc/service-delivery test              # units, mock SAP, no database
pnpm --filter @cc/service-delivery test:integration  # POD flow; needs Postgres
```

The integration suite needs a database:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```

It covers the receipt and discrepancy paths end to end, that nothing is stored when SAP refuses, the one-POD-per-delivery constraint, and the cross-customer and cross-tenant 404 cases.
