"use client";

import type { Material, SalesOrderInput, ShipToAddress } from "@cc/domain";
import type { AvailabilityResult } from "@cc/service-order";
import { Button, Input, Money, QtyStepper, Select, formatDisplayDate } from "@cc/ui";
import { CalendarCheck, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Create Order (docs/03 Screen 4.1, docs/05 §7.4): three sections — Header,
 * Line Items, Terms — with a sticky footer carrying Check Availability (ATP)
 * and Submit Order.
 *
 * Two decisions worth stating:
 *
 * - **The form never sends a price.** VBAP-NETPR is read-only and pre-filled
 *   only when an order originates from an accepted quotation (the registry
 *   says so, and that path arrives with Phase 6). On a direct order SAP
 *   prices every line from its own condition records, so a price posted from
 *   the browser could only ever disagree with the invoice. Seeded prices are
 *   shown as an estimate and labelled as one.
 * - **ATP is advisory, not a gate.** A partially-confirmed line is a date,
 *   not a refusal (docs/05 §7.4: "green full / amber partial with proposed
 *   schedule lines"), so it never blocks Submit. Only SAP's own validation
 *   does, and that happens at submission.
 */

export interface OrderFormSeed {
  header: Partial<SalesOrderInput>;
  lines: Array<{ material: string; quantity: number; uom: string; estimatedPrice?: number }>;
  /** Set when the form was seeded from a saved draft. */
  draftId?: string;
  /** True when seeded from the cart — submitting then empties it. */
  fromCart?: boolean;
}

interface FormLine {
  key: string;
  material: string;
  quantity: number;
  uom: string;
  estimatedPrice?: number;
}

interface ApiIssue {
  field: string;
  message: string;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

async function readError(response: Response): Promise<{ error: string; issues: ApiIssue[] }> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    issues?: ApiIssue[];
  } | null;
  return {
    error: body?.error ?? "Something went wrong. Try again in a moment.",
    issues: body?.issues ?? [],
  };
}

export function CreateOrderForm({
  seed,
  shipTos,
  materials,
  defaultPaymentTerms,
  canCreate,
}: {
  seed: OrderFormSeed;
  shipTos: ShipToAddress[];
  materials: Material[];
  defaultPaymentTerms?: string;
  canCreate: boolean;
}) {
  const router = useRouter();

  const [customerPoRef, setCustomerPoRef] = React.useState(seed.header.customerPoRef ?? "");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = React.useState(
    seed.header.requestedDeliveryDate ?? "",
  );
  const [shipTo, setShipTo] = React.useState(seed.header.shipTo ?? shipTos[0]?.kunnr ?? "");
  const [paymentTerms, setPaymentTerms] = React.useState(
    seed.header.paymentTerms ?? defaultPaymentTerms ?? "",
  );
  const [incoterms, setIncoterms] = React.useState(seed.header.incoterms ?? "");
  const [deliveryPriority, setDeliveryPriority] = React.useState(
    seed.header.deliveryPriority ?? "",
  );

  const [lines, setLines] = React.useState<FormLine[]>(
    seed.lines.map((line) => ({ ...line, key: newKey() })),
  );
  const [draftId, setDraftId] = React.useState(seed.draftId);

  const [availability, setAvailability] = React.useState<AvailabilityResult | null>(null);
  const [busy, setBusy] = React.useState<"atp" | "draft" | "submit" | null>(null);
  const [error, setError] = React.useState<string>();
  const [issues, setIssues] = React.useState<ApiIssue[]>([]);
  const [confirming, setConfirming] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();

  const materialsByCode = React.useMemo(
    () => new Map(materials.map((material) => [material.material, material])),
    [materials],
  );

  /**
   * VBPA identifies a ship-to by KUNNR alone, so two saved addresses sharing
   * one partner number are one choice as far as SAP is concerned. Collapsing
   * them (rather than offering two options that submit the same value) keeps
   * the select honest about what the customer is actually choosing.
   */
  const shipToOptions = React.useMemo(() => {
    const byKunnr = new Map<string, string[]>();
    for (const address of shipTos) {
      const labels = byKunnr.get(address.kunnr) ?? [];
      labels.push(`${address.label} — ${address.address.city}`);
      byKunnr.set(address.kunnr, labels);
    }
    return [...byKunnr].map(([value, labels]) => ({ value, label: labels.join(" / ") }));
  }, [shipTos]);

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  /** Any edit invalidates the ATP answer — it was for a different order. */
  const invalidate = React.useCallback(() => {
    setAvailability(null);
    setNotice(undefined);
  }, []);

  const body = (): SalesOrderInput & { draftId?: string; fromCart?: boolean } => ({
    customerPoRef: customerPoRef.trim() || undefined,
    requestedDeliveryDate,
    shipTo,
    paymentTerms: paymentTerms.trim() || undefined,
    incoterms: incoterms.trim() || undefined,
    deliveryPriority: deliveryPriority.trim() || undefined,
    lines: lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
    })),
    draftId,
    fromCart: seed.fromCart,
  });

  function addLine(material: string) {
    const record = materialsByCode.get(material);
    if (!record) return;
    invalidate();
    setLines((current) =>
      current.some((line) => line.material === material)
        ? current
        : [
            ...current,
            {
              key: newKey(),
              material,
              quantity: record.minimumOrderQty || 1,
              uom: record.uom,
            },
          ],
    );
  }

  async function checkAvailability() {
    setBusy("atp");
    setError(undefined);
    setIssues([]);
    try {
      const response = await fetch("/api/orders/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!response.ok) {
        const failure = await readError(response);
        setError(failure.error);
        setIssues(failure.issues);
        return;
      }
      setAvailability((await response.json()) as AvailabilityResult);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    setBusy("draft");
    setError(undefined);
    setIssues([]);
    try {
      const response = await fetch(
        draftId ? `/api/orders/drafts/${draftId}` : "/api/orders/drafts",
        {
          method: draftId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body()),
        },
      );
      if (!response.ok) {
        const failure = await readError(response);
        setError(failure.error);
        setIssues(failure.issues);
        return;
      }
      const { draft } = (await response.json()) as { draft: { id: string } };
      setDraftId(draft.id);
      setNotice("Draft saved. Everyone on this account can pick it up.");
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    setError(undefined);
    setIssues([]);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body()),
      });
      if (!response.ok) {
        const failure = await readError(response);
        setError(failure.error);
        setIssues(failure.issues);
        setConfirming(false);
        return;
      }
      const { order } = (await response.json()) as { order: { vbeln: string } };
      // Straight to the order, where the credit gate and the confirmed
      // schedule lines are — the customer's next question is always "and?".
      router.push(`/orders/${order.vbeln}`);
    } finally {
      setBusy(null);
    }
  }

  const atpByMaterial = new Map(
    (availability?.lines ?? []).map((line) => [line.material, line] as const),
  );
  const estimatedValue = lines.reduce(
    (sum, line) => sum + (line.estimatedPrice ?? 0) * line.quantity,
    0,
  );

  return (
    <div className="flex flex-col gap-4 pb-24">
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-success-border bg-success-subtle px-4 py-2.5 text-[12.5px] text-success"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {/* --- Header (docs/03 Screen 4.1) ---------------------------------- */}
      <Section title="Header">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Your PO reference" error={issueFor("customerPoRef")}>
            <Input
              value={customerPoRef}
              maxLength={20}
              placeholder="PO-2026-0142"
              onChange={(event) => {
                setCustomerPoRef(event.target.value);
                invalidate();
              }}
            />
          </Field>

          <Field label="Requested delivery date" required error={issueFor("requestedDeliveryDate")}>
            <Input
              type="date"
              value={requestedDeliveryDate}
              onChange={(event) => {
                setRequestedDeliveryDate(event.target.value);
                invalidate();
              }}
            />
          </Field>

          <Field label="Deliver to" required error={issueFor("shipTo")}>
            <Select
              value={shipTo}
              onChange={(event) => {
                setShipTo(event.target.value);
                invalidate();
              }}
              options={shipToOptions}
            />
          </Field>
        </div>
      </Section>

      {/* --- Line items --------------------------------------------------- */}
      <Section title="Line items">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-text-dim">
            No items yet. Add one below, or build a basket in the catalogue and bring it here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line) => {
              const atp = atpByMaterial.get(line.material);
              const record = materialsByCode.get(line.material);
              return (
                <li key={line.key} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-48 flex-1">
                    <p className="font-mono text-[10.5px] text-text-dim">{line.material}</p>
                    <p className="text-[12.5px] font-medium text-text">
                      {record?.description ?? line.material}
                    </p>
                  </div>

                  <QtyStepper
                    value={line.quantity}
                    minimumOrderQty={record?.minimumOrderQty}
                    uom={line.uom}
                    label={`Quantity of ${line.material}`}
                    onChange={(quantity) => {
                      invalidate();
                      setLines((current) =>
                        current.map((l) => (l.key === line.key ? { ...l, quantity } : l)),
                      );
                    }}
                  />

                  <div className="w-32 text-right">
                    {line.estimatedPrice === undefined ? (
                      <span className="text-[11px] text-text-dim">Priced by SAP</span>
                    ) : (
                      <>
                        <Money
                          value={line.estimatedPrice * line.quantity}
                          className="text-[12.5px] font-semibold"
                        />
                        <p className="text-[10.5px] text-text-dim">estimate</p>
                      </>
                    )}
                  </div>

                  {/* Per-line ATP chip (docs/05 §7.4). */}
                  <div className="w-52">
                    {atp ? (
                      <span
                        className={
                          atp.partial
                            ? "inline-flex items-center gap-1 rounded-pill border border-warning-border bg-warning-subtle px-2 py-0.5 text-[11px] text-warning"
                            : "inline-flex items-center gap-1 rounded-pill border border-success-border bg-success-subtle px-2 py-0.5 text-[11px] text-success"
                        }
                      >
                        {atp.partial ? (
                          <TriangleAlert aria-hidden className="size-3" />
                        ) : (
                          <CalendarCheck aria-hidden className="size-3" />
                        )}
                        {atp.confirmedQty} {line.uom} on {formatDisplayDate(atp.confirmedDate)}
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    aria-label={`Remove ${line.material} from this order`}
                    onClick={() => {
                      invalidate();
                      setLines((current) => current.filter((l) => l.key !== line.key));
                    }}
                    className="rounded-md p-1 text-text-dim hover:bg-danger-subtle hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {issueFor("lines") ? (
          <p className="mt-2 text-[11.5px] text-danger">{issueFor("lines")}</p>
        ) : null}

        <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
          <label className="min-w-64 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
              Add an item
            </span>
            <Select
              value=""
              onChange={(event) => addLine(event.target.value)}
              options={[
                { value: "", label: "Choose a material…" },
                ...materials
                  .filter((material) => !lines.some((line) => line.material === material.material))
                  .map((material) => ({
                    value: material.material,
                    label: `${material.material} — ${material.description}`,
                  })),
              ]}
            />
          </label>
          <Plus aria-hidden className="mb-2.5 size-4 text-text-dim" />
        </div>
      </Section>

      {/* --- Terms -------------------------------------------------------- */}
      <Section title="Terms">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="Payment terms">
            <Input
              value={paymentTerms}
              maxLength={4}
              onChange={(event) => setPaymentTerms(event.target.value)}
            />
          </Field>
          <Field label="Incoterms">
            <Input
              value={incoterms}
              maxLength={4}
              placeholder="FOB"
              onChange={(event) => setIncoterms(event.target.value)}
            />
          </Field>
          <Field label="Delivery priority">
            <Select
              value={deliveryPriority}
              onChange={(event) => setDeliveryPriority(event.target.value)}
              options={[
                { value: "", label: "Standard" },
                { value: "01", label: "High" },
                { value: "02", label: "Normal" },
                { value: "03", label: "Low" },
              ]}
            />
          </Field>
        </div>
      </Section>

      {/* --- Sticky footer (docs/05 §7.4) --------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur md:left-[52px] lg:left-[222px]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
          <div className="text-[12px] text-text-dim">
            {availability ? (
              <>
                <span className="font-semibold text-text">
                  <Money value={availability.netValue} /> net
                </span>{" "}
                ·{" "}
                {availability.fullyConfirmed
                  ? "all lines confirmed in full"
                  : "some lines confirm later"}
              </>
            ) : estimatedValue > 0 ? (
              <>
                Estimated <Money value={estimatedValue} /> — check availability for SAP&apos;s
                figure
              </>
            ) : (
              "Check availability to see confirmed quantities and dates."
            )}
          </div>

          {availability?.creditBlockExpected ? (
            <p className="flex items-center gap-1.5 rounded-md border border-danger-border bg-danger-subtle px-3 py-1.5 text-[11.5px] text-danger">
              <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
              This order would exceed your credit limit. You can still place it — it will be held
              for our credit team to review.
            </p>
          ) : null}

          <div className="ml-auto flex gap-2">
            {canCreate ? (
              <Button variant="ghost" onClick={() => void saveDraft()} loading={busy === "draft"}>
                Save draft
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => void checkAvailability()}
              loading={busy === "atp"}
              disabled={lines.length === 0}
            >
              Check availability
            </Button>
            {canCreate ? (
              <Button onClick={() => setConfirming(true)} disabled={lines.length === 0}>
                Submit order
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Submit this order?"
        consequence="This creates a sales order in SAP immediately. You'll get an order number straight away, and you can cancel it only until it starts being processed."
        confirmLabel="Submit order"
        busy={busy === "submit"}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      >
        <dl className="rounded-md border border-border bg-background px-3 py-2 text-[12px]">
          <Row label="Items" value={`${lines.length}`} />
          <Row label="Requested delivery" value={requestedDeliveryDate || "—"} />
          <Row label="Your PO ref" value={customerPoRef || "—"} />
        </dl>
      </ConfirmDialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4 shadow-sm md:p-5">
      <h2 className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-danger">{error}</span> : null}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-0.5">
      <dt className="text-text-dim">{label}</dt>
      <dd className="font-medium text-text">{value}</dd>
    </div>
  );
}
