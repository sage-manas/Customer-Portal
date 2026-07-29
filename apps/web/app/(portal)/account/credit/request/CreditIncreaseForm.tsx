"use client";

import { CREDIT_INCREASE_MAX_MULTIPLE, creditIncreaseIssue } from "@cc/domain";
import { Button, Input, Money, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The credit-increase form (docs/05 §7.9: "requested amount + justification").
 *
 * The live hint under the amount comes from `creditIncreaseIssue` in
 * `@cc/domain` — the *same* function the service refuses on. The client-side
 * check is a courtesy that lets a customer correct an extra zero while typing;
 * it is not a second rule that could drift from the first (CLAUDE.md rule 3).
 */

interface FieldIssue {
  field: string;
  message: string;
}

const JUSTIFICATION_MIN = 20;
const JUSTIFICATION_MAX = 1000;

export function CreditIncreaseForm({ currentLimit }: { currentLimit: number }) {
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const parsedAmount = Number(amount);
  const amountEntered = amount.trim() !== "" && Number.isFinite(parsedAmount);
  const localIssue = amountEntered ? creditIncreaseIssue(parsedAmount, currentLimit) : null;

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch("/api/account/credit/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedLimit: parsedAmount, justification }),
      });

      const body = (await response.json()) as {
        id?: string;
        error?: string;
        issues?: FieldIssue[];
      };

      if (!response.ok || !body.id) {
        setError(body.error ?? "We couldn't send that request.");
        setIssues(body.issues ?? []);
        return;
      }

      router.push("/account");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">New limit you&apos;d like (₹)</span>
        <Input
          type="number"
          inputMode="numeric"
          min={1}
          // `step="any"`, not a round increment: a step of 1000 against a min
          // of 1 makes every figure that isn't 1 mod 1000 fail the browser's
          // own constraint check, which blocks the submit *silently* — no
          // message, no request, a button that appears not to work.
          step="any"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          aria-describedby="amount-hint"
          className="max-w-[16rem] font-mono"
        />
        <span id="amount-hint" className="text-[11px] text-text-dim">
          Your limit today is <Money value={currentLimit} className="text-[11px]" />. Ask for more
          than that, and no more than {CREDIT_INCREASE_MAX_MULTIPLE}× it.
        </span>
        {localIssue ? <span className="text-[11px] text-danger">{localIssue}</span> : null}
        {issueFor("requestedLimit") ? (
          <span className="text-[11px] text-danger">{issueFor("requestedLimit")}</span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-semibold text-text">Why do you need it?</span>
        <Textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={5}
          minLength={JUSTIFICATION_MIN}
          maxLength={JUSTIFICATION_MAX}
          required
          placeholder="New contract, a seasonal peak, a second line coming on stream — whatever will help our credit team decide."
        />
        <span className="text-[11px] text-text-dim tabular-nums">
          {justification.trim().length}/{JUSTIFICATION_MAX}
        </span>
        {issueFor("justification") ? (
          <span className="text-[11px] text-danger">{issueFor("justification")}</span>
        ) : null}
      </label>

      <p className="rounded-md border border-border bg-background px-4 py-2.5 text-[11.5px] text-text-mid">
        We&apos;ll review this and come back to you. An approval here is our credit team&apos;s
        decision — your limit changes once they apply it in our system, so hold off on ordering
        against the new figure until you see it on this page.
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={submitting || localIssue !== null}>
          {submitting ? "Sending…" : "Send request"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/account")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
