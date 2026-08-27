"use client";

import type { InquiryDraftInput, Material } from "@cc/domain";
import { inquiryRequiredDateIssue } from "@cc/domain";
import { Button, Input, QtyStepper, Select, Textarea } from "@cc/ui";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * Raise Inquiry (docs/03 Screen 3.1, docs/05 §7.3): header (required date,
 * validity), a line-item editor over the catalogue, and free-text
 * requirements with a counter — Draft or Submit.
 *
 * Two decisions worth stating:
 *
 * - **The form carries no price at all.** An inquiry is the question "what
 *   would this cost?", so a price posted from the browser would be the
 *   customer answering it themselves. The quotation is where the price
 *   arrives, and it arrives from SAP.
 * - **The required-date rule is the domain's**, not this component's:
 *   `inquiryRequiredDateIssue` is the same function the service uses, so the
 *   inline message and the server's answer cannot drift apart.
 */

export interface InquiryFormSeed {
  header: Partial<InquiryDraftInput>;
  lines: Array<{ material: string; quantity: number; uom: string }>;
  draftId?: string;
}

interface FormLine {
  key: string;
  material: string;
  quantity: number;
  uom: string;
}

interface ApiIssue {
  field: string;
  message: string;
}

/** STXH-TDLINE, per the registry — the counter docs/05 §7.3 asks for. */
const NOTES_MAX = 2000;

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

export function RaiseInquiryForm({
  seed,
  materials,
  today,
  canCreate,
}: {
  seed: InquiryFormSeed;
  materials: Material[];
  /** Server's date, so the past-date rule doesn't depend on the browser clock. */
  today: string;
  canCreate: boolean;
}) {
  const router = useRouter();

  const [requiredDeliveryDate, setRequiredDeliveryDate] = React.useState(
    seed.header.requiredDeliveryDate ?? "",
  );
  const [validityDays, setValidityDays] = React.useState(
    seed.header.validityDays ? String(seed.header.validityDays) : "",
  );
  const [notes, setNotes] = React.useState(seed.header.notes ?? "");
  const [lines, setLines] = React.useState<FormLine[]>(
    seed.lines.map((line) => ({ ...line, key: newKey() })),
  );
  const [draftId, setDraftId] = React.useState(seed.draftId);

  const [busy, setBusy] = React.useState<"draft" | "submit" | null>(null);
  const [error, setError] = React.useState<string>();
  const [issues, setIssues] = React.useState<ApiIssue[]>([]);
  const [confirming, setConfirming] = React.useState(false);
  const [notice, setNotice] = React.useState<string>();

  const materialsByCode = React.useMemo(
    () => new Map(materials.map((material) => [material.material, material])),
    [materials],
  );

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  const dateIssue = requiredDeliveryDate
    ? inquiryRequiredDateIssue(requiredDeliveryDate, today)
    : null;

  const body = (): InquiryDraftInput & { draftId?: string } => ({
    requiredDeliveryDate: requiredDeliveryDate || undefined,
    validityDays: validityDays ? Number(validityDays) : undefined,
    notes: notes.trim() || undefined,
    lines: lines.map((line) => ({
      material: line.material,
      quantity: line.quantity,
      uom: line.uom,
    })),
    draftId,
  });

  function addLine(material: string) {
    const record = materialsByCode.get(material);
    if (!record) return;
    setNotice(undefined);
    setLines((current) =>
      current.some((line) => line.material === material)
        ? current
        : [
            ...current,
            { key: newKey(), material, quantity: record.minimumOrderQty || 1, uom: record.uom },
          ],
    );
  }

  async function saveDraft() {
    setBusy("draft");
    setError(undefined);
    setIssues([]);
    try {
      const response = await fetch(
        draftId ? `/api/inquiries/drafts/${draftId}` : "/api/inquiries/drafts",
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
      const response = await fetch("/api/inquiries", {
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
      const { inquiry } = (await response.json()) as { inquiry: { vbeln: string } };
      router.push(`/inquiries/${inquiry.vbeln}`);
    } finally {
      setBusy(null);
    }
  }

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

      <Section title="What you need, and when">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            label="Required delivery date"
            required
            error={issueFor("requiredDeliveryDate") ?? dateIssue ?? undefined}
          >
            <Input
              type="date"
              min={today}
              value={requiredDeliveryDate}
              onChange={(event) => setRequiredDeliveryDate(event.target.value)}
            />
          </Field>

          <Field label="Quotation validity" error={issueFor("validityDays")}>
            <Select
              value={validityDays}
              onChange={(event) => setValidityDays(event.target.value)}
              options={[
                { value: "", label: "Whatever's standard" },
                { value: "15", label: "15 days" },
                { value: "30", label: "30 days" },
                { value: "60", label: "60 days" },
                { value: "90", label: "90 days" },
              ]}
            />
          </Field>
        </div>
      </Section>

      <Section title="Items">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-text-dim">
            Nothing to price yet. Add an item below.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line) => {
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
                    onChange={(quantity) =>
                      setLines((current) =>
                        current.map((l) => (l.key === line.key ? { ...l, quantity } : l)),
                      )
                    }
                  />

                  <span className="w-32 text-right text-[11px] text-text-dim">
                    Priced by our sales team
                  </span>

                  <button
                    type="button"
                    aria-label={`Remove ${line.material} from this inquiry`}
                    onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
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

      <Section title="Anything else we should know?">
        <Textarea
          value={notes}
          maxLength={NOTES_MAX}
          rows={4}
          placeholder="Delivery constraints, packing, certifications, the plant it's for…"
          onChange={(event) => setNotes(event.target.value)}
        />
        {issueFor("notes") ? (
          <p className="mt-1 text-[11.5px] text-danger">{issueFor("notes")}</p>
        ) : null}
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur md:left-[52px] lg:left-[222px]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3">
          <p className="text-[12px] text-text-dim">
            {lines.length === 0
              ? "Add at least one item — an inquiry with nothing on it can't be priced."
              : "Our sales team will come back with a quotation you can accept."}
          </p>

          <div className="ml-auto flex gap-2">
            {canCreate ? (
              <Button variant="ghost" onClick={() => void saveDraft()} loading={busy === "draft"}>
                Save draft
              </Button>
            ) : null}
            {canCreate ? (
              <Button
                onClick={() => setConfirming(true)}
                disabled={lines.length === 0 || !requiredDeliveryDate || Boolean(dateIssue)}
              >
                Send inquiry
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Send this inquiry?"
        consequence="This creates an inquiry in SAP immediately and puts it in front of our sales team. They'll reply with a quotation — you're not committing to buy anything."
        confirmLabel="Send inquiry"
        busy={busy === "submit"}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      >
        <dl className="rounded-md border border-border bg-background px-3 py-2 text-[12px]">
          <Row label="Items" value={`${lines.length}`} />
          <Row label="Required by" value={requiredDeliveryDate || "—"} />
          <Row label="Validity" value={validityDays ? `${validityDays} days` : "Standard"} />
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
