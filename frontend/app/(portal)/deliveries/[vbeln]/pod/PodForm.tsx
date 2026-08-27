"use client";

import { podDiscrepancy } from "@cc/domain";
import { Button, FileUpload, Input, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * The POD form (docs/03 Screen 5.2, docs/05 §7.5): "received-qty per line
 * (LFIMG, pre-filled = dispatched, editable), receipt date, discrepancy notes,
 * signed-POD upload. **Confirm Receipt** (green) vs **Report Discrepancy**".
 *
 * There is one submit, not two. Doc 05 draws two buttons, and this renders
 * whichever one is *true* — the moment a quantity is edited below what was
 * dispatched, the primary action relabels itself to Report Discrepancy. The
 * decision is `podDiscrepancy` from @cc/domain, the same function the service
 * uses to decide what actually happened, so the button can never promise
 * something different from what gets recorded (CLAUDE.md rule 3).
 */

export interface PodFormLine {
  lineNo: number;
  material: string;
  description?: string;
  uom: string;
  dispatchedQty: number;
}

interface Issue {
  field: string;
  message: string;
}

export function PodForm({
  vbeln,
  lines,
  actualGoodsIssue,
}: {
  vbeln: string;
  lines: PodFormLine[];
  actualGoodsIssue?: string;
}) {
  const router = useRouter();

  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [receiptDate, setReceiptDate] = React.useState(today);
  const [received, setReceived] = React.useState<Record<number, string>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineNo, String(line.dispatchedQty)])),
  );
  const [notes, setNotes] = React.useState("");
  const [signedPodKey, setSignedPodKey] = React.useState<string>();
  const [uploadState, setUploadState] = React.useState<
    "empty" | "uploading" | "uploaded" | "error"
  >("empty");
  const [uploadError, setUploadError] = React.useState<string>();
  const [uploadedFile, setUploadedFile] = React.useState<{ fileName: string; sizeBytes: number }>();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [issues, setIssues] = React.useState<Issue[]>([]);

  // A field mid-edit ("", "1.") is not a quantity yet. Treating it as the
  // dispatched amount keeps the preview honest rather than flashing a
  // discrepancy warning at someone who is still typing.
  const parsedLines = lines.map((line) => {
    const raw = received[line.lineNo];
    const value = Number(raw);
    return {
      lineNo: line.lineNo,
      receivedQty:
        raw !== undefined && raw !== "" && Number.isFinite(value) ? value : line.dispatchedQty,
    };
  });

  const discrepancy = podDiscrepancy(
    lines.map((line) => ({
      lineNo: line.lineNo,
      material: line.material,
      quantity: line.dispatchedQty,
      uom: line.uom,
      netPrice: 0,
      netValue: 0,
    })),
    parsedLines,
  );

  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;

  async function upload(file: File) {
    setUploadState("uploading");
    setUploadError(undefined);
    const body = new FormData();
    body.append("file", file);

    const response = await demoFetch(`/api/deliveries/${vbeln}/pod/signed`, { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as {
      storageKey?: string;
      error?: string;
    } | null;

    if (!response.ok || !payload?.storageKey) {
      setUploadState("error");
      setUploadError(payload?.error ?? "We couldn't upload that file. Try again.");
      return;
    }

    setSignedPodKey(payload.storageKey);
    setUploadedFile({ fileName: file.name, sizeBytes: file.size });
    setUploadState("uploaded");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setIssues([]);

    try {
      const response = await demoFetch(`/api/deliveries/${vbeln}/pod`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptDate,
          lines: parsedLines,
          notes: notes.trim() === "" ? undefined : notes.trim(),
          signedPodKey,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          issues?: Issue[];
        } | null;
        setError(body?.error ?? "We couldn't record this receipt. Try again in a moment.");
        setIssues(body?.issues ?? []);
        return;
      }

      router.push(`/deliveries/${vbeln}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <section className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <caption className="sr-only">Quantities received</caption>
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Material
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Dispatched
              </th>
              <th scope="col" className="px-4 py-2 text-right font-bold">
                Received
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const comparison = discrepancy.lines.find((l) => l.lineNo === line.lineNo);
              const differs = comparison ? comparison.difference !== 0 : false;

              return (
                <tr key={line.lineNo} className="border-t border-border">
                  <td className="px-4 py-2.5">
                    <span className="font-mono">{line.material}</span>
                    {line.description ? (
                      <span className="mt-0.5 block text-[11.5px] text-text-dim">
                        {line.description}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-mid">
                    {line.dispatchedQty} {line.uom}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        aria-label={`Quantity received of ${line.material}`}
                        aria-invalid={differs || undefined}
                        value={received[line.lineNo] ?? ""}
                        onChange={(e) =>
                          setReceived((prev) => ({ ...prev, [line.lineNo]: e.target.value }))
                        }
                        className="w-28 text-right"
                      />
                      <span className="w-8 text-[11.5px] text-text-dim">{line.uom}</span>
                    </div>
                    {differs && comparison ? (
                      <p className="mt-1 text-right text-[11px] font-medium text-warning">
                        {comparison.short
                          ? `${Math.abs(comparison.difference)} ${line.uom} short`
                          : `${comparison.difference} ${line.uom} over`}
                      </p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="receiptDate"
            className="block text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim"
          >
            Receipt date
          </label>
          <Input
            id="receiptDate"
            type="date"
            value={receiptDate}
            max={today}
            min={actualGoodsIssue}
            onChange={(e) => setReceiptDate(e.target.value)}
            aria-describedby={issueFor("receiptDate") ? "receiptDate-error" : undefined}
            aria-invalid={issueFor("receiptDate") ? true : undefined}
            className="mt-1.5"
            required
          />
          {issueFor("receiptDate") ? (
            <p id="receiptDate-error" role="alert" className="mt-1 text-[11.5px] text-danger">
              {issueFor("receiptDate")}
            </p>
          ) : null}
        </div>

        <FileUpload
          label="Signed POD"
          state={
            uploadState === "uploaded"
              ? "uploaded"
              : uploadState === "uploading"
                ? "uploading"
                : uploadState === "error"
                  ? "error"
                  : "empty"
          }
          file={uploadedFile}
          error={uploadError}
          onSelect={upload}
          onRemove={() => {
            setSignedPodKey(undefined);
            setUploadedFile(undefined);
            setUploadState("empty");
          }}
        />
      </div>

      <div>
        <label
          htmlFor="notes"
          className="block text-[11.5px] font-bold uppercase tracking-[0.6px] text-text-dim"
        >
          Notes
        </label>
        <Textarea
          id="notes"
          value={notes}
          maxLength={2000}
          rows={3}
          placeholder={
            discrepancy.hasDiscrepancy
              ? "What was wrong with the delivery? This goes straight to our team."
              : "Anything you'd like to add (optional)."
          }
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1.5"
        />
      </div>

      {/* The honest version of doc 05's two buttons: what happens is decided
          by the quantities, so the label follows them. */}
      {discrepancy.hasDiscrepancy ? (
        <p className="rounded-md border border-warning-border bg-warning-subtle px-4 py-2.5 text-[12.5px] text-text-mid">
          The quantities you&apos;ve entered don&apos;t match what was dispatched. Submitting will
          report a discrepancy and raise it with our team — the receipt is still recorded.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || uploadState === "uploading"}>
          {busy
            ? "Recording…"
            : discrepancy.hasDiscrepancy
              ? "Report discrepancy"
              : "Confirm receipt"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(`/deliveries/${vbeln}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
